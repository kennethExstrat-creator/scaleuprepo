import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ assertCompanyAccess: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data", () => ({ setCompanyRevenueSegments: vi.fn() }));

import { revalidatePath } from "next/cache";

import { saveRevenueSegmentsAction } from "@/app/portal/[companyId]/segments/actions";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import { assertCompanyAccess } from "@/lib/auth/session";
import { setCompanyRevenueSegments } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { ALL_SEGMENTS, IDS, ONLINE, RETAIL, segmentRow } from "./fixtures";

const COMPANY = IDS.company;
const STALE = "The revenue segments have changed since this page was opened. Reload the page and try again.";
/** What the editor was opened with: the company's segments in use (Retail, Online). */
const OPENED = [
  { id: IDS.retail, name: "Retail" },
  { id: IDS.online, name: "Online" },
];

/** The RLS client: `revenue_segments` reads with their filters applied, recorded for the assertions. */
const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as null | { code: string; message: string },
  reads: [] as { table: string; columns: string; filters: [string, unknown][] }[],
}));

type QueryBuilder = {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};

function fakeClient() {
  return {
    from(table: string): QueryBuilder {
      const read = { table, columns: "", filters: [] as [string, unknown][] };
      db.reads.push(read);
      const builder: QueryBuilder = {
        select(columns: string) {
          read.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          read.filters.push([column, value]);
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = db.rows.filter((row) => read.filters.every(([column, value]) => row[column] === value));
          return Promise.resolve(db.error ? { data: null, error: db.error } : { data, error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return builder;
    },
  };
}

let client = fakeClient();

function owner(companyStatus: "active" | "exited" | "written_off" = "active", role: "owner" | "contributor" = "owner") {
  return {
    userId: IDS.owner,
    email: "owner@example.com",
    fullName: "Aisha Rahman",
    scaleupRole: null,
    isActive: true,
    memberships: [{ companyId: COMPANY, companyName: "Demo Company", companyStatus, role }],
    aal: "aal2",
    mfaRequired: true,
    termsAccepted: true,
    companyRole: role,
  };
}

/** A data-layer failure as setCompanyRevenueSegments throws it: a DataError wrapping the database error. */
function dataError(code: string, message: string) {
  return Object.assign(new Error("setCompanyRevenueSegments: save the revenue segments failed"), {
    name: "DataError",
    code,
    cause: { code, message },
  });
}

function revalidated(): string[] {
  return vi.mocked(revalidatePath).mock.calls.map((call) => (call[1] ? `${call[0]} (${call[1]})` : call[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Both kinds, active and retired: only the company's own segments in use count.
  db.rows = ALL_SEGMENTS;
  db.error = null;
  db.reads = [];
  client = fakeClient();
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(assertCompanyAccess).mockResolvedValue(owner() as never);
  vi.mocked(setCompanyRevenueSegments).mockResolvedValue([
    { ...RETAIL, sort_order: 1 },
    segmentRow("f1000000-0000-4000-8000-000000000010", "Web shop", "company", 2),
  ]);
});

describe("saveRevenueSegmentsAction", () => {
  it("saves the complete list for the owner, trimmed, and refreshes every page that shows it", async () => {
    const result = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [
        { id: IDS.retail.toUpperCase(), name: " Retail " },
        { id: null, name: "Web shop\n" },
      ],
    });

    expect(result).toEqual({
      ok: true,
      data: {
        segments: [
          { id: IDS.retail, name: "Retail" },
          { id: "f1000000-0000-4000-8000-000000000010", name: "Web shop" },
        ],
      },
    });
    expect(assertCompanyAccess).toHaveBeenCalledWith(COMPANY, ["owner"]);
    // The segments in use are read on the RLS client first: the company's own, active ones.
    expect(db.reads).toEqual([
      {
        table: "revenue_segments",
        columns: "*",
        filters: [
          ["company_id", COMPANY],
          ["kind", "company"],
          ["is_active", true],
        ],
      },
    ]);
    expect(setCompanyRevenueSegments).toHaveBeenCalledWith(client, COMPANY, [
      { id: IDS.retail, name: "Retail" },
      { name: "Web shop" },
    ]);
    expect(revalidated()).toEqual([
      `/portal/${COMPANY}/segments`,
      `/portal/${COMPANY}/updates`,
      "/portal/[companyId]/updates/[month] (page)",
      `/portal/${COMPANY}`,
      `/admin/companies/${COMPANY}`,
    ]);
  });

  it("accepts an empty list (the company then enters total revenue directly)", async () => {
    vi.mocked(setCompanyRevenueSegments).mockResolvedValue([]);
    expect(await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [] })).toEqual({
      ok: true,
      data: { segments: [] },
    });
    expect(setCompanyRevenueSegments).toHaveBeenCalledWith(client, COMPANY, []);
  });

  it("compares the segments in use with those the editor was opened with, ignoring the case of ids", async () => {
    const opened = OPENED.map((segment) => ({ ...segment, id: segment.id.toUpperCase() }));
    const result = await saveRevenueSegmentsAction({ companyId: COMPANY, expected: opened, segments: [] });
    expect(result.ok).toBe(true);
  });

  it("refuses a page opened before another tab or owner added a segment, before anything is retired", async () => {
    // Opened with Retail and Online; meanwhile "Wholesale" was added (and may already have figures).
    db.rows = [...ALL_SEGMENTS, segmentRow("f1000000-0000-4000-8000-000000000011", "Wholesale", "company", 3)];
    const result = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [
        { id: IDS.retail, name: "Retail" },
        { id: IDS.online, name: "Web" },
      ],
    });
    expect(result).toEqual({ ok: false, error: STALE });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a first set-up when someone else set segments up meanwhile", async () => {
    const result = await saveRevenueSegmentsAction({ companyId: COMPANY, expected: [], segments: [{ name: "Web" }] });
    expect(result).toEqual({ ok: false, error: STALE });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("refuses when a segment was renamed, removed or moved since the page was opened", async () => {
    const save = () =>
      saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [{ id: IDS.retail, name: "Shops" }] });

    db.rows = [RETAIL, { ...ONLINE, name: "Web" }];
    expect(await save()).toEqual({ ok: false, error: STALE });
    db.rows = [RETAIL];
    expect(await save()).toEqual({ ok: false, error: STALE });
    db.rows = [
      { ...ONLINE, sort_order: 1 },
      { ...RETAIL, sort_order: 2 },
    ];
    expect(await save()).toEqual({ ok: false, error: STALE });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("treats a malformed starting list as changed", async () => {
    const notAList = await saveRevenueSegmentsAction({ companyId: COMPANY, expected: "Retail", segments: [] } as never);
    expect(notAList).toEqual({ ok: false, error: STALE });
    const badId = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: [{ id: "x", name: "Retail" }],
      segments: [],
    });
    expect(badId).toEqual({ ok: false, error: STALE });
    const missing = await saveRevenueSegmentsAction({ companyId: COMPANY, segments: [] } as never);
    expect(missing).toEqual({ ok: false, error: STALE });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("shows a failed read of the segments in use as the session or network problem it is", async () => {
    db.error = { code: "PGRST301", message: "JWT expired" };
    expect(await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [] })).toEqual({
      ok: false,
      error: MESSAGES.session,
    });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("refuses contributors and other companies before anything else", async () => {
    vi.mocked(assertCompanyAccess).mockRejectedValue(new ActionError(MESSAGES.permission));
    expect(
      await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [{ name: "Web" }] }),
    ).toEqual({
      ok: false,
      error: MESSAGES.permission,
    });
    expect(db.reads).toEqual([]);
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps exited and written-off companies read-only (BRD B21)", async () => {
    vi.mocked(assertCompanyAccess).mockResolvedValue(owner("exited") as never);
    expect(
      await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [{ name: "Web" }] }),
    ).toEqual({
      ok: false,
      error: "Demo Company is no longer an active portfolio company, so its records are read-only.",
    });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("refuses the lists the database refuses, with the database's own words", async () => {
    const twice = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [{ id: IDS.online, name: "Online" }, { name: " online" }],
    });
    expect(twice).toEqual({
      ok: false,
      error: 'There are two revenue segments called "online". Give each segment a different name.',
    });

    const blank = await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [{ name: " \t " }] });
    expect(blank).toEqual({ ok: false, error: "Each revenue segment needs a name." });

    const tooMany = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: Array.from({ length: 51 }, (_, i) => ({ name: `Segment ${i + 1}` })),
    });
    expect(tooMany).toEqual({ ok: false, error: "A company can have at most 50 revenue segments." });

    const notAList = await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: "Retail" } as never);
    expect(notAList).toEqual({ ok: false, error: "Send the revenue segments as a list." });

    const badId = await saveRevenueSegmentsAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [{ id: "x", name: "Retail" }],
    });
    expect(badId).toEqual({ ok: false, error: STALE });

    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("shows the database's refusals as they are", async () => {
    vi.mocked(setCompanyRevenueSegments).mockRejectedValueOnce(dataError("P0001", STALE));
    expect(
      await saveRevenueSegmentsAction({
        companyId: COMPANY,
        expected: OPENED,
        segments: [{ id: ONLINE.id, name: "Online" }],
      }),
    ).toEqual({ ok: false, error: STALE });

    vi.mocked(setCompanyRevenueSegments).mockRejectedValueOnce(
      dataError("42501", "Only the company owner can change its revenue segments."),
    );
    expect(await saveRevenueSegmentsAction({ companyId: COMPANY, expected: OPENED, segments: [] })).toEqual({
      ok: false,
      error: "Only the company owner can change its revenue segments.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
