"use server";

// Company team management by the company OWNER (BRD C1, B14, B23, B28, B29; docs/ARCHITECTURE.md §1
// "Invite users", §2.2 access_links, §6 Team). Every action: assertCompanyAccess(companyId, ["owner"]) and
// the company must be active (canManageCompanyTeam) → zod → memberships with the owner's RLS client
// (contributor rows of their own active company only) → Auth / links through @/lib/auth-admin
// (service role) → audit entries as the owner (with their company id) → revalidate.
// BRD B29: owners invite NEW contributors, up to the contributor limit — checked before any Auth account
// is created, with the database trigger as the backstop — and send invitation links only to people who
// have not joined yet. Anyone who also reaches another company is simply added and signs in as usual;
// sign-in links come from ScaleUp (BRD B23).
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { contributorAllowance } from "./_components/team-model";
import { ActionError, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import {
  ensureAuthUser,
  getAccessLink,
  getAuthUser,
  isOwnerLinkRefusal,
  revokeAccessLink,
  revokeUserAccessLinks,
} from "@/lib/auth-admin";
import { issueLinkWithAudit, logAccessEvent } from "@/lib/auth-admin/audit";
import {
  inviteContributorSchema,
  teamLinkSchema,
  teamMemberActiveSchema,
  teamMemberLinkSchema,
} from "@/lib/auth-admin/schemas";
import { ACCESS_LINK_PURPOSE_LABELS, displayName, nameWithEmail } from "@/lib/auth-admin/status";
import type { InviteOutcome } from "@/lib/auth-admin/types";
import { isBannedUntil } from "@/lib/auth-admin/users";
import { canManageCompanyTeam, membershipFor } from "@/lib/auth/permissions";
import { assertCompanyAccess, type CompanyAccessContext } from "@/lib/auth/session";
import { getClientSettings } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRole } from "@/lib/types/enums";

type Sb = SupabaseClient<Database>;

/** A member of the company as the owner reads it (RLS: the profiles of company-side co-members). */
type TeamRow = {
  user_id: string;
  role: CompanyRole;
  is_active: boolean;
  profile: { email: string } | null;
};

type MemberRow = {
  user_id: string;
  role: CompanyRole;
  is_active: boolean;
  profile: { email: string; full_name: string | null; is_active: boolean; terms_accepted_at: string | null } | null;
};

const teamPath = (companyId: string) => `/portal/${companyId}/team`;

/** The company id of an action's input, before it is validated (for the access check). */
function companyIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null && "companyId" in input) {
    const value = (input as { companyId: unknown }).companyId;
    if (typeof value === "string") return value;
  }
  return "";
}

/** Owner of an ACTIVE company (exited / written-off companies are read-only, BRD B15). */
async function assertTeamOwner(companyId: string): Promise<CompanyAccessContext & { companyName: string }> {
  const ctx = await assertCompanyAccess(companyId, ["owner"]);
  const membership = membershipFor(ctx, companyId);
  const companyName = membership?.companyName ?? "This company";
  if (!canManageCompanyTeam(ctx, companyId)) {
    throw new ActionError(`${companyName} is no longer an active portfolio company, so its team can't be changed.`);
  }
  return { ...ctx, companyName };
}

/** Owners are managed by ScaleUp: an owner's email address can't be invited as a contributor. */
function assertNotOwner(member: { role: CompanyRole; is_active: boolean }, fullName: string, companyName: string): void {
  if (member.role !== "owner") return;
  throw new ActionError(
    member.is_active
      ? `${fullName} is already an owner of ${companyName}.`
      : `${fullName} used to be an owner of ${companyName}. Ask ScaleUp to restore their access.`,
    { email: "Already an owner of this company." },
  );
}

/**
 * BRD B29: refuses, with the reason the Team page shows, when the owners have no contributor place
 * left. The database trigger (`company_members_contributor_limit`, P0001) still refuses whatever gets
 * past this check, e.g. two owners taking the last place at the same moment.
 */
function assertContributorPlaceLeft(team: readonly TeamRow[], limit: number): void {
  const { blockedReason } = contributorAllowance(team, limit);
  if (blockedReason) throw new ActionError(blockedReason);
}

/**
 * Invites a NEW contributor to the owner's company: checks the contributor limit (BRD B29) BEFORE
 * creating (or reusing) the Auth account, so a refused invitation leaves no orphan account; then adds (or
 * reactivates) the contributor membership as the owner and, for someone who has never signed in, issues
 * a 7-day invitation link. When the database refuses the owner's link (the person also reaches another
 * company, BRD B29) they are still added and simply sign in as usual.
 */
