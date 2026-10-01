import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toFiniteNumber } from "@/lib/format";
import { monthKeyToDate, parseMonthKey } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import { toMonthlyFinancials, type FinancialSeriesPoint } from "@/lib/types/domain";

import { queryError } from "./errors";
import { isUuid, sortByMonthAsc, toFinancialsRow } from "./shared";

/** Optional month bound → 'YYYY-MM-01'; throws a RangeError naming the argument when malformed. */
function monthBound(value: string | null | undefined, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const key = parseMonthKey(value);
  if (!key) {
    throw new RangeError(
      `getFinancialSeries: ${name} ${JSON.stringify(value)} is not a month (expected YYYY-MM or YYYY-MM-DD).`,
    );
  }
  return monthKeyToDate(key);
}

/**
 * The company's monthly system numbers (v_submission_financials), oldest month first, optionally limited
 * to `fromMonth`..`toMonth` (inclusive; 'YYYY-MM' or 'YYYY-MM-DD'). Every submission is included whatever
 * its status: filter on `status` (e.g. only 'approved' for LP-facing figures). Amounts are in `currency`;
 * multiply by `fx_rate_to_myr` (when not null) for RM. `month` is the stored date ('2026-09-01').
 * [] when nothing is visible. Throws a RangeError for a malformed bound.
 */
export async function getFinancialSeries(
  sb: SupabaseClient<Database>,
  companyId: string,
  fromMonth?: string | null,
  toMonth?: string | null,
): Promise<FinancialSeriesPoint[]> {
  const from = monthBound(fromMonth, "fromMonth");
  const to = monthBound(toMonth, "toMonth");
  if (!isUuid(companyId)) return [];

  let query = sb.from("v_submission_financials").select("*").eq("company_id", companyId);
  if (from) query = query.gte("month", from);
  if (to) query = query.lte("month", to);
  const { data, error } = await query.order("month", { ascending: true });
  if (error) {
    const range = from || to ? ` (${from ?? "start"} to ${to ?? "latest"})` : "";
    throw queryError("getFinancialSeries", `load the monthly figures of company ${companyId}${range}`, error);
  }

  const rows = sortByMonthAsc(data.flatMap((row) => toFinancialsRow(row) ?? []));
  return rows.map((row) => ({
    ...toMonthlyFinancials(row),
    submission_id: row.submission_id,
    status: row.status,
    currency: row.currency,
    fx_rate_to_myr: toFiniteNumber(row.fx_rate_to_myr),
  }));
}
