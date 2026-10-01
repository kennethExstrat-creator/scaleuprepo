// Supabase Auth accounts through the Auth admin API (service role): find or create accounts, ban /
// unban, reset two-factor authentication, and summarise accounts for the Users page (last sign-in,
// 2FA). Every function takes the service-role client as its first argument and must only be called
// after the caller's own permission checks (BRD A2, B11, B22).
//
// No "server-only" import and no runtime `@/` imports, so scripts/create-user.ts (plain tsx) can reuse
// it; the app goes through the server-only wrappers in ./index.ts.
import type { Factor, SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";

type AdminClient = SupabaseClient<Database>;

/** `ban_duration` for a deactivated account: 100 years (Supabase Auth has no permanent ban). */
export const BAN_DURATION_DEACTIVATED = "876000h";
/** `ban_duration` that lifts a ban. */
export const BAN_DURATION_NONE = "none";

const LIST_PAGE_SIZE = 1000;
/** Safety stop for the account scan (50,000 accounts). */
const LIST_MAX_PAGES = 50;

/** What the Users pages need to know about an Auth account. */
export type AuthUserSummary = {
  id: string;
  email: string;
  /** Last successful sign-in (null = never signed in, e.g. an invitation not yet accepted). */
  lastSignInAt: string | null;
  /** A verified authenticator (TOTP) is set up; null when Supabase did not report the factors. */
  mfaEnrolled: boolean | null;
  /** Signing in is blocked (deactivated accounts are banned, BRD B22). */
  banned: boolean;
  createdAt: string;
};

/** Lower-cased, trimmed email (Supabase Auth stores emails in lower case). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when `factors` includes a verified authenticator-app (TOTP) factor. */
export function hasVerifiedTotp(factors: readonly Pick<Factor, "factor_type" | "status">[] | null | undefined): boolean {
  return (factors ?? []).some((factor) => factor.factor_type === "totp" && factor.status === "verified");
}

/** True when `bannedUntil` lies in the future. */
export function isBannedUntil(bannedUntil: string | null | undefined, now: number = Date.now()): boolean {
  if (!bannedUntil) return false;
  const until = Date.parse(bannedUntil);
  return Number.isFinite(until) && until > now;
}

/**
 * The Users-page view of an Auth account (pure). Supabase omits `factors` when there are none, so a
 * missing list counts as "no authenticator" when `factorsReported` is true, and as unknown otherwise.
 */
export function summariseAuthUser(user: User, options: { factorsReported?: boolean; now?: number } = {}): AuthUserSummary {
  const factorsReported = options.factorsReported ?? true;
  return {
    id: user.id,
    email: user.email ?? "",
    lastSignInAt: user.last_sign_in_at ?? null,
    mfaEnrolled: (Array.isArray(user.factors) || factorsReported) ? hasVerifiedTotp(user.factors) : null,
    banned: isBannedUntil(user.banned_until, options.now),
    createdAt: user.created_at,
  };
}

/**
 * One page of accounts, and whether another page follows: the page is full, or Supabase reports a
 * next page (so a server that caps the page size below ours is still read to the end).
 */
async function listPage(admin: AdminClient, page: number): Promise<{ users: User[]; more: boolean }> {
  const result = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
  if (result.error) throw result.error;
  const { users, nextPage } = result.data;
  const more = users.length > 0 && (users.length >= LIST_PAGE_SIZE || (typeof nextPage === "number" && nextPage > page));
  return { users, more };
}

/** Every Auth account (paged through `auth.admin.listUsers`, 1,000 per request). */
export async function listAllAuthUsers(admin: AdminClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const result = await listPage(admin, page);
    users.push(...result.users);
    if (!result.more) break;
  }
  return users;
}

/** The Auth account with this email (case-insensitive), or null. */
export async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  const wanted = normaliseEmail(email);
  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const result = await listPage(admin, page);
    const match = result.users.find((user) => normaliseEmail(user.email ?? "") === wanted);
    if (match) return match;
    if (!result.more) return null;
  }
  return null;
}

/** The Auth account with this id, or null. */
export async function getAuthUserById(admin: AdminClient, userId: string): Promise<User | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") return null;
    throw error;
  }
  return data.user ?? null;
}

export type EnsuredAuthUser = { user: User; created: boolean };

/**
 * Returns the Auth account for `email`, creating it when there is none: email confirmed, no password
 * (they choose one after opening their invitation link), `user_metadata.full_name` = `fullName` (the
 * profile trigger copies it). An existing account is returned unchanged (its name is not touched).
 */
export async function ensureAuthUserWith(
  admin: AdminClient,
  input: { email: string; fullName: string },
): Promise<EnsuredAuthUser> {
  const email = normaliseEmail(input.email);
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return { user: existing, created: false };

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() },
  });
  if (error) {
    // Created meanwhile by someone else (two invitations at once): use that account.
    if (error.code === "email_exists" || error.status === 422) {
      const raced = await findAuthUserByEmail(admin, email);
      if (raced) return { user: raced, created: false };
    }
    throw error;
  }
  if (!data.user) throw new Error("Supabase Auth did not return the new account.");
  return { user: data.user, created: true };
}

/** Blocks (deactivated account, BRD B22) or allows signing in. */
export async function setBanned(admin: AdminClient, userId: string, banned: boolean): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? BAN_DURATION_DEACTIVATED : BAN_DURATION_NONE,
  });
  if (error) throw error;
}

/**
 * Removes every two-factor factor of the account (BRD B11: a Super Admin resets a lost authenticator).
 * Deleting a verified factor also ends the person's sessions; they set up a new authenticator at their
 * next sign-in. Returns how many factors were removed.
 */
export async function removeAllFactors(admin: AdminClient, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  let removed = 0;
  for (const factor of data.factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) throw deleteError;
    removed += 1;
  }
  return removed;
}
