// Month, date and reporting-period helpers (docs/ARCHITECTURE.md §0 "Coding conventions" and §5.4).
//
// Everything here is pure and timezone-safe: calendar maths is done on integers (year, month, day)
// and never uses the machine's local timezone. "Today" is always Malaysia time (Asia/Kuala_Lumpur),
// which is a fixed UTC+8 with no daylight saving, so it is computed as `epoch + 8 h`.
//
// Formats
// - `MonthKey`  = 'YYYY-MM'     (URLs, maps, most helpers' return values)
// - `DateKey`   = 'YYYY-MM-DD'  (Postgres `date`; a month is stored as its first day, e.g. '2026-09-01')
// Every helper that takes a month accepts either form (the day of a DateKey is validated, then ignored)
// and throws a RangeError on anything else. Use `isMonthKey` / `parseMonthKey` to check untrusted input
// (e.g. a `[month]` route param) before calling the throwing helpers.

import type { ClosePeriodType } from "@/lib/types/enums";

/** 'YYYY-MM', e.g. '2026-09'. */
export type MonthKey = string;
/** 'YYYY-MM-DD', e.g. '2026-09-30'. */
export type DateKey = string;

/** Malaysia is UTC+8 all year (no DST). */
export const MYT_OFFSET_MINUTES = 8 * 60;
const MYT_OFFSET_MS = MYT_OFFSET_MINUTES * 60_000;
const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO 8601 / Postgres timestamp: '2026-09-30T06:05:00Z', '2026-09-30T06:05:00.123456+00:00', '2026-09-30 06:05:00+08'
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

type Ymd = { year: number; month: number; day: number };

// ---------------------------------------------------------------------------------------------
// Integer calendar maths (proleptic Gregorian; H. Hinnant's days_from_civil / civil_from_days)
// ---------------------------------------------------------------------------------------------

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Days since 1970-01-01 for a civil date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12; // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Civil date for a number of days since 1970-01-01. */
function civilFromDays(days: number): Ymd {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function toMonthKeyParts(year: number, month: number): MonthKey {
  if (year < 0 || year > 9999) throw new RangeError(`Month out of range: year ${year}.`);
  return `${pad4(year)}-${pad2(month)}`;
}

function toDateKeyParts(year: number, month: number, day: number): DateKey {
  return `${toMonthKeyParts(year, month)}-${pad2(day)}`;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/** Parses 'YYYY-MM' (day = 1) or 'YYYY-MM-DD' (day validated). Returns null when malformed. */
function parseYmd(value: unknown): Ymd | null {
  if (typeof value !== "string") return null;
  const m = MONTH_KEY_RE.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? { year, month, day: 1 } : null;
  }
  const d = DATE_KEY_RE.exec(value);
  if (d) {
    const year = Number(d[1]);
    const month = Number(d[2]);
    const day = Number(d[3]);
    if (month < 1 || month > 12) return null;
    return day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
  }
  return null;
}

function parseOrThrow(value: unknown): Ymd {
  const parts = parseYmd(value);
  if (!parts) {
    throw new RangeError(`Invalid month or date ${JSON.stringify(value)}: expected YYYY-MM or YYYY-MM-DD.`);
  }
  return parts;
}

/** True for a well-formed month key 'YYYY-MM' (month 01–12). Does not accept 'YYYY-MM-DD'. */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && MONTH_KEY_RE.test(value) && parseYmd(value) !== null;
}

/** True for a real calendar date 'YYYY-MM-DD' (e.g. '2026-02-30' is false). */
export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && DATE_KEY_RE.test(value) && parseYmd(value) !== null;
}

/**
 * Non-throwing normaliser for untrusted input: 'YYYY-MM' or 'YYYY-MM-DD' → 'YYYY-MM'; anything else → null.
 * Typical use: `const month = parseMonthKey(params.month); if (!month) notFound();`
 */
export function parseMonthKey(value: unknown): MonthKey | null {
  const parts = parseYmd(value);
  return parts ? toMonthKeyParts(parts.year, parts.month) : null;
}

