/**
 * Supabase clients for test set-up and assertions. The service-role client is used only for the
 * dedicated E2E accounts and the dedicated E2E company (never for real portfolio data).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadEnv } from "./env";

// The app's generated Database type lives in src/ (owned by another module); the suite works untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, "public", any>;

export function adminClient(): AnyClient {
  const env = loadEnv();
  return createClient(env.supabaseUrl, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** A client with the publishable key (like the browser), for signing in as an E2E account. */
export function publicClient(): AnyClient {
  const env = loadEnv();
  return createClient(env.supabaseUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Throws with a readable message (never including keys) when a Supabase call failed. */
export function must<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    const code = result.error.code ? ` [${result.error.code}]` : "";
    throw new Error(`${what} failed${code}: ${result.error.message}`);
  }
  return result.data;
}
