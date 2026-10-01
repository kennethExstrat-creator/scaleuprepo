// Server Action result contract (docs/ARCHITECTURE.md §5.3).
//
//   "use server";
//   export async function renameCompany(input: unknown): Promise<ActionResult<{ id: string }>> {
//     try {
//       await assertScaleUp(["super_admin"]);
//       const { id, name } = schema.parse(input);            // ZodError → fieldErrors
//       const supabase = await createClient();
//       const { error } = await supabase.from("companies").update({ name }).eq("id", id);
//       if (error) throw error;                               // PostgrestError → friendly text
//       revalidatePath(`/admin/companies/${id}`);
//       return ok({ id });
//     } catch (e) {
//       return toActionError(e);                              // re-throws redirect()/notFound()
//     }
//   }
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Throw inside an action for an expected, user-facing failure; `toActionError` returns its message. */
export class ActionError extends Error {
  readonly fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | void> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult<never> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

export const MESSAGES = {
  permission: "You don't have permission to do that.",
  duplicate: "That already exists.",
  inUse: "This item is in use and can't be removed.",
  missingReference: "Something this refers to no longer exists. Please reload the page and try again.",
  notAllowed: "One of the values isn't allowed. Please check and try again.",
  network: "Couldn't reach the server. Please try again.",
  session: "Your session has expired. Please sign in again.",
  notFound: "We couldn't find that item. It may have been removed.",
  invalid: "Please check the highlighted fields.",
  /**
   * The app expects a database change that is not deployed yet (an undefined column, table or function,
   * e.g. a migration still to push): an operational problem, not the person's.
   */
  outdated: "This part of the platform is being updated. Please try again in a few minutes, and tell ScaleUp if it keeps happening.",
  generic: "Something went wrong. Please try again.",
} as const;

/**
 * Maps any thrown value to a user-safe failure result. Never leaks SQL or stack traces:
 * - `ActionError` → its message (and field errors)
 * - `ZodError` → "Please check the highlighted fields." + first message per field
 * - Postgres `P0001` (RAISE EXCEPTION in our RPCs) → the database message as-is; `42501` → the
 *   RPC's own friendly message (e.g. "Only the company owner can submit monthly updates."), but
 *   the generic permission message for Postgres text from RLS or privileges ("new row violates
 *   row-level security policy…", "permission denied for table…"); `23505` → "That already exists.";
 *   `23503`/`23001` (foreign key / RESTRICT: Postgres 17 raises 23503, 18 raises 23001) → in-use
 *   message, or "Something this refers to no longer exists…" for an insert/update;
 *   `23514` (check constraint) → "One of the values isn't allowed…"; PostgREST `PGRST116` →
 *   not-found message; `PGRST301`/`PGRST303` (bad/expired JWT) → session-expired message; a database
 *   that is behind the app (`42703` / `42P01` / `42883` undefined column, table or function; PostgREST
 *   `PGRST202` / `PGRST204` / `PGRST205` not in its schema cache — e.g. a migration not pushed yet) →
 *   "This part of the platform is being updated…" (logged on the server).
 *   For a `DataError` (src/lib/data) the database message is read from its `cause`, so the data
 *   layer's internal wording (function names, ids) is never shown.
 * - network failures → "Couldn't reach the server. Please try again."
 * - anything else → a generic message (the original is logged on the server)
 *
 * Next.js control-flow errors (`redirect()`, `notFound()`) are re-thrown, so it is safe to
 * call from a `catch` block that wraps code which may redirect.
 */
export function toActionError(e: unknown): ActionResult<never> {
  unstable_rethrow(e);

  if (e instanceof ActionError) return fail(e.message, e.fieldErrors);

  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    return fail(MESSAGES.invalid, fieldErrors);
  }

  if (isNetworkError(e)) return fail(MESSAGES.network);

  const code = errorCode(e);
  switch (code) {
    case "42501": {
      const message = databaseMessage(e);
      const friendly = message && message.length <= 500 && !POSTGRES_PERMISSION_TEXT.test(message);
      return fail(friendly ? message : MESSAGES.permission);
    }
    case "P0001": {
      const message = databaseMessage(e);
      return fail(message && message.length <= 500 ? message : MESSAGES.generic);
    }
    case "23505":
      return fail(MESSAGES.duplicate);
    case "23001":
    case "23503":
      return fail(/^insert or update on table/i.test(databaseMessage(e) ?? "") ? MESSAGES.missingReference : MESSAGES.inUse);
    case "23514":
      return fail(MESSAGES.notAllowed);
    case "PGRST116":
      return fail(MESSAGES.notFound);
    case "PGRST301":
    case "PGRST303":
      return fail(MESSAGES.session);
    case "42703":
    case "42P01":
    case "42883":
    case "PGRST202":
    case "PGRST204":
    case "PGRST205":
      // The deployed database is behind the app (a migration still to push): say so, and log it loudly.
      console.error("[action] the database is missing something the app needs (deploy pending migrations)", e);
      return fail(MESSAGES.outdated);
  }

  console.error("[action] unexpected error", e);
  return fail(MESSAGES.generic);
}

function errorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return undefined;
}

/** Postgres' own wording for RLS and privilege failures (never shown to users). */
const POSTGRES_PERMISSION_TEXT = /row-level security|permission denied|must be owner of/i;

/**
 * The database's message. A DataError from src/lib/data wraps the PostgrestError as its `cause`
 * (its own message names the data function and ids, which must not reach users).
 */
function databaseMessage(e: unknown): string | undefined {
  if (e instanceof Error && e.name === "DataError" && typeof e.cause === "object" && e.cause !== null) {
    return errorMessage(e.cause);
  }
  return errorMessage(e);
}

function errorMessage(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "message" in e) {
    const message = (e as { message: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return undefined;
}

function isNetworkError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { name, message, status } = e as { name?: unknown; message?: unknown; status?: unknown };
  if (name === "AuthRetryableFetchError") return true;
  if (typeof status === "number" && status === 0 && name !== "ActionError") return true;
  if (typeof message !== "string") return false;
  return /fetch failed|failed to fetch|networkerror|network request failed|econnrefused|econnreset|enotfound|etimedout|socket hang up/i.test(
    message,
  );
}
