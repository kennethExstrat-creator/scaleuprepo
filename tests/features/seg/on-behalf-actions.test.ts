// A Super Admin or Fund Admin sets a company's own revenue segments on the owner's behalf (BRD B30;
// docs/ARCHITECTURE.md §1): saveCompanySegmentsOnBehalfAction on the ScaleUp company page.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ assertScaleUp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/data", () => ({ getCompany: vi.fn(), setCompanyRevenueSegments: vi.fn() }));

import { revalidatePath } from "next/cache";

import { saveCompanySegmentsOnBehalfAction } from "@/app/admin/companies/[companyId]/_components/company-segments-actions";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import { assertScaleUp } from "@/lib/auth/session";
import { getCompany, setCompanyRevenueSegments } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { ALL_SEGMENTS, companyRow, IDS, RETAIL, segmentRow } from "./fixtures";

const COMPANY = IDS.company;
const STALE = "The revenue segments have changed since this page was opened. Reload the page and try again.";
const OPENED = [
  { id: IDS.retail, name: "Retail" },
  { id: IDS.online, name: "Online" },
];

/** The RLS client: `revenue_segments` reads with their equality filters applied. */
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

function fakeClient() {
  return {
    from() {
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = db.rows.filter((row) => filters.every(([column, value]) => row[column] === value));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function staff(role: "super_admin" | "fund_admin" | "partner" | "viewer") {
  return {
    userId: "a1000000-0000-4000-8000-000000000009",
    email: "staff@example.com",
    fullName: "Fay Fund",
    scaleupRole: role,
    isActive: true,
    memberships: [],
    aal: "aal2",
    mfaRequired: true,
    termsAccepted: true,
  };
}

function revalidated(): string[] {
  return vi.mocked(revalidatePath).mock.calls.map((call) => (call[1] ? `${call[0]} (${call[1]})` : call[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rows = ALL_SEGMENTS;
  vi.mocked(createClient).mockResolvedValue(fakeClient() as never);
  vi.mocked(assertScaleUp).mockResolvedValue(staff("fund_admin") as never);
  vi.mocked(getCompany).mockResolvedValue(companyRow());
  vi.mocked(setCompanyRevenueSegments).mockResolvedValue([
    { ...RETAIL, sort_order: 1 },
    segmentRow("f1000000-0000-4000-8000-000000000010", "Web shop", "company", 2),
  ]);
});

describe("saveCompanySegmentsOnBehalfAction", () => {
  it("saves the complete list for a Fund Admin and refreshes both sides", async () => {
    const result = await saveCompanySegmentsOnBehalfAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [
        { id: IDS.retail.toUpperCase(), name: " Retail " },
        { id: null, name: "Web shop" },
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
    expect(assertScaleUp).toHaveBeenCalledWith(["super_admin", "fund_admin"]);
    expect(setCompanyRevenueSegments).toHaveBeenCalledWith(expect.anything(), COMPANY, [
      { id: IDS.retail, name: "Retail" },
      { name: "Web shop" },
    ]);
    expect(revalidated()).toEqual([
      `/admin/companies/${COMPANY}`,
      "/admin/companies/[companyId]/updates/[month] (page)",
      "/admin/review/[submissionId] (page)",
      `/portal/${COMPANY}/segments`,
      `/portal/${COMPANY}/updates`,
      "/portal/[companyId]/updates/[month] (page)",
      `/portal/${COMPANY}`,
    ]);
  });

  it("refuses other roles before reading anything", async () => {
    vi.mocked(assertScaleUp).mockRejectedValue(new ActionError(MESSAGES.permission));
    const result = await saveCompanySegmentsOnBehalfAction({ companyId: COMPANY, expected: OPENED, segments: [] });
    expect(result).toEqual({ ok: false, error: MESSAGES.permission });
    expect(getCompany).not.toHaveBeenCalled();
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("keeps exited and written-off companies read-only", async () => {
    vi.mocked(getCompany).mockResolvedValue(companyRow("exited"));
    const result = await saveCompanySegmentsOnBehalfAction({ companyId: COMPANY, expected: OPENED, segments: [] });
    expect(result).toEqual({
      ok: false,
      error: "Demo Company is no longer an active portfolio company, so its records are read-only.",
    });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("refuses a list based on segments that changed since the page was opened", async () => {
    const result = await saveCompanySegmentsOnBehalfAction({
      companyId: COMPANY,
      expected: [{ id: IDS.retail, name: "Retail" }],
      segments: [{ id: IDS.retail, name: "Retail" }],
    });
    expect(result).toEqual({ ok: false, error: STALE });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });

  it("checks the list in the database's own words and refuses unknown companies", async () => {
    const duplicate = await saveCompanySegmentsOnBehalfAction({
      companyId: COMPANY,
      expected: OPENED,
      segments: [{ name: "Online" }, { name: "online " }],
    });
    expect(duplicate).toEqual({
      ok: false,
      error: 'There are two revenue segments called "online". Give each segment a different name.',
    });
    vi.mocked(getCompany).mockResolvedValue(null);
    expect(await saveCompanySegmentsOnBehalfAction({ companyId: COMPANY, expected: OPENED, segments: [] })).toEqual({
      ok: false,
      error: MESSAGES.notFound,
    });
    expect(setCompanyRevenueSegments).not.toHaveBeenCalled();
  });
});
