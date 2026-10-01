// Period closes and documents as the documents pages show them (docs/ARCHITECTURE.md §2.2, §6 "Period
// close"). Pure and client-safe: the server loads the rows (queries.ts) and these functions shape them,
// so the rules can be unit-tested without a database.
//
// Months counted for a close mirror `confirm_period_close()`: every month from
// greatest(period_start, reporting_start_month) — without a start month, from the company's first month
// with a submission in the period — to the period end. Live totals use `periodTotals` over the
// submitted and approved months of that range (the same result as the stored `computed_totals`).
//
// People (BRD B28): on the company side ScaleUp staff are shown as "<full name> (ScaleUp)" from
// `staff_display_names` (`staffIdsToResolve` → getStaffDisplayNames → `staffNames`), never by email or
// role, and "ScaleUp" only for system actions or when the names could not be loaded (personLabel);
// ScaleUp pages show names with the ScaleUp role from the profiles.

import { CLOSE_PERIOD_TYPE_LABELS, SCALEUP_LABEL, SCALEUP_ROLE_LABELS } from "@/lib/constants";
import { growthPct, periodTotals, type MonthlyFinancials, type PeriodTotals } from "@/lib/metrics";
import {
  addMonths,
  closePeriodOf,
  compareMonths,
  dateToMonthKey,
  halfOf,
  monthKeyToDate,
  monthsBetween,
  parseMonthKey,
  parsePeriodLabel,
  quarterOf,
  type ClosePeriod,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";
import type { Json } from "@/lib/supabase/database.types";
import type {
  ClosePeriodType,
  CompanyStatus,
  DocumentType,
  PeriodCloseStatus,
  ScaleupRole,
  SubmissionStatus,
} from "@/lib/types/enums";

import { effectiveTotals, hasRestatement, parsePeriodTotals, parseRestatedTotals, type RestatedTotals } from "./totals";

/** Who is looking: company users (ScaleUp staff shown as "<full name> (ScaleUp)", BRD B28) or ScaleUp staff. */
export type DocumentsMode = "company" | "scaleup";

/**
 * Names of ScaleUp staff for the company side (BRD B28): lower-case user id → "<full name> (ScaleUp)",
 * e.g. "Renuka Sena (ScaleUp)", as `getStaffDisplayNames` (rpc `staff_display_names`) returns them.
 */
export type StaffNames = Readonly<Record<string, string>>;

/**
 * Company side: someone whose profile the viewer can no longer read and who is not ScaleUp staff (the
 * names were loaded and do not include them), i.e. a person removed from the company's team. Same
 * wording as the comments (M6).
 */
export const FORMER_MEMBER_LABEL = "Former team member";

// ---------------------------------------------------------------------------------------------
// Rows as loaded (queries.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Profile columns loaded for uploaders and confirmers. Null when not visible: company users never read
 * ScaleUp staff profiles (RLS), so those people are named through `StaffNames` instead.
 */
export type PersonProfile = { full_name: string | null; email: string | null; scaleup_role: ScaleupRole | null };

export type CompanyRecord = {
  id: string;
  name: string;
  status: CompanyStatus;
  reporting_currency: string;
  reporting_start_month: string | null;
};

export type CloseRecord = {
  id: string;
  period_type: ClosePeriodType;
  period_start: string;
  period_end: string;
  label: string;
  status: PeriodCloseStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  computed_totals: Json | null;
  restated_totals: Json | null;
  restatement_reason: string | null;
  confirmer: PersonProfile | null;
};

export type DocumentRecord = {
  id: string;
  period_close_id: string | null;
  doc_type: DocumentType;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  uploaded_at: string;
  uploaded_by: string | null;
  uploader: PersonProfile | null;
};

/** A month of the company (v_submission_overview). */
export type MonthRecord = { id: string; month: string; status: SubmissionStatus; is_overdue: boolean };

/** A month's system numbers with its status (getFinancialSeries). */
export type FinancialRecord = MonthlyFinancials & { status: SubmissionStatus };

// ---------------------------------------------------------------------------------------------
// View shapes (plain data: safe to pass to Client Components)
// ---------------------------------------------------------------------------------------------

export type DocumentItem = {
  id: string;
  closeId: string | null;
  docType: DocumentType;
  fileName: string;
  version: number;
  sizeBytes: number | null;
  mimeType: string | null;
  uploadedAt: string;
  /** Display name (personLabel); "<full name> (ScaleUp)" for ScaleUp staff on the company side. */
  uploadedBy: string;
  /** The highest version of its kind in its close (or among the other documents). */
  isLatest: boolean;
};

export type CloseMonth = {
  month: MonthKey;
  /** Inside the counted range (false: before the company's reporting start). */
  counted: boolean;
  submissionId: string | null;
  /** Null when the company has no update for the month. */
  status: SubmissionStatus | null;
  overdue: boolean;
  /** Submitted or approved. */
  submitted: boolean;
};

export type CloseView = {
  id: string;
  label: string;
  type: ClosePeriodType;
  typeLabel: string;
  /** 'Jul–Sep 2026' */
  rangeLabel: string;
  startMonth: MonthKey;
  endMonth: MonthKey;
  /** First counted month. */
  countFrom: MonthKey;
  status: PeriodCloseStatus;
  months: CloseMonth[];
  countedMonths: number;
  submittedMonths: number;
  allSubmitted: boolean;
  /** Totals of the submitted and approved counted months, as they are now. */
  liveTotals: PeriodTotals;
  /**
   * Revenue against the previous quarter / half-year (BRD §6.1: QoQ, HoH growth): only when both periods
   * are complete (every month submitted or approved; a confirmed close counts with its restated figures).
   */
  revenueComparison: RevenueComparison | null;
  /** The snapshot stored at confirmation (null while open). */
  computedTotals: PeriodTotals | null;
  /** Restated figures: of the confirmation, or kept from before a reopen until the next one. */
  restatedTotals: RestatedTotals | null;
  restatementReason: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** Newest version first. */
  managementAccounts: DocumentItem[];
  /** Newest version first. */
  supporting: DocumentItem[];
  /**
   * Open, the company active, every counted month submitted and management accounts uploaded. Never for
   * exited or written-off companies: they are read-only and `confirm_period_close()` refuses them.
   */
  readyToConfirm: boolean;
};

export type CompanyDocumentsView = {
  company: {
    id: string;
    name: string;
    status: CompanyStatus;
    currency: string;
    reportingStartMonth: MonthKey | null;
  };
  /** Newest period first (quarters before halves ending the same day). */
  closes: CloseView[];
  /** Documents not tied to a period close, newest first. */
  otherDocuments: DocumentItem[];
};

/** A period's revenue against the previous period of the same type (QoQ for quarters, HoH for halves). */
export type RevenueComparison = {
  /** "QoQ" (quarter on quarter) or "HoH" (half-year on half-year). */
  kind: "QoQ" | "HoH";
  /** The previous period, e.g. "Q2 2026". */
  previousLabel: string;
  previousRevenue: number;
  revenue: number;
  /** Growth in percent (12.5 = +12.5 %); null when the previous revenue is 0. */
  growthPct: number | null;
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const SUBMITTED_STATUSES: ReadonlySet<SubmissionStatus> = new Set<SubmissionStatus>(["submitted", "approved"]);

/** Submitted or approved: counts towards a period close. */
export function isSubmittedStatus(status: SubmissionStatus | null | undefined): boolean {
  return status !== null && status !== undefined && SUBMITTED_STATUSES.has(status);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

/** The full name, else the email, of a profile; null without either. */
function profileName(profile: PersonProfile | null | undefined): string | null {
  return profile ? profile.full_name?.trim() || profile.email?.trim() || null : null;
}

/**
 * The name the company side takes from a profile: company-side accounts (co-members) only. Null for
 * ScaleUp staff, whose email and role are never shown to company users (BRD B24, B28).
 */
function companySideName(profile: PersonProfile | null | undefined): string | null {
  return profile && profile.scaleup_role === null ? profileName(profile) : null;
}

/**
 * The name shown for an uploader or confirmer.
 * - Company side (BRD B28): company users by name; ScaleUp staff as "<full name> (ScaleUp)" from
 *   `staffNames` (keyed by lower-case id), never their email or role. "ScaleUp" (SCALEUP_LABEL) for
 *   system actions, and for everyone hidden when `staffNames` is undefined (the names could not be
 *   loaded). Once they are loaded, a hidden person missing from them is not ScaleUp staff but someone
 *   removed from the team: "Former team member".
 * - ScaleUp side: the name, with the ScaleUp role in brackets for staff (on-behalf work stands out);
 *   "System" when there is no person.
 */
export function personLabel(
  profile: PersonProfile | null | undefined,
  userId: string | null,
  mode: DocumentsMode,
  staffNames?: StaffNames,
): string {
  if (mode === "company") {
    const own = companySideName(profile);
    if (own !== null) return own;
    if (userId === null || staffNames === undefined) return SCALEUP_LABEL;
    // Own keys only, so no id can hit an Object.prototype member.
    const key = userId.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(staffNames, key)) return staffNames[key].trim() || SCALEUP_LABEL;
    return profile ? SCALEUP_LABEL : FORMER_MEMBER_LABEL;
  }
  const name = profileName(profile);
  if (userId === null && !profile) return "System";
  if (name === null) return "Unknown user";
  return profile?.scaleup_role ? `${name} (${SCALEUP_ROLE_LABELS[profile.scaleup_role]})` : name;
}

/**
 * The uploaders and confirmers the company side cannot name from `profiles` (ScaleUp staff, whose
 * profiles company users never read, and people since removed from the team): lower-case ids, sorted
 * and without duplicates, to resolve with `getStaffDisplayNames` (BRD B28). Only confirmed closes show
 * who confirmed (a reopen clears it).
 */
export function staffIdsToResolve(
  closes: readonly Pick<CloseRecord, "status" | "confirmed_by" | "confirmer">[],
  documents: readonly Pick<DocumentRecord, "uploaded_by" | "uploader">[],
): string[] {
  const ids = new Set<string>();
  for (const close of closes) {
    if (close.status === "confirmed" && close.confirmed_by !== null && companySideName(close.confirmer) === null) {
      ids.add(close.confirmed_by.toLowerCase());
    }
  }
  for (const doc of documents) {
    if (doc.uploaded_by !== null && companySideName(doc.uploader) === null) ids.add(doc.uploaded_by.toLowerCase());
  }
  return Array.from(ids).sort(compareText);
}

/**
 * The first month a close counts (mirrors `confirm_period_close()`): greatest(period start, reporting
 * start month); without a start month, from the company's first month with a submission in the period;
 * the period start when neither applies.
 */
export function closeCountFrom(
  close: { period_start: string; period_end: string },
  reportingStartMonth: string | null,
  submissionMonths: readonly string[],
): MonthKey {
  const start = dateToMonthKey(close.period_start);
  const end = dateToMonthKey(close.period_end);
  let from: MonthKey | null = reportingStartMonth ? parseMonthKey(reportingStartMonth) : null;
  if (from === null) {
    const inPeriod = submissionMonths
      .flatMap((month) => {
        const key = parseMonthKey(month);
        return key !== null && compareMonths(key, start) >= 0 && compareMonths(key, end) <= 0 ? [key] : [];
      })
      .sort(compareText);
    from = inPeriod[0] ?? null;
  }
  return from !== null && compareMonths(from, start) > 0 ? from : start;
}

/** True when `month` lies in from..to (inclusive, by month). */
function inMonthRange(month: string, from: MonthKey, to: MonthKey): boolean {
  const key = parseMonthKey(month);
  return key !== null && compareMonths(key, from) >= 0 && compareMonths(key, to) <= 0;
}

/**
 * Live totals of a close: `periodTotals` over the submitted and approved months from the counted start
 * to the period end (what `confirm_period_close()` would store now). `series` is the company's monthly
 * figures (any status; other months are ignored).
 */
export function liveCloseTotals(
  close: { period_start: string; period_end: string },
  reportingStartMonth: string | null,
  series: readonly FinancialRecord[],
): PeriodTotals {
  const from = closeCountFrom(close, reportingStartMonth, series.map((point) => point.month));
  const end = dateToMonthKey(close.period_end);
  return periodTotals(series.filter((point) => isSubmittedStatus(point.status) && inMonthRange(point.month, from, end)));
}

type CloseRow = {
  period_type: ClosePeriodType;
  period_start: string;
  status: PeriodCloseStatus;
  computed_totals: Json | null;
  restated_totals: Json | null;
};

/**
 * The revenue of a whole period: a confirmed close's figures (restated ones included) when they cover
 * every month of the period, else the submitted and approved months of `series` when every month of the
 * period is one of them; null when the period is not complete.
 */
function completePeriodRevenue(
  period: ClosePeriod,
  close: CloseRow | undefined,
  series: readonly FinancialRecord[],
): number | null {
  if (close?.status === "confirmed") {
    const computed = parsePeriodTotals(close.computed_totals);
    if (computed && computed.months_count === period.months.length) {
      return effectiveTotals(computed, parseRestatedTotals(close.restated_totals)).revenue_total;
    }
  }
  const points = series.filter((point) => isSubmittedStatus(point.status) && inMonthRange(point.month, period.startMonth, period.endMonth));
  const months = new Set(points.flatMap((point) => parseMonthKey(point.month) ?? []));
  if (months.size !== period.months.length) return null;
  return periodTotals(points).revenue_total;
}

/**
 * Revenue of a close's period against the previous period of the same type (BRD §6.1: QoQ, HoH growth),
 * when both are complete; null otherwise (a partial period would compare unlike with like).
 */
export function revenueComparison(
  close: CloseRow,
  closes: readonly CloseRow[],
  series: readonly FinancialRecord[],
): RevenueComparison | null {
  const period = closePeriodOf(close.period_type, close.period_start);
  const previous = closePeriodOf(close.period_type, addMonths(period.startMonth, -1));
  const previousClose = closes.find(
    (row) => row.period_type === close.period_type && dateToMonthKey(row.period_start) === previous.startMonth,
  );
  const revenue = completePeriodRevenue(period, close, series);
  const previousRevenue = completePeriodRevenue(previous, previousClose, series);
  if (revenue === null || previousRevenue === null) return null;
  return {
    kind: close.period_type === "quarter" ? "QoQ" : "HoH",
    previousLabel: previous.label,
    previousRevenue,
    revenue,
    growthPct: growthPct(revenue, previousRevenue),
  };
}

/** Closes newest first: later period end first; for the same end, the quarter before the half. */
export function compareClosesNewestFirst(
  a: { period_end: string; period_type: ClosePeriodType; label: string },
  b: { period_end: string; period_type: ClosePeriodType; label: string },
): number {
  const byEnd = compareText(dateToMonthKey(b.period_end), dateToMonthKey(a.period_end));
  if (byEnd !== 0) return byEnd;
  if (a.period_type !== b.period_type) return a.period_type === "quarter" ? -1 : 1;
  return compareText(a.label, b.label);
}

/** Documents newest version first (then newest upload, then id). */
function compareDocuments(a: DocumentItem, b: DocumentItem): number {
  if (a.version !== b.version) return b.version - a.version;
  const byTime = compareText(b.uploadedAt, a.uploadedAt);
  return byTime !== 0 ? byTime : compareText(a.id, b.id);
}

function toDocumentItem(doc: DocumentRecord, mode: DocumentsMode, staffNames: StaffNames | undefined): DocumentItem {
  return {
    id: doc.id,
    closeId: doc.period_close_id,
    docType: doc.doc_type,
    fileName: doc.file_name,
    version: doc.version,
    sizeBytes: doc.size_bytes,
    mimeType: doc.mime_type,
    uploadedAt: doc.uploaded_at,
    uploadedBy: personLabel(doc.uploader, doc.uploaded_by, mode, staffNames),
    isLatest: false,
  };
}

/** Sorted copies of the documents with `isLatest` set on the highest version of each close and type. */
function withLatestFlags(items: readonly DocumentItem[]): DocumentItem[] {
  const latest = new Map<string, DocumentItem>();
  for (const item of items) {
    const slot = `${item.closeId ?? "general"}:${item.docType}`;
    const current = latest.get(slot);
    if (!current || compareDocuments(item, current) < 0) latest.set(slot, item);
  }
  const latestIds = new Set(Array.from(latest.values(), (item) => item.id));
  return items.map((item) => ({ ...item, isLatest: latestIds.has(item.id) })).sort(compareDocuments);
}

// ---------------------------------------------------------------------------------------------
// Company view
// ---------------------------------------------------------------------------------------------

export type CompanyDocumentsInput = {
  mode: DocumentsMode;
  company: CompanyRecord;
  closes: readonly CloseRecord[];
  documents: readonly DocumentRecord[];
  months: readonly MonthRecord[];
  financials: readonly FinancialRecord[];
  /**
   * Company side: the names of the ScaleUp staff among the uploaders and confirmers (getStaffDisplayNames
   * for `staffIdsToResolve`, BRD B28). Undefined when they could not be loaded: everyone hidden then shows
   * as "ScaleUp" (see personLabel). Unused on the ScaleUp side.
   */
  staffNames?: StaffNames;
};

/** Shapes a company's closes (months, live totals, confirmation, documents) and its other documents. */
export function buildCompanyDocumentsView(input: CompanyDocumentsInput): CompanyDocumentsView {
  const { mode, company, staffNames } = input;
  // Exited and written-off companies are read-only (BRD B15): their open closes can no longer be confirmed.
  const companyActive = company.status === "active";
  const monthByKey = new Map<MonthKey, MonthRecord>();
  for (const record of input.months) {
    const key = parseMonthKey(record.month);
    if (key !== null) monthByKey.set(key, record);
  }
  const submissionMonths = Array.from(monthByKey.keys());

  const closeIds = new Set(input.closes.map((close) => close.id));
  const documents = withLatestFlags(input.documents.map((doc) => toDocumentItem(doc, mode, staffNames)));
  const byClose = new Map<string, DocumentItem[]>();
  const otherDocuments: DocumentItem[] = [];
  for (const item of documents) {
    if (item.closeId !== null && closeIds.has(item.closeId)) {
      const list = byClose.get(item.closeId) ?? [];
      list.push(item);
      byClose.set(item.closeId, list);
    } else {
      otherDocuments.push(item);
    }
  }

  const closes = [...input.closes].sort(compareClosesNewestFirst).map((close): CloseView => {
    const period = closePeriodOf(close.period_type, close.period_start);
    const startMonth = dateToMonthKey(close.period_start);
    const endMonth = dateToMonthKey(close.period_end);
    const countFrom = closeCountFrom(close, company.reporting_start_month, submissionMonths);
    const months = monthsBetween(startMonth, endMonth).map((month): CloseMonth => {
      const record = monthByKey.get(month) ?? null;
      const status = record?.status ?? null;
      return {
        month,
        counted: compareMonths(month, countFrom) >= 0,
        submissionId: record?.id ?? null,
        status,
        overdue: record?.is_overdue ?? false,
        submitted: isSubmittedStatus(status),
      };
    });
    const counted = months.filter((month) => month.counted);
    const submittedMonths = counted.filter((month) => month.submitted).length;
    const closeDocuments = byClose.get(close.id) ?? [];
    const managementAccounts = closeDocuments.filter((doc) => doc.docType === "management_accounts");
    const restated = parseRestatedTotals(close.restated_totals);
    const confirmed = close.status === "confirmed";
    return {
      id: close.id,
      label: close.label,
      type: close.period_type,
      typeLabel: CLOSE_PERIOD_TYPE_LABELS[close.period_type],
      rangeLabel: period.rangeLabel,
      startMonth,
      endMonth,
      countFrom,
      status: close.status,
      months,
      countedMonths: counted.length,
      submittedMonths,
      allSubmitted: submittedMonths === counted.length,
      liveTotals: liveCloseTotals(close, company.reporting_start_month, input.financials),
      revenueComparison: revenueComparison(close, input.closes, input.financials),
      computedTotals: confirmed ? parsePeriodTotals(close.computed_totals) : null,
      restatedTotals: hasRestatement(restated) ? restated : null,
      restatementReason: close.restatement_reason?.trim() || null,
      confirmedAt: confirmed ? close.confirmed_at : null,
      confirmedBy: confirmed ? personLabel(close.confirmer, close.confirmed_by, mode, staffNames) : null,
      managementAccounts,
      supporting: closeDocuments.filter((doc) => doc.docType === "supporting"),
      readyToConfirm: companyActive && !confirmed && submittedMonths === counted.length && managementAccounts.length > 0,
    };
  });

  return {
    company: {
      id: company.id,
      name: company.name,
      status: company.status,
      currency: company.reporting_currency.trim() || "MYR",
      reportingStartMonth: company.reporting_start_month ? parseMonthKey(company.reporting_start_month) : null,
    },
    closes,
    otherDocuments,
  };
}

/**
 * The close expanded when the page opens: the requested one, else every open close, else the newest.
 * Returns the ids to expand.
 */
export function defaultExpandedCloses(closes: readonly Pick<CloseView, "id" | "status">[], focusCloseId?: string | null): string[] {
  if (focusCloseId && closes.some((close) => close.id === focusCloseId)) return [focusCloseId];
  const open = closes.filter((close) => close.status === "open").map((close) => close.id);
  if (open.length > 0) return open;
  return closes.length > 0 ? [closes[0].id] : [];
}

/**
 * The next quarter close to expect when a company has none yet: the quarter of the current month (or of
 * the reporting start month when that is later), created on the 1st of the month after it ends.
 */
export function upcomingClose(
  reportingStartMonth: string | null,
  today: DateKey,
): { period: ClosePeriod; opensOn: DateKey } {
  const current = dateToMonthKey(today);
  const start = reportingStartMonth ? parseMonthKey(reportingStartMonth) : null;
  const base = start !== null && compareMonths(start, current) > 0 ? start : current;
  const period = quarterOf(base);
  return { period, opensOn: monthKeyToDate(addMonths(period.endMonth, 1)) };
}

// ---------------------------------------------------------------------------------------------
// Portfolio view (ScaleUp)
// ---------------------------------------------------------------------------------------------

/** URL key of a period: 'Q3-2026', 'H2-2026' (parsePeriodKey reads it back). */
export function periodKey(period: Pick<ClosePeriod, "type" | "index" | "year">): string {
  return `${period.type === "quarter" ? "Q" : "H"}${period.index}-${period.year}`;
}

/** 'Q3-2026' / 'Q3 2026' / 'h2-2026' → the period; null when not a period key. */
export function parsePeriodKey(value: string | null | undefined): ClosePeriod | null {
  return value ? parsePeriodLabel(value) : null;
}

/**
 * Every calendar quarter and half from the earliest close start to the latest close end (the period
 * selector), newest first; [] when the bounds are missing or reversed.
 */
export function periodOptionsBetween(firstStart: string | null, lastEnd: string | null): ClosePeriod[] {
  const from = firstStart ? parseMonthKey(firstStart) : null;
  const to = lastEnd ? parseMonthKey(lastEnd) : null;
  if (from === null || to === null || compareMonths(from, to) > 0) return [];
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  const options: ClosePeriod[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const month of ["03", "06", "09", "12"]) options.push(quarterOf(`${year}-${month}`));
    for (const month of ["06", "12"]) options.push(halfOf(`${year}-${month}`));
  }
  return options
    .filter((period) => compareMonths(period.startMonth, from) >= 0 && compareMonths(period.endMonth, to) <= 0)
    .sort((a, b) =>
      compareClosesNewestFirst(
        { period_end: a.end, period_type: a.type, label: a.label },
        { period_end: b.end, period_type: b.type, label: b.label },
      ),
    );
}

export type PortfolioCompany = {
  id: string;
  name: string;
  status: CompanyStatus;
  reporting_start_month: string | null;
};

export type PortfolioClose = {
  id: string;
  company_id: string;
  status: PeriodCloseStatus;
  restated_totals: Json | null;
  confirmed_at: string | null;
};

export type PortfolioSubmission = { company_id: string; month: string; status: SubmissionStatus };

export type PortfolioCloseSummary = {
  id: string;
  status: PeriodCloseStatus;
  submittedMonths: number;
  countedMonths: number;
  allSubmitted: boolean;
  /** Management accounts files (every version) linked to the close. */
  managementAccounts: number;
  /** Confirmed with restated figures. */
  restated: boolean;
  confirmedAt: string | null;
  /** Open, the company active, every counted month submitted and management accounts uploaded. */
  readyToConfirm: boolean;
};

export type PortfolioRow = {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  /** No reporting start month (BRD B16). */
  notYetReporting: boolean;
  fundCodes: string[];
  close: PortfolioCloseSummary | null;
};

export type PortfolioInput = {
  period: ClosePeriod;
  companies: readonly PortfolioCompany[];
  /** The period's closes (any company). */
  closes: readonly PortfolioClose[];
  /** Submissions of the period's months (any company). */
  submissions: readonly PortfolioSubmission[];
  /** `period_close_id` of every management accounts document of the period's closes. */
  managementAccountCloseIds: readonly (string | null)[];
  funds: readonly { company_id: string; code: string }[];
};

/** Table order: open closes, open closes of read-only (exited, written-off) companies, confirmed, no close. */
function rowGroup(row: PortfolioRow): number {
  if (row.close === null) return 3;
  if (row.close.status === "confirmed") return 2;
  return row.companyStatus === "active" ? 0 : 1;
}

/**
 * One row per company for the selected period: its close (months submitted x of y, management accounts
 * uploaded, restated, ready to confirm) or none. Open closes first (those of exited and written-off
 * companies, which can no longer be confirmed, after the others), then confirmed, then companies without
 * a close; by name within each group.
 */
export function buildPortfolioRows(input: PortfolioInput): PortfolioRow[] {
  const { period } = input;
  const closeByCompany = new Map(input.closes.map((close) => [close.company_id, close]));
  const accountsByClose = new Map<string, number>();
  for (const closeId of input.managementAccountCloseIds) {
    if (closeId) accountsByClose.set(closeId, (accountsByClose.get(closeId) ?? 0) + 1);
  }
  const submissionsByCompany = new Map<string, PortfolioSubmission[]>();
  for (const submission of input.submissions) {
    if (!inMonthRange(submission.month, period.startMonth, period.endMonth)) continue;
    const list = submissionsByCompany.get(submission.company_id) ?? [];
    list.push(submission);
    submissionsByCompany.set(submission.company_id, list);
  }
  const fundsByCompany = new Map<string, Set<string>>();
  for (const fund of input.funds) {
    const set = fundsByCompany.get(fund.company_id) ?? new Set<string>();
    set.add(fund.code);
    fundsByCompany.set(fund.company_id, set);
  }

  const rows = input.companies.map((company): PortfolioRow => {
    const close = closeByCompany.get(company.id) ?? null;
    let summary: PortfolioCloseSummary | null = null;
    if (close) {
      const submissions = submissionsByCompany.get(company.id) ?? [];
      const statusByMonth = new Map<MonthKey, SubmissionStatus>();
      for (const submission of submissions) {
        const key = parseMonthKey(submission.month);
        if (key !== null) statusByMonth.set(key, submission.status);
      }
      const from = closeCountFrom(
        { period_start: period.start, period_end: period.end },
        company.reporting_start_month,
        submissions.map((submission) => submission.month),
      );
      const counted = monthsBetween(from, period.endMonth);
      const submittedMonths = counted.filter((month) => isSubmittedStatus(statusByMonth.get(month))).length;
      const managementAccounts = accountsByClose.get(close.id) ?? 0;
      const confirmed = close.status === "confirmed";
      summary = {
        id: close.id,
        status: close.status,
        submittedMonths,
        countedMonths: counted.length,
        allSubmitted: submittedMonths === counted.length,
        managementAccounts,
        restated: confirmed && hasRestatement(parseRestatedTotals(close.restated_totals)),
        confirmedAt: confirmed ? close.confirmed_at : null,
        // Exited and written-off companies are read-only: confirm_period_close() refuses them.
        readyToConfirm: company.status === "active" && !confirmed && submittedMonths === counted.length && managementAccounts > 0,
      };
    }
    return {
      companyId: company.id,
      companyName: company.name,
      companyStatus: company.status,
      notYetReporting: company.reporting_start_month === null,
      fundCodes: Array.from(fundsByCompany.get(company.id) ?? []).sort(compareText),
      close: summary,
    };
  });

  return rows.sort((a, b) => rowGroup(a) - rowGroup(b) || compareNames(a.companyName, b.companyName));
}

export type PortfolioSummary = {
  companies: number;
  withClose: number;
  confirmed: number;
  /** Every open close: readyToConfirm + waiting + readOnly. */
  open: number;
  readyToConfirm: number;
  /** Open closes of active companies still waiting for months or management accounts. */
  waiting: number;
  /** Open closes of exited or written-off companies: read-only, they can no longer be confirmed. */
  readOnly: number;
};

/** Counts for the summary tiles above the portfolio table. */
export function summarisePortfolio(rows: readonly PortfolioRow[]): PortfolioSummary {
  const summary: PortfolioSummary = {
    companies: rows.length,
    withClose: 0,
    confirmed: 0,
    open: 0,
    readyToConfirm: 0,
    waiting: 0,
    readOnly: 0,
  };
  for (const row of rows) {
    if (!row.close) continue;
    summary.withClose += 1;
    if (row.close.status === "confirmed") {
      summary.confirmed += 1;
    } else {
      summary.open += 1;
      if (row.companyStatus !== "active") summary.readOnly += 1;
      else if (row.close.readyToConfirm) summary.readyToConfirm += 1;
      else summary.waiting += 1;
    }
  }
  return summary;
}
