// Display formatting (docs/ARCHITECTURE.md §5.4). Pure and deterministic: no ICU/locale data and no
// machine timezone, so server and client renders always agree (no hydration mismatches) and output is
// stable across Node/browser versions. Dates and times are shown in Malaysia time (UTC+8).
//
// Missing values render as an em dash ("—"). Money: `RM 1,234,567`, negatives `-RM 1,234`.

import { MONTH_NAMES_SHORT, daysBetween, mytParts, parseInstant, toMYTDate, type InstantInput } from "@/lib/periods";

/** Placeholder shown for a missing value. */
export const EMPTY_DISPLAY = "—";

/** IANA timezone used for every "today"/date display (fixed UTC+8, no DST). */
export const DISPLAY_TIME_ZONE = "Asia/Kuala_Lumpur";

/** 'MYR' → 'RM'; any other ISO code is shown as the code itself ('SGD'). */
export function currencySymbol(currency: string | null | undefined = "MYR"): string {
  const code = (currency ?? "").trim().toUpperCase() || "MYR";
  return code === "MYR" ? "RM" : code;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

const NUMERIC_STRING_RE = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * Finite number from a number or a plain numeric string (Postgres numerics can arrive as strings,
 * e.g. '1234.5000'); null for null/undefined/NaN/Infinity/anything else. Never returns NaN.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && NUMERIC_STRING_RE.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampDecimals(decimals: number | undefined, fallback: number): number {
  if (decimals === undefined || !Number.isFinite(decimals)) return fallback;
  return Math.min(20, Math.max(0, Math.trunc(decimals)));
}

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Grouped fixed-point text for a non-negative finite number. */
function fixedGrouped(abs: number, decimals: number): string {
  if (abs >= 1e21) return String(abs);
  const [intPart, frac] = abs.toFixed(decimals).split(".");
  return frac === undefined ? groupDigits(intPart) : `${groupDigits(intPart)}.${frac}`;
}

function trimFraction(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** True when the rendered digits are all zero ("0", "0.00"), so no minus sign is shown. */
function isZeroText(text: string): boolean {
  return /^[0.,]+$/.test(text);
}

function signed(value: number, body: string, plus = false): string {
  if (isZeroText(body)) return body;
  if (value < 0) return `-${body}`;
  return plus ? `+${body}` : body;
}

/** 1234567.891 → '1,234,568' (decimals = 0) or '1,234,567.89' (decimals = 2). */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_DISPLAY;
  return signed(n, fixedGrouped(Math.abs(n), clampDecimals(decimals, 0)));
}

/** Grouped number with up to `maxDecimals` decimals and no trailing zeros: 30 → '30', 1234.5 → '1,234.5'. */
export function formatNumberTrimmed(value: number | null | undefined, maxDecimals = 2): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_DISPLAY;
  return signed(n, trimFraction(fixedGrouped(Math.abs(n), clampDecimals(maxDecimals, 2))));
}

/**
 * Text to put back into a number input (round-trips with parseNumberInput): 1234.5 → '1,234.5'; null → ''.
 */
export function formatNumberInput(value: number | null | undefined, maxDecimals = 4): string {
  const n = toFiniteNumber(value);
  if (n === null) return "";
  return signed(n, trimFraction(fixedGrouped(Math.abs(n), clampDecimals(maxDecimals, 4))));
}

const COMPACT_UNITS: ReadonlyArray<[suffix: string, size: number]> = [
  ["", 1],
  ["K", 1e3],
  ["M", 1e6],
  ["B", 1e9],
  ["T", 1e12],
];

/** 1234 → '1.2K', 1234567 → '1.2M', 999 → '999' (non-negative input). */
function compactNumber(abs: number, maxDecimals: number): string {
  let idx = abs < 1e3 ? 0 : abs < 1e6 ? 1 : abs < 1e9 ? 2 : abs < 1e12 ? 3 : 4;
  const render = (i: number) => trimFraction((abs / COMPACT_UNITS[i][1]).toFixed(i === 0 ? 0 : maxDecimals));
  let text = render(idx);
  // Rounding can carry into the next unit: 999.6 → '1K', 999,960 → '1M'.
  if (Number(text) >= 1000 && idx < COMPACT_UNITS.length - 1) {
    idx += 1;
    text = render(idx);
  }
  const [intPart, frac] = text.split(".");
  return `${groupDigits(intPart)}${frac ? `.${frac}` : ""}${COMPACT_UNITS[idx][0]}`;
}

