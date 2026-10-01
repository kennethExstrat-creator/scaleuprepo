import { describe, expect, it } from "vitest";

import {
  buildCompanyDocumentsView,
  buildPortfolioRows,
  closeCountFrom,
  compareClosesNewestFirst,
  defaultExpandedCloses,
  liveCloseTotals,
  parsePeriodKey,
  periodKey,
  periodOptionsBetween,
  personLabel,
  revenueComparison,
  staffIdsToResolve,
  summarisePortfolio,
  upcomingClose,
  type CloseRecord,
  type CompanyRecord,
  type DocumentRecord,
  type FinancialRecord,
  type MonthRecord,
  type PersonProfile,
} from "@/components/documents/view-model";
import { quarterOf } from "@/lib/periods";

const COMPANY: CompanyRecord = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Batik Boutique",
  status: "active",
  reporting_currency: "MYR",
  reporting_start_month: "2026-07-01",
};

const OWNER: PersonProfile = { full_name: "Nadia Owner", email: "nadia@batik.example", scaleup_role: null };
const FUND_ADMIN: PersonProfile = { full_name: "Farid Admin", email: "farid@scaleup.example", scaleup_role: "fund_admin" };
/** What getStaffDisplayNames returns for the Fund Admin (BRD B28). */
const STAFF_NAMES = { "admin-id": "Farid Admin (ScaleUp)" };

function close(overrides: Partial<CloseRecord> & Pick<CloseRecord, "id">): CloseRecord {
  return {
    period_type: "quarter",
    period_start: "2026-07-01",
    period_end: "2026-09-30",
    label: "Q3 2026",
    status: "open",
    confirmed_at: null,
    confirmed_by: null,
    computed_totals: null,
    restated_totals: null,
    restatement_reason: null,
    confirmer: null,
    ...overrides,
  };
}

function doc(overrides: Partial<DocumentRecord> & Pick<DocumentRecord, "id">): DocumentRecord {
  return {
    period_close_id: "q3",
    doc_type: "management_accounts",
    file_name: "accounts.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    version: 1,
    uploaded_at: "2026-10-05T06:00:00Z",
    uploaded_by: "owner-id",
    uploader: OWNER,
    ...overrides,
  };
}

const FIGURES = [
  { revenue_total: 100, gross_profit: 40, net_profit: -10, cash_in_bank: 1000, burn_rate: 30, headcount_ft: 10, headcount_pt: 2 },
  { revenue_total: 200, gross_profit: 90, net_profit: 20, cash_in_bank: 900, burn_rate: 20, headcount_ft: 11, headcount_pt: 3 },
  { revenue_total: 300, gross_profit: 150, net_profit: 60, cash_in_bank: 800, burn_rate: 10, headcount_ft: 12, headcount_pt: 4 },
];

function financials(statuses: FinancialRecord["status"][]): FinancialRecord[] {
  return statuses.map((status, i) => ({ month: `2026-0${7 + i}-01`, status, ...FIGURES[i] }));
}

function months(statuses: MonthRecord["status"][], overdue: boolean[] = []): MonthRecord[] {
  return statuses.map((status, i) => ({ id: `sub-${7 + i}`, month: `2026-0${7 + i}-01`, status, is_overdue: overdue[i] ?? false }));
}

