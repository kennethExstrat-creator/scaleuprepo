// Financial metrics, period totals and review auto-flags (docs/ARCHITECTURE.md §5.4, BRD §6.1 and A7).
// Pure and null-safe: every function returns a finite number or null — never NaN or Infinity.

import { CRITICAL_RUNWAY_MONTHS, DEFAULT_MIN_RUNWAY_MONTHS, DEFAULT_REVENUE_SWING_PCT } from "@/lib/constants";
import { formatMoney, formatNumberTrimmed, formatPct, formatRunway, toFiniteNumber } from "@/lib/format";
import { dateToMonthKey, monthDiff, monthLabel, parseMonthKey } from "@/lib/periods";

/** One month's core numbers (the system fields). `month` is 'YYYY-MM' or 'YYYY-MM-DD'. */
export type MonthlyFinancials = {
  month: string;
  revenue_total: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  cash_in_bank: number | null;
  burn_rate: number | null;
  headcount_ft: number | null;
  headcount_pt: number | null;
};

/**
 * Quarter/half totals (also the shape of `period_closes.computed_totals`, computed in SQL on confirmation).
 * See periodTotals for the exact semantics of each key.
 */
export type PeriodTotals = {
  months_count: number;
  revenue_total: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  gp_pct: number | null;
  np_pct: number | null;
  /** Period end: the last month present. */
  cash_in_bank: number | null;
  /** Mean monthly burn over the months that have a burn figure. */
  avg_burn_rate: number | null;
  /** Period end: the last month present. */
  headcount_ft: number | null;
  /** Period end: the last month present. */
  headcount_pt: number | null;
};

export type FlagCode = "revenue_swing" | "low_runway" | "missing_required" | "negative_cash" | "segments_exceed_total";
export type FlagSeverity = "warning" | "critical";
export type Flag = { code: FlagCode; severity: FlagSeverity; message: string };

const num = toFiniteNumber;

/** Percentage numerator / denominator × 100; null when either is missing or the denominator is 0. */
function ratioPct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const result = (numerator * 100) / denominator; // multiply first: 30 × 100 / 100 is exactly 30
  return Number.isFinite(result) ? result + 0 : null;
}

// ---------------------------------------------------------------------------------------------
// Single-month metrics
// ---------------------------------------------------------------------------------------------

/** Gross margin % = gross profit / revenue × 100. Null when revenue is 0 or either figure is missing. */
export function gpPct(f: Pick<MonthlyFinancials, "revenue_total" | "gross_profit"> | null | undefined): number | null {
  if (!f) return null;
  return ratioPct(num(f.gross_profit), num(f.revenue_total));
}

/** Net margin % = net profit / revenue × 100. Null when revenue is 0 or either figure is missing. */
export function npPct(f: Pick<MonthlyFinancials, "revenue_total" | "net_profit"> | null | undefined): number | null {
  if (!f) return null;
  return ratioPct(num(f.net_profit), num(f.revenue_total));
}

/**
 * True when the month's burn rate is known and 0 (or below): the company is cash-flow positive and has no
 * runway figure (BRD: "Burn rate … 0 if cash-flow positive").
 */
export function isCashflowPositive(f: Pick<MonthlyFinancials, "burn_rate"> | null | undefined): boolean {
  if (!f) return false;
  const burn = num(f.burn_rate);
  return burn !== null && burn <= 0;
}

/**
 * Runway in months = cash in bank / monthly burn, when burn > 0. Null when burn is 0 (cash-flow positive —
 * check isCashflowPositive) or when cash or burn is missing. Negative cash gives 0 (no runway left).
 */
export function runwayMonths(f: Pick<MonthlyFinancials, "cash_in_bank" | "burn_rate"> | null | undefined): number | null {
  if (!f) return null;
  const cash = num(f.cash_in_bank);
  const burn = num(f.burn_rate);
  if (cash === null || burn === null || burn <= 0) return null;
  const months = cash / burn;
  return Number.isFinite(months) ? Math.max(0, months) : null;
}

/**
 * Growth % = (curr − prev) / |prev| × 100, e.g. 100 → 150 is 50, -100 → -50 is 50 (an improvement).
 * Null when prev is 0 or missing, or curr is missing. Used for MoM, QoQ, HoH and YoY.
 */
export function growthPct(curr: number | null | undefined, prev: number | null | undefined): number | null {
  const c = num(curr);
  const p = num(prev);
  if (c === null || p === null || p === 0) return null;
  const result = ((c - p) * 100) / Math.abs(p);
  return Number.isFinite(result) ? result + 0 : null;
}

/** Derived figures for one month (live form preview, company home, review). */
export function deriveMetrics(f: MonthlyFinancials | null | undefined): {
  gp_pct: number | null;
  np_pct: number | null;
  runway_months: number | null;
  cashflow_positive: boolean;
} {
  return { gp_pct: gpPct(f), np_pct: npPct(f), runway_months: runwayMonths(f), cashflow_positive: isCashflowPositive(f) };
}

/**
 * Builds MonthlyFinancials from submission values keyed by field key. Each entry may be a stored row
 * (`{ value_number }`) or a bare number/null (e.g. live form state).
 */