/** '2026-09' → '2026-09-01' (also accepts '2026-09-17' → '2026-09-01'). */
export function monthKeyToDate(value: string): DateKey {
  const { year, month } = parseOrThrow(value);
  return toDateKeyParts(year, month, 1);
}

/** '2026-09-01' → '2026-09' (also accepts '2026-09'). */
export function dateToMonthKey(value: string): MonthKey {
  const { year, month } = parseOrThrow(value);
  return toMonthKeyParts(year, month);
}

/** Calendar parts of a month or date string. Throws on malformed input. */
export function parseMonthParts(value: string): { year: number; month: number } {
  const { year, month } = parseOrThrow(value);
  return { year, month };
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** '2026-09' → 'Sep 2026'. */
export function monthLabel(value: string): string {
  const { year, month } = parseOrThrow(value);
  return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
}

/** '2026-09' → 'September 2026'. */
export function monthLabelLong(value: string): string {
  const { year, month } = parseOrThrow(value);
  return `${MONTH_NAMES_LONG[month - 1]} ${year}`;
}

// ---------------------------------------------------------------------------------------------
// Month arithmetic
// ---------------------------------------------------------------------------------------------

function monthIndex(parts: { year: number; month: number }): number {
  return parts.year * 12 + (parts.month - 1);
}

function fromMonthIndex(index: number): MonthKey {
  const year = Math.floor(index / 12);
  return toMonthKeyParts(year, index - year * 12 + 1);
}

/** Compares two months (either format; days are ignored). Returns -1, 0 or 1. */
export function compareMonths(a: string, b: string): -1 | 0 | 1 {
  const diff = monthIndex(parseOrThrow(a)) - monthIndex(parseOrThrow(b));
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}

/** Adds `n` (integer, may be negative) months: addMonths('2026-12', 1) → '2027-01'. */
export function addMonths(value: string, n: number): MonthKey {
  if (!Number.isInteger(n)) throw new RangeError(`addMonths: n must be an integer, got ${n}.`);
  return fromMonthIndex(monthIndex(parseOrThrow(value)) + n);
}

/** Number of months from `from` to `to` (negative when `to` is earlier): monthDiff('2026-11', '2027-02') → 3. */
export function monthDiff(from: string, to: string): number {
  return monthIndex(parseOrThrow(to)) - monthIndex(parseOrThrow(from));
}

/** Inclusive list of months from `from` to `to`; empty when `to` is before `from`. */
export function monthsBetween(from: string, to: string): MonthKey[] {
  const start = monthIndex(parseOrThrow(from));
  const end = monthIndex(parseOrThrow(to));
  const months: MonthKey[] = [];
  for (let i = start; i <= end; i++) months.push(fromMonthIndex(i));
  return months;
}

/** Last calendar day of the month: '2028-02' → '2028-02-29'. */
export function lastDayOfMonth(value: string): DateKey {
  const { year, month } = parseOrThrow(value);
  return toDateKeyParts(year, month, daysInMonth(year, month));
}

// ---------------------------------------------------------------------------------------------
// Quarters and halves (calendar year: Q1 = Jan–Mar …; H1 = Jan–Jun, H2 = Jul–Dec)
// ---------------------------------------------------------------------------------------------

export type ClosePeriod = {
  type: ClosePeriodType;
  /** 'Q3 2026' | 'H2 2026' (same text as `period_closes.label`). */
  label: string;
  /** 'Jul–Sep 2026' */
  rangeLabel: string;
  year: number;
  /** Quarter 1–4 or half 1–2. */
  index: number;
  /** First day of the period, e.g. '2026-07-01' (matches `period_closes.period_start`). */
  start: DateKey;
  /** Last calendar day of the period, e.g. '2026-09-30'. Compare with DB rows by month (`endMonth`). */
  end: DateKey;
  startMonth: MonthKey;
  endMonth: MonthKey;
  /** Every month in the period, oldest first. */
  months: MonthKey[];
};

function buildPeriod(type: ClosePeriodType, year: number, index: number): ClosePeriod {
  const length = type === "quarter" ? 3 : 6;
  const firstMonth = (index - 1) * length + 1;
  const lastMonth = firstMonth + length - 1;
  const months: MonthKey[] = [];
  for (let m = firstMonth; m <= lastMonth; m++) months.push(toMonthKeyParts(year, m));
  return {
    type,
    label: `${type === "quarter" ? "Q" : "H"}${index} ${year}`,
    rangeLabel: `${MONTH_NAMES_SHORT[firstMonth - 1]}–${MONTH_NAMES_SHORT[lastMonth - 1]} ${year}`,
    year,
    index,
    start: toDateKeyParts(year, firstMonth, 1),
    end: toDateKeyParts(year, lastMonth, daysInMonth(year, lastMonth)),
    startMonth: months[0],
    endMonth: months[months.length - 1],
    months,
  };
}

/** Calendar quarter containing the month: quarterOf('2026-08') → Q3 2026 (Jul–Sep). */
export function quarterOf(value: string): ClosePeriod {
  const { year, month } = parseOrThrow(value);
  return buildPeriod("quarter", year, Math.floor((month - 1) / 3) + 1);
}

/** Calendar half containing the month: halfOf('2026-08') → H2 2026 (Jul–Dec). */
export function halfOf(value: string): ClosePeriod {
  const { year, month } = parseOrThrow(value);
  return buildPeriod("half", year, month <= 6 ? 1 : 2);
}

/** quarterOf / halfOf chosen by `period_closes.period_type`. */
export function closePeriodOf(type: ClosePeriodType, value: string): ClosePeriod {
  return type === "quarter" ? quarterOf(value) : halfOf(value);
}

/** Parses 'Q3 2026' / 'H2 2026' (also 'Q3-2026', 'h2 2026'); null when not a period label. */
export function parsePeriodLabel(label: string): ClosePeriod | null {
  const m = /^\s*([QqHh])([1-4])[\s-]+(\d{4})\s*$/.exec(label);
  if (!m) return null;
  const type: ClosePeriodType = m[1].toUpperCase() === "Q" ? "quarter" : "half";
  const index = Number(m[2]);
  if (type === "half" && index > 2) return null;
  return buildPeriod(type, Number(m[3]), index);
}

/** True for March, June, September and December. */
export function isQuarterEnd(value: string): boolean {
  return parseOrThrow(value).month % 3 === 0;
}

/** True for June and December. */
export function isHalfEnd(value: string): boolean {
  const { month } = parseOrThrow(value);
  return month === 6 || month === 12;
}

// ---------------------------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------------------------

function epochDay(value: string): number {
  const { year, month, day } = parseOrThrow(value);
  return daysFromCivil(year, month, day);
}

/**
 * Whole days from `from` to `to` (positive when `to` is later). Accepts 'YYYY-MM-DD' or 'YYYY-MM' (the 1st).
 * e.g. days overdue = daysBetween(dueDate, todayMYT()).
 */
export function daysBetween(from: string, to: string): number {
  return epochDay(to) - epochDay(from);
}

/** Adds `n` (integer, may be negative) days: addDays('2026-12-25', 14) → '2027-01-08'. */
export function addDays(value: string, n: number): DateKey {
  if (!Number.isInteger(n)) throw new RangeError(`addDays: n must be an integer, got ${n}.`);
  const { year, month, day } = civilFromDays(epochDay(value) + n);
  return toDateKeyParts(year, month, day);
}

/**
 * Due date of a month's numbers: day `dueDay` of the following month, clamped to that month's length.
 * dueDateFor('2026-09', 15) → '2026-10-15'; dueDateFor('2026-12', 15) → '2027-01-15'.
 */
export function dueDateFor(month: string, dueDay: number): DateKey {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new RangeError(`dueDateFor: dueDay must be an integer from 1 to 31, got ${dueDay}.`);
  }
  const next = parseOrThrow(addMonths(month, 1));
  return toDateKeyParts(next.year, next.month, Math.min(dueDay, daysInMonth(next.year, next.month)));
}

