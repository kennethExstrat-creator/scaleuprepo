import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { queryError } from "./errors";
import { isUuid } from "./shared";

/** The most ids `staff_display_names` takes per call (the database refuses more). */
export const STAFF_DISPLAY_NAMES_BATCH = 500;

/**
 * Names of ScaleUp people for the company side (BRD B28): rpc `staff_display_names` maps each id that
 * belongs to ScaleUp staff to "<full name> (ScaleUp)" — e.g. "Renuka Sena (ScaleUp)", or "ScaleUp" when
 * the person has no name — and returns nothing for any other id. Never an email or a role, and the
 * staff profiles themselves stay hidden from company users (RLS), as does the partner-in-charge.
 *
 * Pass the ids a company-visible row carries (`submission_events.actor_id`, `submissions.approved_by`,
 * `comments.author_id` / `resolved_by`, `documents.uploaded_by`, `period_closes.confirmed_by`,
 * `company_members.invited_by`, …) that the caller could not resolve through `profiles`. Nulls,
 * duplicates and non-UUIDs are dropped; the result is keyed by the lower-case id. One request (one per
 * 500 distinct ids); none when nothing is left to ask. Works for every fully signed-in user (ScaleUp staff
 * get the same labels, though their pages show plain names from the profiles); throws a DataError (code
 * 42501) for sessions that are not fully signed in.
 *
 *   const names = await getStaffDisplayNames(sb, comments.map((c) => c.author_id));
 *   const author = profileName ?? names[comment.author_id] ?? SCALEUP_LABEL;
 */
export async function getStaffDisplayNames(
  sb: SupabaseClient<Database>,
  ids: Iterable<string | null | undefined>,
): Promise<Record<string, string>> {
  const unique = [...new Set([...ids].filter(isUuid).map((id) => id.toLowerCase()))];
  const names: Record<string, string> = {};
  if (unique.length === 0) return names;

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += STAFF_DISPLAY_NAMES_BATCH) {
    batches.push(unique.slice(i, i + STAFF_DISPLAY_NAMES_BATCH));
  }
  const results = await Promise.all(batches.map((batch) => sb.rpc("staff_display_names", { p_ids: batch })));
  for (const { data, error } of results) {
    if (error) throw queryError("getStaffDisplayNames", "load the names of ScaleUp staff", error);
    for (const row of data ?? []) names[row.id.toLowerCase()] = row.display_name;
  }
  return names;
}
