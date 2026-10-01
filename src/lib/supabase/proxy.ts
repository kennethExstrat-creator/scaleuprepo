import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_RETRY_AFTER_SECONDS,
  AUTH_UNAVAILABLE_MESSAGE,
  createAuthRefreshGuard,
  isAuthUnavailableError,
  isCookieDeletion,
} from "@/lib/auth/availability";
import {
  EXPIRED_COOKIE_OPTIONS,
  isIdleExpired,
  isSupabaseAuthCookie,
  LAST_SEEN_COOKIE,
  lastSeenCookieOptions,
  type AuthFailureReason,
} from "@/lib/auth/idle";
import { clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { safeNextPath } from "@/lib/auth/redirects";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Pages that anyone can open without a session. `/access/[token]` (module M2) is the accept page of
 * our own invitation and sign-in links (BRD B14).
 */
const PUBLIC_PAGES = ["/login", "/forgot-password", "/access"];

/**
 * Routes that create or end the session themselves (email-link confirmation, PKCE exchange,
 * sign-out, and the access-link accept page, whose Server Action signs the invitee in). The proxy
 * must not refresh or rewrite auth cookies on these requests, otherwise its Set-Cookie headers could
 * race with the handler's. They are reachable without a session; the handler starts the idle clock
 * (`startIdleClock()`) when it signs someone in.
 */
const SELF_MANAGED_AUTH_ROUTES = ["/auth/confirm", "/auth/callback", "/auth/signout", "/access"];

/** Keep-alive ping from <IdleTimer>: answered with JSON instead of a redirect. */
const KEEPALIVE_ROUTE = "/auth/keepalive";

/** Auth-flow pages: need a session, but a ?next= link back to them makes no sense. */
const AUTH_FLOW_PAGES = ["/mfa", "/terms", "/set-password", "/no-access"];

/** Sent with every response that writes cookies (same values @supabase/ssr uses). */
const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

/**
 * Sent with every response the proxy handles (pages, Server Actions, API routes, auth routes).
 * Static assets are outside the matcher and need none of these.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Production over HTTPS only (browsers ignore HSTS over plain HTTP; never pin localhost). */
const HSTS_HEADER = "max-age=31536000; includeSubDomains";

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * Runs on every matched request (see `config.matcher` in src/proxy.ts):
 *
 * 1. Refreshes the Supabase session cookies exactly as @supabase/ssr requires. All cookie
 *    writes are collected and applied to the one response that is returned — including
 *    redirects and 401s — so refreshed tokens are never dropped. They are also mirrored onto
 *    the forwarded request so Server Components in the same request see the new session.
 * 2. Decides authentication with `getClaims()` (verified JWT; no database queries here).
 * 3. Unauthenticated: pages → /login?next=<path+query>; /api/* and the keep-alive → 401 JSON;
 *    public pages and Server Action POSTs pass (actions re-check auth themselves). A browser
 *    navigation to /api/* (a plain download link: C4 export, document pack, document download) is
 *    sent to /login too, with `next` = the same-origin page the link was on, instead of raw JSON.
 * 4. Supabase Auth rate-limited or unreachable: nobody is signed out. Pages get a 503 "try
 *    again" page, /api/* and the keep-alive 503 JSON `{ error, reason: "unavailable" }` with
 *    Retry-After; public pages and Server Actions pass. Token refreshes are capped per client
 *    IP so one client cannot use up the server's shared Supabase refresh budget.
 * 5. Enforces the 30-minute idle timeout via the httpOnly `su_last_seen` cookie; when it has
 *    lapsed the session is revoked, every auth cookie is cleared and the user is sent to
 *    /login?reason=timeout. Otherwise the cookie is refreshed (this request is activity).
 * 6. Adds anti-framing and other security headers to every response.
 *
 * Role, MFA, terms and company checks happen in pages and actions (`@/lib/auth/session`).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const secure = request.nextUrl.protocol === "https:";
  warnIfProductionOverHttp(secure);

  if (matchesAny(pathname, SELF_MANAGED_AUTH_ROUTES)) {
    return withSecurityHeaders(NextResponse.next(), secure);
  }

  const pendingCookies = new Map<string, PendingCookie>();
  const pendingHeaders = new Headers();

  const ip = clientIp(request.headers);
  const refreshGuard = createAuthRefreshGuard({
    allowRefresh: () => consumeRateLimit(RATE_LIMITS.tokenRefreshPerIp, ip).ok,
  });

  const { url, publishableKey } = getSupabasePublicEnv();
  const supabase = createServerClient<Database>(url, publishableKey, {
    global: { fetch: refreshGuard.fetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          // After a refresh failed because Auth is busy or unreachable, auth-js drops the
          // session; that says nothing about the session itself, so keep the user's cookies.
          if (refreshGuard.failedTemporarily() && isSupabaseAuthCookie(cookie.name) && isCookieDeletion(cookie)) {
            continue;
          }
          // Mirror onto the request so Server Components in this request see the new session
          // (an empty value reads as "no cookie" for @supabase/ssr).
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.set(cookie.name, cookie);
        }
        for (const [key, value] of Object.entries(headers)) {
          pendingHeaders.set(key, value);
        }
      },
    },
  });

  // Do not add code between createServerClient and getClaims(): this call validates the JWT
  // and refreshes an expired access token (writing the new cookies through setAll above).
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  // Could not check the session because Supabase Auth is rate-limiting us or unreachable.
  const authUnavailable =
    !isAuthenticated && (refreshGuard.failedTemporarily() || isAuthUnavailableError(claimsError));

  /** Applies every collected cookie and header, plus the security headers, to the response. */
  const finish = (response: NextResponse): NextResponse => {
    for (const { name, value, options } of pendingCookies.values()) {
      response.cookies.set(name, value, options);
    }
    if (pendingCookies.size > 0) {
      // Responses that set per-user cookies must never be stored by a shared cache.
      for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
        if (!pendingHeaders.has(key)) response.headers.set(key, value);
      }
    }
    pendingHeaders.forEach((value, key) => response.headers.set(key, value));
    return withSecurityHeaders(response, secure);
  };

  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const isKeepalive = pathname === KEEPALIVE_ROUTE;
  // fetch() callers of /api/* and the keep-alive get JSON; a link the browser follows gets pages.
  const wantsJson = (isApi && !isNavigation(request)) || isKeepalive;
  const isPublicPage = matchesAny(pathname, PUBLIC_PAGES);
  // Server Actions are POSTs to the page route; a redirect would break the action protocol.
  // They re-check auth themselves (assertScaleUp / assertCompanyAccess), so let them through.
  const isServerAction = request.method === "POST" && request.headers.has("next-action");
  // 303 for anything but GET/HEAD (e.g. a no-JavaScript form post) so the browser follows with a
  // GET instead of re-sending the form body to /login.
  const redirectStatus = request.method === "GET" || request.method === "HEAD" ? 307 : 303;

  if (!isAuthenticated && !authUnavailable) {
    if (isPublicPage || isServerAction) return finish(NextResponse.next({ request }));
    if (wantsJson) {
      return finish(jsonAuthFailure(401, "You're not signed in. Please sign in again.", "signed_out"));
    }
    if (isApi) return finish(NextResponse.redirect(apiNavigationLoginUrl(request), redirectStatus));
    return finish(NextResponse.redirect(loginUrl(request), redirectStatus));
  }

  // Signed in, or holding a session we could not check right now: the idle timeout is our own
  // rule and applies either way.
  if (isIdleExpired(request.cookies.get(LAST_SEEN_COOKIE)?.value)) {
    // Revoke the session in Supabase Auth (fires SIGNED_OUT → cookie removals via setAll).
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Network failure: the cookies are still cleared below.
    }
    // Whatever signOut did or failed to do, no auth cookie may survive: expire every auth
    // cookie the browser sent and every one this request (re)wrote — including fresh tokens
    // from a refresh inside getClaims() that signOut could not revoke.
    const authCookieNames = new Set<string>();
    for (const { name } of request.cookies.getAll()) {
      if (isSupabaseAuthCookie(name)) authCookieNames.add(name);
    }
    for (const name of pendingCookies.keys()) {
      if (isSupabaseAuthCookie(name)) authCookieNames.add(name);
    }
    for (const name of authCookieNames) {
      pendingCookies.set(name, { name, value: "", options: EXPIRED_COOKIE_OPTIONS });
      request.cookies.delete(name);
    }
    pendingCookies.set(LAST_SEEN_COOKIE, { name: LAST_SEEN_COOKIE, value: "", options: EXPIRED_COOKIE_OPTIONS });
    request.cookies.delete(LAST_SEEN_COOKIE);

    if (isPublicPage || isServerAction) return finish(NextResponse.next({ request }));
    if (wantsJson) {
      return finish(jsonAuthFailure(401, "You were signed out after 30 minutes of inactivity.", "timeout"));
    }
    const timeoutUrl = request.nextUrl.clone();
    timeoutUrl.pathname = "/login";
    timeoutUrl.search = "";
    timeoutUrl.searchParams.set("reason", "timeout");
    return finish(NextResponse.redirect(timeoutUrl, redirectStatus));
  }

  if (authUnavailable) {
    // Keep the session and don't count this request as activity (it could not be verified).
    // Public pages and Server Actions run; actions report the outage through their guards.
    if (isPublicPage || isServerAction) return finish(NextResponse.next({ request }));
    if (wantsJson) return finish(jsonAuthFailure(503, AUTH_UNAVAILABLE_MESSAGE, "unavailable"));
    return finish(unavailablePage());
  }

  // Active session: this request counts as activity.
  pendingCookies.set(LAST_SEEN_COOKIE, {
    name: LAST_SEEN_COOKIE,
    value: String(Date.now()),
    options: lastSeenCookieOptions(secure),
  });
  return finish(NextResponse.next({ request }));
}

