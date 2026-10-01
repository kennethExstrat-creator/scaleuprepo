import { describe, expect, it } from "vitest";

import {
  canMove,
  inDisplayOrder,
  nextSortOrder,
  planMove,
  type SortableRow,
} from "@/app/admin/companies/_components/reorder";

function rows(...specs: [id: string, sortOrder: number, active?: boolean, name?: string][]): SortableRow[] {
  return specs.map(([id, sort_order, is_active = true, name = id]) => ({ id, name, sort_order, is_active }));
}

describe("inDisplayOrder", () => {
  it("puts active rows first, then sort order, then name, then id", () => {
    const ordered = inDisplayOrder(
      rows(["d", 10, false], ["b", 20, true, "Retail"], ["a", 20, true, "Outlet 10"], ["c", 20, true, "Outlet 2"], ["e", 5]),
    );
    expect(ordered.map((row) => row.id)).toEqual(["e", "c", "a", "b", "d"]);
  });

  it("does not change its input", () => {
    const input = rows(["b", 20], ["a", 10]);
    inDisplayOrder(input);
    expect(input.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("canMove", () => {
  const list = rows(["a", 10], ["b", 20], ["c", 30, false], ["d", 40, false]);

  it("stops at the edges of the list and of the active/inactive groups", () => {
    expect(canMove(list, "a", "up")).toBe(false);
    expect(canMove(list, "a", "down")).toBe(true);
    expect(canMove(list, "b", "down")).toBe(false);
    expect(canMove(list, "c", "up")).toBe(false);
    expect(canMove(list, "c", "down")).toBe(true);
    expect(canMove(list, "d", "down")).toBe(false);
    expect(canMove(list, "missing", "up")).toBe(false);
  });
});

describe("planMove", () => {
  it("swaps with the neighbour and renumbers in steps of 10", () => {
    expect(planMove(rows(["a", 10], ["b", 20], ["c", 30]), "c", "up")).toEqual([
      { id: "c", sort_order: 20 },
      { id: "b", sort_order: 30 },
    ]);
  });

  it("breaks ties from seeded rows (all sort order 0)", () => {
    const seeded = rows(["x", 0, true, "Mont Kiara"], ["y", 0, true, "The Row"], ["z", 0, true, "IOI City Mall"]);
    // Display order by name: IOI City Mall (z), Mont Kiara (x), The Row (y).
    expect(planMove(seeded, "y", "up")).toEqual([
      { id: "z", sort_order: 10 },
      { id: "y", sort_order: 20 },
      { id: "x", sort_order: 30 },
    ]);
  });

  it("renumbers the inactive rows after the active ones", () => {
    expect(planMove(rows(["a", 5], ["b", 7], ["c", 1, false]), "a", "down")).toEqual([
      { id: "b", sort_order: 10 },
      { id: "a", sort_order: 20 },
      { id: "c", sort_order: 30 },
    ]);
  });

  it("returns no updates when the row cannot move", () => {
    expect(planMove(rows(["a", 10], ["b", 20]), "a", "up")).toEqual([]);
    expect(planMove(rows(["a", 10], ["b", 20, false]), "a", "down")).toEqual([]);
    expect(planMove([], "a", "down")).toEqual([]);
  });
});

describe("nextSortOrder", () => {
  it("goes after the highest sort order", () => {
    expect(nextSortOrder([])).toBe(10);
    expect(nextSortOrder(rows(["a", 0], ["b", 0]))).toBe(10);
    expect(nextSortOrder(rows(["a", 40], ["b", 15]))).toBe(50);
  });
});
