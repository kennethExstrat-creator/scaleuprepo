import "server-only";

import { createClient, type JwtPayload } from "@supabase/supabase-js";

import { isAuthUnavailableError } from "@/lib/auth/availability";

/**
 * Sign-in methods that prove control of the mailbox (the session came from an invitation,
 * password-recovery or sign-in link). Stored with a timestamp in the JWT `amr` claim.
 */
const EMAIL_LINK_METHODS = new Set(["invite", "recovery", "magiclink", "otp"]);

/** How long after opening an email link the password may be set without the current one. */
export const EMAIL_LINK_PASSWORD_WINDOW_SECONDS = 15 * 60;

/**
 * True when the session was created by an email link (invite, recovery or sign-in link) less
 * than 15 minutes ago. Only then may /set-password set a password without the current one;
 * any other session must confirm the current password (OWASP ASVS 2.1.6).
 *
 * Checks every `amr` entry, not only the newest: a recovery session that has since completed
 * two-factor authentication lists `totp` after `recovery`.
 */
export function isRecentEmailLinkSession(
  claims: Pick<JwtPayload, "amr"> | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false; // string form carries no timestamp
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== "string" || !EMAIL_LINK_METHODS.has(method)) return false;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
    const age = nowSeconds - timestamp;
    return age >= -60 && age <= EMAIL_LINK_PASSWORD_WINDOW_SECONDS;
  });
}

export type CurrentPasswordCheck = "ok" | "invalid" | "unavailable";

/**
 * Checks `password` against the account by signing in on a throwaway client that keeps nothing
 * (no cookies, no storage), then revokes the extra session that sign-in created. The caller's
 * own session is untouched. Throttle calls with RATE_LIMITS.signInPerIp / signInPerEmail: each
 * one spends the server's Supabase sign-in budget.
 */
export async function verifyCurrentPassword(email: string, password: string): Promise<CurrentPasswordCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / key).");

  const probe = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error) {
    if (isAuthUnavailableError(error)) return "unavailable";
    if (error.code === "invalid_credentials" || error.status === 400) return "invalid";
    console.error("[password] current-password check failed", error.code, error.message);
    return "unavailable";
  }
  if (data.session) {
    const { error: signOutError } = await probe.auth.signOut({ scope: "local" });
    if (signOutError) console.warn("[password] could not revoke the check session", signOutError.code);
  }
  return "ok";
}