function matchesAny(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** /login, with `next=<path+query>` so the user comes back after signing in. */
function loginUrl(request: NextRequest): URL {
  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/" && !matchesAny(pathname, AUTH_FLOW_PAGES)) {
    url.searchParams.set("next", `${pathname}${search}`);
  }
  return url;
}

/**
 * A top-level browser navigation (e.g. a plain `<a href>` to a download route): `Sec-Fetch-Mode:
 * navigate`, or — from a browser without fetch metadata — an `Accept` header asking for HTML.
 * fetch() calls (the export buttons) send `cors` / `same-origin` and keep getting JSON.
 */
function isNavigation(request: NextRequest): boolean {
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return /\btext\/html\b/i.test(request.headers.get("accept") ?? "");
}

/**
 * /login for a signed-out browser navigation to an /api/* route. After signing in, the person goes back
 * to the same-origin page the link was on (`Referer`), not to the download itself; without a usable
 * referrer, to their home page.
 */
function apiNavigationLoginUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const referrer = request.headers.get("referer");
  if (referrer) {
    try {
      const from = new URL(referrer);
      const back = safeNextPath(`${from.pathname}${from.search}`, "");
      const usable =
        from.origin === request.nextUrl.origin &&
        back !== "" &&
        back !== "/" &&
        !matchesAny(from.pathname, ["/api", ...PUBLIC_PAGES, ...AUTH_FLOW_PAGES]);
      if (usable) url.searchParams.set("next", back);
    } catch {
      // A malformed Referer: no way back, the home page it is.
    }
  }
  return url;
}

