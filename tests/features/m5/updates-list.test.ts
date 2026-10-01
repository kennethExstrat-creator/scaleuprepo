// Server-renders /portal/[companyId]/updates (the monthly updates list) with mocked data: the call to
// action and the "to submit" count follow the months ScaleUp still requests, as the company home counts
// them (monthsNeedingAction) — drafts left from before a reporting start month that ScaleUp moved later
// are marked "Not required" and are never the next month to work on.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  company: null as unknown,
  rows: [] as unknown[],
  role: "owner" as "owner" | "contributor",
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireCompanyAccess: vi.fn(async (companyId: string) => {
    const company = state.company as { name: string; status: "active" | "exited" | "written_off" };
    return {
      userId: "u1",
      email: "owner@example.com",
      fullName: "Owner",
      scaleupRole: null,
      isActive: true,
      memberships: [{ companyId, companyName: company.name, companyStatus: company.status, role: state.role }],
      aal: "aal2",
      mfaRequired: true,
      termsAccepted: true,
      companyRole: state.role,
    };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => ({ data: 0, error: null }) }),
}));
vi.mock("@/lib/data", () => ({
  getCompany: vi.fn(async () => state.company),
  listCompanySubmissions: vi.fn(async () => state.rows),
}));

import MonthlyUpdatesPage from "@/app/portal/[companyId]/updates/page";
import type { CompanyRow, SubmissionOverviewRow } from "@/lib/types/domain";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const TS = "2026-09-30T06:00:00+00:00";

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
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
    reporting_start_month: "2026-09-01",
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

function row(month: string, overrides: Partial<SubmissionOverviewRow> = {}): SubmissionOverviewRow {
  return {
    id: `90000000-0000-4000-8000-0000000000${month.slice(5, 7)}`,
    company_id: COMPANY,
    month,
    status: "draft",
    due_date: "2026-10-15",
    original_due_date: null,
    submitted_at: null,
    approved_at: null,
    revision: 0,
    last_saved_at: null,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: false,
    open_threads: 0,
    ...overrides,
  };
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function render(): Promise<string> {
  const element = await MonthlyUpdatesPage({ params: Promise.resolve({ companyId: COMPANY }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.role = "owner";
  state.company = company();
  // Newest first, as listCompanySubmissions returns them. The start month moved from Jul to Sep 2026:
  // July and August stay as drafts that are no longer required.
  state.rows = [
    row("2026-09-01", { last_saved_at: TS }),
    row("2026-08-01", { due_date: "2026-09-15" }),
    row("2026-07-01", { due_date: "2026-08-15" }),
  ];
});

describe("monthly updates list", () => {
  it("offers the earliest month still requested, not a draft from before the reporting start month", async () => {
    const html = await render();
    const visible = text(html);
    expect(visible).toContain("3 months · 1 to submit");
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-09"`);
    expect(visible).toContain("Continue September 2026");
    expect(visible).not.toContain("Start July 2026");
    // Both earlier drafts are marked, with the reason in the tooltip, and only offer "View".
    expect(visible.match(/Not required/g)?.length).toBe(4); // phone cards and table rows
    expect(html).toContain("Before your reporting start month (September 2026): you don&#x27;t need to submit it.");
    expect(html).toContain('aria-label="View Jul 2026"');
    expect(html).toContain('aria-label="Continue Sep 2026"');
  });

  it("still asks for a month sent back, even before the start month", async () => {
    state.rows = [
      row("2026-09-01"),
      row("2026-08-01", { status: "changes_requested", due_date: "2026-10-15" }),
      row("2026-07-01"),
    ];
    const visible = text(await render());
    expect(visible).toContain("Make changes August 2026");
    expect(visible).toContain("3 months · 2 to submit");
    expect(visible.match(/Not required/g)?.length).toBe(2); // July only
  });

  it("marks nothing for a company whose drafts are all from its start month on", async () => {
    state.company = company({ reporting_start_month: "2026-07-01" });
    const visible = text(await render());
    expect(visible).toContain("Start July 2026");
    expect(visible).toContain("3 months · 3 to submit");
    expect(visible).not.toContain("Not required");
  });

  it("asks nothing of an exited company (read-only)", async () => {
    state.company = company({ status: "exited" });
    const visible = text(await render());
    expect(visible).toContain("is no longer an active portfolio company");
    expect(visible).not.toContain("Not required");
    expect(visible).not.toMatch(/Continue September|Start July/);
  });
});
