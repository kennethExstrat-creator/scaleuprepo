"use server";

// Super Admin user management (BRD A2, B11, B14, B22, B23; docs/ARCHITECTURE.md §1, §2.2 access_links).
// Every action: assertScaleUp(["super_admin"]) → zod → business rows with the caller's RLS client
// (profiles through admin_update_profile, memberships through company_members) → Supabase Auth and
// access links through @/lib/auth-admin (service role) → audit entries as the caller → revalidate.
// Nobody is ever hard-deleted (B22): accounts are deactivated and banned.
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import {
  ensureAuthUser,
  getAccessLink,
  resetUserMfa,
  revokeAccessLink,
  revokeUserAccessLinks,
  setUserBanned,
} from "@/lib/auth-admin";
import { issueLinkWithAudit, logAccessEvent } from "@/lib/auth-admin/audit";
import {
  inviteCompanyUserSchema,
  inviteScaleUpUserSchema,
  issueUserLinkSchema,
  linkIdSchema,
  setUserActiveSchema,
  updateMembershipSchema,
  updateScaleUpUserSchema,
  userIdSchema,
} from "@/lib/auth-admin/schemas";
import {
  ACCESS_LINK_PURPOSE_LABELS,
  companyInviteConflict,
  displayName,
  nameWithEmail,
  scaleUpInviteConflict,
} from "@/lib/auth-admin/status";
import type { InviteOutcome } from "@/lib/auth-admin/types";
import { assertScaleUp } from "@/lib/auth/session";
import { COMPANY_ROLE_LABELS, SCALEUP_ROLE_LABELS } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRole, CompanyStatus, ScaleupRole } from "@/lib/types/enums";

type Sb = SupabaseClient<Database>;

const USERS_PATH = "/admin/users";

type AccountRow = {
  id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  scaleup_role: ScaleupRole | null;
  is_active: boolean;
};

type MembershipRow = {
  company_id: string;
  role: CompanyRole;
  is_active: boolean;
  company: { name: string } | { name: string }[] | null;
};

type CompanyRow = { id: string; name: string; status: CompanyStatus };

// ---------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------

/**
 * Invites a ScaleUp team member: creates (or reuses) the Auth account, sets name, job title and role
 * with `admin_update_profile` as the caller, issues a 7-day invitation link and records `invite`.
 * Refuses company users' email addresses (one account is never both) and accounts that already use
 * ScaleUp (edit them or send a sign-in link instead). Re-inviting someone who never signed in replaces
 * their earlier invitation link.
 */
