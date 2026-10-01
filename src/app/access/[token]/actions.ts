"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ACCESS_LINK_MESSAGES } from "../_components/messages";
import { claimAccessLink, signInWithEmailLink, type ClaimedAccessLink } from "@/lib/auth-admin";
import { isPlausibleAccessToken } from "@/lib/auth-admin/tokens";
import { clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { withNext } from "@/lib/auth/redirects";
import { startIdleClock } from "@/lib/auth/session";

export type AcceptLinkState = {
  error: string | null;
  /** The link can no longer be used (invalid, or claimed but the sign-in failed): hide the button. */
  spent: boolean;
};

/**
 * POST from /access/[token] ("Accept invitation" / "Sign in"), the only place a link is used
 * (docs/ARCHITECTURE.md §2.2 access_links, §4 route map):
 * 1. throttle per client IP (each attempt spends the server's Supabase verification budget);
 * 2. claim the link atomically with `claim_access_link` (service role; single use even under
 *    concurrent requests; no row = expired, used, revoked, deactivated account or issuer no longer
 *    allowed) — never check-then-set;
 * 3. sign the account in on this request's cookie session (`generateLink` magic link → `verifyOtp`);
 * 4. start the idle clock and continue: invitations to /set-password, sign-in links to /mfa and then
 *    /set-password (a sign-in link replaces a forgotten password, BRD B23).
 * Server Actions only accept same-origin posts, and GET never gets here, so link scanners and other
 * sites cannot use a link up. A claimed link stays used even if signing in then fails.
 */
export async function acceptAccessLinkAction(_previous: AcceptLinkState, formData: FormData): Promise<AcceptLinkState> {
  const token = formData.get("token");
  if (!isPlausibleAccessToken(token)) return { error: ACCESS_LINK_MESSAGES.invalid, spent: true };

  const throttle = consumeRateLimit(RATE_LIMITS.emailLinkPerIp, clientIp(await headers()));
  if (!throttle.ok) return { error: ACCESS_LINK_MESSAGES.tooManyAttempts, spent: false };

  let claimed: ClaimedAccessLink | null;
  try {
    claimed = await claimAccessLink(token);
  } catch (error) {
    console.error("[access] could not claim a link", errorCode(error));
    return { error: ACCESS_LINK_MESSAGES.unavailable, spent: false };
  }
  if (!claimed) return { error: ACCESS_LINK_MESSAGES.invalid, spent: true };

  let signedIn = false;
  let unavailable = false;
  try {
    const result = await signInWithEmailLink(claimed.email);
    signedIn = result.ok;
    unavailable = !result.ok && result.reason === "unavailable";
  } catch (error) {
    console.error("[access] sign-in after claiming a link failed", errorCode(error));
  }
  if (!signedIn) {
    return {
      error: unavailable ? ACCESS_LINK_MESSAGES.claimedServiceDown : ACCESS_LINK_MESSAGES.claimedSignInFailed,
      spent: true,
    };
  }

  // A new session: start the idle-timeout clock before the first authenticated request.
  await startIdleClock();
  redirect(claimed.purpose === "invite" ? "/set-password" : withNext("/mfa", "/set-password"));
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
}
