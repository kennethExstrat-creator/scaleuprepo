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
