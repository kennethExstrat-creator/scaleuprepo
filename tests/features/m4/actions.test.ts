// The M4 Server Actions against a fake Supabase client (tests/features/m4/fake-supabase.ts): role checks, the
// RPCs and writes they make, and their error handling. The database rules themselves (open_period,
// extend_due_date, RLS on fx_rates and platform_settings) are covered by tests/db.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  client: null as unknown,
  role: "super_admin" as string | null,
  userId: "a1000000-0000-4000-8000-000000000001",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/data", () => ({
  getCompany: vi.fn(),
  getSubmission: vi.fn(),
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
  createFxRateAction,
  deleteFxRateAction,
  extendDeadlineAction,
  openMonthEarlyAction,
  updateCycleSettingsAction,
  updateFxRateAction,
} from "@/app/admin/cycles/actions";
import { updateSettingsAction } from "@/app/admin/settings/actions";
import { MFA_ALWAYS_ON_MESSAGE, settingsFromRow } from "@/app/admin/settings/_lib/settings-model";
import { MESSAGES } from "@/lib/actions/result";
import { getCompany, getPlatformSettings, getSubmission } from "@/lib/data";
import type { CompanyRow, SubmissionRow } from "@/lib/types/domain";

import { fakeSupabase, filterValue, pgError } from "./fake-supabase";
import { BATIK, NOW, SETTINGS } from "./fixtures";

const SUBMISSION = "b0000000-0000-4000-8000-0000000000aa";

const COMPANY: CompanyRow = {
  id: BATIK,
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
  created_at: "2026-09-30T08:00:00Z",
  updated_at: "2026-09-30T08:00:00Z",
};