export function financialsFromValues(month: string, values: Record<string, unknown> | null | undefined): MonthlyFinancials {
  const read = (key: string): number | null => {
    const v = values?.[key];
    if (v !== null && typeof v === "object" && "value_number" in v) {
      return num((v as { value_number: unknown }).value_number);
    }
    return num(v);
  };
  return {
    month,
    revenue_total: read("revenue_total"),
    gross_profit: read("gross_profit"),
    net_profit: read("net_profit"),
    cash_in_bank: read("cash_in_bank"),
    burn_rate: read("burn_rate"),
    headcount_ft: read("headcount_ft"),
    headcount_pt: read("headcount_pt"),
  };
}

// ---------------------------------------------------------------------------------------------
// Period totals
// ---------------------------------------------------------------------------------------------

function round4(x: number): number {
  return Number(x.toFixed(4)) + 0; // + 0 turns -0 into 0
}

/** Sum of the non-null values (null when there are none), exact to 4 decimals (no 0.1 + 0.2 noise). */
function sumPresent(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  if (present.every((v) => Math.abs(v) < 1e10)) {
    let scaled = 0;
    for (const v of present) scaled += Math.round(v * 1e4); // DB values have at most 4 decimals
    return scaled / 1e4 + 0;
  }
  return round4(present.reduce((a, b) => a + b, 0));
}

/**
 * Totals for a quarter or half from its monthly figures (BRD §6.1: flows summed; cash and headcount at
 * period end; burn as the average monthly burn). Pass only the months that should count — e.g. approved
 * months for LP-facing figures — and read `months_count` to know how many were present.
 *
 * - `months_count`: number of distinct months passed in (duplicates of a month: the last entry wins).
 * - `revenue_total`, `gross_profit`, `net_profit`: sums over the months present, skipping months where the
 *   figure is blank; null when no month has it.
 * - `gp_pct`, `np_pct`: from the sums (Σ GP / Σ revenue × 100), not an average of monthly margins, rounded to 4
 *   decimals like the SQL `computed_totals` (46.6667 means 46.67 %); null when Σ revenue is 0 or missing.
 * - `cash_in_bank`, `headcount_ft`, `headcount_pt`: taken from the latest month present (period end); null
 *   when that month's figure is blank (no fallback to an earlier month).
 * - `avg_burn_rate`: mean of the monthly burn figures that are present (Σ burn / number of months with a burn).
 */
