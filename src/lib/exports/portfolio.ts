// Portfolio data extract (BRD A13, §10 "Data extract": all approved figures by company and period, for
// finance and auditors; B18 RM conversion). Pure: the loader is portfolio-data.ts.
//
// One row per company and month: company, funds, month, status, currency, FX rate, revenue, GP, GP %, NP,
// NP %, cash, burn, runway, headcount, then the RM columns (amount × the month's FX rate to MYR; blank
// where no rate is set). Written as an Excel workbook ("Portfolio data", "Revenue segments", "About") or
// as RFC 4180 CSV (the "Portfolio data" table). "Revenue segments" (BRD B30) has one row per company,
// month and segment with a figure: the company's own segments and ScaleUp's revenue lines. A month still
// open for changes shows what the monthly form shows (segments.ts): the current segments' figures and,
// when the company has segments of its own, revenue calculated from them.
import ExcelJS from "exceljs";

import { REVENUE_SEGMENT_KIND_META, SUBMISSION_STATUS_META, type RevenueSegmentKind } from "@/lib/constants";
import { formatDateTime, toFiniteNumber } from "@/lib/format";
import { gpPct, isCashflowPositive, npPct, runwayMonths } from "@/lib/metrics";
import { dateToMonthKey, monthLabel, parseInstant, parseMonthKey, type MonthKey } from "@/lib/periods";
import { segmentKind } from "@/lib/types/domain";
import type { SubmissionStatus } from "@/lib/types/enums";

import { roundTo, toCsv, type CsvValue } from "./csv";
import { ENTERED_EARLIER_TOTAL_NOTE, isOpenForChanges, shownRevenueTotal } from "./segments";
import {
  BRAND_ARGB,
  NUMBER_FORMATS,
  applyPrintSetup,
  excelDate,
  setColumnWidths,
  setWorkbookProperties,
  styleBodyCell,
  styleHeaderRow,
  writeNote,
  writeTitle,
  type NumberFormatName,
} from "./xlsx";

export type PortfolioStatusFilter = "approved" | "all";
export const PORTFOLIO_STATUS_VALUES = ["approved", "all"] as const satisfies readonly PortfolioStatusFilter[];
export type PortfolioFormat = "xlsx" | "csv";
export const PORTFOLIO_FORMAT_VALUES = ["xlsx", "csv"] as const satisfies readonly PortfolioFormat[];

/** A v_submission_financials row (the columns the extract uses). */
export type PortfolioFinancialRow = {
  /** Joins the month's revenue segment figures (the Excel "Revenue segments" sheet). */
  submission_id?: string | null;
  company_id: string;
  month: string;
  status: SubmissionStatus;
  currency: string;
  fx_rate_to_myr: number | null;
  revenue_total: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  cash_in_bank: number | null;
  burn_rate: number | null;
  headcount_ft: number | null;
  headcount_pt: number | null;
};

export type PortfolioInput = {
  companies: { id: string; name: string }[];
  funds: { id: string; code: string }[];
  investments: { fund_id: string; company_id: string }[];
  financials: PortfolioFinancialRow[];
  /**
   * The companies' revenue segments and the figures of (at least) the months still open for changes:
   * their revenue is calculated from the company's own segments, as the monthly form does (BRD B30).
   * Without them every month shows its stored revenue.
   */
  segments?: readonly PortfolioSegment[];
  segmentValues?: readonly PortfolioSegmentValue[];
};

export type PortfolioRow = {
  submissionId: string | null;
  companyId: string;
  company: string;
  /** Fund codes, e.g. "SFF, SV1". */
  funds: string;
  month: MonthKey;
  status: SubmissionStatus;
  currency: string;
  fxRate: number | null;
  /** Total revenue as the month shows it (shownRevenueTotal). */
  revenue: number | null;
  /** `revenue` was entered before the company's own segments were filled in (a month open for changes). */
  revenueEnteredEarlier: boolean;
  grossProfit: number | null;
  /** Percentages as numbers (46.67 means 46.67 %). */
  gpPct: number | null;
  netProfit: number | null;
  npPct: number | null;
  cash: number | null;
  burn: number | null;
  /** Months of cash at the month's burn; null when cash-flow positive or a figure is missing. */
  runway: number | null;
  /** Burn of 0 (or less): true; positive burn: false; unknown: null. */
  cashflowPositive: boolean | null;
  headcountFt: number | null;
  headcountPt: number | null;
  revenueRm: number | null;
  grossProfitRm: number | null;
  netProfitRm: number | null;
  cashRm: number | null;
  burnRm: number | null;
};

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

