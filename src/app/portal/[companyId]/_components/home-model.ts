// Company home (BRD C2; docs/ARCHITECTURE.md §6 "Company home"): the pure logic behind
// /portal/[companyId] — which month to work on next, missing (overdue) months, changes requested by
// ScaleUp, open comment threads, the latest submitted figures and the next quarter / half close.
// Client-safe and free of I/O (the page loads the data, load-home.ts).

import { SCALEUP_LABEL, type Tone } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { gpPct, growthPct, isCashflowPositive, npPct, runwayMonths } from "@/lib/metrics";
import {
  addMonths,
  compareMonths,
  dateToMonthKey,
  daysBetween,
  dueDateFor,
  halfOf,
  isHalfEnd,
  monthKeyToDate,
  monthLabel,
  monthsBetween,
  quarterOf,
  type ClosePeriod,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";
import type { CompanyRow, FinancialSeriesPoint, SubmissionOverviewRow } from "@/lib/types/domain";
import type { ClosePeriodType, CompanyStatus, PeriodCloseStatus } from "@/lib/types/enums";

export type HomeSubmission = Pick<
  SubmissionOverviewRow,
  | "id"
  | "month"
  | "status"
  | "due_date"
  | "original_due_date"
  | "submitted_at"
  | "approved_at"
  | "revision"
  | "last_saved_at"
  | "is_overdue"
  | "days_overdue"
  | "has_narrative"
  | "open_threads"
>;

/** "1 day" / "3 days". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Jul 2026", "Jul 2026 and Aug 2026", "Jun 2026, Jul 2026 and Aug 2026" (in the given order). */
export function monthListText(months: readonly Pick<HomeSubmission, "month">[]): string {
  const labels = months.map((m) => monthLabel(m.month));
  return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** 'YYYY-MM' of a stored month ('2026-08-01'). */
export function monthKeyOf(submission: Pick<HomeSubmission, "month">): MonthKey {
  return dateToMonthKey(submission.month);
}

/** The monthly form of a month: /portal/<id>/updates/<YYYY-MM>. */
export function updateHref(companyId: string, month: string): string {
  return `/portal/${companyId}/updates/${dateToMonthKey(month)}`;
}

function byMonthAsc<T extends Pick<HomeSubmission, "month">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareMonths(a.month, b.month));
}

function byMonthDesc<T extends Pick<HomeSubmission, "month">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareMonths(b.month, a.month));
}

// ---------------------------------------------------------------------------------------------
// Months to work on
// ---------------------------------------------------------------------------------------------

/**
 * Months the company still has to submit, oldest first (`startMonth` = companies.reporting_start_month):
 * - every month ScaleUp sent back (changes requested): ScaleUp asked for it;
 * - drafts from the reporting start month on. Drafts left from before a start month that was moved
 *   later are not required: they are never overdue (v_submission_overview) and the "submit months in
 *   order" rule skips them (docs/ARCHITECTURE.md §2.6 rule 6);
 * - without a start month (cleared: nothing new is requested, nothing is overdue), only the drafts before
 *   a month sent back: rule 6 then counts every earlier draft, so they must be submitted first.
 */
export function monthsNeedingAction<T extends HomeSubmission>(submissions: readonly T[], startMonth: string | null): T[] {
  const lastSentBack = byMonthDesc(submissions.filter((s) => s.status === "changes_requested"))[0] ?? null;
  return byMonthAsc(
    submissions.filter((s) => {
      if (s.status === "changes_requested") return true;
      if (s.status !== "draft") return false;
      if (startMonth) return compareMonths(s.month, startMonth) >= 0;
      return lastSentBack !== null && compareMonths(s.month, lastSentBack.month) < 0;
    }),
  );
}

/**
 * The month to work on next: the earliest month still to submit (months are submitted in order, BRD
 * B5; see monthsNeedingAction), or null when there is nothing to submit.
 */
export function focusMonth<T extends HomeSubmission>(submissions: readonly T[], startMonth: string | null): T | null {
  return monthsNeedingAction(submissions, startMonth)[0] ?? null;
}

/**
 * Drafts from before the reporting start month (left when ScaleUp moved the start month later): no
 * longer required, oldest first. Empty without a start month (the "not reporting" notice covers those).
 */
export function draftsBeforeStart<T extends HomeSubmission>(submissions: readonly T[], startMonth: string | null): T[] {
  if (!startMonth) return [];
  return byMonthAsc(submissions.filter((s) => s.status === "draft" && compareMonths(s.month, startMonth) < 0));
}

/** Overdue months ("missing numbers", shown in red), oldest first. */
export function overdueMonths<T extends HomeSubmission>(submissions: readonly T[]): T[] {
  return byMonthAsc(submissions.filter((s) => s.is_overdue));
}

