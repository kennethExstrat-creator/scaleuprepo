// Period-close totals and restatements (docs/ARCHITECTURE.md §2.2 period_closes, §2.4 confirm_period_close,
// §5.4 PeriodTotals). Pure and client-safe: used by the close cards, the confirm dialog and the confirm
// action.
//
// `computed_totals` is the PeriodTotals snapshot the database stores on confirmation. `restated_totals`
// is a subset of the same keys (months_count excluded): the figures the company restated to match its
// management accounts. People restate the amounts and headcounts; the gross and net margins follow
// from the (restated) revenue and profit, so they are derived here rather than typed in.

import { formatMoney, formatNumber, formatPct, toFiniteNumber } from "@/lib/format";
import type { PeriodTotals } from "@/lib/metrics";

/** PeriodTotals keys that can be restated (the database accepts exactly these). */
export type RestatableKey = Exclude<keyof PeriodTotals, "months_count">;

export const RESTATABLE_KEYS = [
  "revenue_total",
  "gross_profit",
  "net_profit",
  "gp_pct",
  "np_pct",
  "cash_in_bank",
  "avg_burn_rate",
  "headcount_ft",
  "headcount_pt",
] as const satisfies readonly RestatableKey[];

/** The figures a person restates; the margins are derived from them. */
export type EditableFigureKey = Exclude<RestatableKey, "gp_pct" | "np_pct">;

export const EDITABLE_FIGURE_KEYS = [
  "revenue_total",
  "gross_profit",
  "net_profit",
  "cash_in_bank",
  "avg_burn_rate",
  "headcount_ft",
  "headcount_pt",
] as const satisfies readonly EditableFigureKey[];

/** Restated figures as stored (values may be null in the database's contract, never from this app). */
export type RestatedTotals = Partial<Record<RestatableKey, number | null>>;

/** Figures entered in the confirm dialog (only the ones being restated). */
export type EnteredFigures = Partial<Record<EditableFigureKey, number | null>>;

export type FigureKind = "money" | "percent" | "count";

/** A period figure; `derived` ones (the margins) are shown, never typed in. */
export type FigureDefinition =
  | { key: EditableFigureKey; label: string; kind: FigureKind; derived: false }
  | { key: Exclude<RestatableKey, EditableFigureKey>; label: string; kind: "percent"; derived: true };

const FIGURE_LABELS: Record<RestatableKey, string> = {
  revenue_total: "Revenue",
  gross_profit: "Gross profit",
  gp_pct: "Gross margin",
  net_profit: "Net profit",
  np_pct: "Net margin",
  cash_in_bank: "Cash at period end",
  avg_burn_rate: "Average monthly burn",
  headcount_ft: "Full-time headcount",
  headcount_pt: "Part-time headcount",
};

/** The period figures in display order (BRD §6.1: flows summed, cash and headcount at period end, average burn). */
export const PERIOD_FIGURES: readonly FigureDefinition[] = [
  { key: "revenue_total", label: FIGURE_LABELS.revenue_total, kind: "money", derived: false },
  { key: "gross_profit", label: FIGURE_LABELS.gross_profit, kind: "money", derived: false },
  { key: "gp_pct", label: FIGURE_LABELS.gp_pct, kind: "percent", derived: true },
  { key: "net_profit", label: FIGURE_LABELS.net_profit, kind: "money", derived: false },
  { key: "np_pct", label: FIGURE_LABELS.np_pct, kind: "percent", derived: true },
  { key: "cash_in_bank", label: FIGURE_LABELS.cash_in_bank, kind: "money", derived: false },
  { key: "avg_burn_rate", label: FIGURE_LABELS.avg_burn_rate, kind: "money", derived: false },
  { key: "headcount_ft", label: FIGURE_LABELS.headcount_ft, kind: "count", derived: false },
  { key: "headcount_pt", label: FIGURE_LABELS.headcount_pt, kind: "count", derived: false },
];

/** The display label of a figure ("Revenue", "Gross margin", …). */
export function figureLabel(key: RestatableKey): string {
  return FIGURE_LABELS[key];
}

/** A figure as text: money in the company's currency ('RM 1,234'), margins '46.7%', headcounts '12'; '—' when unknown. */
export function formatFigure(kind: FigureKind, value: number | null | undefined, currency: string): string {
  if (kind === "money") return formatMoney(value, currency);
  if (kind === "percent") return formatPct(value, 1);
  return formatNumber(value, 0);
}

/** Figures that cannot be negative (like the monthly numbers they come from, §2.6 rule 3). */
const NON_NEGATIVE_FIGURES: ReadonlySet<RestatableKey> = new Set<RestatableKey>([
  "revenue_total",
  "cash_in_bank",
  "avg_burn_rate",
  "headcount_ft",
  "headcount_pt",
]);

/** Figures that must be whole numbers. */
const WHOLE_NUMBER_FIGURES: ReadonlySet<RestatableKey> = new Set<RestatableKey>(["headcount_ft", "headcount_pt"]);

