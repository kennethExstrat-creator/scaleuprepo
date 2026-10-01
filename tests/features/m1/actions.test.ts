// The M1 Server Actions against a fake Supabase client (tests/features/m1/fake-supabase.ts): role checks,
// the writes they make, the side effects (open_due_periods, storage clean-up) and their error handling.
// The database rules themselves (RLS, triggers, RPCs) are covered by tests/db.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  client: null as unknown,
  admin: null as unknown,
  role: "super_admin" as string | null,
  userId: "a1000000-0000-4000-8000-000000000009",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin }));
vi.mock("@/lib/data", () => ({
  getCompany: vi.fn(),
  getCompanyInternal: vi.fn(),
  getPlatformSettings: vi.fn(),
}));
vi.mock("@/lib/auth/session", async () => {
  const { ActionError, MESSAGES } = await import("@/lib/actions/result");
  return {
    assertScaleUp: vi.fn(async (roles?: readonly string[]) => {
      if (!state.role || (roles && !roles.includes(state.role))) throw new ActionError(MESSAGES.permission);
      return {
        userId: state.userId,
        email: "staff@example.com",
        fullName: "ScaleUp Staff",
        scaleupRole: state.role,
        isActive: true,
        memberships: [],
        aal: "aal2",
        mfaRequired: true,
        termsAccepted: true,
      };
    }),
  };
});

import { revalidatePath } from "next/cache";

import {
  addRevenueLineAction,
  createCompanyAction,
  deleteCompanyAction,
  moveRevenueLineAction,
  saveKpiAction,
  setRevenueLineActiveAction,
  setCompanyStatusAction,
  setReportingStartAction,
  updateInternalFieldsAction,
} from "@/app/admin/companies/actions";
import { createFundAction } from "@/app/admin/funds/actions";
import { MESSAGES } from "@/lib/actions/result";
import { DEFAULT_OWNER_CONTRIBUTOR_LIMIT } from "@/lib/constants";
import { getCompany, getCompanyInternal, getPlatformSettings } from "@/lib/data";
import type { CompanyInternalWithPartner, CompanyRow, PlatformSettingsRow } from "@/lib/types/domain";

import { fakeStorage, fakeSupabase, filterValue, pgError } from "./fake-supabase";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const NEW_COMPANY = "c0000000-0000-4000-8000-000000000099";
const SV1 = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "a1000000-0000-4000-8000-000000000005";
const KPI = "e0000000-0000-4000-8000-000000000001";

const SETTINGS: PlatformSettingsRow = {
  id: 1,
  due_day: 15,
  escalation_days: 14,
  backfill_grace_days: 14,
  revenue_swing_pct: 30,
  min_runway_months: 6,
  require_mfa: true,
  default_reporting_start: "2026-07-01",
  declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
  terms_version: "2026-09",
  owner_contributor_limit: DEFAULT_OWNER_CONTRIBUTOR_LIMIT,
  updated_by: null,
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};

const BATIK: CompanyRow = {
  id: COMPANY,
  name: "Batik Boutique",
  legal_name: null,
  registration_no: null,
  sector: null,
  country: "Malaysia",
  website: null,
  description: null,
  reporting_currency: "MYR",
  status: "active",
  status_changed_at: null,
  status_reason: null,
  reporting_start_month: "2026-07-01",
  created_at: "2026-09-30T00:00:00Z",
  updated_at: "2026-09-30T00:00:00Z",
};

function internalRow(partnerId: string | null): CompanyInternalWithPartner {
  return {
    company_id: COMPANY,
    partner_in_charge_id: partnerId,
    internal_rating: null,
    exit_strategy_status: null,
    exit_strategy_notes: null,
    notes: null,
    updated_by: null,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
    partner: null,
  };
}

