import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { CompanySegmentInput, RevenueSegmentRow } from "@/lib/types/domain";

import { notFoundError, queryError } from "./errors";
import { isUuid, sortConfigRows } from "./shared";

/**
 * Saves the company's own revenue segments (BRD B30) — rpc `set_company_revenue_segments`: the COMPLETE
 * list in display order, each item a current segment's `id` (from `config.companySegments`) with its
 * (possibly new) name, or just a `name` for a new segment. Returns the company's active company segments
 * in order.
 *
 * The database decides everything (docs/ARCHITECTURE.md §2.4): unchanged names keep their id; a renamed
 * segment is renamed in place unless it has figures in a submitted or approved month — then it continues
 * as a new series and the months still open for changes move to it; segments left out are retired and
 * cleared from those open months; submitted and approved months never change. Callers: the company's
 * owner (active company), or a Super Admin / Fund Admin on the owner's behalf (audited as such).
 *
 * Failures throw a DataError with the database code kept for toActionError(): 42501 "Only the company
 * owner can change its revenue segments." (anyone else), P0001 for the read-only message of exited
 * companies, list problems (see companySegmentListError in @/lib/types/domain) and "The revenue segments
 * have changed since this page was opened. Reload the page and try again." (ids that are no longer
 * current). A non-UUID company id throws a not-found DataError without a request.
 */
export async function setCompanyRevenueSegments(
  sb: SupabaseClient<Database>,
  companyId: string,
  segments: readonly CompanySegmentInput[],
): Promise<RevenueSegmentRow[]> {
  const op = "setCompanyRevenueSegments";
  if (!isUuid(companyId)) throw notFoundError(op, `company ${JSON.stringify(companyId)}`);
  const list = segments.map((segment) => (segment.id ? { id: segment.id, name: segment.name } : { name: segment.name }));
  const { data, error } = await sb.rpc("set_company_revenue_segments", { p_company_id: companyId, p_segments: list });
  if (error) throw queryError(op, `save the revenue segments of company ${companyId}`, error);
  const rows: RevenueSegmentRow[] = data ?? [];
  return sortConfigRows(rows);
}
