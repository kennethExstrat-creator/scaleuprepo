import "server-only";

import { DataError } from "@/lib/data";

// PostgREST returns at most `max_rows` rows per request (1000 on Supabase, supabase/config.toml), so the
// exports read large result sets page by page. Reads stop at the first empty page, which stays correct
// whatever the server's cap is.

/** Rows requested per page (the Supabase default cap). */
export const EXPORT_PAGE_SIZE = 1000;

/** Ids per `.in()` filter, keeping request URLs short. */
export const EXPORT_ID_CHUNK = 100;

/** Chunks read at the same time (a full-portfolio export must not flood the API with requests). */
export const EXPORT_CHUNK_CONCURRENCY = 6;

type QueryError = { message: string; code?: string; details?: string; hint?: string };

/** What an awaited supabase-js query resolves to (success or failure). */
export type PageResult<T> = { data: T[] | null; error: QueryError | null };

/** A failed read as a DataError (toActionError shows the database's own message for it). */
export function exportQueryError(operation: string, what: string, error: QueryError): DataError {
  const code = error.code || undefined;
  return new DataError(operation, `could not ${what}: ${error.message}${code ? ` (${code})` : ""}`, {
    code,
    details: error.details,
    hint: error.hint,
    cause: error,
  });
}

/**
 * Every row of an ordered query, read with `.range(from, to)`. `page` must build the same query with a
 * deterministic order each time. Throws when more than `maxRows` rows come back.
 */
export async function fetchAllPages<T>(
  operation: string,
  what: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
  const maxRows = options.maxRows ?? 250_000;
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + pageSize - 1);
    if (error) throw exportQueryError(operation, what, error);
    const batch = data ?? [];
    if (batch.length === 0) return rows;
    for (const row of batch) rows.push(row);
    if (rows.length > maxRows) {
      throw new DataError(operation, `too many rows (more than ${maxRows}) while trying to ${what}`);
    }
  }
}

/**
 * Splits `ids` (deduplicated) into chunks and loads them, EXPORT_CHUNK_CONCURRENCY at a time (e.g.
 * `.in("submission_id", chunk)`); the results keep the chunks' order.
 */
export async function fetchByIdChunks<T>(
  ids: readonly string[],
  load: (chunk: string[]) => Promise<T[]>,
  chunkSize = EXPORT_ID_CHUNK,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) chunks.push(unique.slice(i, i + chunkSize));
  const results = await mapWithConcurrency(chunks, EXPORT_CHUNK_CONCURRENCY, (chunk) => load(chunk));
  return results.flat();
}

/** Runs `task` over `items` with at most `concurrency` in flight; results keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
