// The company home's loader (load-home.ts) against the fake PostgREST of tests/data with the real
// supabase-js client: it opens due months before reading, reads only this company's rows, names the
// people who sent months back "<full name> (ScaleUp)" with a single staff_display_names call (BRD B28)
// and degrades gracefully when the names or the due day cannot be read.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { changeRequests } from "@/app/portal/[companyId]/_components/home-model";
import { loadHome } from "@/app/portal/[companyId]/_components/load-home";
import { DataError } from "@/lib/data";

import { createFakeClient, type FakeOptions, type RecordedRequest, type Row, type TableData } from "../../data/fake-postgrest";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "c0000000-0000-4000-8000-000000000002";
const OWNER = "a1000000-0000-4000-8000-000000000001";
const PARTNER = "a1000000-0000-4000-8000-000000000005"; // ScaleUp staff with a name
const ADMIN = "a1000000-0000-4000-8000-000000000006"; // ScaleUp staff without a name
const SUB = {
  jul: "90000000-0000-4000-8000-000000000007",
  aug: "90000000-0000-4000-8000-000000000008",
  sep: "90000000-0000-4000-8000-000000000009",
  otherAug: "90000000-0000-4000-8000-000000000208",
};
const Q3 = "70000000-0000-4000-8000-000000000003";
const ts = "2026-09-30T06:00:00+00:00";

/** A ScaleUp staff directory as staff_display_names sees it (company users cannot read these profiles). */
const STAFF: Record<string, string | null> = { [PARTNER]: "Renuka Sena", [ADMIN]: "  " };

function overview(id: string, companyId: string, month: string, status: string, extra: Row = {}): Row {
  return {
    id,
    company_id: companyId,
    month,
    status,
    due_date: "2026-10-15",
    original_due_date: null,
    submitted_at: status === "draft" ? null : ts,
    approved_at: status === "approved" ? ts : null,
    revision: status === "draft" ? 0 : 1,
    last_saved_at: ts,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: false,
    open_threads: 0,
    ...extra,
  };
}

function financials(submissionId: string, companyId: string, month: string, status: string, revenue: number): Row {
  return {
    submission_id: submissionId,
    company_id: companyId,
    month,
    status,
    due_date: "2026-10-15",
    submitted_at: ts,
    approved_at: null,
    currency: "MYR",
    fx_rate_to_myr: 1,
    revenue_total: revenue,
    gross_profit: revenue / 2,
    net_profit: 1_000,
    cash_in_bank: 500_000,
    burn_rate: 20_000,
    headcount_ft: 8,
    headcount_pt: 1,
  };
}

function tables(): TableData {
  return {
    companies: [
      {
        id: COMPANY,
        name: "Batik Boutique",
        status: "active",
        reporting_start_month: "2026-07-01",
        reporting_currency: "MYR",
        created_at: ts,
        updated_at: ts,
      },
    ],
    v_submission_overview: [
      overview(SUB.jul, COMPANY, "2026-07-01", "approved"),
      overview(SUB.aug, COMPANY, "2026-08-01", "changes_requested", { due_date: "2026-10-12", open_threads: 1 }),
      overview(SUB.sep, COMPANY, "2026-09-01", "changes_requested", { due_date: "2026-10-14" }),
      overview(SUB.otherAug, OTHER_COMPANY, "2026-08-01", "changes_requested"),
    ],
    v_submission_financials: [
      financials(SUB.sep, COMPANY, "2026-09-01", "changes_requested", 300_000),
      financials(SUB.jul, COMPANY, "2026-07-01", "approved", 100_000),
      financials(SUB.aug, COMPANY, "2026-08-01", "changes_requested", 200_000),
    ],
    period_closes: [
      {
        id: Q3,
        company_id: COMPANY,
        period_type: "quarter",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        label: "Q3 2026",
        status: "open",
        confirmed_at: null,
      },
    ],
    submission_events: [
      { id: 1, submission_id: SUB.sep, event: "submitted", actor_id: OWNER, message: null, created_at: "2026-09-25T02:00:00+00:00" },
      { id: 2, submission_id: SUB.sep, event: "changes_requested", actor_id: PARTNER, message: "Please check GP", created_at: "2026-09-29T02:00:00+00:00" },
      { id: 3, submission_id: SUB.aug, event: "changes_requested", actor_id: ADMIN, message: "Older request", created_at: "2026-09-01T02:00:00+00:00" },
      { id: 4, submission_id: SUB.aug, event: "reopened", actor_id: null, message: "Restated per audited accounts", created_at: "2026-09-28T02:00:00+00:00" },
      { id: 5, submission_id: SUB.otherAug, event: "changes_requested", actor_id: PARTNER, message: "Other company", created_at: ts },
    ],
  };
}

const MANAGEMENT_ACCOUNTS = [{ id: "d1", period_close_id: Q3, version: 2, uploaded_at: "2026-10-01T02:00:00+00:00" }];

