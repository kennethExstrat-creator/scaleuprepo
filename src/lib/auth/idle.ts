// Server-side idle timeout (BRD §11 and B11: sessions end after 30 minutes of inactivity, with a
// warning 2 minutes before).
// The proxy stamps an httpOnly cookie with the time of the last authenticated request and
// signs the user out when it is older than SESSION_IDLE_TIMEOUT_MS. The client-side
// <IdleTimer> warns at 28 minutes and signs out at 30 minutes while a tab is open.
// Pure module: safe to import from the proxy, route handlers, Server Actions, Client Components
// and tests.
import { SESSION_IDLE_TIMEOUT_MS } from "@/lib/constants";

/** httpOnly cookie holding the epoch-ms time of the last authenticated request. */
export const LAST_SEEN_COOKIE = "su_last_seen";

/** Show the "Stay signed in" warning this long before the idle timeout. */
export const IDLE_WARNING_BEFORE_MS = 2 * 60 * 1000;

/**
 * `reason` field of the proxy's 401 JSON body (`{ error, reason }`), so API callers and the
 * idle timer can tell an inactivity sign-out from a missing session.
 */
export type UnauthenticatedReason = "timeout" | "signed_out";

/**
 * `reason` of any JSON auth failure from the proxy: the 401 reasons above, or "unavailable"
 * with status 503 (+ Retry-After) when Supabase Auth is rate-limiting or unreachable. A 503 does
 * not mean the session has ended.
 */
export type AuthFailureReason = UnauthenticatedReason | "unavailable";

/**
 * Cookie lifetime. Any value longer than the idle timeout works: a missing cookie is
 * treated as expired, so letting the cookie lapse after a day is harmless.
 */
const LAST_SEEN_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Allowed clock skew for a last-seen value that lies in the future. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type LastSeenCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

/**
 * Options for the last-seen cookie. `secure` must follow the scheme the browser actually used
 * (see `isHttpsRequest`): a Secure cookie sent over plain HTTP is dropped by the browser, and the
 * proxy then treats every request as timed out.
 */
export function lastSeenCookieOptions(secure: boolean): LastSeenCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: LAST_SEEN_MAX_AGE_SECONDS,
  };
}

type HeaderReader = { get(name: string): string | null };

/**
 * True when the browser reached the app over HTTPS, from `x-forwarded-proto` (set by Next.js
 * from the socket, or by the TLS-terminating proxy in front of it).
 *
 * @example markSessionActive(await cookies(), { secure: isHttpsRequest(await headers()) })
 */
export function isHttpsRequest(headers: HeaderReader): boolean {
  return headers.get("x-forwarded-proto")?.toLowerCase().includes("https") ?? false;
}

/** Cookie options that delete a cookie set on path "/" (the last-seen and Supabase auth cookies). */
export const EXPIRED_COOKIE_OPTIONS = { path: "/", maxAge: 0 } as const;

/** Anything with a Next.js-style `cookies.set(name, value, options)` (cookies(), NextResponse.cookies). */
type CookieWriter = {
  set(name: string, value: string, options: LastSeenCookieOptions): unknown;
};

/**
 * Starts (or restarts) the idle clock. Every code path that creates a session must call this
 * before its response is sent — the login action, /auth/confirm and /auth/callback do —
 * because the proxy treats a session without a last-seen cookie as timed out. Pass the real
 * request scheme as `secure`; without it the cookie is not marked Secure (the value is a
 * timestamp, and the proxy re-issues the cookie with the right flag on the next request).
 *
 * @example markSessionActive(await cookies(), { secure: isHttpsRequest(await headers()) })
 */
export function markSessionActive(
  cookieStore: CookieWriter,
  { secure = false, now = Date.now() }: { secure?: boolean; now?: number } = {},
): void {
  cookieStore.set(LAST_SEEN_COOKIE, String(now), lastSeenCookieOptions(secure));
}

/**
 * True when the session must be ended for inactivity. Strict on purpose: a missing,
 * malformed or implausible (far-future) value counts as expired, so the timeout cannot be
 * bypassed by dropping the cookie. Every sign-in path calls `markSessionActive()` first.
 */
export function isIdleExpired(raw: string | undefined | null, now: number = Date.now()): boolean {
  if (!raw) return true;
  const lastSeen = Number(raw);
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return true;
  if (lastSeen > now + MAX_FUTURE_SKEW_MS) return true;
  return now - lastSeen > SESSION_IDLE_TIMEOUT_MS;
}

/**
 * Matches Supabase auth cookies: the session (`sb-<ref>-auth-token`, chunked as `.0`, `.1`, …)
 * and PKCE verifiers (`sb-<ref>-auth-token-code-verifier`, `…-flow-<id>-code-verifier`).
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token/.test(name);
}
