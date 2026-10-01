// Submission tracker (BRD A6, O3, O7; docs/ARCHITECTURE.md §6 "Tracker"): the pure model behind
// /admin/tracker. The page loads the portfolio once (load-tracker.ts, server-only: companies, the last
// 12 open months, v_submission_overview, escalation days) and the client workspace builds the grid with
// buildTracker(), so every filter (fund, partner, status, search, 6/12 months) is instant and mirrored
// in the URL (?fund=SV1&partner=<uuid>|none&status=overdue&months=12&search=batik).
// Client-safe: no server-only imports.

import {
  ESCALATED_META,
  MISSING_META,
  OVERDUE_META,
  SUBMISSION_STATUS_META,
  type Tone,
} from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  compareMonths,
  daysBetween,
  isDateKey,
  lastDayOfMonth,
  monthLabel,
  monthLabelLong,
  parseMonthKey,
  toMYTDate,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";
import {
  COMPANY_STATUSES,
  SUBMISSION_STATUSES,
  type CompanyStatus,
  type SubmissionStatus,
} from "@/lib/types/enums";

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

export const TRACKER_PATH = "/admin/tracker";

/** Month windows the grid can show (default 6). */
export const TRACKER_WINDOWS = [6, 12] as const;
export type TrackerWindow = (typeof TRACKER_WINDOWS)[number];
export const DEFAULT_TRACKER_WINDOW: TrackerWindow = 6;

/** The page always loads this many open months; the 6/12 toggle only changes what is shown. */
export const TRACKER_MAX_MONTHS = 12;

/** BRD O3: a month's numbers should be approved within 20 days of the month end. */
export const APPROVAL_TARGET_DAYS = 20;

/** Longest search text kept (anything longer is cut). */
export const SEARCH_MAX_LENGTH = 100;

/** `?partner=none`: companies without a partner-in-charge. */
export const UNASSIGNED_PARTNER = "none";

/**
 * The status filter (`?status=`). A company row is shown when any month in the window matches; months the
 * company is no longer expected to send (isAwaited) match none.
 */
