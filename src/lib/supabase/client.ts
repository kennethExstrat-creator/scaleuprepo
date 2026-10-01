import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Client Components (a singleton in the browser).
 *
 * Use it only where the browser must talk to Supabase directly: TOTP enrolment and
 * verification on /mfa, and uploads to signed upload URLs. Everything else goes through
 * Server Components and Server Actions with the server client.
 */
export function createClient(): SupabaseClient<Database> {
  // Literal process.env references so Next.js can inline them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local.",
    );
  }
  return createBrowserClient<Database>(url, publishableKey);
}