function times(value: number | null, rate: number | null): number | null {
  return value === null || rate === null ? null : value * rate;
}

/** The company's own segments in use, by company id (an open month's revenue is calculated from them). */
function companySegmentIdsByCompany(segments: readonly PortfolioSegment[]): Map<string, string[]> {
  const byCompany = new Map<string, string[]>();
  for (const segment of segments) {
    if (!segment.is_active || segmentKind(segment) !== "company") continue;
    const list = byCompany.get(segment.company_id) ?? [];
    list.push(segment.id);
    byCompany.set(segment.company_id, list);
  }
  return byCompany;
}

const NO_AMOUNTS: Readonly<Record<string, number | null>> = {};

/** Segment figures by submission id, then segment id. */
function amountsBySubmission(values: readonly PortfolioSegmentValue[]): Map<string, Record<string, number | null>> {
  const bySubmission = new Map<string, Record<string, number | null>>();
  for (const value of values) {
    const amounts = bySubmission.get(value.submission_id) ?? {};
    amounts[value.segment_id] = toFiniteNumber(value.amount);
    bySubmission.set(value.submission_id, amounts);
  }
  return bySubmission;
}

/** Rows sorted by company name, then month. Rows of companies that are not visible are dropped. */
export function buildPortfolioRows(input: PortfolioInput): PortfolioRow[] {
  const companies = new Map(input.companies.map((company) => [company.id, company.name]));
  const fundCodes = new Map(input.funds.map((fund) => [fund.id, fund.code]));
  const fundsByCompany = new Map<string, string[]>();
  for (const investment of input.investments) {
    const code = fundCodes.get(investment.fund_id);
    if (!code) continue;
    const list = fundsByCompany.get(investment.company_id) ?? [];
    if (!list.includes(code)) list.push(code);
    fundsByCompany.set(investment.company_id, list);
  }
  const companySegmentIds = companySegmentIdsByCompany(input.segments ?? []);
  const segmentAmounts = amountsBySubmission(input.segmentValues ?? []);

  const rows: PortfolioRow[] = [];
  for (const row of input.financials) {
    const company = companies.get(row.company_id);
    const month = parseMonthKey(row.month);
    if (company === undefined || !month) continue;
    // BRD B30: an open month's revenue follows the company's own segments, as the monthly form shows it.
    const amounts = row.submission_id ? segmentAmounts.get(row.submission_id) : undefined;
    const revenue = shownRevenueTotal(
      { status: row.status, segments: amounts ?? NO_AMOUNTS },
      toFiniteNumber(row.revenue_total),
      companySegmentIds.get(row.company_id) ?? [],
    );
    const financials = {
      revenue_total: revenue.total,
      gross_profit: toFiniteNumber(row.gross_profit),
      net_profit: toFiniteNumber(row.net_profit),
      cash_in_bank: toFiniteNumber(row.cash_in_bank),
      burn_rate: toFiniteNumber(row.burn_rate),
    };
    const rate = toFiniteNumber(row.fx_rate_to_myr);
    rows.push({
      submissionId: row.submission_id ?? null,
      companyId: row.company_id,
      company,
      funds: (fundsByCompany.get(row.company_id) ?? []).sort(compareNames).join(", "),
      month,
      status: row.status,
      currency: row.currency.trim().toUpperCase(),
      fxRate: rate,
      revenue: financials.revenue_total,
      revenueEnteredEarlier: revenue.enteredEarlier,
      grossProfit: financials.gross_profit,
      gpPct: gpPct(financials),
      netProfit: financials.net_profit,
      npPct: npPct(financials),
      cash: financials.cash_in_bank,
      burn: financials.burn_rate,
      runway: runwayMonths(financials),
      cashflowPositive: financials.burn_rate === null ? null : isCashflowPositive(financials),
      headcountFt: toFiniteNumber(row.headcount_ft),
      headcountPt: toFiniteNumber(row.headcount_pt),
      revenueRm: times(financials.revenue_total, rate),
      grossProfitRm: times(financials.gross_profit, rate),
      netProfitRm: times(financials.net_profit, rate),
      cashRm: times(financials.cash_in_bank, rate),
      burnRm: times(financials.burn_rate, rate),
    });
  }
  return rows.sort((a, b) => compareNames(a.company, b.company) || a.companyId.localeCompare(b.companyId) || a.month.localeCompare(b.month));
}

