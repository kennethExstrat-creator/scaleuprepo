// Pure view model of /admin/cycles (module M4, BRD A5, §6.1, B4, B6, B18, B19): reporting months with
// their progress, deadline extensions, the "Extend a deadline" choices, quarter and half closes, and FX
// rates. Client-safe and unit-tested (tests/features/m4/cycles-model.test.ts); the server loader
// (load-cycles.ts) feeds it database rows.

import { DEFAULT_CURRENCY } from "@/lib/constants";
import {
  addDays,
  addMonths,
  compareMonths,
  daysBetween,
  dueDateFor,
  halfOf,
  isDateKey,
  monthKeyToDate,
  parseMonthKey,
  quarterOf,
  toMYTDate,
  type ClosePeriod,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";
import type {
  ClosePeriodType,
  CompanyStatus,
  PeriodCloseStatus,
  SubmissionStatus,
  TemplateStatus,
} from "@/lib/types/enums";

// ---------------------------------------------------------------------------------------------
// Inputs (database rows, already narrowed by the loader)
// ---------------------------------------------------------------------------------------------

/** A `v_submission_overview` row with the identity columns present. */
export type OverviewInput = {
  id: string;
  company_id: string;
  month: string;
  status: SubmissionStatus;
  due_date: string;
  original_due_date: string | null;
  is_overdue: boolean;
  days_overdue: number;
};

export type CompanyInput = {
  id: string;
  name: string;
  status: CompanyStatus;
  /** null = "Not yet reporting" (BRD B16). */
  reporting_start_month: string | null;
  reporting_currency: string;
};

export type PeriodInput = {
  month: string;
  due_date: string;
  opened_at: string;
  /** null = opened automatically by open_due_periods(). */
  opened_by: string | null;
  template: { name: string; versionNo: number; status: TemplateStatus } | null;
};

/** A submission whose due date has moved (`original_due_date` is set). */
export type ExtensionInput = {
  id: string;
  company_id: string;
  month: string;
  status: SubmissionStatus;
  due_date: string;
  original_due_date: string;
  extension_reason: string | null;
};

/**
 * The submission events that move a due date: an extension (extend_due_date), and a send-back
 * (request_changes) or reopening (reopen_submission), which move a due date that is too close to
 * backfill_grace_days from that day (private.send_back_due_date).
 */
export const DEADLINE_EVENTS = ["deadline_extended", "changes_requested", "reopened"] as const;
export type DeadlineEventKind = (typeof DEADLINE_EVENTS)[number];

export function isDeadlineEventKind(value: unknown): value is DeadlineEventKind {
  return typeof value === "string" && (DEADLINE_EVENTS as readonly string[]).includes(value);
}

/** A submission event that can move the due date (submission_events). */
export type ExtensionEventInput = {
  /** submission_events.id: orders events written in the same instant. */
  id?: number;
  submission_id: string;
  event: DeadlineEventKind;
  actor_id: string | null;
  created_at: string;
  /** deadline_extended: "Due date extended to 20 Oct 2026. Reason: …" (not loaded for send-backs). */
  message?: string | null;
};

export type CloseInput = {
  company_id: string;
  period_type: ClosePeriodType;
  period_start: string;
  period_end: string;
  label: string;
  status: PeriodCloseStatus;
};

export type FxRateInput = {
  currency: string;
  month: string;
  rate_to_myr: number;
  updated_at: string;
  updated_by: string | null;
};

/** Profile id → display name (ScaleUp pages show plain names). */
export type NameMap = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** plural(1, "company", "companies") → "1 company"; plural(3, "day") → "3 days". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 15 → "15th", 22 → "22nd". */
export function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** "Batik Boutique", "Batik Boutique and RECQA", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function nameOf(names: NameMap, id: string | null): string | null {
  if (!id) return null;
  return names[id.toLowerCase()] ?? names[id] ?? null;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "en-GB");
}

/** True for a company that reports on the platform today: active with a reporting start month. */
export function isReportingCompany(company: Pick<CompanyInput, "status" | "reporting_start_month">): boolean {
  return company.status === "active" && company.reporting_start_month !== null;
}

