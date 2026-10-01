import { NextResponse, type NextRequest } from "next/server";

import { isAuthUnavailableError } from "@/lib/auth/availability";
import { clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { safeNextPath } from "@/lib/auth/redirects";
import { startIdleClock } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * PKCE callback (e.g. the password-reset email from /forgot-password):
 * `/auth/callback?code=…&next=/set-password`. Exchanges the code for a session — this needs
 * the code-verifier cookie, so the link must be opened in the browser that requested it (a link
 * scanner cannot complete it) — then continues to the validated `next`. Failures go to
 * /login?error=link_invalid (or too_many_attempts / service_unavailable). Throttled per client IP
 * (each exchange spends Supabase's per-IP verification budget).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    const reason = searchParams.get("error_code") ?? searchParams.get("error");
    if (reason) console.warn("[auth/callback] auth error", reason, searchParams.get("error_description"));
    return redirectTo("/login?error=link_invalid");
  }

  if (!consumeRateLimit(RATE_LIMITS.emailLinkPerIp, clientIp(request.headers)).ok) {
    return redirectTo("/login?error=too_many_attempts");
  }

  const supabase = await createClient();
  // auth-js may append its PKCE flow id to the redirect URL; pass it through when present.
  const flowId = searchParams.get("sb_flow_id");
  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error) {
    console.warn("[auth/callback] exchangeCodeForSession failed", error.code, error.message);
    return redirectTo(isAuthUnavailableError(error) ? "/login?error=service_unavailable" : "/login?error=link_invalid");
  }

  // A new session: start the idle-timeout clock before the first authenticated request.
  await startIdleClock();
  return redirectTo(next);
}

/** Same-origin redirect with a relative Location (robust behind proxies); cookies set via cookies() are merged in. */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path, "Cache-Control": "no-store" } });
}