// ---------------------------------------------------------------------------------------------
// Revenue segments (BRD B30)
// ---------------------------------------------------------------------------------------------

/** A revenue segment of a company, either kind (a revenue_segments row; `kind` 'company' or 'scaleup'). */
export type PortfolioSegment = {
  id: string;
  company_id: string;
  name: string;
  kind: string;
  is_active: boolean;
  sort_order: number;
};

/** A month's figure for a segment (a submission_segment_values row). */
export type PortfolioSegmentValue = { submission_id: string; segment_id: string; amount: number | null };

/** One company, month and segment with a figure. */
export type PortfolioSegmentRow = {
  companyId: string;
  company: string;
  funds: string;
  month: MonthKey;
  status: SubmissionStatus;
  currency: string;
  fxRate: number | null;
  /** 'company': the company's own segments (add up to total revenue); 'scaleup': ScaleUp's revenue lines. */
  kind: RevenueSegmentKind;
  segmentId: string;
  segment: string;
  /** False for a segment no longer used (retired). */
  inUse: boolean;
  sortOrder: number;
  amount: number;
  amountRm: number | null;
};

/**
 * The segment figures of the extract's months (`rows`), sorted by company, month, kind (the company's own
 * segments, then ScaleUp's lines), segments in use first, then their order and name. As `segmentsForMonth`
 * decides, a submitted or approved month keeps every figure it was submitted with (retired segments
 * included), while a month still open for changes shows only the current segments' figures.
 */
export function buildPortfolioSegmentRows(
  rows: readonly PortfolioRow[],
  segments: readonly PortfolioSegment[],
  values: readonly PortfolioSegmentValue[],
): PortfolioSegmentRow[] {
  const bySubmission = new Map<string, PortfolioRow>();
  for (const row of rows) if (row.submissionId) bySubmission.set(row.submissionId, row);
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
  const result: PortfolioSegmentRow[] = [];
  for (const value of values) {
    const row = bySubmission.get(value.submission_id);
    const segment = segmentById.get(value.segment_id);
    const amount = toFiniteNumber(value.amount);
    if (!row || !segment || amount === null || segment.company_id !== row.companyId) continue;
    // A month still open for changes shows only the current (active) segments.
    if (isOpenForChanges(row.status) && !segment.is_active) continue;
    result.push({
      companyId: row.companyId,
      company: row.company,
      funds: row.funds,
      month: row.month,
      status: row.status,
      currency: row.currency,
      fxRate: row.fxRate,
      kind: segmentKind(segment),
      segmentId: segment.id,
      segment: segment.name.trim(),
      inUse: segment.is_active,
      sortOrder: segment.sort_order,
      amount,
      amountRm: times(amount, row.fxRate),
    });
  }
  const kindOrder = (kind: RevenueSegmentKind) => (kind === "company" ? 0 : 1);
  return result.sort(
    (a, b) =>
      compareNames(a.company, b.company) ||
      a.companyId.localeCompare(b.companyId) ||
      a.month.localeCompare(b.month) ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      Number(b.inUse) - Number(a.inUse) ||
      a.sortOrder - b.sortOrder ||
      compareNames(a.segment, b.segment) ||
      a.segmentId.localeCompare(b.segmentId),
  );
}

// ---------------------------------------------------------------------------------------------
// Columns (shared by CSV and Excel)
// ---------------------------------------------------------------------------------------------

type ExcelValue = number | string | Date | null;

