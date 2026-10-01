import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, type PageResult } from "@/lib/fetch-all";

/** A fake paged endpoint over `total` rows that returns at most `cap` rows per request. */
function endpoint(total: number, { cap = Infinity, withCount = true } = {}) {
  const rows = Array.from({ length: total }, (_, index) => index);
  const calls: Array<[number, number]> = [];
  const fetchPage = vi.fn(async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap, rows.length);
    return { data: rows.slice(from, end), error: null, count: withCount ? total : null };
  });
  return { fetchPage, calls, rows };
}

describe("fetchAllRows", () => {
  it("reads a single page", async () => {
    const { fetchPage, calls, rows } = endpoint(3);
    expect(await fetchAllRows(fetchPage, { pageSize: 10 })).toEqual(rows);
    expect(calls).toEqual([[0, 9]]);
  });

  it("reads every page until the count is reached", async () => {
    const { fetchPage, calls, rows } = endpoint(25);
    expect(await fetchAllRows(fetchPage, { pageSize: 10 })).toEqual(rows);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("is not fooled by a server cap below the page size (max_rows)", async () => {
    const { fetchPage, rows } = endpoint(25, { cap: 4 });
    expect(await fetchAllRows(fetchPage, { pageSize: 10 })).toEqual(rows);
  });

  it("without a count, stops at the first short page", async () => {
    const { fetchPage, calls, rows } = endpoint(12, { withCount: false });
    expect(await fetchAllRows(fetchPage, { pageSize: 5 })).toEqual(rows);
    expect(calls).toHaveLength(3);
  });

  it("stops on an empty page and after maxPages", async () => {
    const empty = vi.fn(async (): Promise<PageResult<number>> => ({ data: [], error: null, count: 50 }));
    expect(await fetchAllRows(empty, { pageSize: 10 })).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);

    const { fetchPage } = endpoint(100);
    expect(await fetchAllRows(fetchPage, { pageSize: 10, maxPages: 2 })).toHaveLength(20);
  });

  it("throws the page's error", async () => {
    const failure = new Error("boom");
    await expect(
      fetchAllRows(async () => ({ data: null, error: failure, count: null }), { pageSize: 10 }),
    ).rejects.toBe(failure);
    await expect(fetchAllRows(async () => ({ data: [], error: null, count: 0 }), { pageSize: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});