const NEW_COMPANY_INPUT = {
  name: " New Co ",
  legalName: "New Co Sdn Bhd",
  registrationNo: "",
  sector: "Fintech",
  country: "Malaysia",
  website: "newco.my",
  description: "",
  reportingCurrency: "myr",
  reportingStartMonth: "2026-07",
  partnerId: PARTNER,
  funds: [{ fundId: SV1, investmentDate: "", instrument: "Preference shares", ownershipPct: "12.5", notes: "" }],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T04:00:00Z")); // 30 Sep 2026, 12:00 in Malaysia
  state.role = "super_admin";
  vi.mocked(getPlatformSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getCompany).mockResolvedValue(BATIK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Answers the lookups createCompanyAction makes (partner profile, funds) and the insert. */
function companyTables(overrides: { insertError?: ReturnType<typeof pgError>; fundsInsertError?: ReturnType<typeof pgError> } = {}) {
  return fakeSupabase({
    tables: (call) => {
      if (call.table === "profiles") return { data: { id: PARTNER, scaleup_role: "partner", is_active: true }, error: null };
      if (call.table === "funds") return { data: [{ id: SV1, is_active: true }], error: null };
      if (call.table === "companies" && call.op === "insert") {
        return overrides.insertError ? { data: null, error: overrides.insertError } : { data: { id: NEW_COMPANY }, error: null };
      }
      if (call.table === "fund_investments" && overrides.fundsInsertError) {
        return { data: null, error: overrides.fundsInsertError };
      }
      return undefined;
    },
  });
}

describe("createCompanyAction", () => {
  it("is for Super Admins only", async () => {
    state.role = "fund_admin";
    const fake = companyTables();
    state.client = fake.client;
    expect(await createCompanyAction(NEW_COMPANY_INPUT)).toEqual({ ok: false, error: MESSAGES.permission });
    expect(fake.calls).toEqual([]);
  });

  it("creates the company with its partner-in-charge and funds, then opens its months", async () => {
    const fake = companyTables();
    state.client = fake.client;

    expect(await createCompanyAction(NEW_COMPANY_INPUT)).toEqual({ ok: true, data: { id: NEW_COMPANY, warnings: [] } });

    const insert = fake.calls.find((call) => call.table === "companies" && call.op === "insert");
    expect(insert?.values).toEqual({
      name: "New Co",
      legal_name: "New Co Sdn Bhd",
      registration_no: null,
      sector: "Fintech",
      country: "Malaysia",
      website: "https://newco.my",
      description: null,
      reporting_currency: "MYR",
      reporting_start_month: "2026-07-01",
    });
    const internal = fake.calls.find((call) => call.table === "company_internal");
    expect(internal).toMatchObject({ op: "update", values: { partner_in_charge_id: PARTNER } });
    expect(internal && filterValue(internal, "company_id")).toBe(NEW_COMPANY);
    expect(fake.calls.find((call) => call.table === "fund_investments")?.values).toEqual([
      {
        company_id: NEW_COMPANY,
        fund_id: SV1,
        investment_date: null,
        instrument: "Preference shares",
        ownership_pct: 12.5,
        notes: null,
      },
    ]);
    expect(fake.rpcCalls.map((call) => call.fn)).toEqual(["open_due_periods"]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });

  it("opens no months and assigns nobody for a company that is not reporting yet", async () => {
    const fake = companyTables();
    state.client = fake.client;
    const result = await createCompanyAction({ ...NEW_COMPANY_INPUT, reportingStartMonth: "", partnerId: "", funds: [] });
    expect(result.ok).toBe(true);
    const insert = fake.calls.find((call) => call.table === "companies" && call.op === "insert");
    expect(insert?.values).toMatchObject({ reporting_start_month: null });
    expect(fake.calls.some((call) => call.table === "company_internal" || call.table === "fund_investments")).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a start month before the platform's first reporting month", async () => {
    const fake = companyTables();
    state.client = fake.client;
    const result = await createCompanyAction({ ...NEW_COMPANY_INPUT, reportingStartMonth: "2026-01" });
    expect(result).toEqual({
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: {
        reportingStartMonth:
          "The reporting start month can't be before Jul 2026. Earlier months come from the historical workbooks.",
      },
    });
    expect(fake.calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("refuses a partner who is not an active partner or Super Admin", async () => {
    const fake = fakeSupabase({
      tables: (call) =>
        call.table === "profiles" ? { data: { id: PARTNER, scaleup_role: "fund_admin", is_active: true }, error: null } : undefined,
    });
    state.client = fake.client;
    const result = await createCompanyAction(NEW_COMPANY_INPUT);
    expect(result).toMatchObject({ ok: false, fieldErrors: { partnerId: "Choose an active partner or Super Admin." } });
  });

  it("points at the name when it is already taken", async () => {
    const fake = companyTables({ insertError: pgError("23505", "duplicate key value violates unique constraint \"companies_name_key\"") });
    state.client = fake.client;
    expect(await createCompanyAction(NEW_COMPANY_INPUT)).toEqual({
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: { name: "A company with this name already exists." },
    });
    expect(fake.calls.some((call) => call.table === "company_internal")).toBe(false);
  });

  it("keeps the company and warns when a later step fails", async () => {
    const fake = companyTables({ fundsInsertError: pgError("42501", "new row violates row-level security policy") });
    state.client = fake.client;
    const result = await createCompanyAction(NEW_COMPANY_INPUT);
    expect(result).toEqual({
      ok: true,
      data: { id: NEW_COMPANY, warnings: [`The fund mappings could not be saved: ${MESSAGES.permission}`] },
    });
  });
});

describe("setReportingStartAction", () => {
  it("clears the start month without opening months", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await setReportingStartAction({ companyId: COMPANY, month: null })).toEqual({ ok: true, data: { warning: null } });
    expect(fake.calls[0]).toMatchObject({ table: "companies", op: "update", values: { reporting_start_month: null } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("sets it and opens the due months, reporting a failure to open them", async () => {
    const fake = fakeSupabase({
      rpc: () => ({ data: null, error: pgError("P0001", "Publish the default reporting template before opening reporting months.") }),
    });
    state.client = fake.client;
    vi.mocked(getCompany).mockResolvedValue({ ...BATIK, reporting_start_month: null });
    const result = await setReportingStartAction({ companyId: COMPANY, month: "2026-08" });
    expect(fake.calls[0]).toMatchObject({ op: "update", values: { reporting_start_month: "2026-08-01" } });
    expect(result).toEqual({
      ok: true,
      data: {
        warning:
          "The start month was saved, but its monthly updates could not be opened yet: Publish the default reporting template before opening reporting months.",
      },
    });
  });

  it("keeps an existing start month that is now out of range", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    vi.mocked(getCompany).mockResolvedValue({ ...BATIK, reporting_start_month: "2026-01-01" });
    expect((await setReportingStartAction({ companyId: COMPANY, month: "2026-01" })).ok).toBe(true);
    expect(getPlatformSettings).not.toHaveBeenCalled();
  });
});

describe("setCompanyStatusAction", () => {
  it("needs a reason to exit a company", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    const result = await setCompanyStatusAction({ companyId: COMPANY, status: "exited", reason: "" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("marks the company exited with the reason", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await setCompanyStatusAction({ companyId: COMPANY, status: "exited", reason: "Sold" })).toEqual({
      ok: true,
      data: { warning: null },
    });
    expect(fake.rpcCalls).toEqual([
      { fn: "set_company_status", args: { p_company_id: COMPANY, p_status: "exited", p_reason: "Sold" } },
    ]);
  });

  it("opens the due months when a company becomes active again", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    await setCompanyStatusAction({ companyId: COMPANY, status: "active" });
    expect(fake.rpcCalls).toEqual([
      { fn: "set_company_status", args: { p_company_id: COMPANY, p_status: "active", p_reason: undefined } },
      { fn: "open_due_periods", args: undefined },
    ]);
  });

  it("switches between exited and written off without opening any months", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(
      await setCompanyStatusAction({ companyId: COMPANY, status: "written_off", reason: " Buyer fell through; fully impaired. " }),
    ).toEqual({ ok: true, data: { warning: null } });
    expect(await setCompanyStatusAction({ companyId: COMPANY, status: "exited", reason: "Sold after all" })).toEqual({
      ok: true,
      data: { warning: null },
    });
    expect(fake.rpcCalls).toEqual([
      {
        fn: "set_company_status",
        args: { p_company_id: COMPANY, p_status: "written_off", p_reason: "Buyer fell through; fully impaired." },
      },
      { fn: "set_company_status", args: { p_company_id: COMPANY, p_status: "exited", p_reason: "Sold after all" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/companies/${COMPANY}`);
  });

  it("still needs a reason to switch to written off", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    const result = await setCompanyStatusAction({ companyId: COMPANY, status: "written_off", reason: "   " });
    expect(result).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe("deleteCompanyAction", () => {
  const files = [`${COMPANY}/general/a.pdf`, `${COMPANY}/d0000000-0000-4000-8000-000000000001/q3.xlsx`, `c0000000-0000-4000-8000-000000000002/general/b.pdf`];

  it("needs the company's name typed exactly", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    const result = await deleteCompanyAction({ companyId: COMPANY, reason: "Duplicate", confirmName: "batik boutique" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { confirmName: expect.any(String) } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("deletes the company, then removes its files only, without revalidating the deleted page", async () => {
    const fake = fakeSupabase();
    const storage = fakeStorage(files);
    state.client = fake.client;
    state.admin = storage.client;
    const result = await deleteCompanyAction({ companyId: COMPANY, reason: " Added by mistake ", confirmName: " Batik Boutique " });
    expect(result).toEqual({ ok: true, data: { removedFiles: 2, warning: null } });
    expect(fake.rpcCalls).toEqual([
      { fn: "delete_company", args: { p_company_id: COMPANY, p_reason: "Added by mistake" } },
    ]);
    expect(storage.bucketsUsed).toEqual(["company-documents"]);
    expect([...storage.objects]).toEqual(["c0000000-0000-4000-8000-000000000002/general/b.pdf"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("still reports success, with a warning, when the files cannot be removed", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    state.admin = fakeStorage(files, true).client;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await deleteCompanyAction({ companyId: COMPANY, reason: "Mistake", confirmName: "Batik Boutique" });
    expect(result).toMatchObject({ ok: true, data: { removedFiles: 0, warning: expect.stringContaining(COMPANY) } });
  });

  it("does not touch storage when the database refuses", async () => {
    const fake = fakeSupabase({ rpc: () => ({ data: null, error: pgError("42501", "Only Super Admins can delete companies.") }) });
    const storage = fakeStorage(files);
    state.client = fake.client;
    state.admin = storage.client;
    expect(await deleteCompanyAction({ companyId: COMPANY, reason: "x", confirmName: "Batik Boutique" })).toEqual({
      ok: false,
      error: "Only Super Admins can delete companies.",
    });
    expect(storage.bucketsUsed).toEqual([]);
  });
});

describe("configuration actions", () => {
  const RETAIL = "b2000000-0000-4000-8000-000000000001";
  const WHOLESALE = "b2000000-0000-4000-8000-000000000002";
  function revenueLines() {
    return fakeSupabase({
      tables: (call) =>
        call.table === "revenue_segments" && call.op === "select"
          ? {
              data: [
                { id: RETAIL, name: "Retail", sort_order: 0, is_active: true },
                { id: WHOLESALE, name: "Wholesale", sort_order: 0, is_active: true },
              ],
              error: null,
            }
          : undefined,
    });
  }

  it("moves a revenue line by renumbering the list (Fund Admins manage revenue lines)", async () => {
    state.role = "fund_admin";
    const fake = revenueLines();
    state.client = fake.client;
    expect(await moveRevenueLineAction({ companyId: COMPANY, id: WHOLESALE, direction: "up" })).toEqual({
      ok: true,
      data: undefined,
    });
    const updates = fake.calls
      .filter((call) => call.op === "update")
      .map((call) => ({ id: filterValue(call, "id"), company: filterValue(call, "company_id"), values: call.values }));
    expect(updates).toEqual([
      { id: WHOLESALE, company: COMPANY, values: { sort_order: 10 } },
      { id: RETAIL, company: COMPANY, values: { sort_order: 20 } },
    ]);
  });

  it("refuses to move a revenue line of another company, and partners cannot manage them", async () => {
    state.role = "fund_admin";
    const fake = revenueLines();
    state.client = fake.client;
    expect(await moveRevenueLineAction({ companyId: COMPANY, id: SV1, direction: "up" })).toEqual({
      ok: false,
      error: MESSAGES.notFound,
    });
    state.role = "partner";
    expect(await moveRevenueLineAction({ companyId: COMPANY, id: RETAIL, direction: "down" })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(fake.calls.some((call) => call.op === "update")).toBe(false);
  });

  // BRD B30: the company's own revenue segments (kind 'company') share the table but are managed by the
  // owner through set_company_revenue_segments(); this tab renumbers, adds and toggles ScaleUp lines only.
  function mixedRevenueRows() {
    const rows = [
      { id: RETAIL, name: "Retail", sort_order: 0, is_active: true, kind: "scaleup" },
      { id: "b3000000-0000-4000-8000-000000000001", name: "Online", sort_order: 1, is_active: true, kind: "company" },
      { id: "b3000000-0000-4000-8000-000000000002", name: "Stores", sort_order: 5, is_active: true, kind: "company" },
      { id: WHOLESALE, name: "Wholesale", sort_order: 10, is_active: true, kind: "scaleup" },
    ];
    return fakeSupabase({
      tables: (call) => {
        if (call.table !== "revenue_segments" || call.op !== "select") return undefined;
        const kind = filterValue(call, "kind");
        return {
          data: rows
            .filter((row) => kind === undefined || row.kind === kind)
            .map(({ id, name, sort_order, is_active }) => ({ id, name, sort_order, is_active })),
          error: null,
        };
      },
    });
  }

  it("moves a ScaleUp revenue line past the company's own segments (B30: ScaleUp lines only)", async () => {
    state.role = "fund_admin";
    const fake = mixedRevenueRows();
    state.client = fake.client;
    expect(await moveRevenueLineAction({ companyId: COMPANY, id: WHOLESALE, direction: "up" })).toEqual({
      ok: true,
      data: undefined,
    });
    const read = fake.calls.find((call) => call.table === "revenue_segments" && call.op === "select");
    expect(read && filterValue(read, "kind")).toBe("scaleup");
    const updates = fake.calls
      .filter((call) => call.op === "update")
      .map((call) => ({ id: filterValue(call, "id"), kind: filterValue(call, "kind"), values: call.values }));
    // Wholesale (10) and Retail swap places; the company's segments (1, 5) are neither read nor renumbered.
    expect(updates).toEqual([{ id: RETAIL, kind: "scaleup", values: { sort_order: 20 } }]);
  });

  it("adds a revenue line as a ScaleUp line after the last ScaleUp line", async () => {
    state.role = "super_admin";
    const fake = mixedRevenueRows();
    state.client = fake.client;
    expect(await addRevenueLineAction({ companyId: COMPANY, name: "AOnePay" })).toEqual({ ok: true, data: undefined });
    const insert = fake.calls.find((call) => call.table === "revenue_segments" && call.op === "insert");
    expect(insert?.values).toEqual({ company_id: COMPANY, name: "AOnePay", sort_order: 20, kind: "scaleup" });
  });

  it("explains a refused reactivation when another active line has the name (case-insensitive unique)", async () => {
    state.role = "fund_admin";
    const fake = fakeSupabase({
      tables: (call) =>
        call.table === "revenue_segments" && call.op === "update"
          ? {
              data: null,
              error: pgError("23505", 'duplicate key value violates unique constraint "revenue_segments_active_name_key"'),
            }
          : undefined,
    });
    state.client = fake.client;
    const result = await setRevenueLineActiveAction({ companyId: COMPANY, id: RETAIL, active: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Another active revenue line already has this name/);
    const update = fake.calls.find((call) => call.op === "update");
    expect(update && filterValue(update, "kind")).toBe("scaleup");
  });

  it("refuses to change the type of a KPI that has figures", async () => {
    const fake = fakeSupabase({
      tables: (call) => {
        if (call.table === "company_kpis" && call.op === "select") {
          return { data: { id: KPI, value_type: "integer", dimension_id: null }, error: null };
        }
        if (call.table === "submission_kpi_values") return { data: [{ id: "v1" }], error: null };
        return undefined;
      },
    });
    state.client = fake.client;
    const result = await saveKpiAction({
      companyId: COMPANY,
      id: KPI,
      name: "App downloads",
      valueType: "text",
      frequency: "monthly",
      isRequired: true,
      isActive: true,
    });
    expect(result).toMatchObject({ ok: false, fieldErrors: { valueType: expect.stringContaining("Create a new KPI") } });
    expect(fake.calls.some((call) => call.op === "update")).toBe(false);
  });

  it("lets partners edit the internal fields of their own companies only, never the partner-in-charge", async () => {
    state.role = "partner";
    state.userId = PARTNER;
    const fake = fakeSupabase();
    state.client = fake.client;

    vi.mocked(getCompanyInternal).mockResolvedValue(internalRow("a1000000-0000-4000-8000-000000000006"));
    expect(await updateInternalFieldsAction({ companyId: COMPANY, internalRating: "watch" })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(fake.calls).toEqual([]);

    vi.mocked(getCompanyInternal).mockResolvedValue(internalRow(PARTNER));
    expect(await updateInternalFieldsAction({ companyId: COMPANY, internalRating: "watch", notes: " Met the CEO " })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(fake.calls[0]).toMatchObject({
      table: "company_internal",
      op: "update",
      values: { internal_rating: "watch", exit_strategy_status: null, exit_strategy_notes: null, notes: "Met the CEO" },
    });
    expect(fake.calls[0].values).not.toHaveProperty("partner_in_charge_id");
    state.userId = "a1000000-0000-4000-8000-000000000009";
  });
});

describe("createFundAction", () => {
  it("upper-cases the code and explains a duplicate code", async () => {
    const fake = fakeSupabase({
      tables: (call) =>
        call.table === "funds" && call.op === "insert"
          ? { data: null, error: pgError("23505", "duplicate key value violates unique constraint \"funds_code_key\"") }
          : undefined,
    });
    state.client = fake.client;
    const result = await createFundAction({ code: "sv 2", name: "ScaleUp Ventures 2", isActive: true });
    expect(fake.calls[0]?.values).toMatchObject({ code: "SV2", name: "ScaleUp Ventures 2", legal_name: null });
    expect(result).toEqual({
      ok: false,
      error: MESSAGES.invalid,
      fieldErrors: { code: "Another fund already uses this code." },
    });
  });

  it("is for Super Admins only", async () => {
    state.role = "partner";
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await createFundAction({ code: "SV2", name: "X", isActive: true })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(fake.calls).toEqual([]);
  });
});