export async function inviteScaleUpUserAction(input: unknown): Promise<ActionResult<InviteOutcome>> {
  try {
    const ctx = await assertScaleUp(["super_admin"]);
    const values = inviteScaleUpUserSchema.parse(input);
    const sb = await createClient();

    const { user, created } = await ensureAuthUser({ email: values.email, fullName: values.fullName });
    if (!created) {
      const existing = await findAccount(sb, user.id);
      if (existing) {
        const memberships = await loadMemberships(sb, existing.id);
        const conflict = scaleUpInviteConflict({
          scaleupRole: existing.scaleup_role,
          memberships: memberships.map((m) => ({ companyName: companyName(m) })),
        });
        if (conflict) throw new ActionError(conflict, { email: conflict });
        const who = displayName(existing.full_name, existing.email);
        if (!existing.is_active) {
          throw new ActionError(`${who}'s account is deactivated. Reactivate it on the ScaleUp team tab instead.`, {
            email: "This account is deactivated.",
          });
        }
        if (existing.scaleup_role && user.last_sign_in_at) {
          throw new ActionError(
            `${who} already uses ScaleUp Reporting as ${SCALEUP_ROLE_LABELS[existing.scaleup_role]}. Use "Edit details" to change their role, or "Send sign-in link" if they can't sign in.`,
            { email: "This person already has a ScaleUp account." },
          );
        }
      }
    }

    const { error: profileError } = await sb.rpc("admin_update_profile", {
      p_user_id: user.id,
      p_full_name: values.fullName,
      p_job_title: values.jobTitle,
      p_scaleup_role: values.role,
    });
    if (profileError) throw profileError;

    const link = await issueLinkWithAudit(sb, {
      userId: user.id,
      purpose: "invite",
      createdBy: ctx.userId,
      summary: `Invited ${nameWithEmail(values.fullName, values.email)} as ${SCALEUP_ROLE_LABELS[values.role]}`,
      data: { scaleup_role: values.role },
    });

    revalidatePath(USERS_PATH);
    return ok({ userId: user.id, name: values.fullName, email: values.email, link, notice: null });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Invites a company owner or contributor, or adds an existing company-side account to another company.
 * The membership is written with the caller's RLS client. A 7-day invitation link is issued only when
 * the person has never signed in; anyone else just signs in as usual and sees the new company.
 * Refuses ScaleUp staff email addresses, deactivated accounts and companies that are no longer active.
 */
export async function inviteCompanyUserAction(input: unknown): Promise<ActionResult<InviteOutcome>> {
  try {
    const ctx = await assertScaleUp(["super_admin"]);
    const values = inviteCompanyUserSchema.parse(input);
    const sb = await createClient();

    const company = await loadCompany(sb, values.companyId);
    if (company.status !== "active") {
      throw new ActionError(`${company.name} is no longer an active portfolio company, so no one new can be added to it.`, {
        companyId: "Choose an active company.",
      });
    }

    const { user, created } = await ensureAuthUser({ email: values.email, fullName: values.fullName });
    const existing = created ? null : await findAccount(sb, user.id);
    if (existing) {
      const conflict = companyInviteConflict({ scaleupRole: existing.scaleup_role, memberships: [] });
      if (conflict) throw new ActionError(conflict, { email: conflict });
      if (!existing.is_active) {
        const who = displayName(existing.full_name, existing.email);
        throw new ActionError(`${who}'s account is deactivated. Reactivate it on the Company users tab first.`, {
          email: "This account is deactivated.",
        });
      }
    }
    const name = existing?.full_name?.trim() || values.fullName;
    const hasSignedIn = !created && Boolean(user.last_sign_in_at);

    const { data: membershipData, error: membershipError } = await sb
      .from("company_members")
      .select("role, is_active")
      .eq("company_id", company.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const membership: { role: CompanyRole; is_active: boolean } | null = membershipData;

    if (membership?.is_active && membership.role === values.role && hasSignedIn) {
      throw new ActionError(`${name} is already on ${company.name}'s team as ${COMPANY_ROLE_LABELS[values.role]}.`, {
        email: "Already a member of this company.",
      });
    }
    if (membership) {
      if (!membership.is_active || membership.role !== values.role) {
        const { error } = await sb
          .from("company_members")
          .update({ role: values.role, is_active: true })
          .eq("company_id", company.id)
          .eq("user_id", user.id);
        if (error) throw error;
      }
    } else {
      const { error } = await sb
        .from("company_members")
        .insert({ company_id: company.id, user_id: user.id, role: values.role });
      if (error) throw error;
    }

    const who = nameWithEmail(name, values.email);
    const roleLabel = COMPANY_ROLE_LABELS[values.role];
    let outcome: InviteOutcome;
    if (hasSignedIn) {
      await logAccessEvent(sb, {
        action: "invite",
        userId: user.id,
        companyId: company.id,
        summary: `Added ${who} to ${company.name} as ${roleLabel} (existing account, no link needed)`,
        data: { company_role: values.role, link_issued: false },
      });
      outcome = {
        userId: user.id,
        name,
        email: values.email,
        link: null,
        notice: `${name} already has an account, so no invitation link is needed. They can sign in as usual and will now see ${company.name}.`,
      };
    } else {
      const link = await issueLinkWithAudit(sb, {
        userId: user.id,
        purpose: "invite",
        createdBy: ctx.userId,
        companyId: company.id,
        summary: `Invited ${who} to ${company.name} as ${roleLabel}`,
        data: { company_role: values.role },
      });
      outcome = { userId: user.id, name, email: values.email, link, notice: null };
    }

    revalidatePath(USERS_PATH);
    return ok(outcome);
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

/** Changes a ScaleUp team member's name, job title and role (`admin_update_profile` as the caller). */
export async function updateScaleUpUserAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = updateScaleUpUserSchema.parse(input);
    const sb = await createClient();

    const account = await getAccount(sb, values.userId);
    if (!account.scaleup_role) {
      throw new ActionError("This is a company user. Manage their companies on the Company users tab.");
    }
    const { error } = await sb.rpc("admin_update_profile", {
      p_user_id: account.id,
      p_full_name: values.fullName,
      p_job_title: values.jobTitle,
      p_scaleup_role: values.role,
    });
    if (error) throw error;

    revalidatePath(USERS_PATH);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Deactivates or reactivates an account (BRD B22: never deleted). The profile changes first
 * (`admin_update_profile`, so the database hides everything at once), then Supabase Auth blocks or
 * allows signing in; a deactivated account's pending links are revoked.
 */
export async function setUserActiveAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await assertScaleUp(["super_admin"]);
    const { userId, active } = setUserActiveSchema.parse(input);
    if (userId === ctx.userId) throw new ActionError("You can't deactivate or reactivate your own account.");
    const sb = await createClient();

    const account = await getAccount(sb, userId);
    const { error } = await sb.rpc("admin_update_profile", {
      p_user_id: account.id,
      p_full_name: account.full_name ?? "",
      p_job_title: account.job_title ?? "",
      p_scaleup_role: account.scaleup_role ?? undefined,
      p_is_active: active,
    });
    if (error) throw error;

    try {
      await setUserBanned(account.id, !active);
    } catch (banError) {
      console.error("[users] could not update the sign-in block", errorCode(banError));
      throw new ActionError(
        active
          ? "The account was reactivated, but signing in is still blocked. Please try again."
          : "The account was deactivated and can no longer see any data, but we couldn't block signing in. Please try again.",
      );
    }
    if (!active) {
      await revokeUserAccessLinks(account.id).catch((revokeError: unknown) =>
        console.error("[users] could not revoke the pending links of a deactivated account", errorCode(revokeError)),
      );
    }

    revalidatePath(USERS_PATH);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Resets two-factor authentication (BRD B11): removes every authenticator, which also signs the person
 * out everywhere; they set up a new one at their next sign-in. Recorded as `mfa_reset` (first, so the
 * reset is never unrecorded).
 */
export async function resetUserMfaAction(input: unknown): Promise<ActionResult<{ removed: number }>> {
  try {
    const ctx = await assertScaleUp(["super_admin"]);
    const { userId } = userIdSchema.parse(input);
    if (userId === ctx.userId) {
      throw new ActionError("You can't reset your own two-factor authentication. Ask another Super Admin.");
    }
    const sb = await createClient();

    const account = await getAccount(sb, userId);
    await logAccessEvent(sb, {
      action: "mfa_reset",
      userId: account.id,
      summary: `Reset two-factor authentication for ${nameWithEmail(account.full_name, account.email)}`,
    });
    const removed = await resetUserMfa(account.id);

    revalidatePath(USERS_PATH);
    return ok({ removed });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Issues a new link for an account: an invitation (7 days) for someone who never signed in, or a
 * sign-in link (24 hours, BRD B23: forgotten password). Earlier pending links of the same kind stop
 * working. Recorded as `invite` / `sign_in_link`.
 */
export async function issueUserLinkAction(input: unknown): Promise<ActionResult<InviteOutcome>> {
  try {
    const ctx = await assertScaleUp(["super_admin"]);
    const { userId, purpose } = issueUserLinkSchema.parse(input);
    if (userId === ctx.userId) throw new ActionError("You can't create a link for your own account.");
    const sb = await createClient();

    const account = await getAccount(sb, userId);
    const name = displayName(account.full_name, account.email);
    if (!account.is_active) throw new ActionError(`${name}'s account is deactivated. Reactivate it first.`);

    const who = nameWithEmail(account.full_name, account.email);
    const link = await issueLinkWithAudit(sb, {
      userId: account.id,
      purpose,
      createdBy: ctx.userId,
      summary: purpose === "invite" ? `Issued a new invitation link for ${who}` : `Issued a sign-in link for ${who}`,
    });

    revalidatePath(USERS_PATH);
    return ok({ userId: account.id, name, email: account.email, link, notice: null });
  } catch (e) {
    return toActionError(e);
  }
}

/** Revokes a pending invitation or sign-in link. Recorded as `invite_revoke`. */
export async function revokeAccessLinkAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const { linkId } = linkIdSchema.parse(input);
    const sb = await createClient();

    const link = await getAccessLink(linkId);
    if (!link) throw new ActionError(MESSAGES.notFound);
    const account = await getAccount(sb, link.userId);
    const revoked = await revokeAccessLink(link.id);
    if (!revoked) throw new ActionError("This link has already been used or revoked.");

    await logAccessEvent(sb, {
      action: "invite_revoke",
      userId: account.id,
      summary: `Revoked the pending ${ACCESS_LINK_PURPOSE_LABELS[link.purpose].toLowerCase()} for ${nameWithEmail(account.full_name, account.email)}`,
      data: { link_id: link.id, purpose: link.purpose },
    });

    revalidatePath(USERS_PATH);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Company memberships
// ---------------------------------------------------------------------------------------------

/**
 * Changes a company membership's role (owner / contributor) and/or switches it off or on again (never
 * deleted). Written with the caller's RLS client (row-audited). ScaleUp staff never get memberships.
 */
export async function updateMembershipAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = updateMembershipSchema.parse(input);
    const sb = await createClient();

    const account = await getAccount(sb, values.userId);
    if (account.scaleup_role && values.active !== false) {
      throw new ActionError("ScaleUp staff can't be company members: they already see every company.");
    }
    const patch: { role?: CompanyRole; is_active?: boolean } = {};
    if (values.role !== undefined) patch.role = values.role;
    if (values.active !== undefined) patch.is_active = values.active;

    const { data, error } = await sb
      .from("company_members")
      .update(patch)
      .eq("company_id", values.companyId)
      .eq("user_id", values.userId)
      .select("company_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ActionError(MESSAGES.notFound);

    revalidatePath(USERS_PATH);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers (RLS client: a Super Admin reads every profile, membership and company)
// ---------------------------------------------------------------------------------------------

async function findAccount(sb: Sb, userId: string): Promise<AccountRow | null> {
  const { data, error } = await sb
    .from("profiles")
    .select("id, email, full_name, job_title, scaleup_role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const account: AccountRow | null = data;
  return account;
}

async function getAccount(sb: Sb, userId: string): Promise<AccountRow> {
  const account = await findAccount(sb, userId);
  if (!account) throw new ActionError("That user was not found. Please reload the page and try again.");
  return account;
}

async function loadMemberships(sb: Sb, userId: string): Promise<MembershipRow[]> {
  const { data, error } = await sb
    .from("company_members")
    .select("company_id, role, is_active, company:companies(name)")
    .eq("user_id", userId);
  if (error) throw error;
  const rows: MembershipRow[] = data;
  return rows;
}

async function loadCompany(sb: Sb, companyId: string): Promise<CompanyRow> {
  const { data, error } = await sb.from("companies").select("id, name, status").eq("id", companyId).maybeSingle();
  if (error) throw error;
  const company: CompanyRow | null = data;
  if (!company) {
    throw new ActionError("That company was not found. Please reload the page and try again.", {
      companyId: "Choose a company.",
    });
  }
  return company;
}

function companyName(row: MembershipRow): string {
  const company = Array.isArray(row.company) ? row.company[0] : row.company;
  return company?.name ?? "a company";
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
}
