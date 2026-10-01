// Server-render smoke tests for the M1 screens: the tabs of the company page (async Server Components,
// awaited with their data mocked), the companies list, the funds table and the "Add company" form render
// to HTML with realistic data, so runtime rendering errors and missing content are caught. Permission
// variants check what each role is offered.
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/data", () => ({
  getCompany: vi.fn(),
  getCompanyConfig: vi.fn(),
  getCompanyInternal: vi.fn(),
  getPlatformSettings: vi.fn(),
  listCompanySubmissions: vi.fn(),
}));
vi.mock("@/app/admin/companies/actions", () => {
  const stub = () => vi.fn(async () => ({ ok: true, data: undefined }));
  return Object.fromEntries(
    [
      "createCompanyAction",
      "updateCompanyProfileAction",
      "setReportingStartAction",
      "setCompanyStatusAction",
      "deleteCompanyAction",
      "saveFundInvestmentAction",
      "deleteFundInvestmentAction",
      "addRevenueLineAction",
      "renameRevenueLineAction",
      "moveRevenueLineAction",
      "setRevenueLineActiveAction",
      "deleteRevenueLineAction",
      "addDimensionAction",
      "renameDimensionAction",
      "deleteDimensionAction",
      "addDimensionMemberAction",
      "renameDimensionMemberAction",
      "moveDimensionMemberAction",
      "setDimensionMemberActiveAction",
      "deleteDimensionMemberAction",
      "saveKpiAction",
      "moveKpiAction",
      "setKpiActiveAction",
      "deleteKpiAction",
      "assignPartnerAction",
      "updateInternalFieldsAction",
    ].map((name) => [name, stub()]),
  );
});
vi.mock("@/app/admin/funds/actions", () => ({
  createFundAction: vi.fn(async () => ({ ok: true, data: { id: "x" } })),
  updateFundAction: vi.fn(async () => ({ ok: true, data: undefined })),
}));

import { CompanyHeader } from "@/app/admin/companies/[companyId]/_components/company-header";
import { CompanyTabsNav } from "@/app/admin/companies/[companyId]/_components/company-tabs-nav";
import { FundsTab } from "@/app/admin/companies/[companyId]/_components/funds-tab";
import { InternalTab } from "@/app/admin/companies/[companyId]/_components/internal-tab";
import { KpisTab } from "@/app/admin/companies/[companyId]/_components/kpis-tab";
import { OverviewTab } from "@/app/admin/companies/[companyId]/_components/overview-tab";
import { RevenueTab } from "@/app/admin/companies/[companyId]/_components/revenue-tab";
import { TeamTab } from "@/app/admin/companies/[companyId]/_components/team-tab";
import { UpdatesTab } from "@/app/admin/companies/[companyId]/_components/updates-tab";
import { CompaniesExplorer } from "@/app/admin/companies/_components/companies-explorer";
import { NO_FILTERS, type CompanyListRow } from "@/app/admin/companies/_components/company-list";
import { NewCompanyForm } from "@/app/admin/companies/new/_components/new-company-form";
import NewCompanyNotFound from "@/app/admin/companies/new/not-found";
import { FundsTable } from "@/app/admin/funds/_components/funds-table";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { DEFAULT_OWNER_CONTRIBUTOR_LIMIT } from "@/lib/constants";
import { getCompanyConfig, getCompanyInternal, getPlatformSettings, listCompanySubmissions } from "@/lib/data";
import {
  partitionRevenueSegments,
  type CompanyConfig,
  type CompanyInternalWithPartner,
  type CompanyRow,
  type PlatformSettingsRow,
  type SubmissionOverviewRow,
} from "@/lib/types/domain";
import type { ScaleupRole } from "@/lib/types/enums";

import { fakeSupabase, type TableCall } from "./fake-supabase";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const SV1 = "a0000000-0000-4000-8000-000000000001";
const PARTNER = "a1000000-0000-4000-8000-000000000005";
const OWNER = "a2000000-0000-4000-8000-000000000001";
const DIMENSION = "d1000000-0000-4000-8000-000000000001";
const KPI = "e0000000-0000-4000-8000-000000000001";
const MEMBER = "d2000000-0000-4000-8000-000000000001";
const TS = "2026-09-30T02:00:00Z";

