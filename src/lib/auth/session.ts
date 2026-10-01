import "server-only";

import type { JwtPayload } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { ActionError, MESSAGES } from "@/lib/actions/result";
import { AUTH_UNAVAILABLE_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import { isHttpsRequest, markSessionActive } from "@/lib/auth/idle";
import type {
  AccessContext,
  CompanyAccessContext,
  CompanyViewContext,
  Membership,
  ScaleUpAccessContext,
} from "@/lib/auth/types";
import { TERMS_VERSION } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import {
  COMPANY_ROLES,
  COMPANY_STATUSES,
  SCALEUP_ROLES,
  type CompanyRole,
  type CompanyStatus,
  type ScaleupRole,
} from "@/lib/types/enums";

export type { AccessContext, CompanyAccessContext, CompanyViewContext, Membership, ScaleUpAccessContext };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` looks like a UUID (use before putting route params into queries/URLs). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Local row shapes. Query results are assigned to them without casts, so tsc checks every select
// string below against the generated `Database` types (src/lib/supabase/database.types.ts).
type ProfileRow = {
  email: string | null;
  full_name: string | null;
  scaleup_role: string | null;
  is_active: boolean | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
};
type EmbeddedCompany = { id: string; name: string; status: string };
type MemberRow = { role: string; company: EmbeddedCompany | EmbeddedCompany[] | null };
type ClientSettingsRow = { require_mfa: boolean | null; terms_version: string | null };

const MESSAGE_INACTIVE = "Your account is inactive. Please contact ScaleUp.";
const MESSAGE_MFA = "Please complete two-factor authentication, then try again.";
const MESSAGE_TERMS = "Please accept the terms of use, then try again.";
const MESSAGE_NO_COMPANY_ACCESS = "You don't have access to this company.";
const MESSAGE_COMPANY_USERS_ONLY = "This action is only available to company users.";

/** One RLS-scoped Supabase client per request (memoised while rendering). */
const getRequestClient = cache(() => createClient());

/**
 * Thrown by `getAccessContext()` (and so by every require and assert guard) when Supabase Auth is
 * rate-limiting this server or cannot be reached, so the session could not be checked. It is not
 * a sign-out: `toActionError` shows its message ("… You're still signed in …").
 */
export class AuthUnavailableError extends ActionError {
  constructor() {
    super(AUTH_UNAVAILABLE_MESSAGE);
    this.name = "AuthUnavailableError";
  }
}

type SessionState =
  | { status: "signed_in"; claims: JwtPayload }
  | { status: "signed_out" }
  | { status: "unavailable" };

/** The current session as far as Supabase Auth can tell. Memoised per request. */
const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await getRequestClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return { status: "signed_in", claims: data.claims };
  if (isAuthUnavailableError(error)) return { status: "unavailable" };
  return { status: "signed_out" };
});

/**
 * Verified JWT claims of the current session, or null when signed out or when Supabase Auth
 * could not be reached. No database access. Memoised per request.
 */
export const getSessionClaims = cache(async (): Promise<JwtPayload | null> => {
  const state = await getSessionState();
  return state.status === "signed_in" ? state.claims : null;
});

/**
 * Starts the 30-minute idle clock for a session created in this request. Call it in every Server
 * Action or route handler that signs someone in (after verifyOtp, exchangeCodeForSession or
 * signInWithPassword succeeds), before responding; the proxy treats a session without it as
 * timed out.
 */
export async function startIdleClock(): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  markSessionActive(cookieStore, { secure: isHttpsRequest(headerStore) });
}

/**
 * `require_mfa` and the current `terms_version` (safe defaults on failure). Read with the
 * `get_client_settings()` RPC, which every signed-in session may call — also before MFA and before the
 * terms are accepted — while the platform_settings table itself is ScaleUp-only (BRD B27).
 */
export const getAuthSettings = cache(async (): Promise<{ requireMfa: boolean; termsVersion: string }> => {
  const supabase = await getRequestClient();
  const { data, error } = await supabase.rpc("get_client_settings").maybeSingle();
  if (error) console.error("[auth] could not read the client settings", error.message);
  const row: ClientSettingsRow | null = data ?? null;
  return {
    // Fail safe: require MFA unless the settings row says otherwise.
    requireMfa: row?.require_mfa ?? true,
    termsVersion: row?.terms_version || TERMS_VERSION,
  };
});

/**
 * Who is signed in, with role, memberships, MFA level and terms status. Returns null only
 * when there is no valid session; throws `AuthUnavailableError` when Supabase Auth cannot be
 * reached and an Error when the database cannot. Memoised per request with React `cache()`.
 *
 * Never authorise with this directly: use requireUser / requireScaleUp / requireCompanyAccess
 * (pages) or assertUser / assertScaleUp / assertCompanyAccess / assertCanViewCompany (actions
 * and route handlers). As a safeguard, `scaleupRole` is null and `memberships` is empty until the
 * session is fully verified (active account, MFA when required, current terms accepted), so the
 * permission helpers deny everything for a password-only, inactive or terms-pending session. The
 * database enforces the same (its access helpers require MFA and the current terms): until then
 * only the user's own profile and `get_client_settings()` are readable.
 */
export const getAccessContext = cache(async (): Promise<AccessContext | null> => {
  const session = await getSessionState();
  if (session.status === "unavailable") throw new AuthUnavailableError();
  if (session.status === "signed_out") return null;
  const { claims } = session;

  const supabase = await getRequestClient();
  const userId = claims.sub;
  const aal: AccessContext["aal"] = claims.aal === "aal2" ? "aal2" : "aal1";

  const [profileRes, settings, memberRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("email, full_name, scaleup_role, is_active, terms_accepted_at, terms_version")
      .eq("id", userId)
      .maybeSingle(),
    getAuthSettings(),
    supabase
      .from("company_members")
      .select("role, company:companies(id, name, status)")
      .eq("user_id", userId)
      .eq("is_active", true),
  ]);
  if (profileRes.error) throw new Error(`Could not load the signed-in profile: ${profileRes.error.message}`);
  if (memberRes.error) throw new Error(`Could not load company memberships: ${memberRes.error.message}`);

  const profile: ProfileRow | null = profileRes.data ?? null;
  const memberRows: MemberRow[] = memberRes.data ?? [];
  const memberships = memberRows
    .flatMap((row): Membership[] => {
      const company = Array.isArray(row.company) ? row.company[0] : row.company;
      if (!company || !isCompanyRole(row.role)) return [];
      return [
        {
          companyId: company.id,
          companyName: company.name,
          companyStatus: isCompanyStatus(company.status) ? company.status : "active",
          role: row.role,
        },
      ];
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "en-GB"));

  // Your own profile row is always readable (RLS), so a missing row means the account was
  // never set up properly. At aal1 route the user through /mfa first; once the session is
  // aal2 a missing profile counts as inactive (→ /no-access).
  const profileMissingBeforeMfa = profile === null && aal === "aal1" && settings.requireMfa;
  const isActive = profile ? profile.is_active === true : profileMissingBeforeMfa;
  const termsAccepted = Boolean(profile?.terms_accepted_at) && profile?.terms_version === settings.termsVersion;
  // Only a fully verified session carries a role or memberships (see the doc comment).
  const verified = profile !== null && isActive && (aal === "aal2" || !settings.requireMfa) && termsAccepted;

  return {
    userId,
    email: profile?.email ?? (typeof claims.email === "string" ? claims.email : ""),
    fullName: profile?.full_name ?? metadataName(claims.user_metadata),
    scaleupRole: verified && isScaleupRole(profile.scaleup_role) ? profile.scaleup_role : null,
    isActive,
    memberships: verified ? memberships : [],
    aal,
    mfaRequired: settings.requireMfa,
    termsAccepted,
  };
});

// ---------------------------------------------------------------------------------------------
// Pages and layouts: redirect or 404
// ---------------------------------------------------------------------------------------------

/**
 * For pages and layouts. Redirects, in order: no session → /login; inactive profile →
 * /no-access?reason=inactive; MFA required but session not aal2 → /mfa; terms for the
 * current `platform_settings.terms_version` not accepted → /terms.
 */
export async function requireUser(): Promise<AccessContext> {
  const ctx = await getAccessContext();
  if (!ctx) redirect("/login");
  if (!ctx.isActive) redirect("/no-access?reason=inactive");
  if (ctx.mfaRequired && ctx.aal !== "aal2") redirect("/mfa");
  if (!ctx.termsAccepted) redirect("/terms");
  return ctx;
}

/**
 * For ScaleUp pages. `requireUser()` first; company users → redirect('/portal');
 * a ScaleUp role outside `roles` → notFound().
 *
 * @example const ctx = await requireScaleUp(["super_admin", "fund_admin"]);
 */
export async function requireScaleUp(roles?: readonly ScaleupRole[]): Promise<ScaleUpAccessContext> {
  const ctx = await requireUser();
  const role = ctx.scaleupRole;
  if (!role) redirect("/portal");
  if (roles && !roles.includes(role)) notFound();
  return { ...ctx, scaleupRole: role };
}

/**
 * For company-portal pages. `requireUser()` first; ScaleUp users →
 * redirect('/admin/companies/<id>'); not an active member, or company role outside
 * `roles` → notFound().
 *
 * @example const ctx = await requireCompanyAccess(companyId, ["owner"]);
 */
export async function requireCompanyAccess(
  companyId: string,
  roles?: readonly CompanyRole[],
): Promise<CompanyAccessContext> {
  if (!isUuid(companyId)) notFound();
  const ctx = await requireUser();
  if (ctx.scaleupRole) redirect(`/admin/companies/${companyId}`);
  const membership = ctx.memberships.find((m) => m.companyId === companyId);
  if (!membership) notFound();
  if (roles && !roles.includes(membership.role)) notFound();
  return { ...ctx, companyRole: membership.role };
}

// ---------------------------------------------------------------------------------------------
// Server Actions and route handlers: throw ActionError (→ toActionError → friendly message)
// ---------------------------------------------------------------------------------------------

/**
 * The same checks as `requireUser()` (session, active, MFA, terms) but throws an
 * `ActionError` with a friendly message instead of redirecting.
 */
export async function assertUser(): Promise<AccessContext> {
  const ctx = await getAccessContext();
  if (!ctx) throw new ActionError(MESSAGES.session);
  if (!ctx.isActive) throw new ActionError(MESSAGE_INACTIVE);
  if (ctx.mfaRequired && ctx.aal !== "aal2") throw new ActionError(MESSAGE_MFA);
  if (!ctx.termsAccepted) throw new ActionError(MESSAGE_TERMS);
  return ctx;
}

/**
 * ScaleUp staff only (optionally limited to `roles`); company users and other roles get
 * "You don't have permission to do that."
 *
 * @example await assertScaleUp(["super_admin"]);            // manage companies
 * @example await assertScaleUp(["fund_admin"]);             // enter data on behalf
 */
export async function assertScaleUp(roles?: readonly ScaleupRole[]): Promise<ScaleUpAccessContext> {
  const ctx = await assertUser();
  const role = ctx.scaleupRole;
  if (!role || (roles && !roles.includes(role))) throw new ActionError(MESSAGES.permission);
  return { ...ctx, scaleupRole: role };
}

/**
 * Active members of the company only (optionally limited to company `roles`). Mirrors
 * `requireCompanyAccess`: ScaleUp staff are rejected here — on-behalf work goes through
 * `assertScaleUp(["fund_admin"])`, and `assertCanViewCompany` covers both audiences.
 *
 * @example const ctx = await assertCompanyAccess(companyId, ["owner"]); // submit a month
 */
export async function assertCompanyAccess(
  companyId: string,
  roles?: readonly CompanyRole[],
): Promise<CompanyAccessContext> {
  const ctx = await assertUser();
  if (ctx.scaleupRole) throw new ActionError(MESSAGE_COMPANY_USERS_ONLY);
  const membership = isUuid(companyId) ? ctx.memberships.find((m) => m.companyId === companyId) : undefined;
  if (!membership) throw new ActionError(MESSAGE_NO_COMPANY_ACCESS);
  if (roles && !roles.includes(membership.role)) throw new ActionError(MESSAGES.permission);
  return { ...ctx, companyRole: membership.role };
}

/**
 * Anyone who may view the company: ScaleUp staff (any role; `companyRole` null) or its active
 * members. For actions and route handlers both audiences use, e.g. document downloads.
 * Combine with the permission helpers for finer rules, e.g. `canExport(ctx, companyId)`.
 */
export async function assertCanViewCompany(companyId: string): Promise<CompanyViewContext> {
  const ctx = await assertUser();
  if (!isUuid(companyId)) throw new ActionError(MESSAGES.notFound);
  if (ctx.scaleupRole) return { ...ctx, companyRole: null };
  const membership = ctx.memberships.find((m) => m.companyId === companyId);
  if (!membership) throw new ActionError(MESSAGE_NO_COMPANY_ACCESS);
  return { ...ctx, companyRole: membership.role };
}

function isScaleupRole(value: unknown): value is ScaleupRole {
  return typeof value === "string" && (SCALEUP_ROLES as readonly string[]).includes(value);
}

function isCompanyRole(value: unknown): value is CompanyRole {
  return typeof value === "string" && (COMPANY_ROLES as readonly string[]).includes(value);
}

function isCompanyStatus(value: unknown): value is CompanyStatus {
  return typeof value === "string" && (COMPANY_STATUSES as readonly string[]).includes(value);
}

function metadataName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const name = (metadata as { full_name?: unknown }).full_name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}
