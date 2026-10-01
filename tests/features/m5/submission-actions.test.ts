import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  assertUser: vi.fn(),
  assertCompanyAccess: vi.fn(),
  assertScaleUp: vi.fn(),
  assertCanViewCompany: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data", () => ({
  getSubmission: vi.fn(),
  getSubmissionValidation: vi.fn(),
  getSubmissionValues: vi.fn(),
}));
vi.mock("@/components/submission-form/queries", () => ({ listEarlierDrafts: vi.fn() }));

import { revalidatePath } from "next/cache";

import { listEarlierDrafts } from "@/components/submission-form/queries";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import {
  getSubmissionValidationAction,
  requestAmendment,
  saveSubmissionValues,
  submitSubmission,
} from "@/lib/actions/submission";
import { assertCanViewCompany, assertCompanyAccess, assertScaleUp, assertUser } from "@/lib/auth/session";
import { getSubmission, getSubmissionValidation, getSubmissionValues } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const SUB = "90000000-0000-4000-8000-000000000009";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const SEGMENT = "f0000000-0000-4000-8000-000000000001";
const KPI = "e0000000-0000-4000-8000-000000000001";
const MEMBER = "d1000000-0000-4000-8000-000000000001";

const SUBMISSION = {
  id: SUB,
  company_id: COMPANY,
  month: "2026-09-01",
  status: "draft",
  last_saved_at: "2026-09-30T05:00:00+00:00",
};

type RpcResult = { data: unknown; error: { code: string; message: string } | null };

function fakeClient(
  rpcResult: RpcResult = { data: "2026-09-30T06:05:00+00:00", error: null },
  company = { reporting_start_month: "2026-07-01" },
) {
  const rpc = vi.fn(async () => rpcResult);
  const maybeSingle = vi.fn(async () => ({ data: company, error: null }));
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle };
  const from = vi.fn(() => chain);
  return { rpc, from, chain };
}

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { code, details: "", hint: "", name: "PostgrestError" });
}

const companyUser = { userId: "u1", scaleupRole: null, memberships: [] };
const fundAdmin = { userId: "u2", scaleupRole: "fund_admin", memberships: [] };

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  vi.clearAllMocks();
  client = fakeClient();
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(assertUser).mockResolvedValue(companyUser as never);
  vi.mocked(assertCompanyAccess).mockResolvedValue({ ...companyUser, companyRole: "owner" } as never);
  vi.mocked(assertScaleUp).mockResolvedValue(fundAdmin as never);
  vi.mocked(assertCanViewCompany).mockResolvedValue({ ...companyUser, companyRole: "owner" } as never);
  vi.mocked(getSubmission).mockResolvedValue(SUBMISSION as never);
});

const FORM_PATHS = [
  `/portal/${COMPANY}/updates/2026-09`,
  `/portal/${COMPANY}/updates`,
  `/portal/${COMPANY}`,
  `/admin/companies/${COMPANY}/updates/2026-09`,
  `/admin/review/${SUB}`,
  "/admin/tracker",
];

function revalidated(): string[] {
  return vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
}