type ExportColumn<R> = {
  header: string;
  width: number;
  csv: (row: R) => CsvValue;
  xlsx: (row: R) => ExcelValue;
  format?: NumberFormatName;
  /** An Excel note for the cell (shown when hovering over it); the CSV has none. */
  note?: (row: R) => string | null;
};

type PortfolioColumn = ExportColumn<PortfolioRow>;

const round = (value: number | null, decimals: number): number | null =>
  value === null ? null : roundTo(value, decimals);
const fraction = (value: number | null): number | null => (value === null ? null : value / 100);
const yesNo = (value: boolean | null): string | null => (value === null ? null : value ? "Yes" : "No");
const revenueNote = (row: PortfolioRow): string | null => (row.revenueEnteredEarlier ? ENTERED_EARLIER_TOTAL_NOTE : null);

export const PORTFOLIO_COLUMNS: readonly PortfolioColumn[] = [
  { header: "Company", width: 26, csv: (r) => r.company, xlsx: (r) => r.company },
  { header: "Funds", width: 11, csv: (r) => r.funds, xlsx: (r) => r.funds },
  { header: "Month", width: 11, csv: (r) => r.month, xlsx: (r) => excelDate(r.month), format: "month" },
  {
    header: "Status",
    width: 18,
    csv: (r) => SUBMISSION_STATUS_META[r.status].label,
    xlsx: (r) => SUBMISSION_STATUS_META[r.status].label,
  },
  { header: "Currency", width: 9, csv: (r) => r.currency, xlsx: (r) => r.currency },
  { header: "FX rate to MYR", width: 12, csv: (r) => round(r.fxRate, 8), xlsx: (r) => r.fxRate, format: "fx" },
  {
    header: "Revenue",
    width: 14,
    csv: (r) => round(r.revenue, 4),
    xlsx: (r) => r.revenue,
    format: "money",
    note: revenueNote,
  },
  { header: "Gross profit", width: 14, csv: (r) => round(r.grossProfit, 4), xlsx: (r) => r.grossProfit, format: "money" },
  { header: "GP %", width: 9, csv: (r) => round(r.gpPct, 2), xlsx: (r) => fraction(r.gpPct), format: "pct" },
  { header: "Net profit", width: 14, csv: (r) => round(r.netProfit, 4), xlsx: (r) => r.netProfit, format: "money" },
  { header: "NP %", width: 9, csv: (r) => round(r.npPct, 2), xlsx: (r) => fraction(r.npPct), format: "pct" },
  { header: "Cash in bank", width: 14, csv: (r) => round(r.cash, 4), xlsx: (r) => r.cash, format: "money" },
  { header: "Monthly burn", width: 14, csv: (r) => round(r.burn, 4), xlsx: (r) => r.burn, format: "money" },
  { header: "Runway (months)", width: 11, csv: (r) => round(r.runway, 2), xlsx: (r) => r.runway, format: "runway" },
  {
    header: "Cash-flow positive",
    width: 11,
    csv: (r) => yesNo(r.cashflowPositive),
    xlsx: (r) => yesNo(r.cashflowPositive),
  },
  { header: "Headcount FT", width: 11, csv: (r) => r.headcountFt, xlsx: (r) => r.headcountFt, format: "integer" },
  { header: "Headcount PT", width: 11, csv: (r) => r.headcountPt, xlsx: (r) => r.headcountPt, format: "integer" },
  {
    header: "Revenue (RM)",
    width: 14,
    csv: (r) => round(r.revenueRm, 2),
    xlsx: (r) => r.revenueRm,
    format: "money",
    note: revenueNote,
  },
  {
    header: "Gross profit (RM)",
    width: 14,
    csv: (r) => round(r.grossProfitRm, 2),
    xlsx: (r) => r.grossProfitRm,
    format: "money",
  },
  {
    header: "Net profit (RM)",
    width: 14,
    csv: (r) => round(r.netProfitRm, 2),
    xlsx: (r) => r.netProfitRm,
    format: "money",
  },
  { header: "Cash in bank (RM)", width: 14, csv: (r) => round(r.cashRm, 2), xlsx: (r) => r.cashRm, format: "money" },
  { header: "Monthly burn (RM)", width: 14, csv: (r) => round(r.burnRm, 2), xlsx: (r) => r.burnRm, format: "money" },
];

