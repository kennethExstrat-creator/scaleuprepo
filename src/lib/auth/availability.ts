// Telling "Supabase Auth is busy or unreachable" apart from "this session is not valid".
//
// Every Auth call the server makes (sign-in, token refresh, link verification) comes from the
// app server's IP, so Supabase's per-IP rate limits apply to all users together. auth-js treats a
// 429 on a token refresh like a rejected refresh token and drops the session, and the proxy used
// to read any getClaims() failure as "signed out". The helpers below keep a temporary Auth
// problem from signing anyone out: the proxy answers 503 instead, and the cookie adapters skip
// the session deletions auth-js asks for after such a failure.
//
// Pure module (no Next.js imports): safe for the proxy, route handlers, actions and scripts.
import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/** Shown to a signed-in user whose session could not be checked because Supabase Auth is busy or down. */
export const AUTH_UNAVAILABLE_MESSAGE =
  "We can't reach the sign-in service right now. You're still signed in. Please try again in a minute.";

/** Shown on sign-in forms and email links when Supabase Auth is busy or down. */
export const AUTH_SERVICE_DOWN_MESSAGE = "We can't reach the sign-in service right now. Please try again in a minute.";

/** `Retry-After` (seconds) sent with the proxy's 503 responses. */
export const AUTH_RETRY_AFTER_SECONDS = 60;

/**
 * True when an auth-js error means "Auth is temporarily unavailable", not "the session is
 * invalid": a network failure or 5xx (AuthRetryableFetchError), a 429 rate limit, or a response
 * auth-js could not parse (AuthUnknownError, e.g. an HTML error page from a gateway).
 */
export function isAuthUnavailableError(error: unknown): boolean {
  if (!isAuthError(error)) return false;
  if (isAuthRetryableFetchError(error)) return true;
  if (error.status === 429) return true;
  return error.name === "AuthUnknownError";
}

/** A cookie write that deletes the cookie (how @supabase/ssr removes session chunks). */
export function isCookieDeletion(cookie: { value: string; options?: { maxAge?: number } }): boolean {
  return cookie.value === "" || cookie.options?.maxAge === 0;
}

/** Real refresh attempts one client makes after temporary failures before refusing locally. */
const MAX_TEMPORARY_REFRESH_FAILURES = 2;

export type AuthRefreshGuard = {
  /** Pass as `global.fetch` to createServerClient; wraps every Supabase request. */
  fetch: typeof fetch;
  /** True when the latest token refresh of this client failed for a temporary reason. */
  failedTemporarily(): boolean;
};

/**
 * Watches the token-refresh requests of one Supabase client.
 *
 * A refresh answered with a 429 or 5xx, or that fails on the network, marks the client as
 * "failed temporarily", so its cookie adapter can ignore the session deletion auth-js requests
 * afterwards (auth-js removes the session after a non-retryable refresh error such as 429 when
 * the access token has expired). Any other answer (success, or a real rejection such as an
 * invalid refresh token) clears the mark, so the latest attempt decides.
 *
 * Refused locally with a 429, without contacting Supabase: a refresh vetoed by `allowRefresh`
 * (per-client-IP cap in the proxy), and any refresh after two temporary failures in this client.
 * auth-js retries network errors and 5xx with backoff for up to ~25 seconds; the local 429 ends
 * that after about half a second, so a request fails fast instead of hanging during an outage.
 */
export function createAuthRefreshGuard(options: { allowRefresh?: () => boolean } = {}): AuthRefreshGuard {
  let failed = false;
  let temporaryFailures = 0;

  const guardedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isTokenRefreshRequest(input)) return fetch(input, init);

    if (temporaryFailures >= MAX_TEMPORARY_REFRESH_FAILURES || (options.allowRefresh && !options.allowRefresh())) {
      failed = true;
      return Response.json(
        {
          error_code: "over_request_rate_limit",
          msg: "Session refresh refused locally: too many attempts, or Supabase Auth is unavailable.",
        },
        { status: 429 },
      );
    }

    try {
      const response = await fetch(input, init);
      failed = response.status === 429 || response.status >= 500;
      if (failed) temporaryFailures += 1;
      return response;
    } catch (error) {
      failed = true;
      temporaryFailures += 1;
      throw error;
    }
  };

  return { fetch: guardedFetch as typeof fetch, failedTemporarily: () => failed };
}

/** POST <supabase-url>/auth/v1/token?grant_type=refresh_token */
function isTokenRefreshRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw);
    return url.pathname.endsWith("/auth/v1/token") && url.searchParams.get("grant_type") === "refresh_token";
  } catch {
    return false;
  }
}
