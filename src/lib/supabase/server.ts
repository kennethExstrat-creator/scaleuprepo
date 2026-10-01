import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { createAuthRefreshGuard, isCookieDeletion } from "@/lib/auth/availability";
import { isSupabaseAuthCookie } from "@/lib/auth/idle";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * It uses the signed-in user's cookie session, so Row Level Security applies to every
 * query. Create one per request; never share a client between requests.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const { url, publishableKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  // A token refresh that fails because Supabase Auth is rate-limited or unreachable must not
  // sign the user out (auth-js would drop the session after a 429): skip those deletions.
  const refreshGuard = createAuthRefreshGuard();

  return createServerClient<Database>(url, publishableKey, {
    global: { fetch: refreshGuard.fetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const cookie of cookiesToSet) {
            const { name, value, options } = cookie;
            if (refreshGuard.failedTemporarily() && isSupabaseAuthCookie(name) && isCookieDeletion(cookie)) continue;
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The proxy (src/proxy.ts) refreshes the
          // session before any page renders, so the write can safely be skipped here.
        }
      },
    },
  });
}

function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local (Supabase dashboard > Project Settings > API).",
    );
  }
  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is not set. Add it to .env.local.",
    );
  }
  return { url, publishableKey };
}