const MONTH: SubmissionRow = {
  id: SUBMISSION,
  company_id: BATIK,
  period_id: "d0000000-0000-4000-8000-000000000001",
  month: "2026-09-01",
  template_version_id: "b1000000-0000-4000-8000-000000000001",
  status: "draft",
  due_date: "2026-10-15",
  original_due_date: null,
  extension_reason: null,
  submitted_at: null,
  submitted_by: null,
  declaration_text: null,
  approved_at: null,
  approved_by: null,
  revision: 0,
  last_saved_at: null,
  last_saved_by: null,
  created_at: "2026-09-30T16:05:00Z",
  updated_at: "2026-09-30T16:05:00Z",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.role = "super_admin";
  state.client = fakeSupabase().client;
  vi.mocked(getCompany).mockResolvedValue(COMPANY);
  vi.mocked(getSubmission).mockResolvedValue(MONTH);
  vi.mocked(getPlatformSettings).mockResolvedValue(SETTINGS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("openMonthEarlyAction", () => {
  it("opens the current month for Super Admins and Fund Admins", async () => {
    for (const role of ["super_admin", "fund_admin"]) {
      state.role = role;
      const fake = fakeSupabase();
      state.client = fake.client;
      const result = await openMonthEarlyAction({ month: "2026-10" });
      expect(result).toEqual({ ok: true, data: { month: "2026-10" } });
      expect(fake.rpcCalls).toEqual([{ fn: "open_period", args: { p_month: "2026-10-01" } }]);
    }
    expect(revalidatePath).toHaveBeenCalledWith("/admin/cycles");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/tracker");
  });

  it("refuses other roles, future months and bad input before calling the database", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    state.role = "partner";
    expect(await openMonthEarlyAction({ month: "2026-10" })).toEqual({ ok: false, error: MESSAGES.permission });
    state.role = "fund_admin";
    expect(await openMonthEarlyAction({ month: "2026-11" })).toEqual({
      ok: false,
      error: "Only months up to the current month (Oct 2026) can be opened.",
    });
    const invalid = await openMonthEarlyAction({ month: "October" });
    expect(invalid).toMatchObject({ ok: false, fieldErrors: { month: "Choose a month." } });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("shows the database's message", async () => {
    const message = "Publish the default reporting template before opening reporting months.";
    state.client = fakeSupabase({ rpc: () => ({ data: null, error: pgError("P0001", message) }) }).client;
    expect(await openMonthEarlyAction({ month: "2026-10" })).toEqual({ ok: false, error: message });
  });
});

describe("extendDeadlineAction", () => {
  it("extends a month with the reason", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    state.role = "fund_admin";
    const result = await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30", reason: " Audit " });
    expect(result).toEqual({ ok: true, data: { dueDate: "2026-10-30", companyName: "Batik Boutique", month: "2026-09" } });
    expect(fake.rpcCalls).toEqual([
      { fn: "extend_due_date", args: { p_submission_id: SUBMISSION, p_new_due_date: "2026-10-30", p_reason: "Audit" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/review/${SUBMISSION}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/portal/${BATIK}`, "layout");
  });

  it("leaves a blank reason out", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30", reason: "  " });
    expect(fake.rpcCalls[0]?.args).toEqual({ p_submission_id: SUBMISSION, p_new_due_date: "2026-10-30", p_reason: undefined });
  });

  it("refuses partners, read-only companies, approved months and dates that are not later", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    state.role = "partner";
    expect(await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30" })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });

    state.role = "super_admin";
    vi.mocked(getCompany).mockResolvedValueOnce({ ...COMPANY, status: "written_off" });
    expect(await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30" })).toEqual({
      ok: false,
      error: "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
    });

    vi.mocked(getSubmission).mockResolvedValueOnce({ ...MONTH, status: "approved" });
    expect(await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30" })).toEqual({
      ok: false,
      error: "Approved months cannot have their deadline extended.",
    });

    const same = await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-15" });
    expect(same).toEqual({
      ok: false,
      error: "The new due date must be after the current due date (15 Oct 2026).",
      fieldErrors: { newDueDate: "The new due date must be after the current due date (15 Oct 2026)." },
    });
    const tooFar = await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2027-12-01" });
    expect(tooFar).toMatchObject({ ok: false, error: "Choose a date up to 15 Oct 2027." });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("says when the month cannot be found", async () => {
    vi.mocked(getSubmission).mockResolvedValueOnce(null);
    expect(await extendDeadlineAction({ submissionId: SUBMISSION, newDueDate: "2026-10-30" })).toEqual({
      ok: false,
      error: "This monthly update was not found or you do not have access to it.",
    });
  });
});

describe("FX rate actions", () => {
  it("adds a rate on the first of the month", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    state.role = "fund_admin";
    expect(await createFxRateAction({ currency: "usd", month: "2026-09", rate: 4.215 })).toEqual({
      ok: true,
      data: { currency: "USD", month: "2026-09" },
    });
    expect(fake.calls[0]).toMatchObject({
      table: "fx_rates",
      op: "insert",
      values: { currency: "USD", month: "2026-09-01", rate_to_myr: 4.215 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/cycles");
  });

  it("points at the month when the rate already exists", async () => {
    state.client = fakeSupabase({ tables: () => ({ data: null, error: pgError("23505", "duplicate key") }) }).client;
    const message = "There is already a USD rate for September 2026. Edit that rate instead.";
    expect(await createFxRateAction({ currency: "USD", month: "2026-09", rate: 4.2 })).toEqual({
      ok: false,
      error: message,
      fieldErrors: { month: message },
    });
  });

  it("updates and deletes one currency and month", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await updateFxRateAction({ currency: "USD", month: "2026-09", rate: 4.3 })).toMatchObject({ ok: true });
    expect(await deleteFxRateAction({ currency: "USD", month: "2026-09" })).toMatchObject({ ok: true });
    const [update, remove] = fake.calls;
    expect(update).toMatchObject({ op: "update", values: { rate_to_myr: 4.3 } });
    expect(filterValue(update, "currency")).toBe("USD");
    expect(filterValue(update, "month")).toBe("2026-09-01");
    expect(remove).toMatchObject({ op: "delete", returning: "currency" });
    expect(filterValue(remove, "month")).toBe("2026-09-01");
  });

  it("says when the rate is gone, and refuses partners and bad rates", async () => {
    state.client = fakeSupabase({ tables: () => ({ data: [], error: null }) }).client;
    const gone = "This rate no longer exists. Reload the page to see the current rates.";
    expect(await updateFxRateAction({ currency: "USD", month: "2026-09", rate: 4.3 })).toEqual({ ok: false, error: gone });
    expect(await deleteFxRateAction({ currency: "USD", month: "2026-09" })).toEqual({ ok: false, error: gone });

    state.role = "partner";
    expect(await createFxRateAction({ currency: "USD", month: "2026-09", rate: 4.2 })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    state.role = "super_admin";
    expect(await createFxRateAction({ currency: "USD", month: "2026-09", rate: 0 })).toMatchObject({
      ok: false,
      fieldErrors: { rate: "The rate must be more than 0." },
    });
  });
});

describe("updateCycleSettingsAction (BRD A5, B10)", () => {
  const input = { dueDay: 20, graceDays: 10, escalationDays: 21, expectedUpdatedAt: SETTINGS.updated_at };

  it("lets Fund Admins set the due day, grace period and escalation through set_cycle_settings", async () => {
    state.role = "fund_admin";
    const fake = fakeSupabase({ rpc: () => ({ data: "2026-10-01T02:00:00+00:00", error: null }) });
    state.client = fake.client;
    expect(await updateCycleSettingsAction(input)).toEqual({ ok: true, data: { updatedAt: "2026-10-01T02:00:00+00:00" } });
    expect(fake.rpcCalls).toEqual([
      {
        fn: "set_cycle_settings",
        args: { p_due_day: 20, p_backfill_grace_days: 10, p_escalation_days: 21, p_expected_updated_at: SETTINGS.updated_at },
      },
    ]);
    expect(fake.calls).toEqual([]); // never a direct platform_settings write
    expect(revalidatePath).toHaveBeenCalledWith("/admin/cycles");
  });

  it("refuses other roles and values out of range, and shows the database's refusal", async () => {
    state.role = "partner";
    expect(await updateCycleSettingsAction(input)).toEqual({ ok: false, error: MESSAGES.permission });
    state.role = "super_admin";
    expect(await updateCycleSettingsAction({ ...input, dueDay: 29 })).toMatchObject({
      ok: false,
      fieldErrors: { dueDay: "Choose a due day from 1 to 28." },
    });
    const stale =
      "Someone else changed the settings while you were editing. Reload the page to see their changes, then try again.";
    state.client = fakeSupabase({ rpc: () => ({ data: null, error: pgError("P0001", stale) }) }).client;
    expect(await updateCycleSettingsAction(input)).toEqual({ ok: false, error: stale });
  });
});

describe("updateSettingsAction", () => {
  const saved = settingsFromRow(SETTINGS);
  const input = (values: Partial<typeof saved>, expectedUpdatedAt = SETTINGS.updated_at) => ({
    ...saved,
    ...values,
    expectedUpdatedAt,
  });

  it("is for Super Admins only", async () => {
    state.role = "fund_admin";
    expect(await updateSettingsAction(input({ dueDay: 20 }))).toEqual({ ok: false, error: MESSAGES.permission });
  });

  it("writes only the changed columns, guarded by updated_at", async () => {
    const fake = fakeSupabase({ tables: () => ({ data: [{ id: 1 }], error: null }) });
    state.client = fake.client;
    expect(await updateSettingsAction(input({ dueDay: 20, ownerContributorLimit: 6 }))).toEqual({
      ok: true,
      data: { changed: true },
    });
    expect(fake.calls).toHaveLength(1);
    const [call] = fake.calls;
    expect(call).toMatchObject({ table: "platform_settings", op: "update", values: { due_day: 20, owner_contributor_limit: 6 } });
    expect(filterValue(call, "id")).toBe(1);
    expect(filterValue(call, "updated_at")).toBe(SETTINGS.updated_at);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("saves nothing when nothing changed", async () => {
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await updateSettingsAction(input({}))).toEqual({ ok: true, data: { changed: false } });
    expect(fake.calls).toEqual([]);
  });

  it("refuses a save over someone else's change", async () => {
    const stale =
      "Someone else changed the settings while you were editing. Reload the page to see their changes, then try again.";
    const fake = fakeSupabase();
    state.client = fake.client;
    expect(await updateSettingsAction(input({ dueDay: 20 }, "2026-09-29T00:00:00+00:00"))).toEqual({ ok: false, error: stale });
    expect(fake.calls).toEqual([]);

    // The row changed between the read and the write: the guarded update matches nothing.
    state.client = fakeSupabase({ tables: () => ({ data: [], error: null }) }).client;
    expect(await updateSettingsAction(input({ dueDay: 20 }))).toEqual({ ok: false, error: stale });
  });

  it("explains invalid values per field", async () => {
    const result = await updateSettingsAction(input({ dueDay: 31 }));
    expect(result).toMatchObject({ ok: false, error: MESSAGES.invalid, fieldErrors: { dueDay: "Enter a day from 1 to 28." } });
  });

  it("ends on /terms after a terms version change", async () => {
    state.client = fakeSupabase({ tables: () => ({ data: [{ id: 1 }], error: null }) }).client;
    const error = await updateSettingsAction(input({ termsVersion: "2026-10" })).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String((error as { digest?: unknown }).digest)).toContain("/terms");
  });

  it("shows the database's refusal", async () => {
    state.client = fakeSupabase({ tables: () => ({ data: null, error: pgError("23514", "check constraint") }) }).client;
    expect(await updateSettingsAction(input({ dueDay: 20 }))).toEqual({ ok: false, error: MESSAGES.notAllowed });
  });

  it("never turns two-factor authentication off (BRD §11, B11), but turns it back on", async () => {
    const fake = fakeSupabase({ tables: () => ({ data: [{ id: 1 }], error: null }) });
    state.client = fake.client;
    expect(await updateSettingsAction(input({ requireMfa: false, dueDay: 20 }))).toEqual({
      ok: false,
      error: MFA_ALWAYS_ON_MESSAGE,
    });
    expect(fake.calls).toEqual([]);
  });
});