function html(element: ReactNode): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

function ctx(role: ScaleupRole, userId = "a1000000-0000-4000-8000-000000000009"): ScaleUpAccessContext {
  return {
    userId,
    email: "staff@example.com",
    fullName: "Staff",
    scaleupRole: role,
    isActive: true,
    memberships: [],
    aal: "aal2",
    mfaRequired: true,
    termsAccepted: true,
  };
}

const BATIK: CompanyRow = {
  id: COMPANY,
  name: "Batik Boutique",
  legal_name: "Batik Boutique Sdn Bhd",
  registration_no: "201401012345",
  sector: "Retail",
  country: "Malaysia",
  website: "https://batikboutique.com",
  description: "Handmade batik fashion.",
  reporting_currency: "MYR",
  status: "active",
  status_changed_at: null,
  status_reason: null,
  reporting_start_month: "2026-07-01",
  created_at: TS,
  updated_at: TS,
};

const SETTINGS: PlatformSettingsRow = {
  id: 1,
  due_day: 15,
  escalation_days: 14,
  backfill_grace_days: 14,
  revenue_swing_pct: 30,
  min_runway_months: 6,
  require_mfa: true,
  default_reporting_start: "2026-07-01",
  declaration_text: "I confirm.",
  terms_version: "2026-09",
  owner_contributor_limit: DEFAULT_OWNER_CONTRIBUTOR_LIMIT,
  updated_by: null,
  created_at: TS,
  updated_at: TS,
};

const INTERNAL: CompanyInternalWithPartner = {
  company_id: COMPANY,
  partner_in_charge_id: PARTNER,
  internal_rating: "watch",
  exit_strategy_status: "Exploring options",
  exit_strategy_notes: "Trade sale interest from a regional retailer.",
  notes: "Met the founders in September.",
  updated_by: PARTNER,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: TS,
  partner: { id: PARTNER, full_name: "Renuka Sena", email: "renuka@example.com", scaleup_role: "partner", is_active: true },
};

const MONTHS: SubmissionOverviewRow[] = [
  {
    id: "s0000000-0000-4000-8000-000000000008",
    company_id: COMPANY,
    month: "2026-08-01",
    status: "draft",
    due_date: "2026-09-15",
    original_due_date: null,
    submitted_at: null,
    approved_at: null,
    revision: 0,
    last_saved_at: null,
    is_overdue: true,
    days_overdue: 15,
    has_narrative: false,
    open_threads: 0,
  },
  {
    id: "s0000000-0000-4000-8000-000000000007",
    company_id: COMPANY,
    month: "2026-07-01",
    status: "submitted",
    due_date: "2026-08-15",
    original_due_date: "2026-08-10",
    submitted_at: "2026-08-14T03:00:00Z",
    approved_at: null,
    revision: 2,
    last_saved_at: "2026-08-14T02:00:00Z",
    is_overdue: false,
    days_overdue: 0,
    has_narrative: true,
    open_threads: 2,
  },
];

function config(): CompanyConfig {
  const dimension = { id: DIMENSION, company_id: COMPANY, name: "Outlet", created_at: TS };
  const member = { id: MEMBER, dimension_id: DIMENSION, name: "Mont Kiara", sort_order: 10, is_active: true, created_at: TS };
  return {
    company: BATIK,
    segments: [],
    kpis: [
      {
        id: KPI,
        company_id: COMPANY,
        name: "Revenue per outlet",
        description: "Gross sales of each outlet.",
        unit: "RM",
        value_type: "currency",
        frequency: "monthly",
        dimension_id: DIMENSION,
        is_required: true,
        sort_order: 10,
        is_active: true,
        created_at: TS,
        updated_at: TS,
        dimension,
        members: [member],
      },
    ],
    dimensions: [{ ...dimension, members: [member, { ...member, id: "d2000000-0000-4000-8000-000000000002", name: "The Row", is_active: false }] }],
    members: [],
    ...partitionRevenueSegments([]),
  };
}