/**
 * Money in the company's reporting currency: formatMoney(1234567) → 'RM 1,234,567';
 * formatMoney(-500) → '-RM 500'; formatMoney(1234567, 'MYR', { compact: true }) → 'RM 1.2M';
 * formatMoney(1234.5, 'SGD', { decimals: 2 }) → 'SGD 1,234.50'. `decimals` is the fixed number of
 * decimals (default 0) or, when compact, the maximum (default 1). Null/NaN/Infinity → '—'.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string | null | undefined = "MYR",
  opts: { compact?: boolean; decimals?: number } = {},
): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_DISPLAY;
  const symbol = currencySymbol(currency);
  const abs = Math.abs(n);
  const body = opts.compact
    ? compactNumber(abs, clampDecimals(opts.decimals, 1))
    : fixedGrouped(abs, clampDecimals(opts.decimals, 0));
  const negative = n < 0 && !isZeroText(body.replace(/[KMBT]$/, ""));
  return `${negative ? "-" : ""}${symbol} ${body}`;
}

/**
 * A value that is already a percentage: formatPct(45) → '45.0%'; formatPct(-4.04, 1) → '-4.0%'.
 * `signed: true` adds '+' to positive values (for growth/Δ columns). Null/NaN/Infinity → '—'.
 */
export function formatPct(value: number | null | undefined, decimals = 1, opts: { signed?: boolean } = {}): string {
  const n = toFiniteNumber(value);
  if (n === null) return EMPTY_DISPLAY;
  return `${signed(n, fixedGrouped(Math.abs(n), clampDecimals(decimals, 1)), opts.signed)}%`;
}

/**
 * Runway in months: '4.2 months'; 'Cash-flow positive' when burn is 0; '—' when unknown.
 * Truncated (not rounded) to one decimal, so 5.96 shows as '5.9 months' and never looks like it meets a
 * 6-month minimum it misses.
 */
export function formatRunway(months: number | null | undefined, opts: { cashflowPositive?: boolean } = {}): string {
  if (opts.cashflowPositive) return "Cash-flow positive";
  const n = toFiniteNumber(months);
  if (n === null) return EMPTY_DISPLAY;
  const truncated = Math.floor(Math.abs(n) * 10 + 1e-9) / 10; // tiny epsilon absorbs float noise (0.3 stays 0.3)
  return `${formatNumber(n < 0 ? -truncated : truncated, 1)} months`;
}

