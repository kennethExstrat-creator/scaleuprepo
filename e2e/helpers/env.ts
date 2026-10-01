/**
 * Reads the Supabase settings from the app's ../.env.local without ever printing them.
 * Only the three keys the E2E suite needs are returned; values never reach logs or reports.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type E2EEnv = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
};

const here = dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = resolve(here, "..");
export const REPO_ROOT = resolve(E2E_ROOT, "..");

let cached: E2EEnv | null = null;

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(): E2EEnv {
  if (cached) return cached;
  const vars = parseDotenv(readFileSync(resolve(REPO_ROOT, ".env.local"), "utf8"));
  const supabaseUrl = vars.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = vars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secretKey = vars.SUPABASE_SECRET_KEY ?? vars.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    !secretKey && "SUPABASE_SECRET_KEY",
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`../.env.local is missing: ${missing.join(", ")}`);
  cached = { supabaseUrl: supabaseUrl!, publishableKey: publishableKey!, secretKey: secretKey! };
  return cached;
}

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3001";