/** Active, reporting companies whose start month is on or before `month` (they get that month). */
export function companiesReportingIn(companies: readonly CompanyInput[], month: MonthKey): CompanyInput[] {
  return companies.filter((company) => {
    if (!isReportingCompany(company)) return false;
    const start = parseMonthKey(company.reporting_start_month);
    return start !== null && compareMonths(start, month) <= 0;
  });
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

export const CYCLE_TABS = ["months", "deadlines", "closes", "fx"] as const;
export type CycleTab = (typeof CYCLE_TABS)[number];

function isCycleTab(value: unknown): value is CycleTab {
  return typeof value === "string" && (CYCLE_TABS as readonly string[]).includes(value);
}

/** `?tab=` → a tab ("months" when missing or unknown). */
export function parseCycleTab(value: unknown): CycleTab {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  return isCycleTab(raw) ? raw : "months";
}

// ---------------------------------------------------------------------------------------------
// Reporting months
// ---------------------------------------------------------------------------------------------

/**
 * Where a month's monthly updates stand. The buckets partition `total`: approved, awaiting review,
 * changes requested (not overdue), not submitted (not overdue) and overdue (not submitted or sent back,
 * past the due date; `v_submission_overview.is_overdue`).
 */
export type MonthProgress = {
  total: number;
  approved: number;
  awaitingReview: number;
  changesRequested: number;
  notSubmitted: number;
  overdue: number;
  /** Submitted months: awaiting review + approved. */
  submitted: number;
};

export function emptyProgress(): MonthProgress {
  return {
    total: 0,
    approved: 0,
    awaitingReview: 0,
    changesRequested: 0,
    notSubmitted: 0,
    overdue: 0,
    submitted: 0,
  };
}

export function addToProgress(progress: MonthProgress, row: Pick<OverviewInput, "status" | "is_overdue">): void {
  progress.total += 1;
  const open = row.status === "draft" || row.status === "changes_requested";
  if (open && row.is_overdue) {
    progress.overdue += 1;
    return;
  }
  switch (row.status) {
    case "approved":
      progress.approved += 1;
      progress.submitted += 1;
      break;
    case "submitted":
      progress.awaitingReview += 1;
      progress.submitted += 1;
      break;
    case "changes_requested":
      progress.changesRequested += 1;
      break;
    default:
      progress.notSubmitted += 1;
  }
}

export function progressOf(rows: readonly Pick<OverviewInput, "status" | "is_overdue">[]): MonthProgress {
  const progress = emptyProgress();
  for (const row of rows) addToProgress(progress, row);
  return progress;
}

/**
 * The monthly updates of a month that are due after the month's usual due date. A month that opens after
 * its usual due date gets backfill_grace_days from opening (ensure_periods, BRD B4), which leaves
 * original_due_date empty; extensions and send-backs move a due date and set original_due_date.
 */
export type LaterDue = {
  count: number;
  /** Opened after the usual due date; their due date has not moved since. */
  openedLate: number;
  /** Extended, or moved when the month was sent back or reopened. */
  moved: number;
  /** The latest company due date (null when count is 0). */
  latest: DateKey | null;
  /** The one due date they all share (null when they differ, or count is 0). */
  shared: DateKey | null;
};

export function emptyLaterDue(): LaterDue {
  return { count: 0, openedLate: 0, moved: 0, latest: null, shared: null };
}

/** Counts a monthly update in `laterDue` when it is due after its month's usual due date. */
export function addToLaterDue(
  laterDue: LaterDue,
  usualDueDate: DateKey,
  row: Pick<OverviewInput, "due_date" | "original_due_date">,
): void {
  if (!isDateKey(row.due_date) || daysBetween(usualDueDate, row.due_date) <= 0) return;
  laterDue.shared = laterDue.count === 0 || laterDue.shared === row.due_date ? row.due_date : null;
  laterDue.count += 1;
  if (row.original_due_date) laterDue.moved += 1;
  else laterDue.openedLate += 1;
  if (laterDue.latest === null || daysBetween(laterDue.latest, row.due_date) > 0) laterDue.latest = row.due_date;
}

/**
 * The note under a month's usual due date when companies are due later: "All 3 due 14 Oct 2026 (opened
 * late)", "1 due 29 Sep 2026 (extended or sent back)" or "3 due later, up to 20 Oct 2026". Null when every
 * company is due on the usual date.
 */
export function laterDueNote(
  laterDue: LaterDue,
  total: number,
  formatDate: (date: string) => string,
): string | null {
  if (laterDue.count === 0 || laterDue.latest === null) return null;
  const why =
    laterDue.openedLate === laterDue.count
      ? " (opened late)"
      : laterDue.moved === laterDue.count
        ? " (extended or sent back)"
        : "";
  if (laterDue.shared) {
    const who = laterDue.count === total && total > 1 ? `All ${total}` : String(laterDue.count);
    return `${who} due ${formatDate(laterDue.shared)}${why}`;
  }
  return `${laterDue.count} due later, up to ${formatDate(laterDue.latest)}${why}`;
}

/**
 * The due date to quote for a month in one line: the date every company is due when they share a later one
 * (e.g. months that all opened late), otherwise the usual due date and how many companies are due later.
 */
export function effectiveDue(month: Pick<CycleMonth, "dueDate" | "laterDue" | "progress">): {
  date: DateKey;
  later: number;
} {
  const { laterDue, progress } = month;
  if (laterDue.shared && progress.total > 0 && laterDue.count === progress.total) {
    return { date: laterDue.shared, later: 0 };
  }
  return { date: month.dueDate, later: laterDue.count };
}

export type CycleMonth = {
  month: MonthKey;
  /** The month's usual due date (reporting_periods.due_date). */
  dueDate: DateKey;
  /** Companies due later than that (opened late, extended or sent back). */
  laterDue: LaterDue;
  openedAt: string;
  /** Who opened it (display name); null = opened automatically. */
  openedBy: string | null;
  /** Opened by someone (open_period) rather than automatically. */
  openedManually: boolean;
  /** Opened before the month ended (the 1st of the following month, MYT). */
  openedEarly: boolean;
  /** "Portfolio Update v1"; null when the template version could not be read. */
  templateLabel: string | null;
  /** The month's template version has since been replaced (archived). */
  templateSuperseded: boolean;
  progress: MonthProgress;
};

/** True when the instant falls before the 1st of the month after `month` (Malaysia time). */
export function openedBeforeMonthEnd(openedAt: string, month: MonthKey): boolean {
  let opened: DateKey;
  try {
    opened = toMYTDate(openedAt);
  } catch {
    return false;
  }
  return daysBetween(opened, monthKeyToDate(addMonths(month, 1))) > 0;
}

/**
 * The reporting months (newest first) with who opened them, their progress and the companies due after the
 * month's usual due date.
 */
export function buildCycleMonths(
  periods: readonly PeriodInput[],
  overview: readonly OverviewInput[],
  names: NameMap,
): CycleMonth[] {
  const rowsByMonth = new Map<MonthKey, OverviewInput[]>();
  for (const row of overview) {
    const month = parseMonthKey(row.month);
    if (!month) continue;
    const list = rowsByMonth.get(month) ?? [];
    list.push(row);
    rowsByMonth.set(month, list);
  }

  const months: CycleMonth[] = [];
  for (const period of periods) {
    const month = parseMonthKey(period.month);
    if (!month || !isDateKey(period.due_date)) continue;
    const rows = rowsByMonth.get(month) ?? [];
    const laterDue = emptyLaterDue();
    for (const row of rows) addToLaterDue(laterDue, period.due_date, row);
    months.push({
      month,
      dueDate: period.due_date,
      laterDue,
      openedAt: period.opened_at,
      openedBy: nameOf(names, period.opened_by) ?? (period.opened_by ? "A former user" : null),
      openedManually: period.opened_by !== null,
      openedEarly: openedBeforeMonthEnd(period.opened_at, month),
      templateLabel: period.template ? `${period.template.name} v${period.template.versionNo}` : null,
      templateSuperseded: period.template?.status === "archived",
      progress: progressOf(rows),
    });
  }
  return months.sort((a, b) => compareMonths(b.month, a.month));
}

export type OverdueSummary = {
  /** Overdue monthly updates across every open month. */
  overdue: number;
  /** Of those, overdue for longer than the escalation period (`days_overdue > escalation_days`). */
  escalated: number;
  /** Companies with at least one overdue month. */
  companies: number;
};

export function summariseOverdue(
  overview: readonly Pick<OverviewInput, "company_id" | "is_overdue" | "days_overdue">[],
  escalationDays: number,
): OverdueSummary {
  let overdue = 0;
  let escalated = 0;
  const companies = new Set<string>();
  for (const row of overview) {
    if (!row.is_overdue) continue;
    overdue += 1;
    companies.add(row.company_id);
    if (row.days_overdue > escalationDays) escalated += 1;
  }
  return { overdue, escalated, companies: companies.size };
}

/** What opening the current month early would do (null when it is already open). */
export type OpenEarlyPreview = {
  month: MonthKey;
  /** The usual due date of the month (day `due_day` of the following month). */
  dueDate: DateKey;
  /** When it would open on its own (the 1st of the following month). */
  opensOn: DateKey;
  /** Companies that would get the month (active, reporting from this month or earlier). */
  companies: string[];
};

export function openEarlyPreview(
  currentMonth: MonthKey,
  openMonths: readonly MonthKey[],
  dueDay: number,
  companies: readonly CompanyInput[],
): OpenEarlyPreview | null {
  if (openMonths.includes(currentMonth)) return null;
  return {
    month: currentMonth,
    dueDate: dueDateFor(currentMonth, dueDay),
    opensOn: monthKeyToDate(addMonths(currentMonth, 1)),
    companies: companiesReportingIn(companies, currentMonth)
      .map((company) => company.name)
      .sort((a, b) => a.localeCompare(b, "en-GB")),
  };
}

// ---------------------------------------------------------------------------------------------
// Deadline extensions
// ---------------------------------------------------------------------------------------------

/** Why a month's deadline cannot be extended from this page. */
export type ExtendBlock = "inactive" | "not_reporting" | "before_start" | "approved";

/**
 * The one rule for which months this page offers to extend, used by both the Deadlines list and the
 * "Extend a deadline" dialog (null = it can be extended). extend_due_date refuses approved months and
 * exited / written-off companies. The months of a company that is not reporting (no start month, BRD B16)
 * and months before a moved start month are kept as history and are never overdue (v_submission_overview),
 * so they are not offered either.
 */
export function extendBlockOf(
  company: Pick<CompanyInput, "status" | "reporting_start_month">,
  month: MonthKey,
  status: SubmissionStatus,
): ExtendBlock | null {
  if (company.status !== "active") return "inactive";
  const start = parseMonthKey(company.reporting_start_month);
  if (!start) return "not_reporting";
  if (compareMonths(month, start) < 0) return "before_start";
  return status === "approved" ? "approved" : null;
}

const MONTH_ABBREVIATIONS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The new due date written in a deadline_extended event ("Due date extended to 20 Oct 2026. Reason: …",
 * private.date_label), or null when the message does not have that form.
 */
export function extendedToDate(message: string | null | undefined): DateKey | null {
  const match = /^\s*Due date extended to (\d{1,2}) ([A-Za-z]{3}) (\d{4})\b/.exec(message ?? "");
  if (!match) return null;
  const monthNo = MONTH_ABBREVIATIONS.indexOf(match[2].toLowerCase()) + 1;
  if (monthNo === 0) return null;
  const key = `${match[3]}-${String(monthNo).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isDateKey(key) ? key : null;
}

function eventTime(event: Pick<ExtensionEventInput, "created_at">): number {
  const time = Date.parse(event.created_at);
  return Number.isNaN(time) ? 0 : time;
}

/** Oldest first; events written in the same instant by id. */
function compareEvents(a: ExtensionEventInput, b: ExtensionEventInput): number {
  return eventTime(a) - eventTime(b) || (a.id ?? 0) - (b.id ?? 0);
}

export type SentBack = {
  /** changes_requested: sent back for changes; reopened: an approved month was reopened. */
  kind: "changes_requested" | "reopened";
  at: string;
  by: string;
};

export type DeadlineExtension = {
  submissionId: string;
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  /** The company's reporting start month (null = not reporting). */
  reportingStartMonth: MonthKey | null;
  month: MonthKey;
  status: SubmissionStatus;
  isOverdue: boolean;
  originalDueDate: DateKey;
  dueDate: DateKey;
  /** Days between the original and the current due date. */
  daysAdded: number;
  /**
   * What set the current due date. `extended`: a ScaleUp admin extended the deadline (extend_due_date).
   * `sent_back`: the due date moved when ScaleUp sent the month back or reopened it, which gives the company
   * time to resubmit (BRD B19), possibly after an earlier extension.
   */
  cause: "extended" | "sent_back";
  /** The latest extension's reason (extend_due_date), also when a send-back moved the date afterwards. */
  reason: string | null;
  /** The latest extension (deadline_extended event), when there is one. */
  extendedAt: string | null;
  extendedBy: string | null;
  /** The due date the latest extension set (from its event), when known. */
  extendedTo: DateKey | null;
  /** Number of times the deadline was extended. */
  extensionCount: number;
  /** The send-back or reopening that moved the due date last (cause `sent_back`), when it is on record. */
  sentBack: SentBack | null;
  /** The "Extend a deadline" dialog offers this month (extendBlockOf), so the row offers "Extend". */
  canExtendAgain: boolean;
  /** Why the month cannot be extended here (null when it can). */
  extendBlock: ExtendBlock | null;
};

/**
 * Every month whose due date has moved, newest month first, then by company. Its events tell what set the
 * current due date: the latest extension, unless a send-back or reopening after it moved the date again.
 * request_changes / reopen_submission only move a due date that is too close, so a later send-back counts
 * when the due date is no longer the date that extension set (read from its message) or, when the message
 * cannot be read, when the due date is the one the send-back gives (its day plus `graceDays`,
 * private.send_back_due_date).
 */
export function buildExtensions(input: {
  rows: readonly ExtensionInput[];
  /** deadline_extended, changes_requested and reopened events of these months. */
  events: readonly ExtensionEventInput[];
  companies: readonly CompanyInput[];
  overdueById: ReadonlyMap<string, boolean>;
  names: NameMap;
  /** platform_settings.backfill_grace_days. */
  graceDays: number;
}): DeadlineExtension[] {
  const { rows, events, companies, overdueById, names, graceDays } = input;
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const eventsBySubmission = new Map<string, ExtensionEventInput[]>();
  for (const event of events) {
    const list = eventsBySubmission.get(event.submission_id) ?? [];
    list.push(event);
    eventsBySubmission.set(event.submission_id, list);
  }
  const actorName = (actorId: string | null): string =>
    nameOf(names, actorId) ?? (actorId ? "A former user" : "ScaleUp");

  const result: DeadlineExtension[] = [];
  for (const row of rows) {
    const month = parseMonthKey(row.month);
    const company = companyById.get(row.company_id);
    if (!month || !company || !isDateKey(row.due_date) || !isDateKey(row.original_due_date)) continue;
    const history = [...(eventsBySubmission.get(row.id) ?? [])].sort(compareEvents);
    const extensions = history.filter((event) => event.event === "deadline_extended");
    const latestExtension = extensions.at(-1) ?? null;
    // The latest send-back or reopening after the latest extension (of all of them, without one).
    const latestSendBack =
      history
        .filter(
          (event) =>
            event.event !== "deadline_extended" &&
            (latestExtension === null || compareEvents(event, latestExtension) > 0),
        )
        .at(-1) ?? null;
    const extendedTo = latestExtension ? extendedToDate(latestExtension.message) : null;
    const reason = row.extension_reason?.trim() ? row.extension_reason.trim() : null;

    let cause: DeadlineExtension["cause"];
    if (latestExtension === null) {
      cause = latestSendBack || !reason ? "sent_back" : "extended";
    } else if (latestSendBack === null) {
      cause = "extended";
    } else if (extendedTo !== null) {
      cause = extendedTo === row.due_date ? "extended" : "sent_back";
    } else {
      let sendBackDue: DateKey | null = null;
      try {
        sendBackDue = addDays(toMYTDate(latestSendBack.created_at), graceDays);
      } catch {
        sendBackDue = null;
      }
      cause = sendBackDue === row.due_date ? "sent_back" : "extended";
    }

    const extendBlock = extendBlockOf(company, month, row.status);
    result.push({
      submissionId: row.id,
      companyId: company.id,
      companyName: company.name,
      companyStatus: company.status,
      reportingStartMonth: parseMonthKey(company.reporting_start_month),
      month,
      status: row.status,
      isOverdue: overdueById.get(row.id) ?? false,
      originalDueDate: row.original_due_date,
      dueDate: row.due_date,
      daysAdded: daysBetween(row.original_due_date, row.due_date),
      cause,
      reason,
      extendedAt: latestExtension?.created_at ?? null,
      extendedBy: latestExtension ? actorName(latestExtension.actor_id) : null,
      extendedTo,
      extensionCount: extensions.length,
      sentBack:
        cause === "sent_back" && latestSendBack
          ? {
              kind: latestSendBack.event === "reopened" ? "reopened" : "changes_requested",
              at: latestSendBack.created_at,
              by: actorName(latestSendBack.actor_id),
            }
          : null,
      canExtendAgain: extendBlock === null,
      extendBlock,
    });
  }
  return result.sort(
    (a, b) => compareMonths(b.month, a.month) || a.companyName.localeCompare(b.companyName, "en-GB"),
  );
}

export type DeadlineMonthChoice = {
  submissionId: string;
  month: MonthKey;
  status: SubmissionStatus;
  isOverdue: boolean;
  daysOverdue: number;
  dueDate: DateKey;
  originalDueDate: DateKey | null;
};

export type DeadlineCompanyChoice = {
  companyId: string;
  companyName: string;
  /** Months that are not approved yet, newest first. */
  months: DeadlineMonthChoice[];
};

/**
 * What "Extend a deadline" offers: reporting companies (active, with a start month) and their months that
 * are not approved yet (drafts, submitted and sent-back months) from the company's reporting start month —
 * the same rule as the Deadlines list (extendBlockOf).
 */
export function buildDeadlineChoices(
  overview: readonly OverviewInput[],
  companies: readonly CompanyInput[],
): DeadlineCompanyChoice[] {
  const companyById = new Map(companies.map((company) => [company.id, company] as const));
  const monthsByCompany = new Map<string, DeadlineMonthChoice[]>();
  for (const row of overview) {
    const company = companyById.get(row.company_id);
    const month = parseMonthKey(row.month);
    if (!company || !month || !isDateKey(row.due_date)) continue;
    if (extendBlockOf(company, month, row.status) !== null) continue;
    const list = monthsByCompany.get(company.id) ?? [];
    list.push({
      submissionId: row.id,
      month,
      status: row.status,
      isOverdue: row.is_overdue,
      daysOverdue: row.days_overdue,
      dueDate: row.due_date,
      originalDueDate: row.original_due_date && isDateKey(row.original_due_date) ? row.original_due_date : null,
    });
    monthsByCompany.set(company.id, list);
  }
  return [...monthsByCompany.entries()]
    .map(([companyId, months]) => ({
      companyId,
      companyName: companyById.get(companyId)?.name ?? "",
      months: months.sort((a, b) => compareMonths(b.month, a.month)),
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "en-GB"));
}

/** The month the "Extend a deadline" dialog opens on ("Extend" on a Deadlines row, or ?extend=). */
export type ExtendTarget = {
  companyId: string;
  submissionId: string;
  /** "Batik Boutique, August 2026": named when the dialog cannot offer the month any more. */
  label?: string;
};

export type ExtendSelection = {
  companyId: string;
  submissionId: string;
  /** A target was given but the dialog does not offer it (approved meanwhile, or no longer reporting). */
  targetMissing: boolean;
};

/**
 * What the dialog preselects. A target opens on exactly that company and month, or on nothing when the
 * dialog does not offer it — never on another company or month. Without a target, a single company (and
 * its single month) is preselected.
 */
export function initialExtendSelection(
  choices: readonly DeadlineCompanyChoice[],
  target: ExtendTarget | null,
): ExtendSelection {
  if (target) {
    const company = choices.find((choice) => choice.companyId === target.companyId);
    const month = company?.months.find((item) => item.submissionId === target.submissionId);
    return company && month
      ? { companyId: company.companyId, submissionId: month.submissionId, targetMissing: false }
      : { companyId: "", submissionId: "", targetMissing: true };
  }
  const only = choices.length === 1 ? choices[0] : null;
  return {
    companyId: only?.companyId ?? "",
    submissionId: only && only.months.length === 1 ? only.months[0].submissionId : "",
    targetMissing: false,
  };
}

/** Quick choices in the extension dialog (days after the base date). */
export const EXTENSION_QUICK_DAYS = [7, 14, 30] as const;
/** The new due date may be at most this many days after the base date (guards against typos). */
export const EXTENSION_MAX_DAYS = 365;

/**
 * The date quick extensions count from: the current due date, or today when the month is already past
 * it (an overdue month extended by "7 days" from its old due date would still be overdue).
 */
export function extensionBase(dueDate: DateKey, today: DateKey): DateKey {
  return daysBetween(dueDate, today) > 0 ? today : dueDate;
}

/** The latest new due date the dialog accepts. */
export function latestExtensionDate(dueDate: DateKey, today: DateKey): DateKey {
  return addDays(extensionBase(dueDate, today), EXTENSION_MAX_DAYS);
}

/** The earliest new due date: the day after the current due date, or today once that date has passed. */
export function earliestExtensionDate(dueDate: DateKey, today: DateKey): DateKey {
  const dayAfter = addDays(dueDate, 1);
  return daysBetween(today, dayAfter) > 0 ? dayAfter : today;
}

/**
 * Why `newDueDate` cannot be used (null when it can). Mirrors extend_due_date (later than the current due
 * date), and — like the review page's dialog (src/components/review/review-state.ts extensionDateError) —
 * refuses a date that has already passed (an overdue month moved to it would still be overdue) and more
 * than a year ahead (a typo guard).
 */
export function newDueDateIssue(
  newDueDate: string | null | undefined,
  dueDate: DateKey,
  today: DateKey,
  formatDate: (date: string) => string,
): string | null {
  if (!newDueDate || !isDateKey(newDueDate)) return "Choose the new due date.";
  if (daysBetween(dueDate, newDueDate) <= 0) {
    return `The new due date must be after the current due date (${formatDate(dueDate)}).`;
  }
  if (daysBetween(today, newDueDate) < 0) {
    return `The new due date cannot be in the past. Choose today (${formatDate(today)}) or a later date.`;
  }
  const latest = latestExtensionDate(dueDate, today);
  if (daysBetween(newDueDate, latest) < 0) return `Choose a date up to ${formatDate(latest)}.`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Quarter and half closes (calendar year, BRD B6)
// ---------------------------------------------------------------------------------------------

/** 'Q3-2026' / 'H2-2026': the period key /admin/documents?period= understands. */
export function closePeriodKey(period: Pick<ClosePeriod, "type" | "index" | "year">): string {
  return `${period.type === "quarter" ? "Q" : "H"}${period.index}-${period.year}`;
}

export type CloseGroup = {
  key: string;
  type: ClosePeriodType;
  label: string;
  /** "Jul–Sep 2026". */
  rangeLabel: string;
  endDate: DateKey;
  companies: number;
  confirmed: number;
  open: number;
};

/** The period closes that exist (rows of period_closes), one group per period, latest end first. */
export function groupCloses(rows: readonly CloseInput[]): CloseGroup[] {
  const groups = new Map<string, CloseGroup>();
  for (const row of rows) {
    const start = parseMonthKey(row.period_start);
    if (!start) continue;
    const period = row.period_type === "quarter" ? quarterOf(start) : halfOf(start);
    const key = closePeriodKey(period);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        type: period.type,
        label: period.label,
        rangeLabel: period.rangeLabel,
        endDate: period.end,
        companies: 0,
        confirmed: 0,
        open: 0,
      };
      groups.set(key, group);
    }
    group.companies += 1;
    if (row.status === "confirmed") group.confirmed += 1;
    else group.open += 1;
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.endDate.localeCompare(a.endDate) ||
      (a.type === b.type ? 0 : a.type === "quarter" ? -1 : 1),
  );
}

export type UpcomingClose = {
  key: string;
  period: ClosePeriod;
  /** The month whose numbers complete the period (its last month). */
  lastMonth: MonthKey;
  /** When that month opens for the companies (the 1st of the following month). */
  opensOn: DateKey;
  /** The last month's usual due date. */
  dueDate: DateKey;
  /** Companies reporting by then (active, start month on or before the period's last month). */
  companies: number;
};

/**
 * The next quarter and half closes after the latest open month (calendar periods; they open with their
 * last month). With nothing open yet, they follow the current month.
 */
export function upcomingCloses(
  latestOpenMonth: MonthKey | null,
  currentMonth: MonthKey,
  dueDay: number,
  companies: readonly CompanyInput[],
): UpcomingClose[] {
  const next = latestOpenMonth ? addMonths(latestOpenMonth, 1) : currentMonth;
  return [quarterOf(next), halfOf(next)].map((period) => ({
    key: closePeriodKey(period),
    period,
    lastMonth: period.endMonth,
    opensOn: monthKeyToDate(addMonths(period.endMonth, 1)),
    dueDate: dueDateFor(period.endMonth, dueDay),
    companies: companiesReportingIn(companies, period.endMonth).length,
  }));
}

// ---------------------------------------------------------------------------------------------
// FX rates (BRD §12, B18): MYR per one unit of the company's reporting currency, per month
// ---------------------------------------------------------------------------------------------

/** A change from the previous rate above this percentage is highlighted (likely a typo). */
export const FX_UNUSUAL_CHANGE_PCT = 10;

/** The first year the FX month picker offers (historical data from H2 2024 is migrated, BRD §12). */
export const FX_FIRST_YEAR = 2024;

export function normaliseCurrency(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export type FxCompany = {
  id: string;
  name: string;
  status: CompanyStatus;
  reportingStartMonth: MonthKey | null;
};

export type FxMonthRow = {
  month: MonthKey;
  rate: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Companies in this currency with a monthly update for the month: their figures need the rate. */
  reportingCompanies: string[];
  /** A rate is needed (some company in this currency has the month). */
  needed: boolean;
  /** Change from the previous month that has a rate, in %. */
  changePct: number | null;
  comparedWith: MonthKey | null;
  /** |changePct| above FX_UNUSUAL_CHANGE_PCT. */
  unusual: boolean;
};

export type FxCurrency = {
  currency: string;
  /** Companies reporting in this currency (none when only old rates remain). */
  companies: FxCompany[];
  /** Newest month first. */
  rows: FxMonthRow[];
  /** Months that need a rate and have none, oldest first. */
  missing: MonthKey[];
};

/** The non-MYR currencies companies report in, sorted. */
export function currenciesInUse(companies: readonly Pick<CompanyInput, "reporting_currency">[]): string[] {
  const set = new Set<string>();
  for (const company of companies) {
    const code = normaliseCurrency(company.reporting_currency);
    if (code && code !== DEFAULT_CURRENCY) set.add(code);
  }
  return [...set].sort();
}

/**
 * One block per currency (in use by a company, or with rates on record): every open reporting month plus
 * any month that has a rate or a monthly update in that currency, newest first, with the change from the
 * previous rate and whether the month needs one.
 */
export function buildFxCurrencies(input: {
  companies: readonly CompanyInput[];
  rates: readonly FxRateInput[];
  overview: readonly Pick<OverviewInput, "company_id" | "month">[];
  openMonths: readonly MonthKey[];
  names: NameMap;
}): FxCurrency[] {
  const { companies, rates, overview, openMonths, names } = input;
  const companiesByCurrency = new Map<string, CompanyInput[]>();
  for (const company of companies) {
    const code = normaliseCurrency(company.reporting_currency);
    if (!code || code === DEFAULT_CURRENCY) continue;
    const list = companiesByCurrency.get(code) ?? [];
    list.push(company);
    companiesByCurrency.set(code, list);
  }

  const ratesByCurrency = new Map<string, Map<MonthKey, FxRateInput>>();
  for (const rate of rates) {
    const code = normaliseCurrency(rate.currency);
    const month = parseMonthKey(rate.month);
    if (!code || !month) continue;
    const map = ratesByCurrency.get(code) ?? new Map<MonthKey, FxRateInput>();
    map.set(month, rate);
    ratesByCurrency.set(code, map);
  }

  const companyCurrency = new Map<string, string>();
  for (const [code, list] of companiesByCurrency) for (const company of list) companyCurrency.set(company.id, code);
  const companyName = new Map(companies.map((company) => [company.id, company.name]));
  // currency → month → company names with a monthly update
  const reportingByCurrency = new Map<string, Map<MonthKey, Set<string>>>();
  for (const row of overview) {
    const code = companyCurrency.get(row.company_id);
    const month = parseMonthKey(row.month);
    if (!code || !month) continue;
    const byMonth = reportingByCurrency.get(code) ?? new Map<MonthKey, Set<string>>();
    const set = byMonth.get(month) ?? new Set<string>();
    set.add(companyName.get(row.company_id) ?? "");
    byMonth.set(month, set);
    reportingByCurrency.set(code, byMonth);
  }

  const currencies = [...new Set([...companiesByCurrency.keys(), ...ratesByCurrency.keys()])].sort();
  return currencies.map((currency) => {
    const rateMap = ratesByCurrency.get(currency) ?? new Map<MonthKey, FxRateInput>();
    const reporting = reportingByCurrency.get(currency) ?? new Map<MonthKey, Set<string>>();
    const monthSet = new Set<MonthKey>([...openMonths, ...rateMap.keys(), ...reporting.keys()]);
    const ascending = [...monthSet].sort((a, b) => compareMonths(a, b));

    const rows: FxMonthRow[] = [];
    let previous: { month: MonthKey; rate: number } | null = null;
    for (const month of ascending) {
      const rate = rateMap.get(month) ?? null;
      const reportingCompanies = [...(reporting.get(month) ?? [])].filter(Boolean).sort((a, b) =>
        a.localeCompare(b, "en-GB"),
      );
      const value = rate ? Number(rate.rate_to_myr) : null;
      const changePct =
        value !== null && previous && previous.rate > 0 ? ((value - previous.rate) / previous.rate) * 100 : null;
      rows.push({
        month,
        rate: value,
        updatedAt: rate?.updated_at ?? null,
        updatedBy: rate ? nameOf(names, rate.updated_by) : null,
        reportingCompanies,
        needed: reportingCompanies.length > 0,
        changePct,
        comparedWith: changePct !== null && previous ? previous.month : null,
        unusual: changePct !== null && Math.abs(changePct) > FX_UNUSUAL_CHANGE_PCT,
      });
      if (value !== null && Number.isFinite(value)) previous = { month, rate: value };
    }

    const fxCompanies = (companiesByCurrency.get(currency) ?? [])
      .map((company) => ({
        id: company.id,
        name: company.name,
        status: company.status,
        reportingStartMonth: parseMonthKey(company.reporting_start_month),
      }))
      .sort(byName);

    return {
      currency,
      companies: fxCompanies,
      rows: rows.reverse(),
      missing: ascending.filter((month) => !rateMap.has(month) && (reporting.get(month)?.size ?? 0) > 0),
    };
  });
}

/** The nearest month before `month` that has a rate (for "Use the previous rate"). */
export function previousRate(
  rows: readonly Pick<FxMonthRow, "month" | "rate">[],
  month: MonthKey,
): { month: MonthKey; rate: number } | null {
  let best: { month: MonthKey; rate: number } | null = null;
  for (const row of rows) {
    if (row.rate === null || compareMonths(row.month, month) >= 0) continue;
    if (!best || compareMonths(row.month, best.month) > 0) best = { month: row.month, rate: row.rate };
  }
  return best;
}

/** Percentage change from `from` to `to` (null when `from` is not positive). */
export function rateChangePct(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/** Months the FX month picker offers: January of FX_FIRST_YEAR (or an earlier month on record) to `to`. */
export function fxMonthRange(knownMonths: readonly MonthKey[], to: MonthKey): { from: MonthKey; to: MonthKey } {
  let from: MonthKey = `${FX_FIRST_YEAR}-01`;
  for (const month of knownMonths) if (compareMonths(month, from) < 0) from = month;
  return { from, to: compareMonths(to, from) < 0 ? from : to };
}

// ---------------------------------------------------------------------------------------------
// The page's data (built by load-cycles.ts on the server; plain JSON for the client workspace)
// ---------------------------------------------------------------------------------------------

export type CyclesData = {
  /** Today in Malaysia time (from the server, so server and client renders agree). */
  today: DateKey;
  currentMonth: MonthKey;
  /** platform_settings.due_day: months are due on this day of the following month. */
  dueDay: number;
  graceDays: number;
  escalationDays: number;
  /**
   * `platform_settings.updated_at` when the page loaded: "Change cycle settings" sends it back, so a save
   * over someone else's change is refused (set_cycle_settings). Null when the settings row is missing.
   */
  settingsUpdatedAt?: string | null;
  /** Reporting months, newest first. */
  months: CycleMonth[];
  overdue: OverdueSummary;
  /** What "Open <current month> early" would do; null once the current month is open. */
  openEarly: OpenEarlyPreview | null;
  /** The default template's published version ("Portfolio Update v1"), used by the months opened next. */
  currentTemplateLabel: string | null;
  extensions: DeadlineExtension[];
  deadlineChoices: DeadlineCompanyChoice[];
  closes: CloseGroup[];
  upcoming: UpcomingClose[];
  fx: FxCurrency[];
  /** The non-MYR currencies companies report in (the FX dialog's choices). */
  fxCurrencies: string[];
  fxRange: { from: MonthKey; to: MonthKey };
  /** Active companies with a reporting start month. */
  reportingCompanies: number;
};
