import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

/**
 * PostgREST's code for "no row" (`.single()` on zero rows). `toActionError()` (src/lib/actions/result.ts)
 * maps it to its "We couldn't find that item" message, so a missing row reads the same everywhere.
 */
export const NOT_FOUND_CODE = "PGRST116";

type DataErrorOptions = {
  code?: string;
  details?: string;
  hint?: string;
  notFound?: boolean;
  cause?: unknown;
};

/**
 * Thrown by src/lib/data/* when a query fails, or when a function that must return a row finds none.
 * The message names the data function and what it was loading, e.g.
 * "getCompanyConfig: could not load the revenue segments of company 3f2…: permission denied … (42501)".
 * `code` keeps the Postgres / PostgREST code ('42501', 'PGRST301', …), so `toActionError()` still turns
 * it into a friendly message. Missing rows have `notFound: true` and code 'PGRST116' (isNotFoundError).
 */
export class DataError extends Error {
  /** The data function that failed, e.g. "getSubmissionBundle". */
  readonly operation: string;
  /** Postgres SQLSTATE or PostgREST code, when there is one. */
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;
  /** A required row was missing (or hidden by Row Level Security). */
  readonly notFound: boolean;

  constructor(operation: string, message: string, options: DataErrorOptions = {}) {
    super(`${operation}: ${message}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DataError";
    this.operation = operation;
    this.code = options.code || undefined;
    this.details = options.details || undefined;
    this.hint = options.hint || undefined;
    this.notFound = options.notFound ?? false;
  }
}

/** A failed query: "<operation>: could not <what>: <database message> (<code>)". */
export function queryError(operation: string, what: string, error: PostgrestError): DataError {
  const code = error.code || undefined;
  return new DataError(operation, `could not ${what}: ${error.message}${code ? ` (${code})` : ""}`, {
    code,
    details: error.details,
    hint: error.hint,
    cause: error,
  });
}

/** A required row that does not exist or that the caller may not see. */
export function notFoundError(operation: string, what: string): DataError {
  return new DataError(operation, `${what} was not found or is not visible to the signed-in user`, {
    code: NOT_FOUND_CODE,
    notFound: true,
  });
}

/**
 * True for a DataError about a missing row, e.g. to show a 404:
 * `try { … } catch (e) { if (isNotFoundError(e)) notFound(); throw e; }`.
 */
export function isNotFoundError(error: unknown): error is DataError {
  return error instanceof DataError && error.notFound;
}
