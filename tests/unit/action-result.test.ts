import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ActionError, fail, MESSAGES, ok, toActionError } from "@/lib/actions/result";

/** A PostgrestError-like object, as supabase-js returns in `{ error }`. */
function pgError(code: string, message: string) {
  return { code, message, details: "", hint: "", name: "PostgrestError" };
}

/** What src/lib/data throws: its own message names the function and ids; the database error is the cause. */
function dataError(code: string, dbMessage: string) {
  const error = new Error(`getSubmissionValidation: could not validate monthly update 123: ${dbMessage} (${code})`, {
    cause: pgError(code, dbMessage),
  });
  error.name = "DataError";
  return Object.assign(error, { code, operation: "getSubmissionValidation", notFound: false });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ok / fail", () => {
  it("builds results", () => {
    expect(ok()).toEqual({ ok: true, data: undefined });
    expect(ok({ id: "x" })).toEqual({ ok: true, data: { id: "x" } });
    expect(fail("Nope")).toEqual({ ok: false, error: "Nope" });
    expect(fail("Nope", { name: "Required" })).toEqual({ ok: false, error: "Nope", fieldErrors: { name: "Required" } });
  });
});

describe("toActionError", () => {
  it("returns ActionError messages and field errors", () => {
    expect(toActionError(new ActionError("Choose a month.", { month: "Required" }))).toEqual({
      ok: false,
      error: "Choose a month.",
      fieldErrors: { month: "Required" },
    });
  });

  it("turns zod errors into field errors keyed by the dotted path", () => {
    const result = z.object({ name: z.string().min(1, "Enter a name."), items: z.array(z.number()) }).safeParse({ name: "", items: ["x"] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toActionError(result.error)).toEqual({
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: { name: "Enter a name.", "items.0": expect.any(String) },
    });
  });

  it("shows RPC business-rule messages (P0001) as they are", () => {
    expect(toActionError(pgError("P0001", "Submit earlier months first: Jul 2026, Aug 2026."))).toEqual({
      ok: false,
      error: "Submit earlier months first: Jul 2026, Aug 2026.",
    });
    expect(toActionError(pgError("P0001", "x".repeat(501)))).toEqual({ ok: false, error: MESSAGES.generic });
  });

  it("shows the friendly 42501 messages of RPCs but hides Postgres permission text", () => {
    expect(toActionError(pgError("42501", "Only the company owner can submit monthly updates."))).toEqual({
      ok: false,
      error: "Only the company owner can submit monthly updates.",
    });
    expect(toActionError(pgError("42501", 'new row violates row-level security policy for table "comments"'))).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(toActionError(pgError("42501", "permission denied for table audit_log"))).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
  });

  it("uses the database message inside a DataError, never the data layer's own wording", () => {
    expect(toActionError(dataError("42501", "This monthly update was not found or you do not have access to it."))).toEqual({
      ok: false,
      error: "This monthly update was not found or you do not have access to it.",
    });
    expect(toActionError(dataError("42501", "permission denied for view v_submission_overview"))).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
  });

  it("maps constraint violations (23001 on Postgres 18 and 23503 on 17 for RESTRICT)", () => {
    expect(toActionError(pgError("23505", 'duplicate key value violates unique constraint "companies_name_key"'))).toEqual({
      ok: false,
      error: MESSAGES.duplicate,
    });
    const restrict = 'update or delete on table "kpi_dimensions" violates RESTRICT setting of foreign key constraint "company_kpis_dimension_id_fkey" on table "company_kpis"';
    expect(toActionError(pgError("23001", restrict))).toEqual({ ok: false, error: MESSAGES.inUse });
    expect(
      toActionError(pgError("23503", 'update or delete on table "funds" violates foreign key constraint "fund_investments_fund_id_fkey" on table "fund_investments"')),
    ).toEqual({ ok: false, error: MESSAGES.inUse });
    expect(
      toActionError(pgError("23503", 'insert or update on table "fund_investments" violates foreign key constraint "fund_investments_fund_id_fkey"')),
    ).toEqual({ ok: false, error: MESSAGES.missingReference });
    expect(toActionError(pgError("23514", 'new row for relation "companies" violates check constraint "x"'))).toEqual({
      ok: false,
      error: MESSAGES.notAllowed,
    });
  });

  it("maps PostgREST not-found and session codes, and network failures", () => {
    expect(toActionError(pgError("PGRST116", "JSON object requested, multiple (or no) rows returned"))).toEqual({
      ok: false,
      error: MESSAGES.notFound,
    });
    expect(toActionError(pgError("PGRST303", "JWT expired"))).toEqual({ ok: false, error: MESSAGES.session });
    expect(toActionError(new TypeError("fetch failed"))).toEqual({ ok: false, error: MESSAGES.network });
  });

  it("says the platform is being updated when the database is behind the app (a migration not pushed yet)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [code, message] of [
      ["42703", 'column revenue_segments.kind does not exist'],
      ["42P01", 'relation "public.access_links" does not exist'],
      ["42883", "function public.set_cycle_settings(integer) does not exist"],
      ["PGRST202", "Could not find the function public.set_company_revenue_segments in the schema cache"],
      ["PGRST204", "Could not find the 'kind' column of 'revenue_segments' in the schema cache"],
      ["PGRST205", "Could not find the table 'public.x' in the schema cache"],
    ]) {
      expect(toActionError(pgError(code, message)), code).toEqual({ ok: false, error: MESSAGES.outdated });
    }
    expect(log).toHaveBeenCalledTimes(6);
    log.mockRestore();
  });

  it("hides anything else behind a generic message (and logs it)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toActionError(new Error("relation \"secret\" does not exist"))).toEqual({ ok: false, error: MESSAGES.generic });
    expect(log).toHaveBeenCalledOnce();
  });
});