/** Columns of the "Revenue segments" sheet (BRD B30). */
export const PORTFOLIO_SEGMENT_COLUMNS: readonly ExportColumn<PortfolioSegmentRow>[] = [
  { header: "Company", width: 26, csv: (r) => r.company, xlsx: (r) => r.company },
  { header: "Funds", width: 11, csv: (r) => r.funds, xlsx: (r) => r.funds },
  { header: "Month", width: 11, csv: (r) => r.month, xlsx: (r) => excelDate(r.month), format: "month" },
  {
    header: "Status",
    width: 18,
    csv: (r) => SUBMISSION_STATUS_META[r.status].label,
    xlsx: (r) => SUBMISSION_STATUS_META[r.status].label,
  },
  { header: "Currency", width: 9, csv: (r) => r.currency, xlsx: (r) => r.currency },
  { header: "FX rate to MYR", width: 12, csv: (r) => round(r.fxRate, 8), xlsx: (r) => r.fxRate, format: "fx" },
  {
    header: "Breakdown",
    width: 20,
    csv: (r) => REVENUE_SEGMENT_KIND_META[r.kind].label,
    xlsx: (r) => REVENUE_SEGMENT_KIND_META[r.kind].label,
  },
  { header: "Segment", width: 28, csv: (r) => r.segment, xlsx: (r) => r.segment },
  {
    header: "In use",
    width: 14,
    csv: (r) => (r.inUse ? "Yes" : "No longer used"),
    xlsx: (r) => (r.inUse ? "Yes" : "No longer used"),
  },
  { header: "Amount", width: 14, csv: (r) => round(r.amount, 4), xlsx: (r) => r.amount, format: "money" },
  { header: "Amount (RM)", width: 14, csv: (r) => round(r.amountRm, 2), xlsx: (r) => r.amountRm, format: "money" },
];

/** The extract as CSV (UTF-8 BOM, CRLF, RFC 4180). */
export function portfolioCsv(rows: readonly PortfolioRow[]): string {
  return toCsv(
    PORTFOLIO_COLUMNS.map((column) => column.header),
    rows.map((row) => PORTFOLIO_COLUMNS.map((column) => column.csv(row))),
  );
}

// ---------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------

/** What the extract covers (shown on the "About" sheet and in the file name). */
export type PortfolioExportMeta = {
  generatedAt: string;
  /** e.g. "SV1 · ScaleUp Ventures 1 Sdn Bhd"; null = every fund. */
  fund: { code: string; name: string } | null;
  from: MonthKey | null;
  to: MonthKey | null;
  status: PortfolioStatusFilter;
};

function monthsText(meta: Pick<PortfolioExportMeta, "from" | "to">): string {
  if (meta.from && meta.to) return `${monthLabel(meta.from)} to ${monthLabel(meta.to)}`;
  if (meta.from) return `From ${monthLabel(meta.from)}`;
  if (meta.to) return `Up to ${monthLabel(meta.to)}`;
  return "All months";
}

/**
 * One-line description of the extract, e.g. "SV1 · Jul 2026 to Sep 2026 · approved months only" or
 * "All funds · All months · all statuses".
 */
export function portfolioSummary(meta: PortfolioExportMeta): string {
  const fund = meta.fund ? meta.fund.code : "All funds";
  const status = meta.status === "approved" ? "approved months only" : "all statuses";
  return `${fund} · ${monthsText(meta)} · ${status}`;
}

/** One data sheet: brand header row, a row per item, filters, frozen header and first column, landscape print. */
function writeDataSheet<R>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly ExportColumn<R>[],
  rows: readonly R[],
  options: { brandTab?: boolean; emptyNote?: string } = {},
): void {
  const sheet = workbook.addWorksheet(name, options.brandTab ? { properties: { tabColor: { argb: BRAND_ARGB } } } : {});
  setColumnWidths(
    sheet,
    columns.map((column) => column.width),
  );
  const header = sheet.getRow(1);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });
  styleHeaderRow(header, 1, columns.length, { horizontal: "center" });
  header.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };

  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 2);
    columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      const value = column.xlsx(row);
      cell.value = value;
      if (value !== null && typeof value !== "string" && column.format) cell.numFmt = NUMBER_FORMATS[column.format];
      if (value instanceof Date) cell.alignment = { horizontal: "left" };
      const note = column.note?.(row);
      if (note) cell.note = note;
      styleBodyCell(cell);
    });
  });
  if (rows.length === 0 && options.emptyNote) writeNote(sheet, 3, options.emptyNote);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: columns.length },
  };
  applyPrintSetup(sheet, { titleRows: "1:1", titleColumns: "A:A", footer: name });
}

