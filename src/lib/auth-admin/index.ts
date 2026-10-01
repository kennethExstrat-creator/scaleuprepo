import "server-only";

// Supabase Auth administration and our own access links (module M2; BRD A2, B11, B14, B22, B23, B29;
// docs/ARCHITECTURE.md §2.2 `access_links`, §4 `/access/[token]`).
//
// Everything here uses the service-role client (`createAdminClient()`), which bypasses Row Level
// Security and has no audit actor: call it ONLY after the caller's own permission checks
// (assertScaleUp / assertCompanyAccess), write business rows (profiles, memberships) with the caller's
// RLS client, and log invite / sign_in_link / invite_revoke / mfa_reset with `log_audit_event` as the
// acting user. The database still guards who may issue a link for whom (42501, BRD B29).
// Never log tokens, token hashes or links.
import { headers } from "next/headers";

import { isAuthUnavailableError } from "@/lib/auth/availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  claimLink,
  getLink,
  issueAccessLink,
  listPendingLinks,
  previewLink,
  revokeEarlierLinks,
  revokeLink,
  revokePendingLinks,
  type AccessLinkPreview,
  type AccessLinkRecord,
  type ClaimedAccessLink,
  type IssuedAccessLink,
  type PendingAccessLink,
} from "./links";
import { normaliseSiteUrl, type AccessLinkPurpose } from "./tokens";
import {
  ensureAuthUserWith,
  getAuthUserById,
  hasVerifiedTotp,
  listAllAuthUsers,
  removeAllFactors,
  setBanned,
  summariseAuthUser,
  type AuthUserSummary,
  type EnsuredAuthUser,
} from "./users";

export { isOwnerLinkRefusal, ISSUER_REFUSAL_MESSAGE, OWNER_LINK_REFUSAL_MESSAGE } from "./links";
export type { AccessLinkPreview, AccessLinkRecord, ClaimedAccessLink, IssuedAccessLink, PendingAccessLink } from "./links";
export type { AccessLinkPurpose } from "./tokens";
export type { AuthUserSummary, EnsuredAuthUser } from "./users";

const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Base URL for links: `NEXT_PUBLIC_SITE_URL`, else the origin of the current request, else
 * http://localhost:3000.
 */
export async function getSiteUrl(): Promise<string> {
  const configured = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;
  try {
    const headerStore = await headers();
    const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
    const proto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
    const fromRequest = host ? normaliseSiteUrl(`${proto}://${host}`) : null;
    if (fromRequest) return fromRequest;
  } catch {
    // Outside a request (no headers): use the default.
  }
  return DEFAULT_SITE_URL;
}

// ---------------------------------------------------------------------------------------------
// Access links
// ---------------------------------------------------------------------------------------------

/**
 * Issues a single-use `/access/<token>` link for `userId` (invite: 7 days; signin: 24 hours) and revokes
 * that person's earlier pending links of the same purpose — unless `revokeEarlier` is false, in which
 * case call `revokeEarlierAccessLinks(link)` once the new link is recorded. `createdBy` = the acting
 * user. Throws the database's 42501 when the issuer may not hold a link for this person
 * (`isOwnerLinkRefusal` for the owner case, BRD B29). The returned `url` is shown once to the issuer:
 * never log or store it.
 */
export async function createAccessLink(input: {
  userId: string;
  purpose: AccessLinkPurpose;
  createdBy: string;
  revokeEarlier?: boolean;
}): Promise<IssuedAccessLink> {
  return issueAccessLink(createAdminClient(), { ...input, siteUrl: await getSiteUrl() });
}

/**
 * Revokes the person's other pending links of the same purpose as `link` (only the newest works).
 * Never throws (logged instead); returns how many were revoked.
 */
export async function revokeEarlierAccessLinks(link: Pick<IssuedAccessLink, "id" | "userId" | "purpose">): Promise<number> {
  return revokeEarlierLinks(createAdminClient(), link);
}

/** Revokes one pending link; null when it was already used or revoked (or does not exist). */
export async function revokeAccessLink(linkId: string): Promise<AccessLinkRecord | null> {
  return revokeLink(createAdminClient(), linkId);
}

/** Revokes a person's pending links (optionally only those issued by `createdBy`). Returns the count. */
export async function revokeUserAccessLinks(
  userId: string,
  options: { purpose?: AccessLinkPurpose; createdBy?: readonly string[] } = {},
): Promise<number> {
  return revokePendingLinks(createAdminClient(), { userId, ...options });
}

