// loadCycles (src/app/admin/cycles/_lib/load-cycles.ts) against a fake Supabase client: it opens the due
// months first, reads every table it needs (paging the portfolio-wide reads), names the people involved and
// builds the page's data. A failed open_due_periods() is reported without stopping the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", async () => {
  const { DataError } = await vi.importActual<typeof import("@/lib/data/errors")>("@/lib/data/errors");
  return {
    DataError,
    getPlatformSettings: vi.fn(),
    isNotFoundError: (e: unknown) => e instanceof DataError && e.notFound,
  };
});

import { loadCycles } from "@/app/admin/cycles/_lib/load-cycles";
import { getPlatformSettings } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fakeSupabase, paged, pgError, type TableCall } from "./fake-supabase";
import {
  ADMIN,
  CLOSES,
  COMPANIES,
  EXTENSION_EVENTS,
  EXTENSION_ROWS,
  FUND_ADMIN,
  KIDDO,
  NOW,
  OVERVIEW,
  RATES,
  RECQA,
  SEND_BACK_EVENTS,
  SETTINGS,
  overviewId,
} from "./fixtures";

const PERIOD_ROWS = [
  {
    month: "2026-09-01",
    due_date: "2026-10-15",
    opened_at: "2026-09-30T16:05:00Z",
    opened_by: null,
    template_version: { version_no: 1, status: "published", template: { name: "Portfolio Update" } },
  },
  {
    month: "2026-08-01",
    due_date: "2026-09-15",
    opened_at: "2026-08-20T03:00:00Z",
    opened_by: ADMIN,
    template_version: { version_no: 1, status: "published", template: { name: "Portfolio Update" } },
  },
  {
    month: "2026-07-01",
    due_date: "2026-08-15",
    opened_at: "2026-09-30T08:00:00Z",
    opened_by: null,
    template_version: { version_no: 1, status: "published", template: { name: "Portfolio Update" } },
  },
];

/** The overview as the view returns it: every column nullable, plus a row without an id (ignored). */
const OVERVIEW_ROWS = [
  ...OVERVIEW,
  { id: null, company_id: KIDDO, month: "2026-09-01", status: "draft", due_date: "2026-10-15", original_due_date: null, is_overdue: null, days_overdue: null },
];

/** submission_events as the database answers each query: only the events asked for, the message when selected. */
function eventRows(call: TableCall) {
  const eq = call.filters.find((filter) => filter.op === "eq" && filter.column === "event");
  const within = call.filters.find((filter) => filter.op === "in" && filter.column === "event");
  const withMessage = call.columns?.includes("message") ?? false;
  return [...EXTENSION_EVENTS, ...SEND_BACK_EVENTS]
    .filter((event) => (eq ? event.event === eq.value : true))
    .filter((event) => (within ? (within.value as string[]).includes(event.event) : true))
    .map(({ message, ...event }) => (withMessage ? { ...event, message: message ?? null } : event));
}

function tables(call: TableCall) {
  switch (call.table) {
    case "reporting_periods":
      return { data: PERIOD_ROWS, error: null };
    case "v_submission_overview":
      return paged(OVERVIEW_ROWS, call);
    case "companies":
      return { data: COMPANIES, error: null };
    case "submissions":
      return paged(EXTENSION_ROWS, call);
    case "submission_events":
      return paged(eventRows(call), call);
    case "period_closes":
      return paged(CLOSES.map((close, index) => ({ id: `close-${index}`, ...close })), call);
    case "fx_rates":
      return paged(RATES, call);
    case "templates":
      return {
        data: {
          name: "Portfolio Update",
          template_versions: [
            { version_no: 1, status: "archived" },
            { version_no: 2, status: "published" },
          ],
        },
        error: null,
      };
    case "profiles":
      return {
        data: [
          { id: ADMIN, full_name: "Kenneth Lim", email: "kenneth@example.com" },
          { id: FUND_ADMIN, full_name: " ", email: "aisha@example.com" },
        ],
        error: null,
      };
    default:
      return undefined;
  }
}