/**
 * Excel workbook: "Portfolio data" (header row, filters, frozen panes), "Revenue segments" when
 * `segmentRows` is given (BRD B30), and "About".
 */
export function buildPortfolioWorkbook(
  rows: readonly PortfolioRow[],
  meta: PortfolioExportMeta,
  segmentRows?: readonly PortfolioSegmentRow[] | null,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  setWorkbookProperties(workbook, {
    title: `Portfolio data · ${portfolioSummary(meta)}`,
    created: new Date(parseInstant(meta.generatedAt) ?? Date.now()),
  });

  writeDataSheet(workbook, "Portfolio data", PORTFOLIO_COLUMNS, rows, { brandTab: true });
  if (segmentRows) {
    writeDataSheet(workbook, "Revenue segments", PORTFOLIO_SEGMENT_COLUMNS, segmentRows, {
      emptyNote: "None of these months has revenue segment figures.",
    });
  }

  const about = workbook.addWorksheet("About");
  setColumnWidths(about, [22, 90]);
  writeTitle(about, 1, "Portfolio data export");
  const details: [string, string][] = [
    ["Exported", `${formatDateTime(meta.generatedAt)} (Malaysia time)`],
    ["Fund", meta.fund ? `${meta.fund.code} · ${meta.fund.name}` : "All funds"],
    ["Months", monthsText(meta)],
    [
      "Months included",
      meta.status === "approved"
        ? "Approved months only (figures ScaleUp has approved)"
        : "All months: the Status column shows whether each month is approved",
    ],
    ["Rows", String(rows.length)],
    ...(segmentRows ? [["Revenue segment rows", String(segmentRows.length)] satisfies [string, string]] : []),
  ];
  details.forEach(([label, value], index) => {
    const row = about.getRow(index + 3);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
  });
  const notes = [
    "Amounts are in each company's reporting currency (Currency column). RM columns = amount × the month's FX rate to MYR; blank where no rate is set.",
    "GP % and NP % are gross and net profit as a share of total revenue. Runway = cash in bank ÷ monthly burn; blank when the company is cash-flow positive (burn of 0).",
    ...(meta.status === "all"
      ? [
          `Months still open for changes (Status “${SUBMISSION_STATUS_META.draft.label}” or “${SUBMISSION_STATUS_META.changes_requested.label}”) show what the monthly form shows: for a company that reports revenue by its own segments, revenue is the sum of the segments filled in so far.`,
        ]
      : []),
    ...(segmentRows
      ? [
          "Revenue segments: one row per company, month and segment with a figure. A company's own revenue segments add up to its total revenue; ScaleUp revenue lines are set by ScaleUp and need not add up. Submitted months keep the segment names they were reported with (In use = No longer used).",
        ]
      : []),
    "Months are calendar months (Malaysia time). Figures come from the monthly updates on the platform and are never retyped.",
  ];
  notes.forEach((note, index) => writeNote(about, details.length + 4 + index, note));
  return workbook;
}

/** e.g. "Portfolio data SV1 2026-07 to 2026-09 (approved).csv". */
export function portfolioFileName(meta: PortfolioExportMeta, format: PortfolioFormat, today: string): string {
  const fund = meta.fund ? meta.fund.code : "all funds";
  const range =
    meta.from || meta.to
      ? `${meta.from ? dateToMonthKey(meta.from) : "start"} to ${meta.to ? dateToMonthKey(meta.to) : today.slice(0, 7)}`
      : `to ${today}`;
  const status = meta.status === "approved" ? "approved" : "all months";
  return `Portfolio data ${fund} ${range} (${status}).${format}`;
}