/**
 * Due date of a submission created on `createdOn` (mirrors `open_due_periods()`): the normal due date, or
 * `createdOn + graceDays` when the month is only opened after its normal due date (e.g. mid-year onboarding).
 * effectiveDueDate('2026-07', 15, '2026-09-30', 14) → '2026-10-14'.
 */
export function effectiveDueDate(month: string, dueDay: number, createdOn: string, graceDays: number): DateKey {
  const normal = dueDateFor(month, dueDay);
  return daysBetween(normal, createdOn) > 0 ? addDays(createdOn, graceDays) : normal;
}

/** Whole days past the due date (0 when not yet due): daysOverdue('2026-10-15', '2026-10-20') → 5. */
export function daysOverdue(dueDate: string, today: string = todayMYT()): number {
  return Math.max(0, daysBetween(dueDate, today));
}

// ---------------------------------------------------------------------------------------------
// Instants and "today" in Malaysia time
// ---------------------------------------------------------------------------------------------

/** Something that identifies a point in time. Strings: ISO timestamp, or 'YYYY-MM-DD' / 'YYYY-MM' (midnight MYT). */
export type InstantInput = string | number | Date;

/**
 * Epoch milliseconds for a Date, epoch number, ISO/Postgres timestamp string, or a date-only string
 * ('YYYY-MM-DD' / 'YYYY-MM', taken as midnight Malaysia time). Returns null when unparseable.
 * Timestamps without an offset are treated as UTC (never as machine-local time).
 */