export const STATUS_FILTERS = [
  "needs_attention",
  "overdue",
  "escalated",
  "not_submitted",
  "submitted",
  "changes_requested",
  "approved",
  "amendment_requested",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_META: Record<StatusFilter, { label: string; description: string }> = {
  needs_attention: {
    label: "Needs attention",
    description: "Overdue, changes requested, awaiting review or amendment requested",
  },
  overdue: { label: OVERDUE_META.label, description: OVERDUE_META.description },
  escalated: { label: ESCALATED_META.label, description: ESCALATED_META.description },
  not_submitted: {
    label: SUBMISSION_STATUS_META.draft.label,
    description: SUBMISSION_STATUS_META.draft.description,
  },
  submitted: { label: "Awaiting review", description: SUBMISSION_STATUS_META.submitted.description },
  changes_requested: {
    label: SUBMISSION_STATUS_META.changes_requested.label,
    description: SUBMISSION_STATUS_META.changes_requested.description,
  },
  approved: {
    label: SUBMISSION_STATUS_META.approved.label,
    description: SUBMISSION_STATUS_META.approved.description,
  },
  amendment_requested: {
    label: "Amendment requested",
    description: "Approved months the company owner asked to amend (BRD B8): reopen them, or answer in the thread",
  },
};

// ---------------------------------------------------------------------------------------------
// Filters (search params)
// ---------------------------------------------------------------------------------------------

export type TrackerFilters = {
  /** Fund code, upper-case ('SV1'), or null for every fund. */
  fund: string | null;
  /** Partner-in-charge profile id (lower-case uuid), UNASSIGNED_PARTNER, or null for everyone. */
  partner: string | null;
  status: StatusFilter | null;
  /** Company name search ('' = none), whitespace collapsed. */
  search: string;
  months: TrackerWindow;
};

export const DEFAULT_TRACKER_FILTERS: TrackerFilters = {
  fund: null,
  partner: null,
  status: null,
  search: "",
  months: DEFAULT_TRACKER_WINDOW,
};

/** Page `searchParams` (after `await`) or a URLSearchParams. */
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FUND_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

function firstValue(params: SearchParamsInput, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isStatusFilter(value: unknown): value is StatusFilter {
  return typeof value === "string" && (STATUS_FILTERS as readonly string[]).includes(value);
}

/** Search text as kept in the filters and the URL: whitespace collapsed, trimmed, at most 100 characters. */
export function normaliseSearch(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();
}

/**
 * Reads the tracker filters from the URL. Malformed values are dropped (a fund code must look like a
 * code, a partner like a uuid or "none"); values that are well-formed but unknown (a fund code that
 * does not exist) are dropped later by buildTracker.
 */
export function parseTrackerFilters(params: SearchParamsInput): TrackerFilters {
  const fund = firstValue(params, "fund")?.trim();
  const partner = firstValue(params, "partner")?.trim().toLowerCase();
  const status = firstValue(params, "status")?.trim();
  const months = firstValue(params, "months")?.trim();
  return {
    fund: fund && FUND_CODE_RE.test(fund) ? fund.toUpperCase() : null,
    partner: partner && (partner === UNASSIGNED_PARTNER || UUID_RE.test(partner)) ? partner : null,
    status: isStatusFilter(status) ? status : null,
    search: normaliseSearch(firstValue(params, "search")),
    months: months === "12" ? 12 : DEFAULT_TRACKER_WINDOW,
  };
}

/** The query string for the filters (defaults left out, fixed key order), without the leading "?". */
export function trackerQueryString(filters: TrackerFilters): string {
  const params = new URLSearchParams();
  if (filters.fund) params.set("fund", filters.fund);
  if (filters.partner) params.set("partner", filters.partner);
  if (filters.status) params.set("status", filters.status);
  if (filters.months !== DEFAULT_TRACKER_WINDOW) params.set("months", String(filters.months));
  const search = normaliseSearch(filters.search);
  if (search) params.set("search", search);
  return params.toString();
}

/** `/admin/tracker` with the filters, e.g. `/admin/tracker?fund=SV1&status=overdue`. */
export function trackerHref(filters: TrackerFilters): string {
  const query = trackerQueryString(filters);
  return query ? `${TRACKER_PATH}?${query}` : TRACKER_PATH;
}

/** True when a fund, partner, status or search filter is set (the month window does not count). */
export function hasActiveFilters(filters: TrackerFilters): boolean {
  return Boolean(filters.fund || filters.partner || filters.status || normaliseSearch(filters.search));
}

// ---------------------------------------------------------------------------------------------
// Data (what the page loads)
// ---------------------------------------------------------------------------------------------

export type TrackerFund = { id: string; code: string; name: string };
export type TrackerPartner = { id: string; name: string };

export type TrackerCompany = {
  id: string;
  name: string;
  status: CompanyStatus;
  /** First month the company reports ('YYYY-MM'); null = "Not yet reporting" (BRD B16). */
  startMonth: MonthKey | null;
  /** Funds holding the company, by code. */
  funds: TrackerFund[];
  /** Partner-in-charge (ScaleUp-internal, company_internal). */
  partner: TrackerPartner | null;
};

/** An open month (reporting_periods): the portfolio due date; companies may have their own. */
export type TrackerMonth = { month: MonthKey; dueDate: DateKey };

/** One v_submission_overview row. */
export type TrackerSubmission = {
  id: string;
  companyId: string;
  month: MonthKey;
  status: SubmissionStatus;
  dueDate: DateKey;
  originalDueDate: DateKey | null;
  submittedAt: string | null;
  approvedAt: string | null;
  revision: number;
  isOverdue: boolean;
  daysOverdue: number;
  hasNarrative: boolean;
  openThreads: number;
  /**
   * An approved month whose owner asked to amend it and that ScaleUp has not answered yet (BRD B8; an open
   * "Amendment requested: …" thread raised after the latest approval, isPendingAmendment). Set by the loader.
   */
  amendmentRequested?: boolean;
};

export type TrackerData = {
  /** Open months, any order (the model keeps the latest TRACKER_MAX_MONTHS, oldest first). */
  months: TrackerMonth[];
  companies: TrackerCompany[];
  submissions: TrackerSubmission[];
  funds: TrackerFund[];
  /** platform_settings.escalation_days: overdue for longer than this = escalated. */
  escalationDays: number;
  /** Today in Malaysia time, from the server (keeps server and client renders identical). */
  today: DateKey;
  currentUserId: string;
};

// Row shapes as selected by load-tracker.ts (structural, so tests need no database types).
type EmbeddedFund = { id: string; code: string; name: string };
type EmbeddedPartner = { id: string; full_name: string | null; email: string | null };
type EmbeddedInternal = { partner_in_charge_id: string | null; partner: EmbeddedPartner | null };

export type TrackerCompanyRow = {
  id: string;
  name: string;
  status: CompanyStatus;
  reporting_start_month: string | null;
  fund_investments: { fund: EmbeddedFund | null }[] | null;
  company_internal: EmbeddedInternal | EmbeddedInternal[] | null;
};

export type TrackerOverviewRow = {
  id: string | null;
  company_id: string | null;
  month: string | null;
  status: SubmissionStatus | null;
  due_date: string | null;
  original_due_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  revision: number | null;
  is_overdue: boolean | null;
  days_overdue: number | null;
  has_narrative: boolean | null;
  open_threads: number | null;
};

/** The name shown for a person: full name, else email. */
export function personName(profile: { full_name: string | null; email: string | null } | null): string | null {
  const name = profile?.full_name?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  return email ? email : null;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

/** A companies row (with its funds and internal record) as a TrackerCompany. */
export function toTrackerCompany(row: TrackerCompanyRow): TrackerCompany {
  const internal = Array.isArray(row.company_internal) ? (row.company_internal[0] ?? null) : row.company_internal;
  const partnerId = internal?.partner?.id ?? internal?.partner_in_charge_id ?? null;
  const funds = (row.fund_investments ?? [])
    .flatMap((investment) => (investment.fund ? [investment.fund] : []))
    .map((fund) => ({ id: fund.id, code: fund.code, name: fund.name }))
    .sort((a, b) => compareText(a.code, b.code));
  return {
    id: row.id,
    name: row.name,
    status: (COMPANY_STATUSES as readonly string[]).includes(row.status) ? row.status : "active",
    startMonth: parseMonthKey(row.reporting_start_month),
    funds: funds.filter((fund, index) => funds.findIndex((other) => other.id === fund.id) === index),
    partner: partnerId
      ? { id: partnerId.toLowerCase(), name: personName(internal?.partner ?? null) ?? "Unknown partner" }
      : null,
  };
}

/** A v_submission_overview row as a TrackerSubmission; null when its identity columns are missing. */
export function toTrackerSubmission(row: TrackerOverviewRow): TrackerSubmission | null {
  const month = parseMonthKey(row.month);
  if (!row.id || !row.company_id || !month || !row.status || !row.due_date) return null;
  if (!(SUBMISSION_STATUSES as readonly string[]).includes(row.status) || !isDateKey(row.due_date)) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    month,
    status: row.status,
    dueDate: row.due_date,
    originalDueDate: row.original_due_date && isDateKey(row.original_due_date) ? row.original_due_date : null,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    revision: row.revision ?? 0,
    isOverdue: row.is_overdue ?? false,
    daysOverdue: Math.max(0, row.days_overdue ?? 0),
    hasNarrative: row.has_narrative ?? false,
    openThreads: Math.max(0, row.open_threads ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

/**
 * What a month cell shows: the status, or overdue / escalated (BRD §6.1: escalate after 14 days), or — for
 * an approved month whose owner asked to amend it (BRD B8) — "amendment requested".
 */
export type CellState =
  | "not_submitted"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "amendment_requested"
  | "overdue"
  | "escalated";

export function cellStateOf(
  submission: Pick<TrackerSubmission, "status" | "isOverdue" | "daysOverdue" | "amendmentRequested">,
  escalationDays: number,
): CellState {
  if (submission.isOverdue) return submission.daysOverdue > escalationDays ? "escalated" : "overdue";
  if (submission.status === "approved" && submission.amendmentRequested) return "amendment_requested";
  switch (submission.status) {
    case "draft":
      return "not_submitted";
    case "submitted":
      return "submitted";
    case "changes_requested":
      return "changes_requested";
    case "approved":
      return "approved";
  }
}

export const CELL_TONES: Record<CellState, Tone> = {
  not_submitted: SUBMISSION_STATUS_META.draft.tone,
  submitted: SUBMISSION_STATUS_META.submitted.tone,
  changes_requested: SUBMISSION_STATUS_META.changes_requested.tone,
  approved: SUBMISSION_STATUS_META.approved.tone,
  amendment_requested: "warning",
  overdue: OVERDUE_META.tone,
  escalated: ESCALATED_META.tone,
};

/** The chip text of an approved month whose owner asked to amend it (BRD B8). */
export const AMENDMENT_REQUESTED_LABEL = "Amendment requested";

/** Chip text: the status label, or "Overdue · 5d" / "Escalated · 20d". */
export function cellLabel(state: CellState, daysOverdue: number, status: SubmissionStatus): string {
  if (state === "overdue") return `${OVERDUE_META.label} · ${daysOverdue}d`;
  if (state === "escalated") return `${ESCALATED_META.label} · ${daysOverdue}d`;
  if (state === "amendment_requested") return AMENDMENT_REQUESTED_LABEL;
  return SUBMISSION_STATUS_META[status].label;
}

/**
 * Is the company still expected to send this month? Not for a draft of a company that is no longer
 * active (read-only, BRD B15, B21), has no reporting start month (B16) or is before its start month (left
 * when the start month moved later): such months are never overdue (v_submission_overview). Nor for a
 * month sent back to a company that is no longer active: it can never resubmit it. Submitted and
 * approved months always count (ScaleUp can still approve them, B21).
 *
 * Months that are not awaited are left out of the summary and attention counts, match no status filter
 * and are shown dimmed.
 */
export function isAwaited(
  company: Pick<TrackerCompany, "status" | "startMonth">,
  submission: Pick<TrackerSubmission, "month" | "status">,
): boolean {
  switch (submission.status) {
    case "submitted":
    case "approved":
      return true;
    case "changes_requested":
      return company.status === "active";
    case "draft":
      return (
        company.status === "active" &&
        company.startMonth !== null &&
        compareMonths(submission.month, company.startMonth) >= 0
      );
  }
}

/** Why a month is not awaited (isAwaited is false), for its tooltip. */
export function notAwaitedReason(company: Pick<TrackerCompany, "status" | "startMonth">): string {
  if (company.status !== "active") return "The company is no longer active and can no longer submit it";
  if (!company.startMonth) return "Not requested: the company is not reporting";
  return `Not requested: before the reporting start month (${monthLabel(company.startMonth)})`;
}

/** Does a month match the status filter? (No filter: everything matches.) See also isAwaited. */
export function matchesStatusFilter(
  submission: Pick<TrackerSubmission, "status">,
  state: CellState,
  filter: StatusFilter | null,
): boolean {
  switch (filter) {
    case null:
      return true;
    case "needs_attention":
      return (
        state === "overdue" ||
        state === "escalated" ||
        state === "amendment_requested" ||
        submission.status === "changes_requested" ||
        submission.status === "submitted"
      );
    case "overdue":
      return state === "overdue" || state === "escalated";
    case "escalated":
      return state === "escalated";
    case "not_submitted":
      return submission.status === "draft";
    case "submitted":
      return submission.status === "submitted";
    case "changes_requested":
      return submission.status === "changes_requested";
    case "approved":
      return submission.status === "approved";
    case "amendment_requested":
      return state === "amendment_requested";
  }
}

/** "1 day" / "3 days". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Days from the month end to approval (BRD O3), or null when not approved or unparseable. */
export function daysToApproval(submission: Pick<TrackerSubmission, "month" | "approvedAt">): number | null {
  if (!submission.approvedAt) return null;
  try {
    return daysBetween(lastDayOfMonth(submission.month), toMYTDate(submission.approvedAt));
  } catch {
    return null;
  }
}

/**
 * The accessible name of a month cell's link: company, month and state, e.g. "RECQA, August 2026:
 * Escalated, 15 days overdue" (links are also read out of the table's context).
 */
export function cellName(companyName: string, submission: Pick<TrackerSubmission, "month" | "status" | "daysOverdue">, state: CellState): string {
  let stateText: string = SUBMISSION_STATUS_META[submission.status].label;
  if (state === "amendment_requested") stateText = `${SUBMISSION_STATUS_META.approved.label}, ${AMENDMENT_REQUESTED_LABEL.toLowerCase()}`;
  if (state === "overdue") stateText = `${OVERDUE_META.label}, ${plural(submission.daysOverdue, "day")}`;
  if (state === "escalated") stateText = `${ESCALATED_META.label}, ${plural(submission.daysOverdue, "day")} overdue`;
  return `${companyName}, ${monthLabelLong(submission.month)}: ${stateText}`;
}

/**
 * The details of a month cell (its tooltip and accessible description): state with dates, why it is not
 * awaited (notAwaitedReason, when given), due date (and the original one when it moved), revision,
 * narrative and open threads.
 */
export function cellDetails(submission: TrackerSubmission, state: CellState, notAwaited: string | null = null): string {
  const statusLabel = SUBMISSION_STATUS_META[submission.status].label;
  const parts: string[] = [];
  switch (state) {
    case "overdue":
      parts.push(`${statusLabel}, ${plural(submission.daysOverdue, "day")} overdue`);
      break;
    case "escalated":
      parts.push(`${statusLabel}, ${plural(submission.daysOverdue, "day")} overdue (escalated)`);
      break;
    case "submitted":
      parts.push(
        submission.submittedAt
          ? `Submitted on ${formatDate(submission.submittedAt)}, awaiting review`
          : "Submitted, awaiting review",
      );
      break;
    case "approved":
      parts.push(submission.approvedAt ? `Approved on ${formatDate(submission.approvedAt)}` : "Approved");
      break;
    case "amendment_requested":
      parts.push(
        `${submission.approvedAt ? `Approved on ${formatDate(submission.approvedAt)}` : "Approved"}; the company owner asked to amend it`,
      );
      break;
    default:
      parts.push(statusLabel);
  }
  if (notAwaited) parts.push(notAwaited);
  const moved = submission.originalDueDate && submission.originalDueDate !== submission.dueDate;
  parts.push(
    `Due ${formatDate(submission.dueDate)}${moved ? ` (originally ${formatDate(submission.originalDueDate)})` : ""}`,
  );
  if (submission.revision > 1) parts.push(`Revision ${submission.revision}`);
  parts.push(submission.hasNarrative ? "Narrative included" : "No narrative");
  if (submission.openThreads > 0) parts.push(plural(submission.openThreads, "open comment thread"));
  return `${parts.join(". ")}.`;
}

export type SubmissionCell = {
  kind: "submission";
  month: MonthKey;
  submission: TrackerSubmission;
  state: CellState;
  label: string;
  tone: Tone;
  /** False when a status filter is set and this month does not match it (shown dimmed). */
  matches: boolean;
  /** The company is still expected to send it (isAwaited); false = shown dimmed, left out of the counts. */
  awaited: boolean;
  /** Accessible name of the link (cellName). */
  name: string;
  /** Tooltip and accessible description (cellDetails). */
  details: string;
};

/**
 * - `missing`: the month is in the company's reporting range but has no update (not opened for it yet);
 * - `outside`: before the reporting start month, not reporting, or no longer an active company.
 * `name` is what screen readers read in the cell; `details` is the tooltip.
 */
export type EmptyCell =
  | { kind: "missing"; month: MonthKey; name: string; details: string }
  | { kind: "outside"; month: MonthKey; name: string; details: string };

export type TrackerCell = SubmissionCell | EmptyCell;

/** Screen-reader text of a month outside the reporting range. */
export const OUTSIDE_RANGE_NAME = "Not requested";

export function emptyCell(company: Pick<TrackerCompany, "status" | "startMonth">, month: MonthKey): EmptyCell {
  const outside = (details: string): EmptyCell => ({ kind: "outside", month, name: OUTSIDE_RANGE_NAME, details });
  if (company.status !== "active") return outside("No update requested: the company is no longer active.");
  if (!company.startMonth) return outside("No update requested: the company is not reporting yet.");
  if (compareMonths(month, company.startMonth) < 0) {
    return outside(`Before the reporting start month (${monthLabel(company.startMonth)}).`);
  }
  return { kind: "missing", month, name: MISSING_META.label, details: `${MISSING_META.description}.` };
}

// ---------------------------------------------------------------------------------------------
// Partner initials
// ---------------------------------------------------------------------------------------------

const TITLES = new Set([
  "dr",
  "prof",
  "mr",
  "mrs",
  "ms",
  "mx",
  "sir",
  "dato",
  "datuk",
  "datin",
  "puan",
  "encik",
  "tuan",
  "ir",
  "hj",
  "hjh",
  "haji",
  "hajah",
]);

function nameWords(text: string, separators: RegExp): string[] {
  return text
    .split(separators)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word !== "");
}

function stripTitles(words: string[]): string[] {
  const rest = [...words];
  while (rest.length > 1) {
    const first = rest[0].toLowerCase();
    if ((first === "tan" || first === "puan") && rest[1].toLowerCase() === "sri" && rest.length > 2) {
      rest.splice(0, 2);
    } else if (TITLES.has(first)) {
      rest.shift();
    } else {
      break;
    }
  }
  return rest;
}

function initialsFromWords(words: string[]): string {
  if (words.length === 0) return "";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Initials for an avatar: first and last name ("Renuka Sena" → "RS"; titles such as "Dr." or
 * "Dato'" are skipped), else from the email's local part ("renuka.sena@…" → "RS"), else "?".
 */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const fromName = initialsFromWords(stripTitles(nameWords(name ?? "", /\s+/)));
  if (fromName) return fromName;
  const local = (email ?? "").split("@")[0] ?? "";
  const fromEmail = initialsFromWords(nameWords(local, /[._\-+\s]+/));
  return fromEmail || "?";
}

// ---------------------------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------------------------

export type TrackerColumn = TrackerMonth & {
  label: string;
  longLabel: string;
  /** The latest open month (the summary cards describe it). */
  isLatest: boolean;
};

export type TrackerRow = {
  company: TrackerCompany;
  cells: TrackerCell[];
  /** Exited or written off: shown muted. */
  muted: boolean;
  /** No reporting start month, but months from an earlier start are in the window. */
  notYetReporting: boolean;
};

export type TrackerSummary = {
  month: MonthKey | null;
  dueDate: DateKey | null;
  /** The latest month's portfolio due date is today or later. */
  notYetDue: boolean;
  /** Companies (in the fund / partner scope) with an update for the month that is awaited or sent (isAwaited). */
  total: number;
  /** Not submitted and not overdue. */
  notSubmitted: number;
  /** Overdue (draft or changes requested past the due date), escalated included. */
  overdue: number;
  escalated: number;
  awaitingReview: number;
  /** Changes requested and not overdue. */
  changesRequested: number;
  approved: number;
  /** Approved within APPROVAL_TARGET_DAYS of the month end (BRD O3). */
  approvedWithinTarget: number;
  /** Submitted at least once (submitted, changes requested or approved). */
  received: number;
  /** Received updates with a narrative. */
  withNarrative: number;
  /** withNarrative / received as a whole percentage; null when nothing was received. */
  narrativeCoveragePct: number | null;
};

/** Months needing ScaleUp's or the company's attention across the whole window (fund / partner scope). */
export type TrackerAttention = {
  overdue: number;
  escalated: number;
  awaitingReview: number;
  changesRequested: number;
  /** Approved months whose owner asked to amend them (BRD B8). */
  amendmentRequested: number;
};

export type FilterOption = { value: string; label: string; description?: string };

export type TrackerModel = {
  /** The filters in effect: unknown fund codes / partners are dropped. */
  filters: TrackerFilters;
  columns: TrackerColumn[];
  /** Companies with a reporting start month (or months in the window), after every filter. */
  rows: TrackerRow[];
  /** "Not yet reporting" companies without months in the window (fund / partner / search filters). */
  notReporting: TrackerCompany[];
  /** "Not yet reporting" companies hidden only because a status filter is set. */
  notReportingHiddenByStatus: number;
  summary: TrackerSummary;
  attention: TrackerAttention;
  options: { funds: FilterOption[]; partners: FilterOption[] };
  /** Reporting companies in the fund / partner scope before the search and status filters. */
  reportingInScope: number;
  escalationDays: number;
};

/** Accent- and case-insensitive text for searching ("Café" matches "cafe"). */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesSearch(company: Pick<TrackerCompany, "name">, search: string): boolean {
  const needle = foldForSearch(normaliseSearch(search));
  return needle === "" || foldForSearch(company.name).includes(needle);
}

function matchesFund(company: TrackerCompany, fund: string | null): boolean {
  return fund === null || company.funds.some((f) => f.code.toUpperCase() === fund);
}

function matchesPartner(company: TrackerCompany, partner: string | null): boolean {
  if (partner === null) return true;
  if (partner === UNASSIGNED_PARTNER) return company.partner === null;
  return company.partner?.id === partner;
}

/** Partner filter options: every assigned partner-in-charge by name ("(you)" marked), then "No partner assigned". */
export function partnerOptions(companies: TrackerCompany[], currentUserId: string): FilterOption[] {
  const byId = new Map<string, TrackerPartner>();
  for (const company of companies) if (company.partner) byId.set(company.partner.id, company.partner);
  const options = [...byId.values()]
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
    .map((partner) => ({
      value: partner.id,
      label: partner.id === currentUserId.toLowerCase() ? `${partner.name} (you)` : partner.name,
    }));
  if (companies.some((company) => company.partner === null)) {
    options.push({ value: UNASSIGNED_PARTNER, label: "No partner assigned" });
  }
  return options;
}

/** Fund filter options by code. */
export function fundOptions(funds: TrackerFund[]): FilterOption[] {
  const seen = new Set<string>();
  return [...funds]
    .sort((a, b) => compareText(a.code, b.code))
    .filter((fund) => {
      const code = fund.code.toUpperCase();
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .map((fund) => ({ value: fund.code.toUpperCase(), label: fund.code, description: fund.name }));
}

/** The window's columns: the latest `size` open months, oldest first. */
export function windowColumns(months: TrackerMonth[], size: number): TrackerColumn[] {
  const unique = new Map<MonthKey, TrackerMonth>();
  for (const month of months) {
    const key = parseMonthKey(month.month);
    if (key && !unique.has(key)) unique.set(key, { month: key, dueDate: month.dueDate });
  }
  const sorted = [...unique.values()].sort((a, b) => compareMonths(a.month, b.month));
  const shown = sorted.slice(Math.max(0, sorted.length - Math.max(1, size)));
  return shown.map((month, index) => ({
    ...month,
    label: monthLabel(month.month),
    longLabel: monthLabelLong(month.month),
    isLatest: index === shown.length - 1,
  }));
}

function emptySummary(month: TrackerColumn | null, today: DateKey): TrackerSummary {
  return {
    month: month?.month ?? null,
    dueDate: month?.dueDate ?? null,
    notYetDue: month ? daysBetween(today, month.dueDate) >= 0 : false,
    total: 0,
    notSubmitted: 0,
    overdue: 0,
    escalated: 0,
    awaitingReview: 0,
    changesRequested: 0,
    approved: 0,
    approvedWithinTarget: 0,
    received: 0,
    withNarrative: 0,
    narrativeCoveragePct: null,
  };
}

/**
 * The summary cards: the latest open month's updates among `submissions` — buildTracker passes only the
 * months the companies in scope are still expected to send, or sent (isAwaited).
 */
export function summariseMonth(
  column: TrackerColumn | null,
  submissions: TrackerSubmission[],
  escalationDays: number,
  today: DateKey,
): TrackerSummary {
  const summary = emptySummary(column, today);
  if (!column) return summary;
  for (const submission of submissions) {
    if (submission.month !== column.month) continue;
    summary.total += 1;
    const state = cellStateOf(submission, escalationDays);
    if (state === "not_submitted") summary.notSubmitted += 1;
    if (state === "overdue" || state === "escalated") summary.overdue += 1;
    if (state === "escalated") summary.escalated += 1;
    if (state === "submitted") summary.awaitingReview += 1;
    if (state === "changes_requested") summary.changesRequested += 1;
    if (state === "approved" || state === "amendment_requested") {
      summary.approved += 1;
      const days = daysToApproval(submission);
      if (days !== null && days <= APPROVAL_TARGET_DAYS) summary.approvedWithinTarget += 1;
    }
    if (submission.status !== "draft") {
      summary.received += 1;
      if (submission.hasNarrative) summary.withNarrative += 1;
    }
  }
  summary.narrativeCoveragePct =
    summary.received > 0 ? Math.round((summary.withNarrative * 100) / summary.received) : null;
  return summary;
}

function compareRows(a: TrackerRow, b: TrackerRow): number {
  return Number(a.muted) - Number(b.muted) || compareText(a.company.name, b.company.name) || compareText(a.company.id, b.company.id);
}

/**
 * Builds the tracker for the filters: columns (latest 6 or 12 open months, oldest first), one row per
 * company with a cell per month, the "Not yet reporting" group, the summary of the latest month and the
 * attention counts.
 *
 * Rows: every company with an update in the months shown, plus active companies with a reporting start
 * month (a later start shows "–" everywhere). Active first, then by name; exited / written-off companies
 * are muted (and left out when they have nothing in the window). "Not yet reporting": no start month and
 * nothing in the window (BRD B16).
 *
 * Scope: the fund and partner filters limit everything (rows, summary, attention); the search and
 * status filters only limit the rows (a row is kept when any of its months matches the status; the
 * other months are dimmed). The "Not yet reporting" group has no months, so a status filter hides it.
 * Months a company is no longer expected to send (isAwaited: leftover drafts of exited / written-off
 * companies or from before the start month) are dimmed, left out of the summary and attention counts,
 * and match no status filter.
 */
export function buildTracker(data: TrackerData, requested: TrackerFilters): TrackerModel {
  const funds = fundOptions(data.funds);
  const partners = partnerOptions(data.companies, data.currentUserId);
  const filters: TrackerFilters = {
    fund: requested.fund && funds.some((option) => option.value === requested.fund) ? requested.fund : null,
    partner:
      requested.partner && partners.some((option) => option.value === requested.partner) ? requested.partner : null,
    status: requested.status,
    search: normaliseSearch(requested.search),
    months: requested.months,
  };

  const allColumns = windowColumns(data.months, TRACKER_MAX_MONTHS);
  const columns = windowColumns(data.months, filters.months);
  const latest = columns.at(-1) ?? null;
  const windowMonths = new Set(allColumns.map((column) => column.month));
  const shownMonths = new Set(columns.map((column) => column.month));

  const byCompany = new Map<string, Map<MonthKey, TrackerSubmission>>();
  for (const submission of data.submissions) {
    if (!windowMonths.has(submission.month)) continue;
    let months = byCompany.get(submission.companyId);
    if (!months) {
      months = new Map();
      byCompany.set(submission.companyId, months);
    }
    months.set(submission.month, submission);
  }

  const scoped = data.companies.filter(
    (company) => matchesFund(company, filters.fund) && matchesPartner(company, filters.partner),
  );
  const hasShownMonths = (company: TrackerCompany) =>
    [...(byCompany.get(company.id)?.values() ?? [])].some((submission) => shownMonths.has(submission.month));
  // Grid rows: companies with months in the window, and active companies with a start month (even a
  // later one). Exited / written-off companies without months in the window are left out.
  const isReporting = (company: TrackerCompany) =>
    hasShownMonths(company) || (company.status === "active" && company.startMonth !== null);
  // The "Not yet reporting" group: no start month and nothing in the window.
  const isNotYetReporting = (company: TrackerCompany) => company.startMonth === null && !hasShownMonths(company);

  const reporting = scoped.filter(isReporting);
  // What the counts are about: the months shown that the companies are still expected to send, or sent
  // (isAwaited). Leftover drafts of exited / written-off companies, or from before a start month, never
  // become overdue and would otherwise stay "Not submitted" for good.
  const awaitedSubmissions = reporting.flatMap((company) =>
    [...(byCompany.get(company.id)?.values() ?? [])].filter(
      (submission) => shownMonths.has(submission.month) && isAwaited(company, submission),
    ),
  );

  const attention: TrackerAttention = {
    overdue: 0,
    escalated: 0,
    awaitingReview: 0,
    changesRequested: 0,
    amendmentRequested: 0,
  };
  for (const submission of awaitedSubmissions) {
    const state = cellStateOf(submission, data.escalationDays);
    if (state === "overdue" || state === "escalated") attention.overdue += 1;
    if (state === "escalated") attention.escalated += 1;
    if (state === "submitted") attention.awaitingReview += 1;
    if (state === "changes_requested") attention.changesRequested += 1;
    if (state === "amendment_requested") attention.amendmentRequested += 1;
  }

  const rows = reporting
    .filter((company) => matchesSearch(company, filters.search))
    .map((company): TrackerRow => {
      const months = byCompany.get(company.id);
      const cells = columns.map((column): TrackerCell => {
        const submission = months?.get(column.month);
        if (!submission) return emptyCell(company, column.month);
        const state = cellStateOf(submission, data.escalationDays);
        const awaited = isAwaited(company, submission);
        return {
          kind: "submission",
          month: column.month,
          submission,
          state,
          label: cellLabel(state, submission.daysOverdue, submission.status),
          tone: CELL_TONES[state],
          // A month no longer awaited matches no status filter (the counts leave it out too).
          matches: filters.status === null || (awaited && matchesStatusFilter(submission, state, filters.status)),
          awaited,
          name: cellName(company.name, submission, state),
          details: cellDetails(submission, state, awaited ? null : notAwaitedReason(company)),
        };
      });
      return {
        company,
        cells,
        muted: company.status !== "active",
        notYetReporting: company.startMonth === null,
      };
    })
    .filter((row) => filters.status === null || row.cells.some((cell) => cell.kind === "submission" && cell.matches))
    .sort(compareRows);

  const notReportingAll = scoped
    .filter((company) => isNotYetReporting(company) && matchesSearch(company, filters.search))
    .sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || compareText(a.name, b.name));

  return {
    filters,
    columns,
    rows,
    notReporting: filters.status === null ? notReportingAll : [],
    notReportingHiddenByStatus: filters.status === null ? 0 : notReportingAll.length,
    summary: summariseMonth(latest, awaitedSubmissions, data.escalationDays, data.today),
    attention,
    options: { funds, partners },
    reportingInScope: reporting.length,
    escalationDays: data.escalationDays,
  };
}