/** A company_members row with its profile, as loadCompanyMembers selects it. */
function memberRow(
  userId: string,
  role: "owner" | "contributor",
  options: { name: string; email: string; jobTitle?: string; isActive?: boolean; signedIn?: boolean; invitedBy?: string },
) {
  return {
    company_id: COMPANY,
    user_id: userId,
    role,
    is_active: options.isActive ?? true,
    invited_by: options.invitedBy ?? null,
    created_at: TS,
    updated_at: TS,
    profile: {
      id: userId,
      email: options.email,
      full_name: options.name,
      job_title: options.jobTitle ?? null,
      is_active: true,
      terms_accepted_at: options.signedIn === false ? null : TS,
    },
  };
}

const OWNER_MEMBER = memberRow(OWNER, "owner", {
  name: "Amira Effendi",
  email: "amira@batikboutique.com",
  jobTitle: "Founder",
});

/** Table answers for the tab loaders. */
function tables(call: TableCall) {
  switch (call.table) {
    case "fund_investments":
      return {
        data: [
          {
            id: "f0000000-0000-4000-8000-000000000001",
            fund_id: SV1,
            investment_date: "2023-05-02",
            instrument: "Preference shares",
            ownership_pct: 12.5,
            notes: null,
            fund: { id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", is_active: true },
          },
        ],
        error: null,
      };
    case "funds":
      return {
        data: [
          { id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", is_active: true },
          { id: "a0000000-0000-4000-8000-000000000002", code: "SFF", name: "ScaleUp Founders Fund LP", is_active: true },
        ],
        error: null,
      };
    case "v_submission_overview":
      return { data: MONTHS, error: null };
    case "companies":
      return { data: [{ sector: "Retail" }, { sector: "Fintech" }], error: null };
    case "submissions":
      return { data: [{ id: MONTHS[1].id }], error: null };
    case "revenue_segments":
      return {
        data: [
          { id: "b2000000-0000-4000-8000-000000000001", name: "Retail", sort_order: 10, is_active: true },
          { id: "b2000000-0000-4000-8000-000000000002", name: "Online", sort_order: 20, is_active: false },
        ],
        error: null,
      };
    case "submission_segment_values":
      return { data: [{ submission_id: MONTHS[1].id, segment_id: "b2000000-0000-4000-8000-000000000001" }], error: null };
    case "submission_kpi_values":
      return { data: [{ id: "v1", submission_id: MONTHS[1].id, kpi_id: KPI, dimension_member_id: MEMBER }], error: null };
    case "company_members":
      return { data: [OWNER_MEMBER], error: null };
    case "profiles":
      return call.single
        ? { data: { full_name: "Renuka Sena", email: "renuka@example.com" }, error: null }
        : {
            data: [
              { id: PARTNER, full_name: "Renuka Sena", email: "renuka@example.com", scaleup_role: "partner", is_active: true },
              { id: "a1000000-0000-4000-8000-000000000001", full_name: "Kenneth Siew", email: "kenneth@example.com", scaleup_role: "super_admin", is_active: true },
            ],
            error: null,
          };
    default:
      return undefined;
  }
}

async function renderTab(tab: (props: { ctx: ScaleUpAccessContext; company: CompanyRow }) => Promise<ReactElement>, role: ScaleupRole, company = BATIK) {
  return html(await tab({ ctx: ctx(role), company }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T04:00:00Z"));
  state.client = fakeSupabase({ tables }).client;
  vi.mocked(getPlatformSettings).mockResolvedValue(SETTINGS);
  vi.mocked(getCompanyInternal).mockResolvedValue(INTERNAL);
  vi.mocked(getCompanyConfig).mockResolvedValue(config());
  vi.mocked(listCompanySubmissions).mockResolvedValue(MONTHS);
  return () => vi.useRealTimers();
});

describe("company page chrome", () => {
  it("renders the header and the tab links", () => {
    const markup = html(
      createElement("div", null, createElement(CompanyHeader, { company: BATIK }), createElement(CompanyTabsNav, { companyId: COMPANY, active: "kpis" })),
    );
    expect(markup).toContain("Batik Boutique");
    expect(markup).toContain("Reporting from Jul 2026");
    const current = /<a [^>]*aria-current="page"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(current).toContain(`href="/admin/companies/${COMPANY}?tab=kpis"`);
    expect(markup).toContain(`href="/admin/companies/${COMPANY}"`);
    expect(markup).toContain("(ScaleUp only)");
  });
});

describe("Overview tab", () => {
  it("lets Super Admins edit the profile, reporting start and status, and delete", async () => {
    const markup = await renderTab(OverviewTab, "super_admin");
    expect(markup).toContain("Company profile");
    expect(markup).toContain('value="Batik Boutique Sdn Bhd"');
    expect(markup).toContain("Locked: the company has reported figures in this currency.");
    expect(markup).toContain("Save start month");
    expect(markup).toContain("Mark as exited");
    expect(markup).toContain("Mark as written off");
    expect(markup).toContain("Delete company");
    // At a glance.
    expect(markup).toContain("SV1");
    expect(markup).toContain("12.5%");
    expect(markup).toContain("Renuka Sena");
    expect(markup).toContain("Watch");
  });

  it("is read-only for other roles", async () => {
    const markup = await renderTab(OverviewTab, "partner");
    expect(markup).toContain("Only Super Admins can change the profile.");
    expect(markup).not.toContain("Save start month");
    expect(markup).not.toContain("Mark as exited");
    expect(markup).not.toContain("Delete company");
  });

  it("explains a company that is not reporting yet", async () => {
    const markup = await renderTab(OverviewTab, "super_admin", { ...BATIK, reporting_start_month: null, status: "written_off", status_reason: "Fully impaired." });
    expect(markup).toContain("Not yet reporting");
    expect(markup).toContain("Return to active");
    expect(markup).toContain("Fully impaired.");
    // A written-off company can be marked exited directly (not through active, which opens missed months).
    expect(markup).toContain("Mark as exited");
    expect(markup).not.toContain("Mark as written off");
  });

  it("lets Super Admins switch an exited company to written off directly", async () => {
    const exited: CompanyRow = { ...BATIK, status: "exited", status_reason: "Sold to a trade buyer.", status_changed_at: TS };
    const markup = await renderTab(OverviewTab, "super_admin", exited);
    expect(markup).toContain("Sold to a trade buyer.");
    expect(markup).toContain("Return to active");
    expect(markup).toContain("Mark as written off");
    expect(markup).not.toContain("Mark as exited");
    expect(markup).toContain("switch between exited and written off directly");
    const partner = await renderTab(OverviewTab, "partner", exited);
    expect(partner).toContain("Sold to a trade buyer.");
    expect(partner).not.toContain("Mark as written off");
    expect(partner).not.toContain("Return to active");
    expect(partner).not.toContain("switch between exited and written off directly");
  });
});

describe("other tabs", () => {
  it("Funds & investment: mappings, managed by Super Admins only", async () => {
    const admin = await renderTab(FundsTab, "super_admin");
    expect(admin).toContain("Preference shares");
    expect(admin).toContain("2 May 2023");
    expect(admin).toContain("Add fund");
    const viewer = await renderTab(FundsTab, "viewer");
    expect(viewer).toContain("Preference shares");
    expect(viewer).not.toContain("Add fund");
  });

  it("Revenue lines: usage and the add form for Fund Admins", async () => {
    const markup = await renderTab(RevenueTab, "fund_admin");
    expect(markup).toContain("Retail");
    expect(markup).toContain("Figures in 1 month");
    expect(markup).toContain("Inactive");
    expect(markup).toContain("Add line");
    expect(await renderTab(RevenueTab, "partner")).not.toContain("Add line");
  });

  it("KPIs: the KPI table and the dimensions with their members", async () => {
    const markup = await renderTab(KpisTab, "fund_admin");
    expect(markup).toContain("Revenue per outlet");
    expect(markup).toContain("Currency");
    expect(markup).toContain("Outlet");
    expect(markup).toContain("Mont Kiara");
    expect(markup).toContain("used by Revenue per outlet");
    expect(markup).toContain("Add KPI");
    expect(markup).toContain("Add member");
    const viewer = await renderTab(KpisTab, "viewer");
    expect(viewer).not.toContain("Add KPI");
  });

  it("Team: members, and the Users link for Super Admins", async () => {
    const markup = await renderTab(TeamTab, "super_admin");
    expect(markup).toContain("Amira Effendi");
    expect(markup).toContain("Company Owner");
    expect(markup).toContain(`/admin/users?company=${COMPANY}`);
    expect(await renderTab(TeamTab, "fund_admin")).not.toContain("Manage users");
  });

  it("Team: the owner's contributor allowance (BRD B29)", async () => {
    const markup = await renderTab(TeamTab, "fund_admin");
    expect(markup).toContain("0</span> active contributors, pending invitations included.");
    expect(markup).toContain("Owners can invite up to 4; ScaleUp can add more.");
    expect(markup).not.toContain("Owner limit reached");

    // Four active contributors (one not signed in yet: a pending invitation counts) and one removed.
    const contributor = (n: number, options: { isActive?: boolean; signedIn?: boolean } = {}) =>
      memberRow(`a2000000-0000-4000-8000-00000000001${n}`, "contributor", {
        name: `Contributor ${n}`,
        email: `contributor${n}@batikboutique.com`,
        invitedBy: OWNER,
        ...options,
      });
    const team = [
      OWNER_MEMBER,
      contributor(1),
      contributor(2),
      contributor(3),
      contributor(4, { signedIn: false }),
      contributor(5, { isActive: false }),
    ];
    state.client = fakeSupabase({
      tables: (call) => (call.table === "company_members" ? { data: team, error: null } : tables(call)),
    }).client;
    const full = await renderTab(TeamTab, "super_admin");
    expect(full).toContain("4</span> active contributors, pending invitations included.");
    expect(full).toContain("Owner limit reached");
    expect(full).toContain("Not signed in yet");
    expect(full).toContain("Removed from team");

    // A limit of 0: only ScaleUp adds contributors.
    vi.mocked(getPlatformSettings).mockResolvedValue({ ...SETTINGS, owner_contributor_limit: 0 });
    const closed = await renderTab(TeamTab, "super_admin");
    expect(closed).toContain("Owners can&#x27;t invite contributors; ScaleUp adds them.");
    expect(closed).not.toContain("Owner limit reached");
  });

  it("Internal: fields for editors, read-only for viewers, partner picker for Super Admins", async () => {
    const admin = await renderTab(InternalTab, "super_admin");
    expect(admin).toContain("Assessment and exit strategy");
    expect(admin).toContain("Met the founders in September.");
    expect(admin).toContain("Change partner-in-charge");
    expect(admin).toContain("by Renuka Sena");
    const fundAdmin = await renderTab(InternalTab, "fund_admin");
    expect(fundAdmin).toContain("Discard changes");
    expect(fundAdmin).toContain("Only Super Admins assign the partner-in-charge.");
    const viewer = await renderTab(InternalTab, "viewer");
    expect(viewer).not.toContain("Discard changes");
    expect(viewer).toContain("Trade sale interest from a regional retailer.");
  });

  it("Monthly updates: statuses, overdue, links to review and on-behalf entry for Fund Admins", async () => {
    const fundAdmin = await renderTab(UpdatesTab, "fund_admin");
    expect(fundAdmin).toContain("Overdue 15 days");
    expect(fundAdmin).toContain(`/admin/review/${MONTHS[1].id}`);
    expect(fundAdmin).toContain(`/admin/companies/${COMPANY}/updates/2026-08`);
    expect(fundAdmin).toContain("Revision 2");
    expect(fundAdmin).toContain("Originally 10 Aug 2026");
    const partner = await renderTab(UpdatesTab, "partner");
    expect(partner).not.toContain("Edit on behalf");
    // Exited companies are read-only for on-behalf work.
    const exited = await renderTab(UpdatesTab, "fund_admin", { ...BATIK, status: "exited" });
    expect(exited).not.toContain("Edit on behalf");
  });

  it("Monthly updates: a company that is not reporting yet", async () => {
    vi.mocked(listCompanySubmissions).mockResolvedValue([]);
    const markup = await renderTab(UpdatesTab, "super_admin", { ...BATIK, reporting_start_month: null });
    expect(markup).toContain("Not yet reporting");
    expect(markup).toContain("Set the start month");
  });
});

describe("lists and forms", () => {
  const rows: CompanyListRow[] = [
    {
      id: COMPANY,
      name: "Batik Boutique",
      legalName: "Batik Boutique Sdn Bhd",
      sector: "Retail",
      country: "Malaysia",
      status: "active",
      reportingStartMonth: "2026-07-01",
      reportingCurrency: "MYR",
      funds: [{ id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd" }],
      partner: { id: PARTNER, name: "Renuka Sena", isActive: true },
      latest: { submissionId: MONTHS[0].id, month: "2026-08-01", status: "draft", isOverdue: true, daysOverdue: 15 },
    },
    {
      id: "c0000000-0000-4000-8000-000000000016",
      name: "i-Motorbike",
      legalName: "iMotorbike Pte Ltd",
      sector: null,
      country: "Singapore",
      status: "active",
      reportingStartMonth: null,
      reportingCurrency: "USD",
      funds: [],
      partner: null,
      latest: null,
    },
  ];

  it("renders the companies list", () => {
    const markup = html(
      createElement(CompaniesExplorer, {
        rows,
        funds: [{ id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", isActive: true }],
        partners: [{ id: PARTNER, name: "Renuka Sena", isActive: true }],
        initialFilters: NO_FILTERS,
        canCreate: true,
      }),
    );
    expect(markup).toContain("2 companies · 2 active · 1 reporting · 1 not yet reporting");
    expect(markup).toContain("From Jul 2026");
    expect(markup).toContain("Not yet reporting");
    expect(markup).toContain("Overdue");
    expect(markup).toContain("USD");
    expect(markup).toContain("Unassigned");
  });

  it("shows the filtered empty state", () => {
    const markup = html(
      createElement(CompaniesExplorer, {
        rows,
        funds: [],
        partners: [],
        initialFilters: { ...NO_FILTERS, q: "no such company" },
        canCreate: false,
      }),
    );
    expect(markup).toContain("No companies match these filters");
    expect(markup).toContain("Showing 0 of 2 companies");
  });

  it("renders the funds table with counts", () => {
    const markup = html(
      createElement(FundsTable, {
        funds: [
          { id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", legalName: "ScaleUp Ventures 1 Sdn Bhd", description: null, isActive: true, companies: 7, activeCompanies: 7 },
          { id: "a0000000-0000-4000-8000-000000000002", code: "SFF", name: "ScaleUp Founders Fund LP", legalName: null, description: "Second fund.", isActive: false, companies: 11, activeCompanies: 10 },
        ],
        canManage: true,
      }),
    );
    expect(markup).toContain("/admin/companies?fund=SV1");
    expect(markup).toContain("11 companies");
    expect(markup).toContain("10 active");
    expect(markup).toContain("Inactive");
    expect(markup).toContain("Edit");
  });

  it("renders the Add company form", () => {
    const markup = html(
      createElement(NewCompanyForm, {
        funds: [{ id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", isActive: true }],
        partners: [{ id: PARTNER, name: "Renuka Sena", email: "renuka@example.com", role: "partner", isActive: true }],
        sectors: ["Retail"],
        startMonths: ["2026-07", "2026-08", "2026-09"],
        today: "2026-09-30",
        dueDay: 15,
        graceDays: 14,
      }),
    );
    expect(markup).toContain("Company details");
    expect(markup).toContain('value="MYR"');
    expect(markup).toContain("No reporting start month set yet");
    expect(markup).toContain("Partner-in-charge");
    expect(markup).toContain("Add company");
  });

  it("explains Add company to staff who are not Super Admins (its guard calls notFound())", () => {
    const markup = html(createElement(NewCompanyNotFound));
    expect(markup).toContain("Only Super Admins can add companies");
    expect(markup).toContain('href="/admin/companies"');
    expect(markup).toContain("Back to companies");
  });
});
