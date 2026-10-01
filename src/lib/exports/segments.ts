// Revenue segment rules shared by the exports (BRD §6.1 and B30; docs/ARCHITECTURE.md §5.5
// `segmentsForMonth`, §6 "(B30) Monthly form"). Pure and client-safe.
//
// A month still open for changes (draft, changes requested) follows the company's CURRENT segments, as
// the monthly form shows it: only the figures of the segments in use, and — when the company has revenue
// segments of its own — total revenue calculated from them. A submitted or approved month keeps exactly
// the figures it was submitted with (retired segments included) and its stored total, which was checked
// against its segments when it was submitted.
import { toFiniteNumber } from "@/lib/format";
import { sumSegmentAmounts } from "@/lib/types/domain";
import type { SubmissionStatus } from "@/lib/types/enums";

/** A month's status and its segment figures by segment id (either kind). */
export type MonthSegmentFigures = {
  status: SubmissionStatus;
  segments: Readonly<Record<string, number | null | undefined>>;
};

const OPEN_STATUSES: readonly SubmissionStatus[] = ["draft", "changes_requested"];

/** True for a month still open for changes (draft, changes requested). */
export function isOpenForChanges(status: SubmissionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * The segment figures a month shows, as `segmentsForMonth` decides (BRD B30): a submitted or approved
 * month keeps exactly the figures it was submitted with, retired segments included; a month still open
 * for changes follows the current segments (`activeSegmentIds`, both kinds), so a figure left on a retired
 * one is not shown.
 */
export function shownSegmentAmounts(
  month: MonthSegmentFigures,
  activeSegmentIds: ReadonlySet<string>,
): Record<string, number> {
  const open = isOpenForChanges(month.status);
  const shown: Record<string, number> = {};
  for (const [id, amount] of Object.entries(month.segments)) {
    const value = toFiniteNumber(amount);
    if (value === null || (open && !activeSegmentIds.has(id))) continue;
    shown[id] = value;
  }
  return shown;
}

/** The total revenue a month shows (shownRevenueTotal). */
export type ShownRevenueTotal = {
  total: number | null;
  /**
   * True when `total` is a figure entered before any of the company's own segments was filled in (an
   * open month whose segments are all still empty): the monthly form keeps it until a segment is filled
   * in and then replaces it with their sum.
   */
  enteredEarlier: boolean;
};

/**
 * The total revenue a month shows (BRD B30), mirroring the monthly form. While a month is open for
 * changes and the company has revenue segments of its own (`companySegmentIds`: its ACTIVE segments of
 * kind 'company'), total revenue is the sum of their amounts — calculated exactly like the form
 * (`sumSegmentAmounts`), which saves it with the next change. The stored figure can be out of date: when
 * the owner removes or renames a segment, its figures in open months are cleared or moved, but their
 * stored total is not recalculated until the month is next saved. As in the form, a stored total is kept
 * while none of the segments has an amount yet (`enteredEarlier`). Every other month shows its stored
 * total. ScaleUp revenue lines never count towards total revenue.
 */
export function shownRevenueTotal(
  month: MonthSegmentFigures,
  storedTotal: number | null,
  companySegmentIds: readonly string[],
): ShownRevenueTotal {
  const stored = toFiniteNumber(storedTotal);
  if (!isOpenForChanges(month.status) || companySegmentIds.length === 0) return { total: stored, enteredEarlier: false };
  const calculated = sumSegmentAmounts(
    companySegmentIds.map((id) => ({ id })),
    month.segments,
  );
  if (calculated !== null) return { total: calculated, enteredEarlier: false };
  return { total: stored, enteredEarlier: stored !== null };
}

/** The note on a total revenue figure entered before the company's own segments were filled in. */
export const ENTERED_EARLIER_TOTAL_NOTE =
  "Entered before the revenue segments were filled in. Once they are, total revenue is their sum.";
