/**
 * Test-data set-up and teardown with the service role. Only ever touches the dedicated E2E accounts
 * (helpers/accounts.ts) and the company named "E2E Test Co (automated)".
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import {
  ACCOUNTS,
  E2E_COMPANY,
  INVITEE,
  OTHER_COMPANY_NAME,
  ROLES,
  assertE2EEmail,
  type AccountSpec,
  type Role,
} from "./accounts";
import { apiSignOut } from "./api-user";
import { must, publicClient, type AnyClient } from "./supabase";
import { nextTotpCode } from "./totp-ledger";
import type { RunState, UserState } from "./state";

const BAN_FOREVER = "876000h";
const DOCUMENTS_BUCKET = "company-documents";

export function generatePassword(): string {
  // 32 random url-safe characters plus one of each class, well above the 12-character minimum.
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

export async function findAuthUserByEmail(admin: AnyClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function deleteAllFactors(admin: AnyClient, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`mfa.listFactors failed: ${error.message}`);
  let removed = 0;
  for (const factor of data.factors) {
    const del = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (del.error) throw new Error(`mfa.deleteFactor failed: ${del.error.message}`);
    removed += 1;
  }
  return removed;
}

async function setProfile(
  admin: AnyClient,
  userId: string,
  spec: { fullName: string; scaleupRole: string | null },
  active: boolean,
): Promise<void> {
  const args: Record<string, unknown> = {
    p_user_id: userId,
    p_full_name: spec.fullName,
    p_job_title: "Automated E2E test account",
    p_is_active: active,
  };
  if (spec.scaleupRole) args.p_scaleup_role = spec.scaleupRole;
  must(await admin.rpc("admin_update_profile", args), `admin_update_profile(${spec.fullName})`);
}

/**
 * Creates or resets one E2E account: new random password, confirmed, unbanned, active profile with
 * the right ScaleUp role, no MFA factors, then (signed in like a browser) a verified TOTP factor whose
 * secret the suite keeps. Every account but the owner also accepts the current terms (flow 1 shows
 * the owner the terms page).
 */
export async function resetAccount(admin: AnyClient, spec: AccountSpec, termsVersion: string, runId: string): Promise<UserState> {
  assertE2EEmail(spec.email);
  const password = generatePassword();
  let user = await findAuthUserByEmail(admin, spec.email);
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: spec.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    });
    if (created.error || !created.data.user) throw new Error(`createUser(${spec.email}) failed: ${created.error?.message}`);
    user = created.data.user;
  } else {
    const updated = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      ban_duration: "none",
      user_metadata: { full_name: spec.fullName },
    });
    if (updated.error) throw new Error(`updateUserById(${spec.email}) failed: ${updated.error.message}`);
  }
  const userId = user.id;

  await setProfile(admin, userId, spec, true);
  await deleteAllFactors(admin, userId);

  // Terms: the owner sees the terms page in flow 1; everyone else has accepted them (below).
  must(
    await admin.from("profiles").update({ terms_accepted_at: null, terms_version: null }).eq("id", userId),
    `reset terms of ${spec.email}`,
  );

  const state: UserState = {
    role: spec.role,
    id: userId,
    email: spec.email,
    fullName: spec.fullName,
    password,
    totpSecret: null,
  };

  // Enrol and verify TOTP as the user (publishable key), like the /mfa page does.
  const sb = publicClient();
  try {
    const signIn = await sb.auth.signInWithPassword({ email: spec.email, password });
    if (signIn.error) throw new Error(`sign-in as ${spec.email} failed: ${signIn.error.message}`);
    const enrolled = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `E2E authenticator ${runId}`,
      issuer: "ScaleUp Reporting (E2E)",
    });
    if (enrolled.error || !enrolled.data) throw new Error(`mfa.enroll(${spec.email}) failed: ${enrolled.error?.message}`);
    state.totpSecret = enrolled.data.totp.secret;
    const code = await nextTotpCode(userId, state.totpSecret);
    const verified = await sb.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code });
    if (verified.error) throw new Error(`TOTP verify(${spec.email}) failed: ${verified.error.message}`);
    if (spec.role !== "owner") {
      must(await sb.rpc("accept_terms", { p_version: termsVersion }), `accept_terms(${spec.email})`);
    }
  } finally {
    await apiSignOut(sb);
  }
  return state;
}

