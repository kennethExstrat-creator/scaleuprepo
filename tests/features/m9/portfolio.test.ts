import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { CSV_BOM } from "@/lib/exports/csv";
import {
  PORTFOLIO_CLOSE_COLUMNS,
  PORTFOLIO_COLUMNS,
  PORTFOLIO_KPI_COLUMNS,
  PORTFOLIO_SEGMENT_COLUMNS,
  buildPortfolioCloseRows,
  buildPortfolioKpiRows,
  buildPortfolioRows,
  buildPortfolioSegmentRows,
  buildPortfolioWorkbook,
  portfolioCsv,
  portfolioFileName,
  portfolioSummary,
  type PortfolioExportMeta,
  type PortfolioFinancialRow,
  type PortfolioInput,
  type PortfolioSegment,
} from "@/lib/exports/portfolio";
import { ENTERED_EARLIER_TOTAL_NOTE } from "@/lib/exports/segments";

const BATIK = "c0000000-0000-4000-8000-000000000001";
const KIDDO = "c0000000-0000-4000-8000-000000000003";
const IMOTO = "c0000000-0000-4000-8000-000000000016";
const SV1 = "f1000000-0000-4000-8000-000000000001";
const SFF = "f1000000-0000-4000-8000-000000000002";
const SUB_JUL = "5c000000-0000-4000-8000-000000000007";
const SUB_AUG = "5c000000-0000-4000-8000-000000000008";
const SUB_USD = "5c000000-0000-4000-8000-000000000016";
const SEG_RETAIL = "a3000000-0000-4000-8000-000000000001";
const SEG_ONLINE = "a3000000-0000-4000-8000-000000000002";
const SEG_RETIRED = "a3000000-0000-4000-8000-000000000003";
const SEG_LINE = "a3000000-0000-4000-8000-000000000004";
const SEG_USD = "a3000000-0000-4000-8000-000000000005";

/** Batik's own segments (Wholesale retired) and a ScaleUp line; i-Motorbike's own segment. */
const SEGMENTS: PortfolioSegment[] = [
  { id: SEG_LINE, company_id: BATIK, name: "Corporate gifting", kind: "scaleup", is_active: true, sort_order: 1 },
  { id: SEG_RETIRED, company_id: BATIK, name: "Wholesale", kind: "company", is_active: false, sort_order: 1 },
  { id: SEG_ONLINE, company_id: BATIK, name: "Online", kind: "company", is_active: true, sort_order: 2 },
  { id: SEG_RETAIL, company_id: BATIK, name: "Retail", kind: "company", is_active: true, sort_order: 1 },
  { id: SEG_USD, company_id: IMOTO, name: "Rentals", kind: "company", is_active: true, sort_order: 1 },
];

function financial(overrides: Partial<PortfolioFinancialRow>): PortfolioFinancialRow {
  return {
    company_id: BATIK,
    month: "2026-07-01",
    status: "approved",
    currency: "MYR",
    fx_rate_to_myr: 1,
    revenue_total: 120_000,
    gross_profit: 48_000,
    net_profit: -12_000,
    cash_in_bank: 600_000,
    burn_rate: 50_000,
    headcount_ft: 12,
    headcount_pt: 3,
    ...overrides,
  };
}

function input(financials: PortfolioFinancialRow[]): PortfolioInput {
  return {
    companies: [
      { id: BATIK, name: "Batik Boutique" },
      { id: KIDDO, name: "Kiddocare" },
      { id: IMOTO, name: "i-Motorbike" },
    ],
    funds: [
      { id: SV1, code: "SV1" },
      { id: SFF, code: "SFF" },
    ],
    investments: [
      { fund_id: SV1, company_id: BATIK },
      { fund_id: SFF, company_id: BATIK },
      { fund_id: SFF, company_id: KIDDO },
      { fund_id: SFF, company_id: IMOTO },
    ],
    financials,
  };
}

const META: PortfolioExportMeta = {
  generatedAt: "2026-09-30T06:05:00Z",
  fund: { code: "SFF", name: "ScaleUp Founders Fund LP" },
  from: "2026-07",
  to: "2026-08",
  status: "approved",
};

