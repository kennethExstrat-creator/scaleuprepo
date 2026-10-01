import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { EXPIRED_COOKIE_OPTIONS, isSupabaseAuthCookie, LAST_SEEN_COOKIE } from "@/lib/auth/idle";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout[?reason=timeout] — ends the session (revokes it in Supabase Auth and
 * clears every auth cookie), then 303 → /login (keeping ?reason=timeout so the login page
 * can explain why). Used by the user menu, the sign-out buttons and <IdleTimer>.
 */
export async function POST(request: NextRequest) {
  // Refuse cross-site form posts (logout CSRF); same-origin forms and fetches pass.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site sign-out is not allowed." }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.warn("[auth/signout] signOut failed", error.code, error.message);

  // Clear anything signOut could not (e.g. when the Auth API was unreachable).
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) cookieStore.set(cookie.name, "", EXPIRED_COOKIE_OPTIONS);
  }
  cookieStore.set(LAST_SEEN_COOKIE, "", EXPIRED_COOKIE_OPTIONS);

  const location = request.nextUrl.searchParams.get("reason") === "timeout" ? "/login?reason=timeout" : "/login";
  // Relative Location (robust behind proxies); the cookie deletions above are merged in by Next.js.
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}