/** JSON for API routes and the keep-alive: 401 `{ error, reason }`, or 503 with Retry-After. */
function jsonAuthFailure(status: 401 | 503, message: string, reason: AuthFailureReason): NextResponse {
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (status === 503) headers["Retry-After"] = String(AUTH_RETRY_AFTER_SECONDS);
  return NextResponse.json({ error: message, reason }, { status, headers });
}

/**
 * Self-contained 503 page for document requests while Supabase Auth is unavailable (the app's
 * own pages cannot render without a verified session). Static markup; nothing from the request
 * is echoed. The logo is served from /brand, which the proxy matcher excludes.
 */
function unavailablePage(): NextResponse {
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Temporarily unavailable - ScaleUp Portfolio Reporting</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 16px;background:#f7f7f7;color:#1f1f1f;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:28rem;display:flex;flex-direction:column;align-items:center;gap:32px}
img{height:56px;width:auto}
.card{width:100%;background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:24px}
h1{margin:0 0 8px;font-size:1.125rem;font-weight:600;line-height:1.3}
p{margin:0 0 20px;font-size:.875rem;line-height:1.55;color:#595959}
a{display:inline-block;background:#c25716;color:#fff;text-decoration:none;font-size:.875rem;font-weight:500;padding:8px 14px;border-radius:8px}
a:focus-visible{outline:3px solid #1f1f1f;outline-offset:2px}
</style>
</head>
<body>
<main>
<img src="/brand/scaleup-logo.png" alt="ScaleUp Malaysia" width="100" height="56">
<div class="card">
<h1>We can't confirm your sign-in right now</h1>
<p>The sign-in service is busy or can't be reached. You haven't been signed out. Please wait a minute, then try again.</p>
<a href="">Try again</a>
</div>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(AUTH_RETRY_AFTER_SECONDS),
      ...NO_STORE_HEADERS,
    },
  });
}

function withSecurityHeaders(response: NextResponse, secure: boolean): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  if (secure && process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", HSTS_HEADER);
  }
  return response;
}

let warnedAboutHttp = false;

/** One server warning when a production build is reached over plain HTTP (e.g. a LAN test). */
function warnIfProductionOverHttp(secure: boolean): void {
  if (secure || warnedAboutHttp || process.env.NODE_ENV !== "production") return;
  warnedAboutHttp = true;
  console.warn(
    "[proxy] This production build is being served over plain HTTP. Sign-in still works (cookies follow the " +
      "request scheme), but serve it over HTTPS for real use, and make sure a TLS-terminating proxy sets " +
      "X-Forwarded-Proto: https.",
  );
}

function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local.",
    );
  }
  return { url, publishableKey };
}