describe("buildPortfolioRows", () => {
  it("sorts by company then month, joins the funds and derives the metrics", () => {
    const rows = buildPortfolioRows(
      input([
        financial({ company_id: KIDDO, month: "2026-08-01", burn_rate: 0 }),
        financial({ month: "2026-08-01", revenue_total: 0 }),
        financial({}),
      ]),
    );
    expect(rows.map((r) => [r.company, r.month])).toEqual([
      ["Batik Boutique", "2026-07"],
      ["Batik Boutique", "2026-08"],
      ["Kiddocare", "2026-08"],
    ]);
    const [july, august, kiddo] = rows;
    expect(july.funds).toBe("SFF, SV1");
    expect(july.gpPct).toBe(40);
    expect(july.npPct).toBe(-10);
    expect(july.runway).toBe(12);
    expect(july.cashflowPositive).toBe(false);
    expect(july.revenueRm).toBe(120_000);
    // Margins are unknown on zero revenue; burn of 0 means cash-flow positive (no runway).
    expect(august.gpPct).toBeNull();
    expect(kiddo.funds).toBe("SFF");
    expect(kiddo.runway).toBeNull();
    expect(kiddo.cashflowPositive).toBe(true);
  });

  it("converts to RM with the month's rate and leaves RM blank without one", () => {
    const [withRate, withoutRate] = buildPortfolioRows(
      input([
        financial({ company_id: IMOTO, currency: "USD ", fx_rate_to_myr: 4.2, revenue_total: 1_000, cash_in_bank: 10_000 }),
        financial({ company_id: IMOTO, month: "2026-08-01", currency: "USD", fx_rate_to_myr: null }),
      ]),
    );
    expect(withRate.currency).toBe("USD");
    expect(withRate.revenueRm).toBeCloseTo(4_200, 8);
    expect(withRate.cashRm).toBeCloseTo(42_000, 8);
    expect(withoutRate.fxRate).toBeNull();
    expect(withoutRate.revenueRm).toBeNull();
    expect(withoutRate.burnRm).toBeNull();
  });

  it("drops rows of companies that are not visible", () => {
    expect(buildPortfolioRows(input([financial({ company_id: "c0000000-0000-4000-8000-000000000099" })]))).toEqual([]);
  });

  it("calculates the revenue of months open for changes from the company's own segments (BRD B30)", () => {
    const SUB_SEP = "5c000000-0000-4000-8000-000000000009";
    const rows = buildPortfolioRows({
      ...input([
        // Submitted: the stored total stands (checked against its segments on submission).
        financial({ submission_id: SUB_JUL, revenue_total: 120_000 }),
        // Sent back after the owner removed Wholesale: the stored 130,000 still includes it.
        financial({
          submission_id: SUB_AUG,
          month: "2026-08-01",
          status: "changes_requested",
          revenue_total: 130_000,
          gross_profit: 45_000,
        }),
        // Total revenue entered before the segments were set up; none is filled in yet.
        financial({ submission_id: SUB_SEP, month: "2026-09-01", status: "draft", revenue_total: 100_000 }),
        financial({
          submission_id: SUB_USD,
          company_id: IMOTO,
          status: "draft",
          currency: "USD",
          fx_rate_to_myr: 4.5,
          revenue_total: 999,
        }),
      ]),
      segments: SEGMENTS,
      segmentValues: [
        { submission_id: SUB_JUL, segment_id: SEG_RETAIL, amount: 80_000 },
        { submission_id: SUB_AUG, segment_id: SEG_RETAIL, amount: 90_000 },
        { submission_id: SUB_AUG, segment_id: SEG_RETIRED, amount: 40_000 },
        { submission_id: SUB_AUG, segment_id: SEG_LINE, amount: 5_000 },
        { submission_id: SUB_SEP, segment_id: SEG_LINE, amount: 6_000 },
        { submission_id: SUB_USD, segment_id: SEG_USD, amount: 1_000 },
      ],
    });
    const [july, august, september, usd] = rows;
    expect([july.month, july.revenue, july.revenueEnteredEarlier]).toEqual(["2026-07", 120_000, false]);
    // Retail only: the retired Wholesale and the ScaleUp line do not count; margins follow the total.
    expect([august.revenue, august.gpPct, august.revenueRm, august.revenueEnteredEarlier]).toEqual([90_000, 50, 90_000, false]);
    expect([september.revenue, september.revenueEnteredEarlier]).toEqual([100_000, true]);
    expect([usd.company, usd.revenue, usd.revenueRm]).toEqual(["i-Motorbike", 1_000, 4_500]);
    // Without segment figures every month shows its stored revenue.
    expect(buildPortfolioRows(input([financial({ submission_id: SUB_AUG, status: "draft", revenue_total: 1 })]))[0].revenue).toBe(1);
  });
});