export function parseInstant(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  const dateOnly = parseYmd(s);
  if (dateOnly) return daysFromCivil(dateOnly.year, dateOnly.month, dateOnly.day) * MS_PER_DAY - MYT_OFFSET_MS;
  const m = TIMESTAMP_RE.exec(s);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] ? Number(m[6]) : 0;
  const millis = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  const tz = m[8];
  if (tz && tz !== "Z" && tz !== "z") {
    const digits = tz.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (tz[0] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  return (
    daysFromCivil(year, month, day) * MS_PER_DAY +
    hour * 3_600_000 +
    minute * 60_000 +
    second * 1000 +
    millis -
    offsetMinutes * 60_000
  );
}

export type MytParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock parts in Malaysia time for an epoch-millisecond instant. */
export function mytParts(epochMs: number): MytParts {
  const shifted = epochMs + MYT_OFFSET_MS;
  const days = Math.floor(shifted / MS_PER_DAY);
  const msOfDay = shifted - days * MS_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  return {
    year,
    month,
    day,
    hour: Math.floor(msOfDay / 3_600_000),
    minute: Math.floor((msOfDay % 3_600_000) / 60_000),
    second: Math.floor((msOfDay % 60_000) / 1000),
  };
}

function instantOrThrow(value: InstantInput): number {
  const ms = parseInstant(value);
  if (ms === null) throw new RangeError(`Invalid date or timestamp ${JSON.stringify(value)}.`);
  return ms;
}

/**
 * Malaysia calendar date of an instant: toMYTDate('2026-09-30T16:30:00Z') → '2026-10-01'.
 * Date-only strings are returned as that date ('YYYY-MM' → the 1st).
 */
export function toMYTDate(value: InstantInput): DateKey {
  const { year, month, day } = mytParts(instantOrThrow(value));
  return toDateKeyParts(year, month, day);
}

/** Today's date in Malaysia time, 'YYYY-MM-DD'. `now` defaults to the current time (fake-timer friendly). */
export function todayMYT(now: number | Date = Date.now()): DateKey {
  return toMYTDate(now);
}

/** The current calendar month in Malaysia time, 'YYYY-MM'. */
export function currentMonthMYT(now: number | Date = Date.now()): MonthKey {
  return dateToMonthKey(todayMYT(now));
}

/**
 * The most recent month that has fully ended (a month opens for reporting on the 1st of the next month).
 * `today` is a 'YYYY-MM-DD' / 'YYYY-MM' string or an instant; defaults to todayMYT().
 * lastCompletedMonth('2026-09-30') → '2026-08'; lastCompletedMonth('2026-10-01') → '2026-09'.
 */
export function lastCompletedMonth(today: string | Date | number = todayMYT()): MonthKey {
  const day = typeof today === "string" ? today : todayMYT(today);
  return addMonths(day, -1);
}
