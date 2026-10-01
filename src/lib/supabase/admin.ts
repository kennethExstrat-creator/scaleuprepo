import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Service-role Supabase client. It BYPASSES Row Level Security and has no audit actor.
 *
 * Only for Supabase Auth admin APIs (invite, ban, MFA reset, generateLink) and for signing
 * storage URLs after the caller's permission has been checked. Never use it to read or
 * write business tables — use the RLS-scoped client from `@/lib/supabase/server`.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.");
  }
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY (or the legacy SUPABASE_SERVICE_ROLE_KEY) is not set. The admin client needs the " +
        "project's secret key (Supabase dashboard > Project Settings > API keys). Never expose it to the browser.",
    );
  }
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
