// Company history (/portal/[companyId]/history): every month on the platform with its status, dates,
// revision and key figures. Pure (unit-tested); the page loads the rows.

import { shownRevenueTotal } from "@/lib/exports/segments";
import { compareMonths, dateToMonthKey, type MonthKey } from "@/lib/periods";
import type { FinancialSeriesPoint, SubmissionOverviewRow } from "@/lib/types/domain";
import type { SubmissionStatus } from "@/lib/types/enums";

export type HistoryRow = {
  id: string;
  month: MonthKey;
  status: SubmissionStatus;
  isOverdue: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Times submitted (0 = never). */
  revision: number;
  revenue: number | null;
  netProfit: number | null;
  cash: number | null;
  /** The company's reporting currency (amounts are in it). */
  currency: string;
};

type OverviewInput = Pick<
  SubmissionOverviewRow,
  "id" | "month" | "status" | "is_overdue" | "submitted_at" | "approved_at" | "revision"
>;
type SeriesInput = Pick<FinancialSeriesPoint, "submission_id" | "revenue_total" | "net_profit" | "cash_in_bank" | "currency">;

/**
 * What a month still open for changes needs for its total revenue (BRD B30): the company's own revenue
 * segments in use (ids) and the segment figures of its open months, by submission id.
 */
export type OpenMonthRevenue = {
  companySegmentIds: readonly string[];
  amounts: Readonly<Record<string, Readonly<Record<string, number | null>>>>;
};

/**
 * One row per month, newest first, with the month's revenue, net profit and cash (matched by submission).
 * With `openRevenue`, a month still open for changes (draft, changes requested) shows total revenue as the
 * sum of the company's own segments once one has a figure — what the monthly form, the review page and the
 * exports show (shownRevenueTotal) — since its stored total can be out of date after the owner changed the
 * segments, until the month is next saved. Submitted and approved months show their stored total.
 */
export function buildHistoryRows(
  submissions: readonly OverviewInput[],
  series: readonly SeriesInput[],
  currency: string,
  openRevenue?: OpenMonthRevenue,
): HistoryRow[] {
  const figures = new Map(series.map((point) => [point.submission_id, point]));
  return [...submissions]
    .sort((a, b) => compareMonths(b.month, a.month))
    .map((submission) => {
      const point = figures.get(submission.id);
      const stored = point?.revenue_total ?? null;
      const revenue = openRevenue
        ? shownRevenueTotal(
            { status: submission.status, segments: openRevenue.amounts[submission.id] ?? {} },
            stored,
            openRevenue.companySegmentIds,
          ).total
        : stored;
      return {
        id: submission.id,
        month: dateToMonthKey(submission.month),
        status: submission.status,
        isOverdue: submission.is_overdue,
        submittedAt: submission.submitted_at,
        approvedAt: submission.approved_at,
        revision: submission.revision,
        revenue,
        netProfit: point?.net_profit ?? null,
        cash: point?.cash_in_bank ?? null,
        currency: point?.currency?.trim() || currency,
      };
    });
}

export type HistoryCounts = Record<SubmissionStatus, number> & { total: number; overdue: number };

/** How many months are in each status (and overdue). */
export function historyCounts(rows: readonly Pick<HistoryRow, "status" | "isOverdue">[]): HistoryCounts {
  const counts: HistoryCounts = { total: 0, overdue: 0, draft: 0, submitted: 0, changes_requested: 0, approved: 0 };
  for (const row of rows) {
    counts.total += 1;
    counts[row.status] += 1;
    if (row.isOverdue) counts.overdue += 1;
  }
  return counts;
}

/** The first and last month of the history, or null when it is empty. */
export function historyRange(rows: readonly Pick<HistoryRow, "month">[]): { from: MonthKey; to: MonthKey } | null {
  if (rows.length === 0) return null;
  const months = rows.map((row) => row.month).sort(compareMonths);
  return { from: months[0], to: months[months.length - 1] };
}