/** One link by id (no token or hash), or null. */
export async function getAccessLink(linkId: string): Promise<AccessLinkRecord | null> {
  return getLink(createAdminClient(), linkId);
}

/** Pending links (unused, unrevoked, unexpired), newest first; optionally only those of `userIds`. */
export async function listPendingAccessLinks(filter: { userIds?: readonly string[] } = {}): Promise<PendingAccessLink[]> {
  return listPendingLinks(createAdminClient(), filter);
}

/**
 * For GET /access/[token]: who the link is for, WITHOUT using it (link scanners cannot use it up).
 * `unavailable` when the database could not be reached.
 */
export async function previewAccessLink(token: string): Promise<AccessLinkPreview | { status: "unavailable" }> {
  try {
    return await previewLink(createAdminClient(), token);
  } catch (error) {
    console.error("[access-links] could not look up a link", errorText(error));
    return { status: "unavailable" };
  }
}

/**
 * Uses the link atomically (`claim_access_link`, single use): the account to sign in, or null when the
 * link is not valid for any reason. Throws when the database cannot be reached.
 */
export async function claimAccessLink(token: string): Promise<ClaimedAccessLink | null> {
  return claimLink(createAdminClient(), token);
}

export type EmailLinkSignInResult = { ok: true } | { ok: false; reason: "unavailable" | "failed" };

/**
 * Signs `email` in on this request's cookie session: a one-off magic-link token from the Auth admin
 * API (`generateLink`, sends no email) verified straight away with `verifyOtp` on the server client.
 * Only for the /access accept action, after `claimAccessLink` succeeded. The caller then calls
 * `startIdleClock()`.
 */
export async function signInWithEmailLink(email: string): Promise<EmailLinkSignInResult> {
  const admin = createAdminClient();
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) {
    console.error("[access-links] generateLink failed", generated.error?.code, generated.error?.status);
    return { ok: false, reason: isAuthUnavailableError(generated.error) ? "unavailable" : "failed" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) {
    console.error("[access-links] verifyOtp failed", error.code, error.status);
    return { ok: false, reason: isAuthUnavailableError(error) ? "unavailable" : "failed" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Auth accounts
// ---------------------------------------------------------------------------------------------

/**
 * The Auth account for `email`, created when there is none (email confirmed, no password,
 * `user_metadata.full_name`; the profile row is created by the database trigger). Existing accounts
 * are returned unchanged.
 */
export async function ensureAuthUser(input: { email: string; fullName: string }): Promise<EnsuredAuthUser> {
  return ensureAuthUserWith(createAdminClient(), input);
}

/** One account's Auth summary (last sign-in, 2FA, banned), or null. */
export async function getAuthUser(userId: string): Promise<AuthUserSummary | null> {
  const user = await getAuthUserById(createAdminClient(), userId);
  return user ? summariseAuthUser(user) : null;
}

/** Blocks (deactivated account, BRD B22: ban for 100 years) or allows signing in. */
export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  await setBanned(createAdminClient(), userId, banned);
}

/** Removes every two-factor factor of the account (they set up a new one at their next sign-in). */
export async function resetUserMfa(userId: string): Promise<number> {
  return removeAllFactors(createAdminClient(), userId);
}

/** Parallel map with at most `limit` calls in flight. */
async function mapLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Every Auth account's summary for the Users page: last sign-in, whether a verified authenticator is
 * set up, and whether signing in is blocked. Supabase includes the factors in the account list; if it
 * ever stops doing so, the accounts that have signed in are asked one by one (5 at a time).
 */
export async function listAuthUsers(): Promise<AuthUserSummary[]> {
  const admin = createAdminClient();
  const users = await listAllAuthUsers(admin);
  const factorsReported = users.some((user) => Array.isArray(user.factors));
  const summaries = users.map((user) => summariseAuthUser(user, { factorsReported }));
  if (factorsReported) return summaries;

  const unknown = summaries.filter((summary) => summary.mfaEnrolled === null);
  await mapLimited(unknown, 5, async (summary) => {
    if (!summary.lastSignInAt) {
      summary.mfaEnrolled = false; // never signed in, so no authenticator yet
      return;
    }
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: summary.id });
    summary.mfaEnrolled = error ? null : hasVerifiedTotp(data.factors);
  });
  return summaries;
}

function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return [code, message].filter((part) => typeof part === "string" && part !== "").join(" ");
  }
  return String(error);
}
