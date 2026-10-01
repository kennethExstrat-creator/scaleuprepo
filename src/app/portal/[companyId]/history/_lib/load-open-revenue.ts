import "server-only";

// What the history page needs to show the total revenue of months still open for changes as the sum of the
// company's own revenue segments (BRD B30; history-model.ts buildHistoryRows, `openRevenue`): the company's
// own segments in use and the segment figures of its open months, on the RLS-scoped client.

import type { SupabaseClient } from "@supabase/supabase-js";

import { DataError } from "@/lib/data";
import { toFiniteNumber } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";

import type { OpenMonthRevenue } from "./history-model";

function loadError(what: string, error: { message: string; code?: string }): DataError {
  return new DataError("loadOpenMonthRevenue", `could not load ${what}: ${error.message}`, { code: error.code, cause: error });
}

/**
 * The company's own revenue segments in use and the figures of the given open months (none are read when
 * the company has no segments of its own, or no month is open).
 */
export async function loadOpenMonthRevenue(
  sb: SupabaseClient<Database>,
  companyId: string,
  openSubmissionIds: readonly string[],
): Promise<OpenMonthRevenue> {
  if (openSubmissionIds.length === 0) return { companySegmentIds: [], amounts: {} };
  const segmentsRes = await sb
    .from("revenue_segments")
    .select("id")
    .eq("company_id", companyId)
    .eq("kind", "company")
    .eq("is_active", true);
  if (segmentsRes.error) throw loadError("the revenue segments", segmentsRes.error);
  const segments: { id: string }[] = segmentsRes.data;
  if (segments.length === 0) return { companySegmentIds: [], amounts: {} };

  const valuesRes = await sb
    .from("submission_segment_values")
    .select("submission_id, segment_id, amount")
    .in("submission_id", [...openSubmissionIds]);
  if (valuesRes.error) throw loadError("the revenue segment figures", valuesRes.error);
  const rows: { submission_id: string; segment_id: string; amount: number | null }[] = valuesRes.data;
  const amounts: Record<string, Record<string, number | null>> = {};
  for (const row of rows) {
    amounts[row.submission_id] = { ...(amounts[row.submission_id] ?? {}), [row.segment_id]: toFiniteNumber(row.amount) };
  }
  return { companySegmentIds: segments.map((segment) => segment.id), amounts };
}
