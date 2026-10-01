// Ordering of a company's configuration rows (revenue lines, KPIs, dimension members). They are shown
// like the data layer sorts them (src/lib/data/shared.ts sortConfigRows): active first, then
// `sort_order`, then name. Moving a row swaps it with its neighbour in that order (only within the
// active or the inactive group) and renumbers the list in steps of 10, so ties from seeded rows
// disappear. Pure; unit-tested in tests/features/m1/reorder.test.ts.

export type SortableRow = { id: string; name: string; sort_order: number; is_active: boolean };
export type MoveDirection = "up" | "down";
export type SortOrderUpdate = { id: string; sort_order: number };

export const SORT_STEP = 10;

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rows in display order: active first, then `sort_order`, then name, then id. */
export function inDisplayOrder<T extends SortableRow>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      a.sort_order - b.sort_order ||
      compareNames(a.name, b.name) ||
      compareIds(a.id, b.id),
  );
}

/** True when the row can move one place up or down (not past the edge of its active/inactive group). */
export function canMove(rows: readonly SortableRow[], id: string, direction: MoveDirection): boolean {
  const ordered = inDisplayOrder(rows);
  const index = ordered.findIndex((row) => row.id === id);
  if (index < 0) return false;
  const target = direction === "up" ? index - 1 : index + 1;
  return target >= 0 && target < ordered.length && ordered[target].is_active === ordered[index].is_active;
}

/**
 * The `sort_order` updates that move the row one place up or down: the whole list renumbered
 * 10, 20, 30… in the new order, keeping only the rows whose value changes. [] when it cannot move.
 */
export function planMove(rows: readonly SortableRow[], id: string, direction: MoveDirection): SortOrderUpdate[] {
  if (!canMove(rows, id, direction)) return [];
  const ordered = inDisplayOrder(rows);
  const index = ordered.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.flatMap((row, position) => {
    const sortOrder = (position + 1) * SORT_STEP;
    return row.sort_order === sortOrder ? [] : [{ id: row.id, sort_order: sortOrder }];
  });
}

/** The `sort_order` for a new row: after every existing row. */
export function nextSortOrder(rows: readonly { sort_order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + SORT_STEP;
}