type Client = SupabaseClient<Database>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(getPlatformSettings).mockResolvedValue(SETTINGS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("loadCycles", () => {
  it("opens the due months, then builds the page's data", async () => {
    const fake = fakeSupabase({ tables });
    const { data, openError } = await loadCycles(fake.client as unknown as Client);

    expect(openError).toBeNull();
    expect(fake.rpcCalls[0]).toEqual({ fn: "open_due_periods", args: undefined });
    expect(data).toMatchObject({ today: "2026-10-01", currentMonth: "2026-10", dueDay: 15, graceDays: 14, escalationDays: 14 });
    expect(data.months.map((month) => month.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(data.months[1].openedBy).toBe("Kenneth Lim");
    // The view row without an id is ignored.
    expect(data.months[0].progress.total).toBe(4);
    expect(data.overdue).toEqual({ overdue: 3, escalated: 2, companies: 3 });
    expect(data.openEarly).toMatchObject({ month: "2026-10", dueDate: "2026-11-15" });
    expect(data.currentTemplateLabel).toBe("Portfolio Update v2");
    expect(data.extensions).toHaveLength(3);
    const kiddo = data.extensions.find((row) => row.submissionId === overviewId(KIDDO, "2026-07-01"));
    expect(kiddo).toMatchObject({ cause: "extended", extendedBy: "Kenneth Lim", extendedTo: "2026-08-29", extensionCount: 2 });
    const recqa = data.extensions.find((row) => row.submissionId === overviewId(RECQA, "2026-08-01"));
    expect(recqa).toMatchObject({ cause: "sent_back", sentBack: { kind: "changes_requested", by: "Kenneth Lim" } });
    expect(data.deadlineChoices.map((choice) => choice.companyName)).toEqual([
      "Acme Pte Ltd",
      "Batik Boutique",
      "Kiddocare",
      "RECQA",
    ]);
    expect(data.closes.map((close) => close.key)).toEqual(["Q3-2026", "Q2-2026", "H1-2026"]);
    expect(data.upcoming.map((close) => close.key)).toEqual(["Q4-2026", "H2-2026"]);
    expect(data.fxCurrencies).toEqual(["USD"]);
    expect(data.fx.map((group) => group.currency)).toEqual(["SGD", "USD"]);
    // A blank name falls back to the email.
    expect(data.fx[1].rows.find((row) => row.month === "2026-07")?.updatedBy).toBe("aisha@example.com");
    expect(data.fxRange).toEqual({ from: "2024-01", to: "2026-10" });
    expect(data.reportingCompanies).toBe(4);
  });

  it("reads the portfolio-wide tables page by page with an exact count", async () => {
    const fake = fakeSupabase({ tables });
    await loadCycles(fake.client as unknown as Client);
    const overview = fake.calls.find((call) => call.table === "v_submission_overview");
    expect(overview?.options).toEqual({ count: "exact" });
    expect(overview?.range).toEqual([0, 999]);
    const extensions = fake.calls.find((call) => call.table === "submissions");
    expect(extensions?.filters).toContainEqual({ op: "not", column: "original_due_date", value: null });
    const events = fake.calls.filter((call) => call.table === "submission_events");
    const extended = events.find((call) => call.filters.some((filter) => filter.op === "eq"));
    expect(extended?.filters).toEqual([{ op: "eq", column: "event", value: "deadline_extended" }]);
    expect(extended?.columns).toContain("message");
    // Send-backs and reopenings, without their messages to the company.
    const sentBack = events.find((call) => call.filters.some((filter) => filter.op === "in"));
    expect(sentBack?.filters).toEqual([{ op: "in", column: "event", value: ["changes_requested", "reopened"] }]);
    expect(sentBack?.columns).not.toContain("message");
    expect(sentBack?.options).toEqual({ count: "exact" });
    const profiles = fake.calls.find((call) => call.table === "profiles");
    expect(new Set(profiles?.filters[0]?.value as string[])).toEqual(new Set([ADMIN, FUND_ADMIN]));
  });

  it("keeps going when the due months cannot be opened", async () => {
    const message = "Publish the default reporting template before opening reporting months.";
    const fake = fakeSupabase({ tables, rpc: () => ({ data: null, error: pgError("P0001", message) }) });
    const { data, openError } = await loadCycles(fake.client as unknown as Client);
    expect(openError).toBe(message);
    expect(data.months).toHaveLength(3);
  });

  it("throws a DataError when a read fails", async () => {
    const fake = fakeSupabase({
      tables: (call) => (call.table === "fx_rates" ? { data: null, error: pgError("XX000", "boom") } : tables(call)),
    });
    await expect(loadCycles(fake.client as unknown as Client)).rejects.toMatchObject({
      name: "DataError",
      message: expect.stringContaining("could not load the FX rates"),
    });
  });
});