describe("buildPortfolioSegmentRows (BRD B30)", () => {
  it("lists each month's figures by company, month and kind, as the month shows them", () => {
    const rows = buildPortfolioRows(
      input([
        financial({ submission_id: SUB_JUL }),
        financial({ submission_id: SUB_AUG, month: "2026-08-01", status: "changes_requested" }),
        financial({ submission_id: SUB_USD, company_id: IMOTO, currency: "USD", fx_rate_to_myr: 4.5 }),
      ]),
    );
    const segmentRows = buildPortfolioSegmentRows(rows, SEGMENTS, [
      { submission_id: SUB_JUL, segment_id: SEG_LINE, amount: 5_000 },
      { submission_id: SUB_JUL, segment_id: SEG_RETIRED, amount: 40_000 },
      { submission_id: SUB_JUL, segment_id: SEG_RETAIL, amount: 80_000 },
      { submission_id: SUB_JUL, segment_id: SEG_ONLINE, amount: null },
      // Sent back after Wholesale was retired: the month follows the current segments.
      { submission_id: SUB_AUG, segment_id: SEG_RETIRED, amount: 40_000 },
      { submission_id: SUB_AUG, segment_id: SEG_RETAIL, amount: 90_000 },
      { submission_id: SUB_USD, segment_id: SEG_USD, amount: 1_000 },
      // Unknown months and segments of another company are ignored.
      { submission_id: "5c000000-0000-4000-8000-000000000099", segment_id: SEG_RETAIL, amount: 1 },
      { submission_id: SUB_USD, segment_id: SEG_RETAIL, amount: 1 },
    ]);
    expect(segmentRows.map((r) => [r.company, r.month, r.kind, r.segment, r.inUse, r.amount, r.amountRm])).toEqual([
      ["Batik Boutique", "2026-07", "company", "Retail", true, 80_000, 80_000],
      ["Batik Boutique", "2026-07", "company", "Wholesale", false, 40_000, 40_000],
      ["Batik Boutique", "2026-07", "scaleup", "Corporate gifting", true, 5_000, 5_000],
      ["Batik Boutique", "2026-08", "company", "Retail", true, 90_000, 90_000],
      ["i-Motorbike", "2026-07", "company", "Rentals", true, 1_000, 4_500],
    ]);
    expect(segmentRows[0].funds).toBe("SFF, SV1");
  });
});

describe("portfolio CSV", () => {
  it("writes the header and rounded values (RFC 4180, BOM, CRLF)", () => {
    const rows = buildPortfolioRows(
      input([financial({ revenue_total: 3, gross_profit: 1, net_profit: 2, company_id: KIDDO, month: "2026-07-01" })]),
    );
    const csv = portfolioCsv(rows);
    const lines = csv.split("\r\n");
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines[0].slice(1)).toBe(PORTFOLIO_COLUMNS.map((c) => c.header).join(","));
    expect(lines[0]).toContain("Company,Funds,Month,Status,Currency,FX rate to MYR,Revenue,Gross profit,GP %");
    expect(lines[1]).toBe("Kiddocare,SFF,2026-07,Approved,MYR,1,3,1,33.33,2,66.67,600000,50000,12,No,12,3,3,1,2,600000,50000");
    expect(lines[2]).toBe("");
    expect(lines).toHaveLength(3);
  });

  it("quotes fund lists", () => {
    const csv = portfolioCsv(buildPortfolioRows(input([financial({})])));
    expect(csv.split("\r\n")[1].startsWith('Batik Boutique,"SFF, SV1",2026-07,')).toBe(true);
  });
});