/** File size with binary units: 2048 → '2 KB', 26214400 → '25 MB'. */
export function formatFileSize(bytes: number | null | undefined): string {
  const n = toFiniteNumber(bytes);
  if (n === null || n < 0) return EMPTY_DISPLAY;
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = n / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${trimFraction(size.toFixed(size < 10 ? 1 : 0))} ${units[i]}`;
}

// ---------------------------------------------------------------------------------------------
// Dates (Malaysia time)
// ---------------------------------------------------------------------------------------------

type DateInput = InstantInput | null | undefined;

function instant(value: DateInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  return parseInstant(value);
}

function isDateOnly(value: DateInput): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(value.trim());
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * '2026-09-30' → '30 Sep 2026'. Timestamps are converted to Malaysia time first
 * ('2026-09-30T16:30:00Z' → '1 Oct 2026'). Invalid or empty → '—'.
 */
export function formatDate(value: DateInput): string {
  const ms = instant(value);
  if (ms === null) return EMPTY_DISPLAY;
  const p = mytParts(ms);
  return `${p.day} ${MONTH_NAMES_SHORT[p.month - 1]} ${p.year}`;
}

/** Timestamp → '30 Sep 2026, 14:05' (24-hour, Malaysia time). A date-only value is shown as formatDate. */
export function formatDateTime(value: DateInput): string {
  if (isDateOnly(value)) return formatDate(value);
  const ms = instant(value);
  if (ms === null) return EMPTY_DISPLAY;
  const p = mytParts(ms);
  return `${p.day} ${MONTH_NAMES_SHORT[p.month - 1]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Timestamp → '14:05' (Malaysia time), e.g. for "Saved 14:05". */
export function formatTime(value: DateInput): string {
  const ms = instant(value);
  if (ms === null) return EMPTY_DISPLAY;
  const p = mytParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function unitText(n: number, unit: string, past: boolean): string {
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return past ? `${text} ago` : `in ${text}`;
}

/**
 * Relative time against `now` (default: current time), in Malaysia calendar days:
 * 'just now' (under 45 s), '5 minutes ago', 'in 2 hours' (same day, or under 6 hours), 'yesterday',
 * 'tomorrow', '3 days ago', 'in 4 days'; 7+ days away → the date ('12 Aug 2026').
 * Date-only values ('2026-10-15') use whole days and 'today'.
 * Depends on the clock, so render it in client components (or accept a server/client difference).
 */
export function formatRelative(value: DateInput, now: InstantInput = Date.now()): string {
  const ms = instant(value);
  if (ms === null) return EMPTY_DISPLAY;
  const nowMs = parseInstant(now) ?? Date.now();
  const days = daysBetween(toMYTDate(nowMs), toMYTDate(ms));
  if (isDateOnly(value)) {
    if (days === 0) return "today";
  } else {
    const seconds = (ms - nowMs) / 1000;
    const abs = Math.abs(seconds);
    if (abs < 45) return "just now";
    if (abs < 3600) return unitText(Math.max(1, Math.floor(abs / 60)), "minute", seconds < 0);
    // Hours on the same day, or within 6 hours across midnight ("1 hour ago" at 00:30, not "yesterday").
    if (days === 0 || abs < 6 * 3600) return unitText(Math.floor(abs / 3600), "hour", seconds < 0);
  }
  if (days === -1) return "yesterday";
  if (days === 1) return "tomorrow";
  if (Math.abs(days) < 7) return unitText(Math.abs(days), "day", days < 0);
  return formatDate(ms);
}

// ---------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------

// Digits with optional thousands separators in the right places, optional decimals: '1,234.50', '1234', '.5', '5.'
const NUMBER_BODY_RE = /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/;
// Currency prefix: 'RM' / 'MYR' (any case) or an upper-case ISO code ('SGD').
const CURRENCY_PREFIX_RE = /^(?:[Rr][Mm]|[Mm][Yy][Rr]|[A-Z]{3})(?![A-Za-z])/;

/**
 * Parses what a person types into a number box. Accepts thousands separators, a currency prefix,
 * a leading minus/plus (before or after the currency) and accounting parentheses:
 * '1,234.50' → 1234.5 · 'RM 1,234.50' → 1234.5 · '(1,000)' → -1000 · '-RM 500' → -500 · ' 12 ' → 12.
 * Returns null for empty or invalid input, e.g. '1e3', '1.2.3', '--5', '(-5)', '1,23', '12 345', 'abc'.
 * A comma is only accepted as a thousands separator, so '1234,50' is rejected rather than read as 123450.
 */
export function parseNumberInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw + 0 : null;
  let s = String(raw)
    .trim()
    .replace(/[\u2212\u2013]/g, "-"); // true minus sign (U+2212) / en dash (U+2013) pasted from documents
  if (s === "") return null;

  let parens = false;
  const takeParens = () => {
    if (!parens && s.startsWith("(") && s.endsWith(")")) {
      parens = true;
      s = s.slice(1, -1).trim();
    }
  };
  let sign = "";
  const takeSign = () => {
    if (sign === "" && (s.startsWith("-") || s.startsWith("+"))) {
      sign = s[0];
      s = s.slice(1).trimStart();
    }
  };
  takeParens();
  takeSign();
  const currency = CURRENCY_PREFIX_RE.exec(s);
  if (currency) s = s.slice(currency[0].length).trimStart();
  takeParens();
  takeSign();

  if (!NUMBER_BODY_RE.test(s)) return null;
  if (parens && sign !== "") return null; // '(-5)' and '(+5)' are ambiguous
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const negative = parens || sign === "-";
  return negative ? (n === 0 ? 0 : -n) : n;
}
