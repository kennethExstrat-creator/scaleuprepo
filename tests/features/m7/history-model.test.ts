import { describe, expect, it } from "vitest";

import { buildHistoryRows, historyCounts, historyRange } from "@/app/portal/[companyId]/history/_lib/history-model";

const submissions = [
  { id: "s7", month: "2026-07-01", status: "approved" as const, is_overdue: false, submitted_at: "2026-08-10T02:00:00Z", approved_at: "2026-08-20T02:00:00Z", revision: 2 },
  { id: "s9", month: "2026-09-01", status: "draft" as const, is_overdue: false, submitted_at: null, approved_at: null, revision: 0 },
  { id: "s8", month: "2026-08-01", status: "changes_requested" as const, is_overdue: true, submitted_at: "2026-09-12T02:00:00Z", approved_at: null, revision: 1 },
];

const series = [
  { submission_id: "s7", revenue_total: 120_000, net_profit: -5_000, cash_in_bank: 400_000, currency: "USD" },
  { submission_id: "s8", revenue_total: 90_000, net_profit: null, cash_in_bank: 380_000, currency: "USD " },
];

describe("buildHistoryRows", () => {
  it("lists every month newest first with its figures", () => {
    expect(buildHistoryRows(submissions, series, "MYR")).toEqual([
      { id: "s9", month: "2026-09", status: "draft", isOverdue: false, submittedAt: null, approvedAt: null, revision: 0, revenue: null, netProfit: null, cash: null, currency: "MYR" },
      { id: "s8", month: "2026-08", status: "changes_requested", isOverdue: true, submittedAt: "2026-09-12T02:00:00Z", approvedAt: null, revision: 1, revenue: 90_000, netProfit: null, cash: 380_000, currency: "USD" },
      { id: "s7", month: "2026-07", status: "approved", isOverdue: false, submittedAt: "2026-08-10T02:00:00Z", approvedAt: "2026-08-20T02:00:00Z", revision: 2, revenue: 120_000, netProfit: -5_000, cash: 400_000, currency: "USD" },
    ]);
  });

  it("is empty without submissions", () => {
    expect(buildHistoryRows([], series, "MYR")).toEqual([]);
  });

  it("shows an open month's total revenue as the sum of the company's own segments (BRD B30)", () => {
    // Aug (sent back) still stores 90,000, but after the owner removed a segment its figures add up to 60,000.
    const openRevenue = {
      companySegmentIds: ["seg-retail", "seg-web"],
      amounts: {
        s8: { "seg-retail": 40_000, "seg-web": 20_000, "line-aone": 5_000 },
        s7: { "seg-retail": 1 },
      },
    };
    const rows = buildHistoryRows(submissions, series, "MYR", openRevenue);
    expect(rows.map((row) => [row.id, row.revenue])).toEqual([
      ["s9", null], // nothing yet
      ["s8", 60_000], // the segments in use; ScaleUp lines never count
      ["s7", 120_000], // approved: the stored total, always
    ]);
    // No segment figure yet: the stored total stays; no segments of its own: always the stored total.
    expect(buildHistoryRows(submissions, series, "MYR", { ...openRevenue, amounts: {} })[1].revenue).toBe(90_000);
    expect(buildHistoryRows(submissions, series, "MYR", { companySegmentIds: [], amounts: openRevenue.amounts })[1].revenue).toBe(90_000);
  });
});

describe("historyCounts / historyRange", () => {
  const rows = buildHistoryRows(submissions, series, "MYR");

  it("counts months by status and overdue", () => {
    expect(historyCounts(rows)).toEqual({ total: 3, overdue: 1, draft: 1, submitted: 0, changes_requested: 1, approved: 1 });
    expect(historyCounts([])).toEqual({ total: 0, overdue: 0, draft: 0, submitted: 0, changes_requested: 0, approved: 0 });
  });

  it("gives the first and last month", () => {
    expect(historyRange(rows)).toEqual({ from: "2026-07", to: "2026-09" });
    expect(historyRange([])).toBeNull();
  });
});