describe("portfolio workbook", () => {
  it("has a data sheet with the brand header, filters and frozen panes, and an About sheet", async () => {
    const rows = buildPortfolioRows(input([financial({}), financial({ company_id: KIDDO })]));
    const workbook = buildPortfolioWorkbook(rows, META);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
    const data = loaded.getWorksheet("Portfolio data");
    const about = loaded.getWorksheet("About");
    if (!data || !about) throw new Error("missing sheets");
    expect(data.getCell("A1").value).toBe("Company");
    expect(data.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FFE2743A" } });
    expect(data.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 1 });
    expect(data.pageSetup).toMatchObject({ orientation: "landscape" });
    expect(data.getCell("A2").value).toBe("Batik Boutique");
    expect(data.getCell("C2").value).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(data.getCell("C2").numFmt).toBe("mmm yyyy");
    expect(data.getCell("I2").value).toBe(0.4);
    expect(data.getCell("I2").numFmt).toBe("0.0%;[Red]-0.0%");
    expect(data.getCell("A3").value).toBe("Kiddocare");
    expect(about.getCell("B4").value).toBe("SFF · ScaleUp Founders Fund LP");
    expect(about.getCell("B5").value).toBe("Jul 2026 to Aug 2026");
    expect(about.getCell("B7").value).toBe("2");
  });

  it("adds a Revenue segments sheet when asked (BRD B30)", async () => {
    const rows = buildPortfolioRows(input([financial({ submission_id: SUB_JUL })]));
    const segmentRows = buildPortfolioSegmentRows(rows, SEGMENTS, [
      { submission_id: SUB_JUL, segment_id: SEG_RETAIL, amount: 80_000 },
      { submission_id: SUB_JUL, segment_id: SEG_LINE, amount: 5_000 },
    ]);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await buildPortfolioWorkbook(rows, META, segmentRows).xlsx.writeBuffer());
    expect(loaded.worksheets.map((ws) => ws.name)).toEqual(["Portfolio data", "Revenue segments", "About"]);
    const sheet = loaded.getWorksheet("Revenue segments");
    if (!sheet) throw new Error("missing sheet");
    const header: unknown[] = [];
    sheet.getRow(1).eachCell((cell) => header.push(cell.value));
    expect(header).toEqual(PORTFOLIO_SEGMENT_COLUMNS.map((column) => column.header));
    expect(sheet.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FFE2743A" } });
    expect([sheet.getCell("G2").value, sheet.getCell("H2").value, sheet.getCell("I2").value, sheet.getCell("J2").value]).toEqual([
      "Revenue segment",
      "Retail",
      "Yes",
      80_000,
    ]);
    expect([sheet.getCell("G3").value, sheet.getCell("H3").value]).toEqual(["ScaleUp revenue line", "Corporate gifting"]);
    expect(loaded.getWorksheet("About")?.getCell("A8").value).toBe("Revenue segment rows");
    expect(loaded.getWorksheet("About")?.getCell("B8").value).toBe("2");

    const empty = buildPortfolioWorkbook(rows, META, []);
    expect(empty.getWorksheet("Revenue segments")?.getCell("A3").value).toBe("None of these months has revenue segment figures.");
    expect(buildPortfolioWorkbook(rows, META).worksheets.map((ws) => ws.name)).toEqual(["Portfolio data", "About"]);
  });

  it("adds KPIs (long format) and Period closes with restated totals (BRD §10, §6.1)", async () => {
    const rows = buildPortfolioRows(input([financial({ submission_id: SUB_JUL })]));
    const KPI = "e0000000-0000-4000-8000-000000000001";
    const FLAG = "e0000000-0000-4000-8000-000000000003";
    const OTHER = "e0000000-0000-4000-8000-000000000099";
    const MONT_KIARA = "d1000000-0000-4000-8000-000000000001";
    const kpiRows = buildPortfolioKpiRows(
      rows,
      [
        { id: KPI, company_id: BATIK, name: "Revenue per outlet", unit: "RM", value_type: "currency", sort_order: 1 },
        { id: FLAG, company_id: BATIK, name: "Profitable", unit: null, value_type: "boolean", sort_order: 3 },
        { id: OTHER, company_id: KIDDO, name: "App downloads", unit: "downloads", value_type: "integer", sort_order: 1 },
      ],
      [{ id: MONT_KIARA, name: "Mont Kiara", sort_order: 1 }],
      [
        { submission_id: SUB_JUL, kpi_id: FLAG, dimension_member_id: MONT_KIARA, value_number: null, value_text: null, value_bool: true },
        { submission_id: SUB_JUL, kpi_id: KPI, dimension_member_id: MONT_KIARA, value_number: 12_500.5, value_text: null, value_bool: null },
        // Another company's KPI on this month, an unknown month and an empty value are left out.
        { submission_id: SUB_JUL, kpi_id: OTHER, dimension_member_id: null, value_number: 1, value_text: null, value_bool: null },
        { submission_id: SUB_AUG, kpi_id: KPI, dimension_member_id: MONT_KIARA, value_number: 1, value_text: null, value_bool: null },
        { submission_id: SUB_JUL, kpi_id: KPI, dimension_member_id: null, value_number: null, value_text: null, value_bool: null },
      ],
    );
    expect(kpiRows.map((row) => [row.company, row.month, row.kpi, row.member, row.unit, row.value])).toEqual([
      ["Batik Boutique", "2026-07", "Revenue per outlet", "Mont Kiara", "RM", 12_500.5],
      ["Batik Boutique", "2026-07", "Profitable", "Mont Kiara", null, "Yes"],
    ]);

    const closeRows = buildPortfolioCloseRows(rows, [
      {
        id: "close-h2",
        company_id: BATIK,
        period_type: "half",
        period_start: "2026-07-01",
        period_end: "2026-12-31",
        label: "H2 2026",
        status: "open",
        confirmed_at: null,
        computed_totals: null,
        restated_totals: null,
        restatement_reason: null,
      },
      {
        id: "close-q3",
        company_id: BATIK,
        period_type: "quarter",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        label: "Q3 2026",
        status: "confirmed",
        confirmed_at: "2026-10-12T02:00:00Z",
        computed_totals: { months_count: 3, revenue_total: 300_000, gross_profit: 90_000, gp_pct: 30, net_profit: 10_000, np_pct: 3.3333 },
        restated_totals: { revenue_total: 310_000 },
        restatement_reason: "Management accounts include a late invoice.",
      },
      // Another company's close: not in the extract's rows, left out.
      {
        id: "x",
        company_id: KIDDO,
        period_type: "quarter",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        label: "Q3 2026",
        status: "open",
        confirmed_at: null,
        computed_totals: null,
        restated_totals: null,
        restatement_reason: null,
      },
    ]);
    expect(closeRows.map((row) => [row.label, row.status, row.computed?.revenue_total ?? null, row.restated?.revenue_total ?? null, row.confirmed?.revenue_total ?? null])).toEqual([
      ["Q3 2026", "confirmed", 300_000, 310_000, 310_000],
      ["H2 2026", "open", null, null, null],
    ]);

    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await buildPortfolioWorkbook(rows, META, [], { kpiRows, closeRows }).xlsx.writeBuffer());
    expect(loaded.worksheets.map((ws) => ws.name)).toEqual(["Portfolio data", "Revenue segments", "KPIs", "Period closes", "About"]);
    const kpis = loaded.getWorksheet("KPIs");
    const closes = loaded.getWorksheet("Period closes");
    if (!kpis || !closes) throw new Error("missing sheets");
    const header = (sheet: ExcelJS.Worksheet) => {
      const values: unknown[] = [];
      sheet.getRow(1).eachCell((cell) => values.push(cell.value));
      return values;
    };
    expect(header(kpis)).toEqual(PORTFOLIO_KPI_COLUMNS.map((column) => column.header));
    expect(header(closes)).toEqual(PORTFOLIO_CLOSE_COLUMNS.map((column) => column.header));
    expect([kpis.getCell("E2").value, kpis.getCell("F2").value, kpis.getCell("I2").value]).toEqual(["Revenue per outlet", "Mont Kiara", 12_500.5]);
    expect(kpis.getCell("I3").value).toBe("Yes");
    const column = (name: string) => PORTFOLIO_CLOSE_COLUMNS.findIndex((entry) => entry.header === name) + 1;
    expect(closes.getRow(2).getCell(column("Revenue (calculated)")).value).toBe(300_000);
    expect(closes.getRow(2).getCell(column("GP % (calculated)")).value).toBe(0.3);
    expect(closes.getRow(2).getCell(column("Revenue (restated)")).value).toBe(310_000);
    expect(closes.getRow(2).getCell(column("Revenue (confirmed)")).value).toBe(310_000);
    expect(closes.getRow(2).getCell(column("Restatement reason")).value).toBe("Management accounts include a late invoice.");
    expect(closes.getRow(3).getCell(column("Status")).value).toBe("Open");
  });

  it("notes a revenue entered before the segments were filled in, and explains open months (BRD B30)", async () => {
    const rows = buildPortfolioRows({
      ...input([
        financial({ submission_id: SUB_JUL }),
        financial({ submission_id: SUB_AUG, month: "2026-08-01", status: "draft", revenue_total: 100_000 }),
      ]),
      segments: SEGMENTS,
      segmentValues: [{ submission_id: SUB_JUL, segment_id: SEG_RETAIL, amount: 120_000 }],
    });
    const meta: PortfolioExportMeta = { ...META, status: "all" };
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await buildPortfolioWorkbook(rows, meta).xlsx.writeBuffer());
    const data = loaded.getWorksheet("Portfolio data");
    if (!data) throw new Error("missing sheet");
    const revenueCol = PORTFOLIO_COLUMNS.findIndex((column) => column.header === "Revenue") + 1;
    const revenueRmCol = PORTFOLIO_COLUMNS.findIndex((column) => column.header === "Revenue (RM)") + 1;
    expect(data.getCell(2, revenueCol).note).toBeUndefined();
    expect(data.getCell(3, revenueCol).value).toBe(100_000);
    expect(data.getCell(3, revenueCol).note).toBe(ENTERED_EARLIER_TOTAL_NOTE);
    expect(data.getCell(3, revenueRmCol).note).toBe(ENTERED_EARLIER_TOTAL_NOTE);

    const notes = (workbook: ExcelJS.Workbook) => {
      const about = workbook.getWorksheet("About");
      const values: string[] = [];
      about?.getColumn(1).eachCell((cell) => values.push(String(cell.value)));
      return values.join("\n");
    };
    expect(notes(loaded)).toContain(
      "Months still open for changes (Status “Not submitted” or “Changes requested”) show what the monthly form shows",
    );
    expect(notes(buildPortfolioWorkbook(rows, META))).not.toContain("Months still open for changes");
  });

  it("describes and names the export", () => {
    expect(portfolioSummary(META)).toBe("SFF · Jul 2026 to Aug 2026 · approved months only");
    expect(portfolioSummary({ ...META, fund: null, from: null, to: null, status: "all" })).toBe(
      "All funds · All months · all statuses",
    );
    expect(portfolioFileName(META, "csv", "2026-09-30")).toBe("Portfolio data SFF 2026-07 to 2026-08 (approved).csv");
    expect(portfolioFileName({ ...META, fund: null, from: null, to: null, status: "all" }, "xlsx", "2026-09-30")).toBe(
      "Portfolio data all funds to 2026-09-30 (all months).xlsx",
    );
  });
});