/** Removes the objects of a deleted company's storage folder (the RPC keeps them; M1 deletes them). */
async function removeCompanyStorage(admin: AnyClient, companyId: string): Promise<number> {
  const bucket = admin.storage.from(DOCUMENTS_BUCKET);
  const paths: string[] = [];
  const top = await bucket.list(companyId, { limit: 1000 });
  if (top.error) return 0;
  for (const entry of top.data ?? []) {
    if (entry.id === null) {
      // A folder (close id or 'general').
      const inner = await bucket.list(`${companyId}/${entry.name}`, { limit: 1000 });
      for (const file of inner.data ?? []) {
        if (file.id !== null) paths.push(`${companyId}/${entry.name}/${file.name}`);
      }
    } else {
      paths.push(`${companyId}/${entry.name}`);
    }
  }
  if (paths.length === 0) return 0;
  const removed = await bucket.remove(paths);
  if (removed.error) throw new Error(`storage remove failed: ${removed.error.message}`);
  return paths.length;
}

/** Deletes every company named exactly like the E2E company (rpc delete_company with a reason). */
export async function deleteE2ECompanies(admin: AnyClient, reason: string): Promise<string[]> {
  const rows = must(
    await admin.from("companies").select("id, name").eq("name", E2E_COMPANY.name),
    "find E2E company",
  ) as { id: string; name: string }[];
  const deleted: string[] = [];
  for (const row of rows) {
    if (row.name !== E2E_COMPANY.name) continue; // belt and braces: exact name only
    must(await admin.rpc("delete_company", { p_company_id: row.id, p_reason: reason }), "delete_company");
    await removeCompanyStorage(admin, row.id);
    deleted.push(row.id);
  }
  return deleted;
}

/**
 * Removes the invitee's account left by an earlier run, so flow 10 exercises a first-time invitation.
 * Returns a note when it could not be removed (then flow 10 may be skipped).
 */
export async function removeInvitee(admin: AnyClient): Promise<string | null> {
  assertE2EEmail(INVITEE.email);
  const user = await findAuthUserByEmail(admin, INVITEE.email);
  if (!user) return null;
  const del = await admin.auth.admin.deleteUser(user.id);
  if (!del.error) return null;
  // History may keep the account (foreign keys): then reset it for a re-invitation instead.
  await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  await deleteAllFactors(admin, user.id).catch(() => 0);
  return `could not delete the earlier invitee account (${del.error.message}); it was unbanned instead`;
}