/** The newest month on the platform, whatever its status. */
export function latestMonth<T extends HomeSubmission>(submissions: readonly T[]): T | null {
  return byMonthDesc(submissions)[0] ?? null;
}

/** The newest submitted or approved month (what "You're up to date" describes), or null. */
export function latestSubmittedMonth<T extends HomeSubmission>(submissions: readonly T[]): T | null {
  return latestMonth(submissions.filter((s) => s.status === "submitted" || s.status === "approved"));
}

/** Due-date wording and tone for a month still to submit ("15 days overdue", "Due in 3 days"). */
export function dueStatus(
  submission: Pick<HomeSubmission, "due_date" | "is_overdue" | "days_overdue">,
  today: DateKey,
): { text: string; tone: Tone } {
  if (submission.is_overdue) return { text: `${plural(submission.days_overdue, "day")} overdue`, tone: "danger" };
  const days = daysBetween(today, submission.due_date);
  if (days < 0) return { text: "Past its due date", tone: "neutral" };
  if (days === 0) return { text: "Due today", tone: "warning" };
  if (days === 1) return { text: "Due tomorrow", tone: "warning" };
  return { text: `Due in ${days} days`, tone: days <= 7 ? "warning" : "neutral" };
}

/** The month that opens next: which month, when it opens (1st of the following month) and its due date. */
export type NextMonth = {
  month: MonthKey;
  opensOn: DateKey;
  /**
   * Its due date (day `due_day` of the following month), or null when it is still to open after that
   * date: a month that opens late gets the backfill grace period from the day it opens (BRD B4), which
   * company users cannot read, so the date is not known yet.
   */
  dueOn: DateKey | null;
  /** It should already be open (it opens with the next open_due_periods run). */
  alreadyDue: boolean;
};

/**
 * The next month that will open for an active, reporting company: the month after the newest one on
 * the platform (never before the reporting start month). Null for companies that are not reporting or
 * no longer active.
 */
export function nextMonthToOpen({
  status,
  startMonth,
  latest,
  today,
  dueDay,
}: {
  status: CompanyStatus;
  startMonth: string | null;
  latest: MonthKey | null;
  today: DateKey;
  dueDay: number;
}): NextMonth | null {
  if (status !== "active" || !startMonth) return null;
  const start = dateToMonthKey(startMonth);
  let month = latest ? addMonths(latest, 1) : start;
  if (compareMonths(month, start) < 0) month = start;
  const opensOn = monthKeyToDate(addMonths(month, 1));
  const alreadyDue = daysBetween(today, opensOn) <= 0;
  // Like effectiveDueDate() with today as the opening day: the usual due date, unless that has passed.
  const usualDueOn = dueDateFor(month, dueDay);
  const opensLate = alreadyDue && daysBetween(usualDueOn, today) > 0;
  return { month, opensOn, dueOn: opensLate ? null : usualDueOn, alreadyDue };
}

/**
 * When the next month opens and is due, as a sentence fragment after the month's name: "opens on 1 Nov
 * 2026 and is due by 15 Nov 2026", "opens shortly and is due by 15 Oct 2026", or, when the due date is
 * not known yet (it opens late), "opens shortly; you'll see its due date here once it opens".
 */
export function nextMonthTiming(next: Pick<NextMonth, "opensOn" | "dueOn" | "alreadyDue">): string {
  const opens = next.alreadyDue ? "opens shortly" : `opens on ${formatDate(next.opensOn)}`;
  return next.dueOn ? `${opens} and is due by ${formatDate(next.dueOn)}` : `${opens}; you'll see its due date here once it opens`;
}

// ---------------------------------------------------------------------------------------------
// ScaleUp's requests
// ---------------------------------------------------------------------------------------------

/** A timeline event of a month sent back (request_changes) or reopened (reopen_submission). */
export type ChangeEvent = {
  id: number;
  submission_id: string;
  event: string;
  /** Who sent the month back: a ScaleUp person, or null for a system action. */
  actor_id: string | null;
  message: string | null;
  created_at: string;
};

export type ChangeRequest<T extends HomeSubmission = HomeSubmission> = {
  submission: T;
  /** ScaleUp's message (the request-changes message or the reopen reason); null when not found. */
  message: string | null;
  /** Who asked, as the company sees it: "Renuka Sena (ScaleUp)" (BRD B28), or "ScaleUp" when nobody can be named. */
  author: string;
  requestedAt: string | null;
  /** How it came back: sent back after a submission, or an approved month reopened. */
  kind: "changes_requested" | "reopened";
};

