// Reads every row of a PostgREST query in pages. The Data API returns at most `max_rows` rows per request
// (1000 on Supabase, supabase/config.toml), and portfolio-wide reads such as v_submission_overview
// (companies × months, for the tracker and /admin/cycles) pass that at the design scale of 150 companies.
// The first page asks for the exact count, so a server cap below the page size never truncates the result
// silently. Generic, dependency-free and client-safe (unit-tested in tests/features/m7/fetch-all.test.ts).
// The exports (src/lib/exports/fetch-all.ts) have their own variant that wraps failures in a DataError and
// caps the total number of rows.

export type PageResult<T> = {
  data: T[] | null;
  error: unknown;
  /** Total matching rows (select with `{ count: "exact" }`); null when not requested. */
  count: number | null;
};

/**
 * @param fetchPage runs the query for rows `from`..`to` (inclusive), ordered by a unique key so pages never
 *   overlap, e.g. `(from, to) => sb.from("v").select("…", { count: "exact" }).order("id").range(from, to)`.
 * @throws the page's `error` as soon as one fails.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = 1000, maxPages = 200 }: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError(`fetchAllRows: bad page size ${pageSize}.`);
  const rows: T[] = [];
  let total: number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const from = rows.length;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const data = result.data ?? [];
    if (total === null) total = result.count;
    rows.push(...data);
    if (data.length === 0) break;
    if (total !== null ? rows.length >= total : data.length < pageSize) break;
  }
  return rows;
}
