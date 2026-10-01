// Display text for the review page's comparison cells (see ./comparison). Pure and client-safe.
import {
  EMPTY_DISPLAY,
  formatMoney,
  formatNumber,
  formatNumberTrimmed,
  formatPct,
  formatRunway,
} from "@/lib/format";

import type { ChangeKind, ComparisonRow, ComparisonValue } from "./comparison";

function withUnit(text: string, unit: string | null): string {
  return unit ? `${text} ${unit}` : text;
}

/** A value of a comparison row: money in the company's currency, percentages, runway, yes/no, text. */
export function formatComparisonValue(
  row: Pick<ComparisonRow, "kind" | "unit">,
  value: ComparisonValue,
  currency: string,
  options: { cashflowPositive?: boolean } = {},
): string {
  if (row.kind === "runway") {
    return formatRunway(typeof value === "number" ? value : null, { cashflowPositive: options.cashflowPositive });
  }
  if (value === null || value === "") return EMPTY_DISPLAY;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  switch (row.kind) {
    case "money":
      return formatMoney(value, currency);
    case "percent":
      return formatPct(value, 1);
    case "integer":
    case "number":
      return withUnit(formatNumberTrimmed(value, 2), row.unit);
    default:
      return String(value);
  }
}

function signedDifference(change: number, decimals: number, suffix: string): string {
  const body = formatNumber(Math.abs(change), decimals);
  const zero = /^[0.,]+$/.test(body);
  const sign = zero ? "" : change > 0 ? "+" : "-";
  return `${sign}${body}${suffix}`;
}

/** A change: '+12.5%' (growth), '+5.0 pp' (percentage points), '-1.2 months' (runway), '—' when unknown. */
export function formatChange(changeKind: ChangeKind, change: number | null): string {
  if (change === null || !Number.isFinite(change)) return EMPTY_DISPLAY;
  switch (changeKind) {
    case "growth":
      return formatPct(change, 1, { signed: true });
    case "points":
      return signedDifference(change, 1, " pp");
    case "months":
      return signedDifference(change, 1, " months");
    default:
      return EMPTY_DISPLAY;
  }
}

/** Direction of a change for an arrow icon (null when unknown or no change at display precision). */
export function changeDirection(change: number | null): "up" | "down" | null {
  if (change === null || !Number.isFinite(change) || Math.abs(change) < 0.05) return null;
  return change > 0 ? "up" : "down";
}

/** Accessible description of a change, e.g. "up 12.5% on Aug 2026". */
export function describeChange(changeKind: ChangeKind, change: number | null, against: string): string {
  if (change === null) return `No comparison with ${against}`;
  const direction = changeDirection(change);
  const text = formatChange(changeKind, change).replace(/^[+-]/, "");
  if (direction === null) return `No change on ${against}`;
  return `${direction === "up" ? "Up" : "Down"} ${text} on ${against}`;
}