/**
 * The name the company side shows for a ScaleUp person (BRD B28): their "<full name> (ScaleUp)" display
 * name from `staff_display_names` (keyed by lower-case id), else "ScaleUp" (system actions, or names that
 * could not be loaded). Never an email or a role.
 */
export function scaleUpAuthor(actorId: string | null, staffNames: Readonly<Record<string, string>>): string {
  return (actorId ? staffNames[actorId.toLowerCase()] : undefined) ?? SCALEUP_LABEL;
}

/** The ids to resolve with getStaffDisplayNames for the change requests: every actor of the events. */
export function changeEventActorIds(events: readonly Pick<ChangeEvent, "actor_id">[]): string[] {
  return [...new Set(events.flatMap((e) => (e.actor_id ? [e.actor_id.toLowerCase()] : [])))];
}

/**
 * Months ScaleUp sent back, oldest first, each with the latest "changes requested" / "reopened" message
 * and its author named "<full name> (ScaleUp)" (BRD B28; `staffNames` from getStaffDisplayNames).
 */
export function changeRequests<T extends HomeSubmission>(
  submissions: readonly T[],
  events: readonly ChangeEvent[],
  staffNames: Readonly<Record<string, string>> = {},
): ChangeRequest<T>[] {
  return byMonthAsc(submissions.filter((s) => s.status === "changes_requested")).map((submission) => {
    const latest = events
      .filter((e) => e.submission_id === submission.id && (e.event === "changes_requested" || e.event === "reopened"))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))[0];
    return {
      submission,
      message: latest?.message?.trim() ? latest.message.trim() : null,
      author: scaleUpAuthor(latest?.actor_id ?? null, staffNames),
      requestedAt: latest?.created_at ?? null,
      kind: latest?.event === "reopened" ? "reopened" : "changes_requested",
    };
  });
}

/**
 * Unresolved comment threads the company can see (shared threads), per month, newest first. They are
 * not all ScaleUp's: an owner's amendment request is a shared thread too (request_amendment).
 */
export function openThreadMonths<T extends HomeSubmission>(submissions: readonly T[]): { total: number; months: T[] } {
  const months = byMonthDesc(submissions.filter((s) => s.open_threads > 0));
  return { total: months.reduce((sum, s) => sum + s.open_threads, 0), months };
}

// ---------------------------------------------------------------------------------------------
// Latest figures
// ---------------------------------------------------------------------------------------------

export type LatestFigures = {
  point: FinancialSeriesPoint;
  /** The previous calendar month, when it was submitted too (for month-on-month change). */
  previous: FinancialSeriesPoint | null;
  gpPct: number | null;
  npPct: number | null;
  runwayMonths: number | null;
  cashflowPositive: boolean;
  /** Revenue growth vs the previous month (%), or null. */
  revenueGrowth: number | null;
  /** Full-time + part-time headcount, or null when neither is known. */
  headcount: number | null;
};

const SUBMITTED = new Set(["submitted", "approved"]);