export async function inviteContributorAction(input: unknown): Promise<ActionResult<InviteOutcome>> {
  try {
    const ctx = await assertTeamOwner(companyIdOf(input));
    const values = inviteContributorSchema.parse(input);
    const sb = await createClient();
    const { companyName } = ctx;

    if (values.email === ctx.email.trim().toLowerCase()) {
      throw new ActionError("That's your own email address.", { email: "Enter the new team member's email address." });
    }

    // Before anything is created: is this person already on the team, and is there a place left?
    const [team, settings] = await Promise.all([loadTeam(sb, values.companyId), getClientSettings(sb)]);
    const known = team.find((member) => member.profile?.email.toLowerCase() === values.email) ?? null;
    if (known) assertNotOwner(known, values.fullName, companyName);
    const alreadyActiveContributor = known?.role === "contributor" && known.is_active;
    if (!alreadyActiveContributor) assertContributorPlaceLeft(team, settings.owner_contributor_limit);

    const { user, created } = await ensureAuthUser({ email: values.email, fullName: values.fullName });
    if (!created && isBannedUntil(user.banned_until)) {
      throw new ActionError("This email address belongs to an account that has been deactivated. Ask ScaleUp to reactivate it.", {
        email: "This account has been deactivated.",
      });
    }
    const hasSignedIn = !created && Boolean(user.last_sign_in_at);

    const { data: existingData, error: existingError } = await sb
      .from("company_members")
      .select("role, is_active")
      .eq("company_id", values.companyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) throw existingError;
    const existing: { role: CompanyRole; is_active: boolean } | null = existingData;

    if (existing) assertNotOwner(existing, values.fullName, companyName);
    if (existing?.is_active && hasSignedIn) {
      throw new ActionError(`${values.fullName} is already on your team.`, { email: "Already on your team." });
    }
    if (existing && !existing.is_active) {
      const { error } = await sb
        .from("company_members")
        .update({ is_active: true })
        .eq("company_id", values.companyId)
        .eq("user_id", user.id)
        .eq("role", "contributor");
      if (error) throw error; // P0001 from the contributor limit (BRD B29) is shown as-is
    } else if (!existing) {
      const { error } = await sb
        .from("company_members")
        .insert({ company_id: values.companyId, user_id: user.id, role: "contributor" });
      if (error) {
        // RLS: owners may only add company-side accounts (never ScaleUp staff) as contributors.
        if (error.code === "42501") {
          throw new ActionError("This email address can't be added to your team. Ask ScaleUp for help.", {
            email: "This email address can't be added.",
          });
        }
        throw error; // P0001 from the contributor limit (BRD B29) is shown as-is
      }
    }

    const who = nameWithEmail(values.fullName, values.email);
    let outcome: InviteOutcome = { userId: user.id, name: values.fullName, email: values.email, link: null, notice: null };
    if (!hasSignedIn) {
      try {
        const link = await issueLinkWithAudit(sb, {
          userId: user.id,
          purpose: "invite",
          createdBy: ctx.userId,
          companyId: values.companyId,
          summary: `Invited ${who} to ${companyName} as Contributor`,
          data: { company_role: "contributor" },
        });
        outcome = { ...outcome, link };
      } catch (linkError) {
        if (!isOwnerLinkRefusal(linkError)) throw linkError;
        outcome = {
          ...outcome,
          notice: `${values.fullName} has been added to your team. They already have an account, so they don't need an invitation: ask them to sign in as usual. If they can't sign in, ScaleUp can send them a sign-in link.`,
        };
      }
    } else {
      outcome = {
        ...outcome,
        notice: `${values.fullName} has been added to your team. They already have an account: ask them to sign in as usual. ${companyName} now appears in their company list.`,
      };
    }
    if (!outcome.link) {
      await logAccessEvent(sb, {
        action: "invite",
        userId: user.id,
        companyId: values.companyId,
        summary: `Added ${who} to ${companyName} as Contributor (existing account, no link)`,
        data: { company_role: "contributor", link_issued: false },
      });
    }

    revalidatePath(teamPath(values.companyId));
    return ok(outcome);
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Issues a new INVITATION link for an active contributor who has not joined yet (BRD B29). Whoever holds
 * a link can sign in as the person, so owners never get links for someone who has signed in: they sign
 * in as usual, or ScaleUp sends them a sign-in link (BRD B23). The database also refuses an owner's link
 * for anyone who reaches another company; its message ("Only ScaleUp can send this person a link, …")
 * is shown as-is.
 */
export async function issueContributorLinkAction(input: unknown): Promise<ActionResult<InviteOutcome>> {
  try {
    const ctx = await assertTeamOwner(companyIdOf(input));
    const { companyId, userId, purpose } = teamMemberLinkSchema.parse(input);
    const sb = await createClient();

    const member = await loadMember(sb, companyId, userId);
    if (!member || member.role !== "contributor" || !member.is_active || !member.profile) {
      throw new ActionError("You can only send invitation links to active contributors of your company.");
    }
    if (!member.profile.is_active) throw new ActionError("This account has been deactivated. Ask ScaleUp for help.");
    const name = displayName(member.profile.full_name, member.profile.email);
    const joined = member.profile.terms_accepted_at !== null || Boolean((await getAuthUser(userId))?.lastSignInAt);
    if (joined) {
      throw new ActionError(
        `${name} already has an account: ask them to sign in as usual. If they can't, ScaleUp can send them a sign-in link.`,
      );
    }

    const who = nameWithEmail(member.profile.full_name, member.profile.email);
    const link = await issueLinkWithAudit(sb, {
      userId,
      purpose,
      createdBy: ctx.userId,
      companyId,
      summary: `Issued a new invitation link for ${who} (${ctx.companyName})`,
    });

    revalidatePath(teamPath(companyId));
    return ok({ userId, name, email: member.profile.email, link, notice: null });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Revokes a pending link of one of the company's contributors that one of its owners sent (links sent
 * by ScaleUp are revoked by ScaleUp). Recorded as `invite_revoke`.
 */
export async function revokeTeamLinkAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await assertTeamOwner(companyIdOf(input));
    const { companyId, linkId } = teamLinkSchema.parse(input);
    const sb = await createClient();

    const link = await getAccessLink(linkId);
    if (!link || link.usedAt || link.revokedAt) throw new ActionError("This link has already been used or cancelled.");

    const team = await loadTeam(sb, companyId);
    const target = team.find((member) => member.user_id === link.userId);
    const sentByOwner = link.createdBy !== null && team.some((m) => m.user_id === link.createdBy && m.role === "owner");
    if (!target || target.role !== "contributor" || !sentByOwner) {
      throw new ActionError("Only ScaleUp can cancel this link.");
    }

    const revoked = await revokeAccessLink(link.id);
    if (!revoked) throw new ActionError("This link has already been used or cancelled.");

    const member = await loadMember(sb, companyId, link.userId);
    const who = member?.profile ? nameWithEmail(member.profile.full_name, member.profile.email) : "a contributor";
    await logAccessEvent(sb, {
      action: "invite_revoke",
      userId: link.userId,
      companyId,
      summary: `Revoked the pending ${ACCESS_LINK_PURPOSE_LABELS[link.purpose].toLowerCase()} for ${who} (${ctx.companyName})`,
      data: { link_id: link.id, purpose: link.purpose },
    });

    revalidatePath(teamPath(companyId));
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Deactivates or reactivates a contributor's access to the company (the membership; never deleted).
 * Reactivating takes a contributor place, so it is refused when none is left (BRD B29; the database
 * trigger is the backstop). Pending links this company's owners sent are revoked on deactivation.
 */
export async function setContributorActiveAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await assertTeamOwner(companyIdOf(input));
    const { companyId, userId, active } = teamMemberActiveSchema.parse(input);
    if (userId === ctx.userId) throw new ActionError("You can't change your own access.");
    const sb = await createClient();

    if (active) {
      const [team, settings] = await Promise.all([loadTeam(sb, companyId), getClientSettings(sb)]);
      const target = team.find((member) => member.user_id === userId);
      if (target?.role === "contributor" && !target.is_active) {
        assertContributorPlaceLeft(team, settings.owner_contributor_limit);
      }
    }

    const { data, error } = await sb
      .from("company_members")
      .update({ is_active: active })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("role", "contributor")
      .select("user_id")
      .maybeSingle();
    if (error) throw error; // P0001 from the contributor limit (BRD B29) is shown as-is
    if (!data) throw new ActionError("Only contributors of your company can be changed here.");

    if (!active) {
      const { data: ownersData, error: ownersError } = await sb
        .from("company_members")
        .select("user_id")
        .eq("company_id", companyId)
        .eq("role", "owner");
      if (ownersError) throw ownersError;
      const ownerIds: { user_id: string }[] = ownersData;
      await revokeUserAccessLinks(userId, { createdBy: ownerIds.map((owner) => owner.user_id) }).catch(
        (revokeError: unknown) => console.error("[team] could not revoke pending links", errorCode(revokeError)),
      );
    }

    revalidatePath(teamPath(companyId));
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Every member of the company with their email where the owner can read it (RLS). */
async function loadTeam(sb: Sb, companyId: string): Promise<TeamRow[]> {
  const { data, error } = await sb
    .from("company_members")
    .select("user_id, role, is_active, profile:profiles!company_members_user_id_fkey(email)")
    .eq("company_id", companyId);
  if (error) throw error;
  return data.map(({ profile, ...member }): TeamRow => ({ ...member, profile: profile ?? null }));
}

async function loadMember(sb: Sb, companyId: string, userId: string): Promise<MemberRow | null> {
  const { data, error } = await sb
    .from("company_members")
    .select(
      "user_id, role, is_active, profile:profiles!company_members_user_id_fkey(email, full_name, is_active, terms_accepted_at)",
    )
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { profile, ...member } = data;
  const row: MemberRow = { ...member, profile: profile ?? null };
  return row;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
}