export async function createE2ECompany(admin: AnyClient, users: Record<Role, UserState>): Promise<RunState["company"]> {
  const company = must(
    await admin
      .from("companies")
      .insert({
        name: E2E_COMPANY.name,
        legal_name: "E2E Test Co Sdn Bhd (automated test data)",
        description: "Created and deleted by the automated end-to-end tests (e2e/). Not a portfolio company.",
        reporting_currency: E2E_COMPANY.currency,
        reporting_start_month: E2E_COMPANY.reportingStartMonth,
      })
      .select("id, name")
      .single(),
    "insert E2E company",
  ) as { id: string; name: string };

  must(
    await admin
      .from("company_internal")
      .update({ partner_in_charge_id: users.partner.id })
      .eq("company_id", company.id),
    "assign partner-in-charge",
  );

  const line = must(
    await admin
      .from("revenue_segments")
      .insert({ company_id: company.id, name: E2E_COMPANY.scaleupLineName, kind: "scaleup", sort_order: 1 })
      .select("id")
      .single(),
    "insert ScaleUp revenue line",
  ) as { id: string };

  const kpi = must(
    await admin
      .from("company_kpis")
      .insert({
        company_id: company.id,
        name: E2E_COMPANY.kpiName,
        description: "Paying customers at month end (E2E test KPI).",
        unit: "customers",
        value_type: "integer",
        frequency: "monthly",
        is_required: true,
        sort_order: 1,
      })
      .select("id")
      .single(),
    "insert KPI",
  ) as { id: string };

  must(
    await admin.from("company_members").insert([
      { company_id: company.id, user_id: users.owner.id, role: "owner" },
      { company_id: company.id, user_id: users.contributor.id, role: "contributor" },
    ]),
    "insert memberships",
  );

  must(await admin.rpc("open_due_periods"), "open_due_periods");

  const subs = must(
    await admin.from("submissions").select("id, month, status").eq("company_id", company.id).order("month"),
    "list submissions",
  ) as { id: string; month: string; status: string }[];
  const submissions: Record<string, string> = {};
  for (const s of subs) submissions[s.month.slice(0, 7)] = s.id;

  const closes = must(
    await admin.from("period_closes").select("id, label").eq("company_id", company.id),
    "list closes",
  ) as { id: string; label: string }[];
  const q3 = closes.find((c) => c.label === "Q3 2026") ?? null;

  return {
    id: company.id,
    name: company.name,
    scaleupLineId: line.id,
    kpiId: kpi.id,
    submissions,
    q3CloseId: q3?.id ?? null,
  };
}

export async function otherCompanyId(admin: AnyClient): Promise<string | null> {
  const row = must(
    await admin.from("companies").select("id").eq("name", OTHER_COMPANY_NAME).maybeSingle(),
    "find other company",
  ) as { id: string } | null;
  return row?.id ?? null;
}

export async function termsVersionOf(admin: AnyClient): Promise<string> {
  const row = must(
    await admin.from("platform_settings").select("terms_version").eq("id", 1).single(),
    "read terms version",
  ) as { terms_version: string };
  return row.terms_version;
}

/** The whole reset. */
export async function setUpRun(admin: AnyClient): Promise<RunState> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const termsVersion = await termsVersionOf(admin);

  await deleteE2ECompanies(admin, "E2E set-up: removing the previous run's test company");
  const inviteeNote = await removeInvitee(admin);

  const users = {} as Record<Role, UserState>;
  for (const role of ROLES) users[role] = await resetAccount(admin, ACCOUNTS[role], termsVersion, runId);

  const company = await createE2ECompany(admin, users);
  return {
    runId,
    startedAt: new Date().toISOString(),
    termsVersion,
    users,
    company,
    otherCompanyId: await otherCompanyId(admin),
    inviteSkippedReason: inviteeNote,
  };
}

/** Deletes the E2E company and bans + deactivates every E2E account (they stay off until the next run). */
export async function tearDownRun(admin: AnyClient): Promise<{ deletedCompanies: string[]; banned: string[]; problems: string[] }> {
  const problems: string[] = [];
  let deletedCompanies: string[] = [];
  try {
    deletedCompanies = await deleteE2ECompanies(admin, "E2E cleanup");
  } catch (e) {
    problems.push(`delete company: ${(e as Error).message}`);
  }
  const banned: string[] = [];
  const specs: { email: string; fullName: string }[] = [...ROLES.map((r) => ACCOUNTS[r]), INVITEE];
  for (const spec of specs) {
    try {
      assertE2EEmail(spec.email);
      const user = await findAuthUserByEmail(admin, spec.email);
      if (!user) continue;
      // Company-side and inactive in the app (no dormant ScaleUp role), no authenticator, banned in Auth.
      await setProfile(admin, user.id, { fullName: spec.fullName, scaleupRole: null }, false);
      await deleteAllFactors(admin, user.id);
      const ban = await admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_FOREVER });
      if (ban.error) throw new Error(ban.error.message);
      banned.push(spec.email);
    } catch (e) {
      problems.push(`${spec.email}: ${(e as Error).message}`);
    }
  }
  return { deletedCompanies, banned, problems };
}
