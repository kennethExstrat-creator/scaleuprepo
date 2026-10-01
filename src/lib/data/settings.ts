import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { ClientSettings, PlatformSettingsRow } from "@/lib/types/domain";

import { notFoundError, queryError } from "./errors";

/**
 * The full platform settings row (singleton, id 1): due day, grace and escalation days, flag thresholds,
 * declaration text, terms version. ScaleUp staff only (BRD B27): for company users Row Level Security
 * hides the row, so this throws a not-found DataError (as when the row is missing; the seed always
 * creates it). Company-side code uses getClientSettings.
 */
export async function getPlatformSettings(sb: SupabaseClient<Database>): Promise<PlatformSettingsRow> {
  const op = "getPlatformSettings";
  const row = await findPlatformSettings(sb, op);
  if (!row) throw notFoundError(op, "the platform settings row");
  return row;
}

/** The full platform settings for ScaleUp staff, or null when not visible (company users). Internal. */
export async function findPlatformSettings(
  sb: SupabaseClient<Database>,
  op = "findPlatformSettings",
): Promise<PlatformSettingsRow | null> {
  const { data, error } = await sb.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw queryError(op, "load the platform settings", error);
  return data;
}

/**
 * What every signed-in user may read from the platform settings (rpc `get_client_settings`, also before
 * MFA and before the terms are accepted): `require_mfa`, `terms_version`, `declaration_text`, `due_day`
 * and `owner_contributor_limit` (BRD B29: the most active contributors a company owner can have).
 * Throws a not-found DataError when the settings row is missing.
 */
export async function getClientSettings(sb: SupabaseClient<Database>): Promise<ClientSettings> {
  const op = "getClientSettings";
  const { data, error } = await sb.rpc("get_client_settings").maybeSingle();
  if (error) throw queryError(op, "load the platform settings", error);
  if (!data) throw notFoundError(op, "the platform settings row");
  return data;
}