describe("saveSubmissionValues", () => {
  it("saves the changed entries for a company member and revalidates the month's pages", async () => {
    const result = await saveSubmissionValues({
      submissionId: SUB,
      values: [
        { key: "gross_profit", value_number: -1200.5 },
        { key: "key_milestones", value_text: null },
      ],
      segments: [{ segment_id: SEGMENT, amount: 1000 }],
      kpis: [{ kpi_id: KPI, dimension_member_id: MEMBER, value_number: 3 }],
    });

    expect(result).toEqual({ ok: true, data: { savedAt: "2026-09-30T06:05:00+00:00" } });
    expect(assertCompanyAccess).toHaveBeenCalledWith(COMPANY);
    expect(assertScaleUp).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith("save_submission_values", {
      p_submission_id: SUB,
      p_values: [
        { key: "gross_profit", value_number: -1200.5 },
        { key: "key_milestones", value_text: null },
      ],
      p_segments: [{ segment_id: SEGMENT, amount: 1000 }],
      p_kpis: [{ kpi_id: KPI, dimension_member_id: MEMBER, value_number: 3 }],
    });
    expect(revalidated()).toEqual(FORM_PATHS);
  });

  it("lets a Fund Admin save on behalf, and only a Fund Admin among ScaleUp staff", async () => {
    vi.mocked(assertUser).mockResolvedValue(fundAdmin as never);
    const result = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: 1 }],
    });
    expect(result.ok).toBe(true);
    expect(assertScaleUp).toHaveBeenCalledWith(["fund_admin"]);
    expect(assertCompanyAccess).not.toHaveBeenCalled();

    vi.mocked(assertUser).mockResolvedValue({ ...fundAdmin, scaleupRole: "partner" } as never);
    vi.mocked(assertScaleUp).mockRejectedValue(new ActionError(MESSAGES.permission));
    const refused = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: 1 }],
    });
    expect(refused).toEqual({ ok: false, error: MESSAGES.permission });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses numbers sent as text and unknown properties before calling the database", async () => {
    const asText = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: "12" as unknown as number }],
    });
    expect(asText.ok).toBe(false);
    const extra = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: 1, value_bool: true } as never],
    });
    expect(extra.ok).toBe(false);
    const huge = await saveSubmissionValues({ submissionId: SUB, segments: [{ segment_id: SEGMENT, amount: 1e15 }] });
    expect(huge.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a month it cannot see as not found", async () => {
    vi.mocked(getSubmission).mockResolvedValue(null);
    const result = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: 1 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "This monthly update was not found or you do not have access to it.",
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("shows the database's business-rule message", async () => {
    client = fakeClient({
      data: null,
      error: pgError("P0001", "Sep 2026 has been submitted and is awaiting review, so it can no longer be edited."),
    });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const result = await saveSubmissionValues({
      submissionId: SUB,
      values: [{ key: "gross_profit", value_number: 1 }],
    });
    expect(result).toEqual({
      ok: false,
      error: "Sep 2026 has been submitted and is awaiting review, so it can no longer be edited.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does nothing for an empty save", async () => {
    const result = await saveSubmissionValues({ submissionId: SUB });
    expect(result).toEqual({ ok: true, data: { savedAt: SUBMISSION.last_saved_at } });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("submitSubmission", () => {
  it("submits for the owner with the declaration and revalidates the lists", async () => {
    const result = await submitSubmission(SUB, true);
    expect(result).toEqual({ ok: true, data: { month: "2026-09" } });
    expect(assertCompanyAccess).toHaveBeenCalledWith(COMPANY, ["owner"]);
    expect(client.rpc).toHaveBeenCalledWith("submit_submission", {
      p_submission_id: SUB,
      p_declaration_accepted: true,
    });
    expect(revalidated()).toEqual([...FORM_PATHS, `/portal/${COMPANY}/history`, `/admin/companies/${COMPANY}`]);
  });

  it("needs the declaration", async () => {
    const result = await submitSubmission(SUB, false);
    expect(result).toEqual({ ok: false, error: "Please confirm the declaration before submitting." });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("is refused for contributors", async () => {
    vi.mocked(assertCompanyAccess).mockRejectedValue(new ActionError(MESSAGES.permission));
    const result = await submitSubmission(SUB, true);
    expect(result).toEqual({ ok: false, error: MESSAGES.permission });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("passes on the earlier-months rule of the database", async () => {
    client = fakeClient({ data: null, error: pgError("P0001", "Submit earlier months first: Jul 2026, Aug 2026.") });
    vi.mocked(createClient).mockResolvedValue(client as never);
    const result = await submitSubmission(SUB, true);
    expect(result).toEqual({ ok: false, error: "Submit earlier months first: Jul 2026, Aug 2026." });
  });
});

describe("requestAmendment", () => {
  it("sends the trimmed reason for the owner", async () => {
    vi.mocked(getSubmission).mockResolvedValue({ ...SUBMISSION, status: "approved" } as never);
    const result = await requestAmendment(SUB, "  Net profit was restated after the audit.  ");
    expect(result).toEqual({ ok: true, data: undefined });
    expect(assertCompanyAccess).toHaveBeenCalledWith(COMPANY, ["owner"]);
    expect(client.rpc).toHaveBeenCalledWith("request_amendment", {
      p_submission_id: SUB,
      p_reason: "Net profit was restated after the audit.",
    });
  });

  it("needs a reason", async () => {
    const result = await requestAmendment(SUB, "   ");
    expect(result).toEqual({
      ok: false,
      error: "Please describe the amendment you need.",
      fieldErrors: { reason: "Please describe the amendment you need." },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("states the reason's length limit rather than a generic message", async () => {
    const result = await requestAmendment(SUB, "x".repeat(4_901));
    expect(result).toEqual({
      ok: false,
      error: "Please keep the description under 4,900 characters.",
      fieldErrors: { reason: "Please keep the description under 4,900 characters." },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("reports a malformed id as not found", async () => {
    const result = await requestAmendment("not-a-uuid", "Audit adjustment");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This monthly update was not found or you do not have access to it.");
    expect(getSubmission).not.toHaveBeenCalled();
  });
});

describe("getSubmissionValidationAction", () => {
  const stored = {
    values: {
      gross_profit: {
        submission_id: SUB,
        field_key: "gross_profit",
        value_number: 10,
        value_text: null,
        value_json: null,
        created_at: "x",
        updated_at: "x",
        updated_by: "someone",
      },
    },
    segments: {},
    kpis: {},
  };

  it("returns the server check with the stored values (value columns only)", async () => {
    vi.mocked(getSubmissionValidation).mockResolvedValue({ ok: true, errors: [] });
    vi.mocked(getSubmissionValues).mockResolvedValue(stored as never);
    const result = await getSubmissionValidationAction(SUB);
    expect(result).toEqual({
      ok: true,
      data: {
        ok: true,
        errors: [],
        priorMonths: [],
        values: {
          values: { gross_profit: { value_number: 10, value_text: null, value_json: null } },
          segments: {},
          kpis: {},
        },
        lastSavedAt: SUBMISSION.last_saved_at,
        status: "draft",
      },
    });
    expect(assertCanViewCompany).toHaveBeenCalledWith(COMPANY);
    expect(listEarlierDrafts).not.toHaveBeenCalled();
  });

  it("lists the earlier months to submit when that rule fails", async () => {
    vi.mocked(getSubmissionValidation).mockResolvedValue({
      ok: false,
      errors: [{ target: "general", code: "prior_months", message: "Submit earlier months first: Aug 2026." }],
    });
    vi.mocked(getSubmissionValues).mockResolvedValue(stored as never);
    vi.mocked(listEarlierDrafts).mockResolvedValue(["2026-08"]);
    const result = await getSubmissionValidationAction(SUB);
    expect(result.ok && result.data.priorMonths).toEqual(["2026-08"]);
    expect(client.from).toHaveBeenCalledWith("companies");
    expect(listEarlierDrafts).toHaveBeenCalledWith(client, COMPANY, "2026-09-01", "2026-07-01");
  });

  it("refuses a malformed id", async () => {
    const result = await getSubmissionValidationAction("not-a-uuid");
    expect(result.ok).toBe(false);
    expect(getSubmission).not.toHaveBeenCalled();
  });
});
