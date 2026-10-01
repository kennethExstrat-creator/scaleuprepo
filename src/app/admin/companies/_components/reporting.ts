// The reporting start month (BRD B3, B16): which months a Super Admin may choose and what setting one
// does. Months open on the 1st of the following month (B4); months opened after their normal due date
// get the backfill grace period from the day they open (mirrors open_due_periods(); effectiveDueDate).
// Pure; unit-tested in tests/features/m1/reporting.test.ts.
import { formatDate } from "@/lib/format";
import {
  addMonths,
  compareMonths,
  dateToMonthKey,
  effectiveDueDate,
  lastCompletedMonth,
  monthKeyToDate,
  monthLabel,
  monthsBetween,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";

/** How far ahead a start month may be set (onboarding a company that starts reporting later). */
export const START_MONTH_MAX_MONTHS_AHEAD = 12;

export type StartMonthBounds = { min: MonthKey; max: MonthKey };

/**
 * The months a start month may be chosen from: from the platform's default reporting start (July 2026;
 * earlier history comes from the workbook migration, BRD B3) to 12 months after the current month.
 */
export function startMonthBounds(defaultReportingStart: string, today: string): StartMonthBounds {
  const min = dateToMonthKey(defaultReportingStart);
  const max = addMonths(today, START_MONTH_MAX_MONTHS_AHEAD);
  return { min, max: compareMonths(max, min) < 0 ? min : max };
}

/** Why the month cannot be chosen, or null when it can. */
export function startMonthIssue(month: MonthKey, bounds: StartMonthBounds): string | null {
  if (compareMonths(month, bounds.min) < 0) {
    return `The reporting start month can't be before ${monthLabel(bounds.min)}. Earlier months come from the historical workbooks.`;
  }
  if (compareMonths(month, bounds.max) > 0) {
    return `The reporting start month can't be after ${monthLabel(bounds.max)}.`;
  }
  return null;
}

/** The months offered in the picker, oldest first; the current value is kept even when out of range. */
export function startMonthOptions(bounds: StartMonthBounds, current: string | null): MonthKey[] {
  const months = monthsBetween(bounds.min, bounds.max);
  const currentKey = current ? dateToMonthKey(current) : null;
  if (currentKey && !months.includes(currentKey)) {
    months.push(currentKey);
    months.sort((a, b) => compareMonths(a, b));
  }
  return months;
}

export type StartMonthPreview =
  | {
      kind: "opens_now";
      /** Months requested straight away, oldest first. */
      months: MonthKey[];
      /** Due date of the first of them. */
      firstDue: DateKey;
    }
  | {
      kind: "opens_later";
      month: MonthKey;
      /** The 1st of the following month. */
      opensOn: DateKey;
      /** The normal due date of that month. */
      due: DateKey;
    };

/**
 * What choosing `month` as the start month means today: the months that open at once (up to the last
 * completed month) and when the first is due, or when the first month will open.
 */
export function startMonthPreview(month: MonthKey, today: DateKey, dueDay: number, graceDays: number): StartMonthPreview {
  const lastDone = lastCompletedMonth(today);
  const months = monthsBetween(month, lastDone);
  if (months.length > 0) {
    return { kind: "opens_now", months, firstDue: effectiveDueDate(months[0], dueDay, today, graceDays) };
  }
  return {
    kind: "opens_later",
    month,
    opensOn: monthKeyToDate(addMonths(month, 1)),
    due: effectiveDueDate(month, dueDay, monthKeyToDate(addMonths(month, 1)), graceDays),
  };
}

/**
 * One sentence for the preview, e.g. "Jul 2026 to Aug 2026 (2 months) open straight away; the first is
 * due 14 Oct 2026." or "Oct 2026 opens on 1 Nov 2026 and is due 15 Nov 2026."
 */
export function describeStartMonthPreview(preview: StartMonthPreview): string {
  if (preview.kind === "opens_later") {
    return `${monthLabel(preview.month)} opens on ${formatDate(preview.opensOn)} and is due ${formatDate(preview.due)}.`;
  }
  const { months, firstDue } = preview;
  if (months.length === 1) {
    return `${monthLabel(months[0])} opens straight away and is due ${formatDate(firstDue)}.`;
  }
  const range = `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`;
  return `${range} (${months.length} months) open straight away; the first is due ${formatDate(firstDue)}.`;
}