export function periodTotals(months: ReadonlyArray<MonthlyFinancials>): PeriodTotals {
  const byMonth = new Map<string, MonthlyFinancials>();
  for (const m of months) byMonth.set(dateToMonthKey(m.month), m);
  const keys = Array.from(byMonth.keys()).sort();
  const rows = keys.map((k) => byMonth.get(k) as MonthlyFinancials);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;

  const revenue = sumPresent(rows.map((r) => num(r.revenue_total)));
  const gross = sumPresent(rows.map((r) => num(r.gross_profit)));
  const net = sumPresent(rows.map((r) => num(r.net_profit)));
  const burns = rows.map((r) => num(r.burn_rate)).filter((v): v is number => v !== null);
  const burnSum = sumPresent(burns);
  const pct = (numerator: number | null): number | null => {
    const result = ratioPct(numerator, revenue);
    return result === null ? null : round4(result);
  };

  return {
    months_count: rows.length,
    revenue_total: revenue,
    gross_profit: gross,
    net_profit: net,
    gp_pct: pct(gross),
    np_pct: pct(net),
    cash_in_bank: last ? num(last.cash_in_bank) : null,
    avg_burn_rate: burnSum === null ? null : round4(burnSum / burns.length),
    headcount_ft: last ? num(last.headcount_ft) : null,
    headcount_pt: last ? num(last.headcount_pt) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Auto-flags (review A7)
// ---------------------------------------------------------------------------------------------

export type FlagSettings = {
  /** Flag when |month-on-month revenue change| exceeds this percentage (default 30). */
  revenue_swing_pct?: number | null;
  /** Flag when runway is below this many months (default 6). */
  min_runway_months?: number | null;
};

export type ComputeFlagsInput = {
  current: MonthlyFinancials;
  /** The prior month (for the month-on-month revenue swing). */
  previous?: MonthlyFinancials | null;
  /** Accepted for the review page's convenience; not used for flags (YoY swings are normal for growth companies). */
  sameMonthLastYear?: MonthlyFinancials | null;
  /** `platform_settings` row or just the two thresholds; missing/negative values fall back to the defaults. */
  settings?: FlagSettings | null;
  /** Validation issues (client or `get_submission_validation`); issues with code 'required' raise missing_required. */
  validationErrors?: ReadonlyArray<{ code: string }> | null;
  /**
   * Optional (BRD B30): the month's ScaleUp revenue lines added up, e.g.
   * `sumSegmentAmounts(segmentsForMonth(bundle.config, bundle.current, editable).scaleup, bundle.current.segments)`
   * (src/lib/types/domain.ts). They need not add up to total revenue, but more than total revenue raises
   * the `segments_exceed_total` warning. Omitted or null: no such flag.
   */
  scaleupLinesTotal?: number | null;
  /** Reporting currency for money in messages (default MYR → "RM"). */
  currency?: string | null;
};

function thresholdOr(value: unknown, fallback: number): number {
  const n = num(value);
  return n === null || n < 0 ? fallback : n;
}

/** An amount as an exact integer of 1/10,000ths (database amounts have at most 4 decimals). */
function toScaled(value: number): number {
  return Math.round(value * 1e4);
}

function labelOf(month: string, fallback: string): string {
  const key = parseMonthKey(month);
  return key ? monthLabel(key) : fallback;
}

const SEVERITY_ORDER: Record<FlagSeverity, number> = { critical: 0, warning: 1 };

/**
 * Review auto-flags for a month, critical first:
 * - `missing_required` (critical): validation issues with code 'required' are present.
 * - `negative_cash` (critical): cash in bank < 0.
 * - `low_runway`: runway < `min_runway_months` (warning), critical below 3 months. Not raised when the
 *   company is cash-flow positive (burn 0), when cash/burn is missing, or when cash is negative
 *   (negative_cash covers that).
 * - `revenue_swing`: |month-on-month revenue change| > `revenue_swing_pct` (strictly greater; warning),
 *   critical above twice the threshold. Needs `previous` (the prior month) with non-zero revenue; the message
 *   names both months and only says "month on month" when they are consecutive.
 * - `segments_exceed_total` (warning, BRD B30): `scaleupLinesTotal` (the ScaleUp revenue lines added up) is
 *   more than total revenue. Not raised when either figure is missing. It never blocks anything.
 */
export function computeFlags(input: ComputeFlagsInput): Flag[] {
  const { current, previous, settings, validationErrors } = input;
  const currency = input.currency ?? "MYR";
  const money = (v: number) => formatMoney(v, currency);
  const flags: Flag[] = [];

  const missing = (validationErrors ?? []).filter((issue) => issue.code === "required").length;
  if (missing > 0) {
    flags.push({
      code: "missing_required",
      severity: "critical",
      message: `${missing} required ${missing === 1 ? "value is" : "values are"} missing.`,
    });
  }

  const cash = num(current.cash_in_bank);
  if (cash !== null && cash < 0) {
    flags.push({ code: "negative_cash", severity: "critical", message: `Cash in bank is negative (${money(cash)}).` });
  }

  const minRunway = thresholdOr(settings?.min_runway_months, DEFAULT_MIN_RUNWAY_MONTHS);
  const runway = runwayMonths(current);
  const burn = num(current.burn_rate);
  if (cash !== null && cash >= 0 && burn !== null && runway !== null && runway < minRunway) {
    const critical = runway < CRITICAL_RUNWAY_MONTHS;
    flags.push({
      code: "low_runway",
      severity: critical ? "critical" : "warning",
      message:
        `${critical ? "Runway is critically low at" : "Runway is"} ${formatRunway(runway)} ` +
        `(${money(cash)} cash at ${money(burn)} monthly burn), below the ${formatNumberTrimmed(minRunway, 2)}-month minimum.`,
    });
  }

  const swingPct = thresholdOr(settings?.revenue_swing_pct, DEFAULT_REVENUE_SWING_PCT);
  const currRevenue = num(current.revenue_total);
  const prevRevenue = previous ? num(previous.revenue_total) : null;
  const change = growthPct(currRevenue, prevRevenue);
  if (previous && change !== null && currRevenue !== null && prevRevenue !== null && Math.abs(change) > swingPct) {
    const critical = Math.abs(change) > 2 * swingPct;
    const prevKey = parseMonthKey(previous.month);
    const currKey = parseMonthKey(current.month);
    const consecutive = prevKey !== null && currKey !== null && monthDiff(prevKey, currKey) === 1;
    flags.push({
      code: "revenue_swing",
      severity: critical ? "critical" : "warning",
      message:
        `Revenue ${change > 0 ? "rose" : "fell"} ${formatPct(Math.abs(change), 1)}${consecutive ? " month on month" : ""} ` +
        `(${money(prevRevenue)} in ${labelOf(previous.month, "the previous month")} to ${money(currRevenue)} in ` +
        `${labelOf(current.month, "this month")}), ${critical ? "more than twice" : "above"} the ` +
        `${formatNumberTrimmed(swingPct, 2)}% swing threshold.`,
    });
  }

  const lines = num(input.scaleupLinesTotal);
  if (lines !== null && currRevenue !== null && toScaled(lines) > toScaled(currRevenue)) {
    flags.push({
      code: "segments_exceed_total",
      severity: "warning",
      message: `The ScaleUp revenue lines add up to ${money(lines)}, more than total revenue (${money(currRevenue)}).`,
    });
  }

  return flags
    .map((flag, i) => ({ flag, i }))
    .sort((a, b) => SEVERITY_ORDER[a.flag.severity] - SEVERITY_ORDER[b.flag.severity] || a.i - b.i)
    .map(({ flag }) => flag);
}