describe("personLabel", () => {
  it("names ScaleUp staff '<full name> (ScaleUp)' on the company side, never by email or role (BRD B28)", () => {
    expect(personLabel(OWNER, "owner-id", "company", STAFF_NAMES)).toBe("Nadia Owner");
    // Company users cannot read staff profiles (null embed): the name comes from staff_display_names.
    expect(personLabel(null, "admin-id", "company", STAFF_NAMES)).toBe("Farid Admin (ScaleUp)");
    // Even a readable staff profile never gives its email or role away on the company side.
    expect(personLabel(FUND_ADMIN, "admin-id", "company", STAFF_NAMES)).toBe("Farid Admin (ScaleUp)");
    // Ids are looked up in lower case, as getStaffDisplayNames keys them.
    const upper = "A0000000-0000-4000-8000-0000000000AA";
    expect(personLabel(null, upper, "company", { [upper.toLowerCase()]: "Renuka Sena (ScaleUp)" })).toBe("Renuka Sena (ScaleUp)");
  });

  it("falls back to 'ScaleUp' on the company side for system actions and when the names could not be loaded", () => {
    expect(personLabel(null, null, "company", STAFF_NAMES)).toBe("ScaleUp");
    // Names not loaded (lookup failed): nobody hidden can be told apart.
    expect(personLabel(null, "admin-id", "company")).toBe("ScaleUp");
    expect(personLabel(null, "someone-else", "company", undefined)).toBe("ScaleUp");
    // A staff profile (never readable by company users in practice) is still never shown.
    expect(personLabel(FUND_ADMIN, "admin-id", "company", {})).toBe("ScaleUp");
    expect(personLabel(null, "admin-id", "company", { "admin-id": "  " })).toBe("ScaleUp");
  });

  it("names a hidden person the loaded names do not include as a former team member (not ScaleUp)", () => {
    expect(personLabel(null, "removed-contributor", "company", STAFF_NAMES)).toBe("Former team member");
    // Own keys only: an id can never pick up an Object.prototype member.
    expect(personLabel(null, "constructor", "company", {})).toBe("Former team member");
  });

  it("names people and ScaleUp roles on the ScaleUp side", () => {
    expect(personLabel(OWNER, "owner-id", "scaleup")).toBe("Nadia Owner");
    expect(personLabel(FUND_ADMIN, "admin-id", "scaleup")).toBe("Farid Admin (Fund Admin)");
    // Staff display names are for the company side only.
    expect(personLabel(FUND_ADMIN, "admin-id", "scaleup", STAFF_NAMES)).toBe("Farid Admin (Fund Admin)");
    expect(personLabel({ full_name: " ", email: "x@y.example", scaleup_role: null }, "x", "scaleup")).toBe("x@y.example");
    expect(personLabel(null, "gone", "scaleup")).toBe("Unknown user");
    expect(personLabel(null, null, "scaleup")).toBe("System");
  });
});

describe("staffIdsToResolve", () => {
  it("lists the uploaders and confirmers the company side cannot name from profiles, once each, in lower case", () => {
    const ids = staffIdsToResolve(
      [
        close({ id: "q2", status: "confirmed", confirmed_by: "B-STAFF", confirmer: null }),
        close({ id: "q1", status: "confirmed", confirmed_by: "owner-id", confirmer: OWNER }),
        // An open close shows no confirmer (a reopen clears it anyway).
        close({ id: "q3", status: "open", confirmed_by: "c-staff", confirmer: null }),
      ],
      [
        doc({ id: "d1", uploaded_by: "a-staff", uploader: null }),
        doc({ id: "d2", uploaded_by: "A-STAFF", uploader: null }),
        doc({ id: "d3", uploaded_by: "owner-id", uploader: OWNER }),
        doc({ id: "d4", uploaded_by: "d-staff", uploader: FUND_ADMIN }),
        doc({ id: "d5", uploaded_by: null, uploader: null }),
      ],
    );
    expect(ids).toEqual(["a-staff", "b-staff", "d-staff"]);
    expect(staffIdsToResolve([], [doc({ id: "d", uploaded_by: "owner-id", uploader: OWNER })])).toEqual([]);
  });
});

describe("closeCountFrom", () => {
  const q3 = { period_start: "2026-07-01", period_end: "2026-09-30" };

  it("counts from the later of the period start and the reporting start", () => {
    expect(closeCountFrom(q3, "2026-07-01", [])).toBe("2026-07");
    expect(closeCountFrom(q3, "2026-08-01", [])).toBe("2026-08");
    expect(closeCountFrom(q3, "2025-01-01", [])).toBe("2026-07");
  });

  it("without a start month, counts from the first month with a submission in the period", () => {
    expect(closeCountFrom(q3, null, ["2026-06-01", "2026-09-01", "2026-08-01"])).toBe("2026-08");
    expect(closeCountFrom(q3, null, ["2026-10-01"])).toBe("2026-07");
    expect(closeCountFrom(q3, null, [])).toBe("2026-07");
  });
});