/** The newest submitted or approved month's figures (BRD C2 "last submitted figures"), or null. */
export function latestFigures(series: readonly FinancialSeriesPoint[]): LatestFigures | null {
  const submitted = [...series].filter((p) => SUBMITTED.has(p.status)).sort((a, b) => compareMonths(a.month, b.month));
  const point = submitted.at(-1);
  if (!point) return null;
  const previousMonth = addMonths(point.month, -1);
  const previous = submitted.find((p) => compareMonths(p.month, previousMonth) === 0) ?? null;
  const ft = point.headcount_ft;
  const pt = point.headcount_pt;
  return {
    point,
    previous,
    gpPct: gpPct(point),
    npPct: npPct(point),
    runwayMonths: runwayMonths(point),
    cashflowPositive: isCashflowPositive(point),
    revenueGrowth: previous ? growthPct(point.revenue_total, previous.revenue_total) : null,
    headcount: ft === null && pt === null ? null : (ft ?? 0) + (pt ?? 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Quarter and half closes
// ---------------------------------------------------------------------------------------------

export type HomeClose = {
  id: string;
  period_type: ClosePeriodType;
  period_start: string;
  period_end: string;
  label: string;
  status: PeriodCloseStatus;
  confirmed_at: string | null;
};

export type HomeManagementAccounts = {
  id: string;
  period_close_id: string | null;
  version: number;
  uploaded_at: string;
};

export type CloseSummary = {
  id: string;
  label: string;
  type: ClosePeriodType;
  /** 'Jul–Sep 2026'. */
  rangeLabel: string;
  periodEnd: DateKey;
  status: PeriodCloseStatus;
  confirmedAt: string | null;
  /** The months that must be submitted before confirming (from the reporting start). */
  months: MonthKey[];
  monthsSubmitted: number;
  /** The latest management accounts uploaded for the close, or null. */
  managementAccounts: { count: number; version: number; uploadedAt: string } | null;
};

function closePeriod(close: HomeClose): ClosePeriod {
  return close.period_type === "quarter" ? quarterOf(close.period_start) : halfOf(close.period_start);
}

/**
 * Open and confirmed closes with what they still need (every month submitted, management accounts
 * uploaded, BRD B13). The months counted start at the reporting start month (without one: the first
 * month with an update in the period), like confirm_period_close.
 */
export function summariseCloses({
  closes,
  documents,
  submissions,
  startMonth,
}: {
  closes: readonly HomeClose[];
  documents: readonly HomeManagementAccounts[];
  submissions: readonly HomeSubmission[];
  startMonth: string | null;
}): { open: CloseSummary[]; lastConfirmed: CloseSummary | null } {
  const statusByMonth = new Map(submissions.map((s) => [monthKeyOf(s), s.status]));
  const summaries = closes.map((close): CloseSummary => {
    const period = closePeriod(close);
    let months = monthsBetween(period.startMonth, period.endMonth);
    if (startMonth) {
      const start = dateToMonthKey(startMonth);
      months = months.filter((m) => compareMonths(m, start) >= 0);
    } else {
      const first = months.findIndex((m) => statusByMonth.has(m));
      months = first === -1 ? [] : months.slice(first);
    }
    const docs = documents.filter((d) => d.period_close_id === close.id);
    const latestDoc = [...docs].sort((a, b) => b.version - a.version || (a.uploaded_at < b.uploaded_at ? 1 : -1))[0];
    return {
      id: close.id,
      label: close.label,
      type: close.period_type,
      rangeLabel: period.rangeLabel,
      periodEnd: period.end,
      status: close.status,
      confirmedAt: close.confirmed_at,
      months,
      monthsSubmitted: months.filter((m) => SUBMITTED.has(statusByMonth.get(m) ?? "")).length,
      managementAccounts: latestDoc
        ? { count: docs.length, version: latestDoc.version, uploadedAt: latestDoc.uploaded_at }
        : null,
    };
  });
  const order = (a: CloseSummary, b: CloseSummary) =>
    (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0) ||
    Number(a.type === "half") - Number(b.type === "half");
  const open = summaries.filter((s) => s.status === "open").sort(order);
  const confirmed = summaries.filter((s) => s.status === "confirmed").sort(order);
  return { open, lastConfirmed: confirmed.at(-1) ?? null };
}

/**
 * The next quarter (and half, when it ends at the same time) that has no close yet, from the current
 * month on — for an active company with a reporting start month. Closes open once the period's last
 * month has opened.
 */
export function upcomingCloses({
  status,
  startMonth,
  today,
  closes,
}: {
  status: CompanyStatus;
  startMonth: string | null;
  today: DateKey;
  closes: readonly Pick<HomeClose, "period_type" | "period_start">[];
}): ClosePeriod[] {
  if (status !== "active" || !startMonth) return [];
  const existing = new Set(closes.map((c) => `${c.period_type}:${dateToMonthKey(c.period_start)}`));
  const start = dateToMonthKey(startMonth);
  let month = dateToMonthKey(today);
  if (compareMonths(month, start) < 0) month = start;
  for (let i = 0; i < 8; i++) {
    const quarter = quarterOf(month);
    if (!existing.has(`quarter:${quarter.startMonth}`)) {
      const half = halfOf(month);
      const withHalf = isHalfEnd(quarter.endMonth) && !existing.has(`half:${half.startMonth}`);
      return withHalf ? [quarter, half] : [quarter];
    }
    month = addMonths(quarter.endMonth, 1);
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Everything the page loads (load-home.ts)
// ---------------------------------------------------------------------------------------------

export type HomeData = {
  company: CompanyRow;
  /** v_submission_overview rows, newest month first. */
  submissions: SubmissionOverviewRow[];
  /** Monthly figures, oldest first (every status). */
  series: FinancialSeriesPoint[];
  /** "Changes requested" / "reopened" events of the months currently sent back, newest first. */
  changeEvents: ChangeEvent[];
  /**
   * "<full name> (ScaleUp)" by lower-case id for the authors of those events (BRD B28,
   * getStaffDisplayNames); empty when there are none or the names could not be loaded.
   */
  staffNames: Record<string, string>;
  closes: HomeClose[];
  /** Management accounts linked to a close (every version). */
  managementAccounts: HomeManagementAccounts[];
  /** platform_settings.due_day (get_client_settings). */
  dueDay: number;
  /** Today in Malaysia time. */
  today: DateKey;
};
