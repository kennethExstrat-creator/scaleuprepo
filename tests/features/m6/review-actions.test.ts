import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ assertScaleUp: vi.fn() }));
vi.mock("@/lib/data", () => ({ getSubmission: vi.fn(), getCompany: vi.fn(), getCompanyInternal: vi.fn() }));

import { revalidatePath } from "next/cache";

import {
  approveSubmissionAction,
  extendDueDateAction,
  reopenSubmissionAction,
  requestChangesAction,
} from "@/app/admin/review/[submissionId]/actions";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import { assertScaleUp } from "@/lib/auth/session";
import { getCompany, getCompanyInternal, getSubmission } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { CompanyInternalWithPartner, SubmissionRow } from "@/lib/types/domain";
import type { CompanyStatus, ScaleupRole, SubmissionStatus } from "@/lib/types/enums";

import { IDS, TS, companyRow, submissionRow } from "./fixtures";
import { fakeSupabase, scaleUpCtx, type Answer } from "./fake-supabase";

const INTERNAL: CompanyInternalWithPartner = {
  company_id: IDS.company,
  partner_in_charge_id: IDS.partner,
  internal_rating: null,
  exit_strategy_status: null,
  exit_strategy_notes: null,
  notes: null,
  updated_by: null,
  created_at: TS,
  updated_at: TS,
  partner: { id: IDS.partner, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner", is_active: true },
};

function setUp(opts: {
  role: ScaleupRole;
  userId?: string;
  status?: SubmissionStatus;
  companyStatus?: CompanyStatus;
  rpc?: Answer;
  /** Changes to the month as it is before the action (e.g. an earlier due date). */
  before?: Partial<SubmissionRow>;
  after?: Partial<SubmissionRow>;
}) {
  const ctx = scaleUpCtx(opts.role, opts.userId ?? `user-${opts.role}`);
  vi.mocked(assertScaleUp).mockImplementation(async (roles) => {
    if (roles && !roles.includes(ctx.scaleupRole)) throw new ActionError(MESSAGES.permission);
    return ctx;
  });
  const before = { ...submissionRow(IDS.sep, "2026-09-01", opts.status ?? "submitted"), ...opts.before };
  vi.mocked(getSubmission).mockResolvedValueOnce(before).mockResolvedValue({ ...before, ...opts.after });
  vi.mocked(getCompany).mockResolvedValue(companyRow({ status: opts.companyStatus ?? "active" }));
  vi.mocked(getCompanyInternal).mockResolvedValue(INTERNAL);
  const db = fakeSupabase(undefined, () => opts.rpc ?? { data: null, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubmission).mockReset();
});

describe("approveSubmissionAction", () => {
  it("lets the partner-in-charge approve, with an optional message", async () => {
    const db = setUp({ role: "partner", userId: IDS.partner });
    expect(await approveSubmissionAction({ submissionId: IDS.sep, message: "   " })).toEqual({ ok: true, data: undefined });
    expect(db.rpcs).toEqual([{ name: "approve_submission", args: { p_submission_id: IDS.sep, p_message: undefined } }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/review/${IDS.sep}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/tracker");
    expect(revalidatePath).toHaveBeenCalledWith(`/portal/${IDS.company}/updates/2026-09`);
  });

  it("refuses other partners and Fund Admins before calling the database (BRD B9)", async () => {
    let db = setUp({ role: "partner", userId: "a1000000-0000-4000-8000-000000000099" });
    expect(await approveSubmissionAction({ submissionId: IDS.sep })).toEqual({
      ok: false,
      error: "Only the partner-in-charge or a Super Admin can approve this update.",
    });
    expect(db.rpcs).toHaveLength(0);
    db = setUp({ role: "fund_admin" });
    expect(await approveSubmissionAction({ submissionId: IDS.sep })).toEqual({ ok: false, error: MESSAGES.permission });
    expect(db.rpcs).toHaveLength(0);
  });

  it("still approves months of exited companies (BRD B21) and passes database refusals through", async () => {
    let db = setUp({ role: "super_admin", companyStatus: "exited" });
    expect((await approveSubmissionAction({ submissionId: IDS.sep, message: "Final numbers." })).ok).toBe(true);
    expect(db.rpcs[0].args).toEqual({ p_submission_id: IDS.sep, p_message: "Final numbers." });
    db = setUp({ role: "super_admin", rpc: { data: null, error: { code: "P0001", message: "Only submitted updates can be approved." } } });
    expect(await approveSubmissionAction({ submissionId: IDS.sep })).toEqual({ ok: false, error: "Only submitted updates can be approved." });
    expect(revalidatePath).toHaveBeenCalledTimes(10);
  });
});

describe("requestChangesAction", () => {
  it("sends the month back with a message and reports the new due date", async () => {
    const db = setUp({ role: "fund_admin", after: { status: "changes_requested", due_date: "2026-10-24" } });
    expect(await requestChangesAction({ submissionId: IDS.sep, message: "  Please fix the Online segment. " })).toEqual({
      ok: true,
      data: { dueDate: "2026-10-24" },
    });
    expect(db.rpcs).toEqual([
      { name: "request_changes", args: { p_submission_id: IDS.sep, p_message: "Please fix the Online segment." } },
    ]);
  });

  it("requires a message", async () => {
    const db = setUp({ role: "partner" });
    expect(await requestChangesAction({ submissionId: IDS.sep, message: "  " })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: { message: "Explain what needs to change." },
    });
    expect(db.rpcs).toHaveLength(0);
  });

  it("refuses exited companies and viewers", async () => {
    let db = setUp({ role: "partner", companyStatus: "written_off" });
    expect(await requestChangesAction({ submissionId: IDS.sep, message: "Fix it" })).toEqual({
      ok: false,
      error: "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
    });
    expect(db.rpcs).toHaveLength(0);
    db = setUp({ role: "viewer" });
    expect(await requestChangesAction({ submissionId: IDS.sep, message: "Fix it" })).toEqual({ ok: false, error: MESSAGES.permission });
    expect(db.rpcs).toHaveLength(0);
  });

  it("answers unknown months with a not-found message", async () => {
    setUp({ role: "partner" });
    vi.mocked(getSubmission).mockReset().mockResolvedValue(null);
    expect(await requestChangesAction({ submissionId: IDS.sep, message: "Fix it" })).toEqual({
      ok: false,
      error: "This monthly update was not found or you do not have access to it.",
    });
  });
});

describe("reopenSubmissionAction", () => {
  it("lets a Fund Admin reopen an approved month with a reason (BRD B8)", async () => {
    const db = setUp({ role: "fund_admin", status: "approved", after: { status: "changes_requested", due_date: "2026-10-15" } });
    expect(await reopenSubmissionAction({ submissionId: IDS.sep, reason: "Restated cash." })).toEqual({
      ok: true,
      data: { dueDate: "2026-10-15" },
    });
    expect(db.rpcs).toEqual([{ name: "reopen_submission", args: { p_submission_id: IDS.sep, p_reason: "Restated cash." } }]);
  });

  it("refuses partners who are not in charge and exited companies", async () => {
    let db = setUp({ role: "partner", userId: "someone-else", status: "approved" });
    expect(await reopenSubmissionAction({ submissionId: IDS.sep, reason: "Why not" })).toEqual({
      ok: false,
      error: "Only a Super Admin, a Fund Admin or the partner-in-charge can reopen an approved month.",
    });
    expect(db.rpcs).toHaveLength(0);
    db = setUp({ role: "super_admin", status: "approved", companyStatus: "exited" });
    expect((await reopenSubmissionAction({ submissionId: IDS.sep, reason: "Why not" })).ok).toBe(false);
    expect(db.rpcs).toHaveLength(0);
    expect(await reopenSubmissionAction({ submissionId: IDS.sep, reason: "" })).toMatchObject({
      ok: false,
      fieldErrors: { reason: "Give a reason for reopening this month." },
    });
  });
});

describe("extendDueDateAction", () => {
  // 1 Oct 2026, 10:00 in Malaysia.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T02:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the due date to a later day with an optional reason", async () => {
    const db = setUp({ role: "fund_admin" });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-10-29", reason: "  " })).toEqual({
      ok: true,
      data: { dueDate: "2026-10-29" },
    });
    expect(db.rpcs).toEqual([
      { name: "extend_due_date", args: { p_submission_id: IDS.sep, p_new_due_date: "2026-10-29", p_reason: undefined } },
    ]);
  });

  it("refuses dates that are not later, malformed dates and roles other than Super Admin and Fund Admin", async () => {
    let db = setUp({ role: "super_admin" });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-10-15" })).toEqual({
      ok: false,
      error: "The new due date must be after the current due date (15 Oct 2026).",
      fieldErrors: { newDueDate: "The new due date must be after the current due date (15 Oct 2026)." },
    });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-02-30" })).toMatchObject({
      ok: false,
      fieldErrors: { newDueDate: "Choose the new due date." },
    });
    expect(db.rpcs).toHaveLength(0);
    db = setUp({ role: "partner" });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-10-29" })).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(db.rpcs).toHaveLength(0);
  });

  it("refuses a date in the past for an overdue month, and accepts today or later", async () => {
    // August, due 15 Sep and overdue on 1 Oct: 22 Sep is after the due date but would leave it overdue.
    let db = setUp({ role: "fund_admin", status: "draft", before: { month: "2026-08-01", due_date: "2026-09-15" } });
    const message = "The new due date cannot be in the past. Choose today (1 Oct 2026) or a later date.";
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-09-22" })).toEqual({
      ok: false,
      error: message,
      fieldErrors: { newDueDate: message },
    });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-09-30" })).toMatchObject({
      ok: false,
      fieldErrors: { newDueDate: message },
    });
    expect(db.rpcs).toHaveLength(0);

    db = setUp({ role: "fund_admin", status: "draft", before: { month: "2026-08-01", due_date: "2026-09-15" } });
    expect(await extendDueDateAction({ submissionId: IDS.sep, newDueDate: "2026-10-01" })).toEqual({
      ok: true,
      data: { dueDate: "2026-10-01" },
    });
    expect(db.rpcs).toEqual([
      { name: "extend_due_date", args: { p_submission_id: IDS.sep, p_new_due_date: "2026-10-01", p_reason: undefined } },
    ]);
  });
});