describe("liveCloseTotals", () => {
  const q3 = { period_start: "2026-07-01", period_end: "2026-09-30" };

  it("uses the submitted and approved months only (like computed_totals)", () => {
    expect(liveCloseTotals(q3, "2026-07-01", financials(["approved", "submitted", "submitted"]))).toEqual({
      months_count: 3,
      revenue_total: 600,
      gross_profit: 280,
      net_profit: 70,
      gp_pct: 46.6667,
      np_pct: 11.6667,
      cash_in_bank: 800,
      avg_burn_rate: 20,
      headcount_ft: 12,
      headcount_pt: 4,
    });
    const partial = liveCloseTotals(q3, "2026-07-01", financials(["approved", "changes_requested", "draft"]));
    expect(partial.months_count).toBe(1);
    expect(partial.revenue_total).toBe(100);
    expect(partial.cash_in_bank).toBe(1000);
  });

  it("ignores months before the reporting start and outside the period", () => {
    const series = [...financials(["submitted", "submitted", "submitted"]), { ...financials(["submitted"])[0], month: "2026-10-01" }];
    expect(liveCloseTotals(q3, "2026-08-01", series).months_count).toBe(2);
  });
});

describe("revenueComparison (BRD §6.1: QoQ and HoH growth)", () => {
  const point = (month: string, revenue: number, status: FinancialRecord["status"] = "approved"): FinancialRecord => ({
    month,
    status,
    revenue_total: revenue,
    gross_profit: null,
    net_profit: null,
    cash_in_bank: null,
    burn_rate: null,
    headcount_ft: null,
    headcount_pt: null,
  });
  const q2 = ["2026-04-01", "2026-05-01", "2026-06-01"].map((month) => point(month, 100));
  const q3 = ["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => point(month, 150));

  it("compares a complete quarter with the complete quarter before it", () => {
    expect(revenueComparison(close({ id: "q3" }), [], [...q2, ...q3])).toEqual({
      kind: "QoQ",
      previousLabel: "Q2 2026",
      previousRevenue: 300,
      revenue: 450,
      growthPct: 50,
    });
  });

  it("says nothing while either period is incomplete (not every month submitted)", () => {
    expect(revenueComparison(close({ id: "q3" }), [], [...q2, q3[0], q3[1]])).toBeNull();
    expect(revenueComparison(close({ id: "q3" }), [], [...q2, q3[0], q3[1], point("2026-09-01", 150, "changes_requested")])).toBeNull();
    expect(revenueComparison(close({ id: "q3" }), [], [q2[1], q2[2], ...q3])).toBeNull();
  });

  it("uses a confirmed close's figures, restated ones included", () => {
    const confirmedQ2 = close({
      id: "q2",
      period_start: "2026-04-01",
      period_end: "2026-06-30",
      label: "Q2 2026",
      status: "confirmed",
      computed_totals: { months_count: 3, revenue_total: 300 },
      restated_totals: { revenue_total: 360 },
    });
    expect(revenueComparison(close({ id: "q3" }), [confirmedQ2], q3)).toMatchObject({
      previousLabel: "Q2 2026",
      previousRevenue: 360,
      growthPct: 25,
    });
    const half = close({ id: "h2", period_type: "half", period_start: "2026-07-01", period_end: "2026-12-31", label: "H2 2026" });
    expect(revenueComparison(half, [], [...q2, ...q3])).toBeNull(); // H1 2026 and H2 2026 are incomplete
  });
});

describe("buildCompanyDocumentsView", () => {
  it("shapes an open close: months, counts, live totals, documents and readiness", () => {
    const view = buildCompanyDocumentsView({
      mode: "company",
      company: COMPANY,
      closes: [close({ id: "q3" })],
      documents: [
        doc({ id: "ma1", version: 1, uploaded_at: "2026-10-02T01:00:00Z" }),
        doc({ id: "ma2", version: 2, uploaded_by: "admin-id", uploader: null, file_name: "accounts v2.pdf" }),
        doc({ id: "sup1", doc_type: "supporting", version: 1, file_name: "bank.pdf" }),
        doc({ id: "gen1", period_close_id: null, doc_type: "supporting", file_name: "board pack.docx" }),
      ],
      months: months(["approved", "submitted", "changes_requested"], [false, false, true]),
      financials: financials(["approved", "submitted", "changes_requested"]),
      staffNames: STAFF_NAMES,
    });

    expect(view.company).toEqual({
      id: COMPANY.id,
      name: "Batik Boutique",
      status: "active",
      currency: "MYR",
      reportingStartMonth: "2026-07",
    });
    const [q3] = view.closes;
    expect(q3).toMatchObject({
      id: "q3",
      label: "Q3 2026",
      typeLabel: "Quarter",
      rangeLabel: "Jul–Sep 2026",
      countFrom: "2026-07",
      status: "open",
      countedMonths: 3,
      submittedMonths: 2,
      allSubmitted: false,
      computedTotals: null,
      restatedTotals: null,
      confirmedAt: null,
      confirmedBy: null,
      readyToConfirm: false,
    });
    expect(q3.months).toEqual([
      { month: "2026-07", counted: true, submissionId: "sub-7", status: "approved", overdue: false, submitted: true },
      { month: "2026-08", counted: true, submissionId: "sub-8", status: "submitted", overdue: false, submitted: true },
      { month: "2026-09", counted: true, submissionId: "sub-9", status: "changes_requested", overdue: true, submitted: false },
    ]);
    expect(q3.liveTotals.months_count).toBe(2);
    expect(q3.liveTotals.revenue_total).toBe(300);
    expect(q3.managementAccounts.map((d) => [d.id, d.version, d.isLatest, d.uploadedBy])).toEqual([
      ["ma2", 2, true, "Farid Admin (ScaleUp)"],
      ["ma1", 1, false, "Nadia Owner"],
    ]);
    expect(q3.supporting.map((d) => [d.id, d.isLatest])).toEqual([["sup1", true]]);
    expect(view.otherDocuments.map((d) => [d.id, d.isLatest])).toEqual([["gen1", true]]);
  });

  it("is ready to confirm once every counted month is in and management accounts are uploaded", () => {
    const base = {
      mode: "company" as const,
      company: { ...COMPANY, reporting_start_month: "2026-08-01" },
      closes: [close({ id: "q3" })],
      months: months(["draft", "submitted", "approved"]),
      financials: financials(["draft", "submitted", "approved"]),
    };
    const withoutAccounts = buildCompanyDocumentsView({ ...base, documents: [doc({ id: "s", doc_type: "supporting" })] });
    expect(withoutAccounts.closes[0]).toMatchObject({ countedMonths: 2, submittedMonths: 2, allSubmitted: true, readyToConfirm: false });
    expect(withoutAccounts.closes[0].months[0]).toMatchObject({ month: "2026-07", counted: false, status: "draft" });
    const ready = buildCompanyDocumentsView({ ...base, documents: [doc({ id: "ma" })] });
    expect(ready.closes[0].readyToConfirm).toBe(true);
    expect(ready.closes[0].liveTotals.months_count).toBe(2);
  });

  it("is never ready to confirm for an exited or written-off company (read-only)", () => {
    for (const status of ["exited", "written_off"] as const) {
      const view = buildCompanyDocumentsView({
        mode: "company",
        company: { ...COMPANY, status },
        closes: [close({ id: "q3" })],
        documents: [doc({ id: "ma" })],
        months: months(["approved", "approved", "approved"]),
        financials: financials(["approved", "approved", "approved"]),
      });
      expect(view.closes[0]).toMatchObject({ status: "open", countedMonths: 3, submittedMonths: 3, allSubmitted: true, readyToConfirm: false });
      expect(view.closes[0].managementAccounts).toHaveLength(1);
    }
  });

  it("shows the confirmation: snapshot, restatement, reason and who confirmed", () => {
    const confirmedClose = close({
      id: "q3",
      status: "confirmed",
      confirmed_at: "2026-10-06T02:00:00Z",
      confirmed_by: "admin-id",
      computed_totals: { months_count: 3, revenue_total: 600, gp_pct: 46.6667 },
      restated_totals: { revenue_total: 610 },
      restatement_reason: "  Year-end accrual ",
    });
    const input = {
      mode: "company" as const,
      company: COMPANY,
      closes: [confirmedClose],
      documents: [doc({ id: "ma" })],
      months: months(["approved", "approved", "approved"]),
      financials: financials(["approved", "approved", "approved"]),
    };
    const view = buildCompanyDocumentsView({ ...input, staffNames: STAFF_NAMES });
    expect(view.closes[0]).toMatchObject({
      status: "confirmed",
      confirmedAt: "2026-10-06T02:00:00Z",
      confirmedBy: "Farid Admin (ScaleUp)",
      restatedTotals: { revenue_total: 610 },
      restatementReason: "Year-end accrual",
      readyToConfirm: false,
    });
    expect(view.closes[0].computedTotals).toMatchObject({ months_count: 3, revenue_total: 600, net_profit: null });
    // Without the staff names (lookup failed): "ScaleUp".
    expect(buildCompanyDocumentsView(input).closes[0].confirmedBy).toBe("ScaleUp");
    expect(buildCompanyDocumentsView({ ...input, staffNames: undefined }).closes[0].confirmedBy).toBe("ScaleUp");

    const scaleup = buildCompanyDocumentsView({
      mode: "scaleup",
      company: COMPANY,
      closes: [close({ id: "q3", status: "confirmed", confirmed_by: "admin-id", confirmer: FUND_ADMIN })],
      documents: [],
      months: [],
      financials: [],
    });
    expect(scaleup.closes[0].confirmedBy).toBe("Farid Admin (Fund Admin)");
  });

  it("keeps a restatement of a reopened close but no confirmation details", () => {
    const view = buildCompanyDocumentsView({
      mode: "scaleup",
      company: COMPANY,
      closes: [close({ id: "q3", status: "open", restated_totals: { cash_in_bank: 805 }, restatement_reason: "Accrual" })],
      documents: [],
      months: [],
      financials: [],
    });
    expect(view.closes[0]).toMatchObject({
      restatedTotals: { cash_in_bank: 805 },
      restatementReason: "Accrual",
      computedTotals: null,
      confirmedBy: null,
    });
  });

  it("orders closes newest first, quarters before halves ending the same day", () => {
    const view = buildCompanyDocumentsView({
      mode: "company",
      company: COMPANY,
      closes: [
        close({ id: "q3" }),
        close({ id: "h2", period_type: "half", period_start: "2026-07-01", period_end: "2026-12-31", label: "H2 2026" }),
        close({ id: "q4", period_start: "2026-10-01", period_end: "2026-12-31", label: "Q4 2026" }),
      ],
      documents: [doc({ id: "lost", period_close_id: "unknown-close" })],
      months: [],
      financials: [],
    });
    expect(view.closes.map((c) => c.id)).toEqual(["q4", "h2", "q3"]);
    expect(view.closes[1]).toMatchObject({ typeLabel: "Half-year", rangeLabel: "Jul–Dec 2026", countedMonths: 6 });
    // A document whose close is not listed is still shown (under the other documents).
    expect(view.otherDocuments.map((d) => d.id)).toEqual(["lost"]);
  });

  it("trims the reporting currency", () => {
    const view = buildCompanyDocumentsView({
      mode: "scaleup",
      company: { ...COMPANY, reporting_currency: "USD", reporting_start_month: null },
      closes: [],
      documents: [],
      months: [],
      financials: [],
    });
    expect(view.company).toMatchObject({ currency: "USD", reportingStartMonth: null });
  });
});

describe("compareClosesNewestFirst", () => {
  it("sorts by end month, then quarter before half", () => {
    const rows = [
      { period_end: "2026-06-30", period_type: "half" as const, label: "H1 2026" },
      { period_end: "2026-12-31", period_type: "half" as const, label: "H2 2026" },
      { period_end: "2026-06-30", period_type: "quarter" as const, label: "Q2 2026" },
      { period_end: "2026-12-31", period_type: "quarter" as const, label: "Q4 2026" },
    ];
    expect([...rows].sort(compareClosesNewestFirst).map((r) => r.label)).toEqual(["Q4 2026", "H2 2026", "Q2 2026", "H1 2026"]);
  });
});

describe("defaultExpandedCloses", () => {
  const closes = [
    { id: "q4", status: "open" as const },
    { id: "h2", status: "open" as const },
    { id: "q3", status: "confirmed" as const },
  ];

  it("opens the requested close, else the open ones, else the newest", () => {
    expect(defaultExpandedCloses(closes, "q3")).toEqual(["q3"]);
    expect(defaultExpandedCloses(closes, "missing")).toEqual(["q4", "h2"]);
    expect(defaultExpandedCloses(closes)).toEqual(["q4", "h2"]);
    expect(defaultExpandedCloses([{ id: "q3", status: "confirmed" }])).toEqual(["q3"]);
    expect(defaultExpandedCloses([])).toEqual([]);
  });
});

describe("upcomingClose", () => {
  it("is the quarter of the current month, opening on the 1st after it ends", () => {
    expect(upcomingClose("2026-07-01", "2026-09-30")).toMatchObject({ opensOn: "2026-10-01", period: { label: "Q3 2026" } });
    expect(upcomingClose(null, "2026-09-30")).toMatchObject({ opensOn: "2026-10-01", period: { label: "Q3 2026" } });
  });

  it("waits for a later reporting start", () => {
    expect(upcomingClose("2026-11-01", "2026-09-30")).toMatchObject({ opensOn: "2027-01-01", period: { label: "Q4 2026" } });
  });
});

describe("period keys and options", () => {
  it("round-trips period keys", () => {
    const q3 = quarterOf("2026-09");
    expect(periodKey(q3)).toBe("Q3-2026");
    expect(parsePeriodKey("Q3-2026")).toEqual(q3);
    expect(parsePeriodKey("h2 2026")?.label).toBe("H2 2026");
    expect(parsePeriodKey("Q5-2026")).toBeNull();
    expect(parsePeriodKey("")).toBeNull();
    expect(parsePeriodKey(null)).toBeNull();
  });

  it("lists every quarter and half between the first and last close, newest first", () => {
    expect(periodOptionsBetween("2026-07-01", "2026-12-31").map((p) => p.label)).toEqual(["Q4 2026", "H2 2026", "Q3 2026"]);
    expect(periodOptionsBetween("2026-01-01", "2026-09-30").map((p) => p.label)).toEqual([
      "Q3 2026",
      "Q2 2026",
      "H1 2026",
      "Q1 2026",
    ]);
    expect(periodOptionsBetween("2026-07-01", "2026-09-30").map((p) => p.label)).toEqual(["Q3 2026"]);
    expect(periodOptionsBetween(null, "2026-09-30")).toEqual([]);
    expect(periodOptionsBetween("2026-10-01", "2026-09-30")).toEqual([]);
  });
});

describe("buildPortfolioRows", () => {
  const period = quarterOf("2026-09");
  const companies = [
    { id: "a", name: "Batik Boutique", status: "active" as const, reporting_start_month: "2026-07-01" },
    { id: "b", name: "RECQA", status: "active" as const, reporting_start_month: "2026-08-01" },
    { id: "c", name: "Kiddocare", status: "active" as const, reporting_start_month: "2026-07-01" },
    { id: "d", name: "AOne", status: "active" as const, reporting_start_month: null },
    { id: "e", name: "StayHere", status: "written_off" as const, reporting_start_month: null },
    // Exited after every month was in and the accounts uploaded, before anyone confirmed.
    { id: "f", name: "Mamakhaus", status: "exited" as const, reporting_start_month: "2026-07-01" },
  ];
  const submissions = [
    ...["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({ company_id: "a", month, status: "approved" as const })),
    ...["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({ company_id: "f", month, status: "approved" as const })),
    { company_id: "b", month: "2026-08-01", status: "submitted" as const },
    { company_id: "b", month: "2026-09-01", status: "submitted" as const },
    { company_id: "c", month: "2026-07-01", status: "approved" as const },
    { company_id: "c", month: "2026-08-01", status: "changes_requested" as const },
    { company_id: "c", month: "2026-09-01", status: "draft" as const },
    { company_id: "c", month: "2026-10-01", status: "draft" as const },
  ];
  const rows = buildPortfolioRows({
    period,
    companies,
    closes: [
      { id: "qa", company_id: "a", status: "confirmed", restated_totals: { revenue_total: 1 }, confirmed_at: "2026-10-06T02:00:00Z" },
      { id: "qb", company_id: "b", status: "open", restated_totals: { revenue_total: 1 }, confirmed_at: null },
      { id: "qc", company_id: "c", status: "open", restated_totals: null, confirmed_at: null },
      { id: "qf", company_id: "f", status: "open", restated_totals: null, confirmed_at: null },
    ],
    submissions,
    managementAccountCloseIds: ["qa", "qa", "qb", null, "qf"],
    funds: [
      { company_id: "a", code: "SV1" },
      { company_id: "c", code: "SFF" },
      { company_id: "c", code: "SV1" },
    ],
  });

  it("summarises each company's close for the period", () => {
    // Open closes (read-only companies after the others), then confirmed, then no close.
    expect(rows.map((row) => row.companyName)).toEqual(["Kiddocare", "RECQA", "Mamakhaus", "Batik Boutique", "AOne", "StayHere"]);
    const byId = Object.fromEntries(rows.map((row) => [row.companyId, row]));
    expect(byId.a.close).toEqual({
      id: "qa",
      status: "confirmed",
      submittedMonths: 3,
      countedMonths: 3,
      allSubmitted: true,
      managementAccounts: 2,
      restated: true,
      confirmedAt: "2026-10-06T02:00:00Z",
      readyToConfirm: false,
    });
    expect(byId.b.close).toMatchObject({ submittedMonths: 2, countedMonths: 2, managementAccounts: 1, restated: false, readyToConfirm: true });
    expect(byId.c.close).toMatchObject({ submittedMonths: 1, countedMonths: 3, managementAccounts: 0, readyToConfirm: false });
    expect(byId.c.fundCodes).toEqual(["SFF", "SV1"]);
    expect(byId.d).toMatchObject({ close: null, notYetReporting: true, fundCodes: [] });
    expect(byId.e).toMatchObject({ close: null, companyStatus: "written_off" });
    // Complete but exited: confirm_period_close() refuses it, so it is never "ready to confirm".
    expect(byId.f).toMatchObject({ companyStatus: "exited" });
    expect(byId.f.close).toMatchObject({
      status: "open",
      submittedMonths: 3,
      countedMonths: 3,
      allSubmitted: true,
      managementAccounts: 1,
      readyToConfirm: false,
    });
  });

  it("counts the summary tiles, keeping read-only closes out of 'ready' and 'waiting'", () => {
    expect(summarisePortfolio(rows)).toEqual({
      companies: 6,
      withClose: 4,
      confirmed: 1,
      open: 3,
      readyToConfirm: 1,
      waiting: 1,
      readOnly: 1,
    });
  });
});