function client(
  data: TableData = tables(),
  { rpc = {}, intercept }: { rpc?: FakeOptions["rpc"]; intercept?: FakeOptions["intercept"] } = {},
) {
  return createFakeClient(data, {
    rpc: {
      open_due_periods: () => ({ body: 0 }),
      get_client_settings: () => ({
        body: [{ require_mfa: true, terms_version: "2026-09", declaration_text: "I confirm.", due_day: 20, owner_contributor_limit: 4 }],
      }),
      staff_display_names: (args) => ({
        body: (Array.isArray(args.p_ids) ? args.p_ids : [])
          .filter((id): id is string => typeof id === "string" && id in STAFF)
          .map((id) => ({ id, display_name: STAFF[id]?.trim() ? `${STAFF[id]?.trim()} (ScaleUp)` : "ScaleUp" })),
      }),
      ...rpc,
    },
    // The fake does not emulate `not.is.null`: answer the management-accounts query here (and check it).
    intercept: (request: RecordedRequest) =>
      intercept?.(request) ??
      (request.path === "documents" ? { status: 200, body: MANAGEMENT_ACCOUNTS } : undefined),
  });
}

const paths = (requests: RecordedRequest[]) => requests.map((r) => r.path);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadHome", () => {
  it("opens due months first, then reads this company's home", async () => {
    const { sb, requests } = client();
    const data = await loadHome(sb, COMPANY);
    expect(data).not.toBeNull();
    expect(requests[0].path).toBe("rpc/open_due_periods");

    expect(data?.company.name).toBe("Batik Boutique");
    expect(data?.submissions.map((s) => s.month)).toEqual(["2026-09-01", "2026-08-01", "2026-07-01"]);
    expect(data?.series.map((p) => p.month)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(data?.dueDay).toBe(20);
    expect(data?.closes.map((c) => c.label)).toEqual(["Q3 2026"]);
    expect(data?.managementAccounts).toEqual(MANAGEMENT_ACCOUNTS);
    expect(data?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const documents = requests.find((r) => r.path === "documents");
    expect(documents?.params.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(documents?.params.get("doc_type")).toBe("eq.management_accounts");
    expect(documents?.params.get("period_close_id")).toBe("not.is.null");
  });

  it("loads the change requests of the months sent back and names their authors (BRD B28)", async () => {
    const { sb, requests } = client();
    const data = await loadHome(sb, COMPANY);
    if (!data) throw new Error("expected data");

    // Only the events of this company's months that were sent back, newest first, with their actors.
    expect(data.changeEvents.map((e) => e.id)).toEqual([2, 4, 3]);
    const events = requests.find((r) => r.path === "submission_events");
    expect(events?.params.get("select")).toBe("id,submission_id,event,actor_id,message,created_at");
    expect(events?.params.get("event")).toBe("in.(changes_requested,reopened)");

    // One staff_display_names call for the distinct actors (system actions have none).
    const names = requests.filter((r) => r.path === "rpc/staff_display_names");
    expect(names).toHaveLength(1);
    expect(names[0].body).toEqual({ p_ids: [PARTNER, ADMIN] });
    expect(data.staffNames).toEqual({ [PARTNER]: "Renuka Sena (ScaleUp)", [ADMIN]: "ScaleUp" });

    const requestsShown = changeRequests(data.submissions, data.changeEvents, data.staffNames);
    expect(requestsShown.map((r) => [r.submission.month, r.kind, r.author, r.message])).toEqual([
      ["2026-08-01", "reopened", "ScaleUp", "Restated per audited accounts"],
      ["2026-09-01", "changes_requested", "Renuka Sena (ScaleUp)", "Please check GP"],
    ]);
    // Nothing ScaleUp-internal or person-identifying is read: no profiles, no company_internal.
    expect(paths(requests)).not.toContain("profiles");
    expect(paths(requests)).not.toContain("company_internal");
  });

  it("skips the events and names when no month was sent back", async () => {
    const data = tables();
    data.v_submission_overview = data.v_submission_overview.map((row) => ({ ...row, status: "approved" }));
    const { sb, requests } = client(data);
    const home = await loadHome(sb, COMPANY);
    expect(home?.changeEvents).toEqual([]);
    expect(home?.staffNames).toEqual({});
    expect(paths(requests)).not.toContain("submission_events");
    expect(paths(requests)).not.toContain("rpc/staff_display_names");
  });

  it("still shows the requests, signed 'ScaleUp', when the names cannot be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sb } = client(tables(), {
      rpc: {
        staff_display_names: () => ({ status: 401, body: { code: "42501", message: "Please sign in first.", details: null, hint: null } }),
      },
    });
    const data = await loadHome(sb, COMPANY);
    if (!data) throw new Error("expected data");
    expect(data.staffNames).toEqual({});
    expect(changeRequests(data.submissions, data.changeEvents, data.staffNames).map((r) => r.author)).toEqual([
      "ScaleUp",
      "ScaleUp",
    ]);
    expect(error).toHaveBeenCalled();
  });

  it("falls back to the default due day and survives a failed open_due_periods", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = { status: 400, body: { code: "P0001", message: "Publish the default reporting template first.", details: null, hint: null } };
    const { sb } = client(tables(), {
      rpc: { get_client_settings: () => failure, open_due_periods: () => failure },
    });
    const data = await loadHome(sb, COMPANY);
    expect(data?.dueDay).toBe(15);
    expect(data?.submissions).toHaveLength(3);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("returns null when the company is not visible", async () => {
    const data = tables();
    data.companies = [];
    const { sb } = client(data);
    expect(await loadHome(sb, COMPANY)).toBeNull();
  });

  it("throws a DataError when a query fails", async () => {
    const { sb } = client(tables(), {
      intercept: (request) =>
        request.path === "period_closes"
          ? { status: 500, body: { code: "XX000", message: "boom", details: null, hint: null } }
          : undefined,
    });
    await expect(loadHome(sb, COMPANY)).rejects.toBeInstanceOf(DataError);
  });
});