/** Largest magnitude accepted for a figure (the monthly values' limit, §2.4 save_submission_values). */
export const MAX_FIGURE_ABS = 1e15;

/** Longest reason accepted for a restatement or a reopen. */
export const REASON_MAX_LENGTH = 2000;

/**
 * Why a restated figure is not acceptable, or null when it is: finite and below 1e15 in magnitude, not
 * negative for revenue, cash, burn and headcounts, a whole number for headcounts.
 */
export function figureIssue(key: EditableFigureKey, value: number): string | null {
  const label = figureLabel(key);
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_FIGURE_ABS) return `${label} is too large.`;
  if (NON_NEGATIVE_FIGURES.has(key) && value < 0) return `${label} cannot be negative.`;
  if (WHOLE_NUMBER_FIGURES.has(key) && !Number.isInteger(value)) return `${label} must be a whole number.`;
  return null;
}

/** Totals of a period with no months (every figure unknown). */
export function emptyPeriodTotals(): PeriodTotals {
  return {
    months_count: 0,
    revenue_total: null,
    gross_profit: null,
    net_profit: null,
    gp_pct: null,
    np_pct: null,
    cash_in_bank: null,
    avg_burn_rate: null,
    headcount_ft: null,
    headcount_pt: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `period_closes.computed_totals` (jsonb) → PeriodTotals; null when it is not an object (e.g. an open
 * close). Missing or non-numeric figures become null; numeric strings are accepted.
 */
export function parsePeriodTotals(value: unknown): PeriodTotals | null {
  if (!isPlainObject(value)) return null;
  const totals = emptyPeriodTotals();
  const count = toFiniteNumber(value.months_count);
  totals.months_count = count === null ? 0 : Math.max(0, Math.trunc(count));
  for (const key of RESTATABLE_KEYS) totals[key] = toFiniteNumber(value[key]);
  return totals;
}

/**
 * `period_closes.restated_totals` (jsonb) → the restated figures (known keys only; a JSON null stays
 * null); null when it is not an object or holds no known key.
 */
export function parseRestatedTotals(value: unknown): RestatedTotals | null {
  if (!isPlainObject(value)) return null;
  const restated: RestatedTotals = {};
  for (const key of RESTATABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) restated[key] = toFiniteNumber(value[key]);
  }
  return Object.keys(restated).length > 0 ? restated : null;
}

function round4(value: number): number {
  return Number(value.toFixed(4)) + 0; // + 0 turns -0 into 0
}

/** Two figures are the same when both are unknown or they agree to 4 decimals (the stored precision). */
export function sameFigure(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null || y === null) return x === y;
  return round4(x) === round4(y);
}

/** numerator / denominator × 100 to 4 decimals; null when either is unknown or the denominator is 0. */
function percentage(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const result = (numerator * 100) / denominator;
  return Number.isFinite(result) ? round4(result) : null;
}

/**
 * The `restated_totals` to store for the figures entered in the confirm dialog:
 * - every entered figure that differs from the calculated one (compared to 4 decimals; blanks and
 *   unchanged figures are left out), rounded to 4 decimals;
 * - when revenue, gross profit or net profit is restated, the gross and net margins recomputed from the
 *   effective (restated or calculated) figures — each only when it changes.
 * Null when nothing differs (no restatement, so no reason is needed).
 */
export function deriveRestatement(computed: PeriodTotals, entered: EnteredFigures | null | undefined): RestatedTotals | null {
  const restated: RestatedTotals = {};
  for (const key of EDITABLE_FIGURE_KEYS) {
    const value = entered?.[key];
    if (value === undefined || value === null || !Number.isFinite(value)) continue;
    const rounded = round4(value);
    if (!sameFigure(rounded, computed[key])) restated[key] = rounded;
  }
  const flowsRestated =
    restated.revenue_total !== undefined || restated.gross_profit !== undefined || restated.net_profit !== undefined;
  if (flowsRestated) {
    const revenue = restated.revenue_total ?? computed.revenue_total;
    const gpPct = percentage(restated.gross_profit ?? computed.gross_profit, revenue);
    const npPct = percentage(restated.net_profit ?? computed.net_profit, revenue);
    if (!sameFigure(gpPct, computed.gp_pct)) restated.gp_pct = gpPct;
    if (!sameFigure(npPct, computed.np_pct)) restated.np_pct = npPct;
  }
  return Object.keys(restated).length > 0 ? restated : null;
}

/** The totals as confirmed: the calculated figures with the restated ones laid over them. */
export function effectiveTotals(computed: PeriodTotals, restated: RestatedTotals | null | undefined): PeriodTotals {
  if (!restated) return { ...computed };
  const result: PeriodTotals = { ...computed };
  for (const key of RESTATABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(restated, key)) result[key] = restated[key] ?? null;
  }
  return result;
}

/** True when a restatement holds at least one figure. */
export function hasRestatement(restated: RestatedTotals | null | undefined): restated is RestatedTotals {
  return restated !== null && restated !== undefined && Object.keys(restated).length > 0;
}
