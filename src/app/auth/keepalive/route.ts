import { AUTH_RETRY_AFTER_SECONDS, AUTH_UNAVAILABLE_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import type { AuthFailureReason } from "@/lib/auth/idle";
import { createClient } from "@/lib/supabase/server";

// Never cache: the point of the request is to pass through the proxy.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET/POST /auth/keepalive — used by <IdleTimer> (pings while the user is active, and the
 * "Stay signed in" button). The proxy has already refreshed the session and the `su_last_seen`
 * idle cookie, or answered 401 `{ error, reason }` when the session is gone or timed out (503
 * `reason: "unavailable"` when Supabase Auth could not be reached); this handler only
 * double-checks the session and returns 204.
 */
async function handle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return new Response(null, { status: 204, headers: NO_STORE });

  if (isAuthUnavailableError(error)) {
    const reason: AuthFailureReason = "unavailable";
    return Response.json(
      { error: AUTH_UNAVAILABLE_MESSAGE, reason },
      { status: 503, headers: { ...NO_STORE, "Retry-After": String(AUTH_RETRY_AFTER_SECONDS) } },
    );
  }
  const reason: AuthFailureReason = "signed_out";
  return Response.json({ error: "You're not signed in.", reason }, { status: 401, headers: NO_STORE });
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
