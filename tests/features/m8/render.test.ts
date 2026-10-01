// Render smoke test of the documents UI: the whole PeriodClosePanel tree (loader mocked) rendered on the
// server for both audiences, so markup, permissions and wording can be checked without a browser.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/actions/documents", () => ({
  prepareDocumentUpload: vi.fn(),
  saveDocument: vi.fn(),
  confirmPeriodClose: vi.fn(),
  reopenPeriodClose: vi.fn(),
}));

const loadCompanyDocuments = vi.fn();
vi.mock("@/components/documents/queries", () => ({ loadCompanyDocuments: (...args: unknown[]) => loadCompanyDocuments(...args) }));

import { PortfolioTable } from "@/app/admin/documents/_components/portfolio-table";
import { PeriodClosePanel } from "@/components/documents/period-close-panel";
import {
  buildCompanyDocumentsView,
  buildPortfolioRows,
  periodKey,
  type CloseRecord,
  type DocumentsMode,
  type MonthRecord,
  type StaffNames,
} from "@/components/documents/view-model";
import { quarterOf } from "@/lib/periods";
import type { PermissionSubject } from "@/lib/auth/permissions";
import type { CompanyRow } from "@/lib/types/domain";

const COMPANY: CompanyRow = {
  id: "c0000000-0000-4000-8000-000000000001",
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
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const FUND_ADMIN = { full_name: "Fay Fund", email: "fund@scaleup.test", scaleup_role: "fund_admin" as const };
const OWNER_PROFILE = { full_name: "Bea Batik", email: "owner@batik.test", scaleup_role: null };
/** What staff_display_names returns to company users for the Fund Admin (BRD B28). */
const STAFF_NAMES: StaffNames = { "fund-admin-id": "Fay Fund (ScaleUp)" };

const Q3: CloseRecord = {
  id: "d0000000-0000-4000-8000-000000000003",
  period_type: "quarter",
  period_start: "2026-07-01",
  period_end: "2026-09-30",
  label: "Q3 2026",
  status: "open",
  confirmed_at: null,
  confirmed_by: null,
  computed_totals: null,
  restated_totals: null,
  restatement_reason: null,
  confirmer: null,
};

const Q2_CONFIRMED: CloseRecord = {
  ...Q3,
  id: "d0000000-0000-4000-8000-000000000002",
  period_start: "2026-04-01",
  period_end: "2026-06-30",
  label: "Q2 2026",
  status: "confirmed",
  confirmed_at: "2026-07-10T02:00:00Z",
  confirmed_by: "fund-admin-id",
  computed_totals: { months_count: 3, revenue_total: 600, gross_profit: 280, net_profit: 70, gp_pct: 46.6667, np_pct: 11.6667, cash_in_bank: 800, avg_burn_rate: 20, headcount_ft: 12, headcount_pt: 4 },
  restated_totals: { revenue_total: 610, gp_pct: 45.9016, np_pct: 11.4754 },
  restatement_reason: "Year-end accruals",
  confirmer: FUND_ADMIN,
};

const MONTHS: MonthRecord[] = [
  { id: "s7", month: "2026-07-01", status: "approved", is_overdue: false },
  { id: "s8", month: "2026-08-01", status: "submitted", is_overdue: false },
  { id: "s9", month: "2026-09-01", status: "changes_requested", is_overdue: true },
];

/**
 * The company's documents as the loader shapes them. Company users cannot read ScaleUp staff profiles
 * (null embeds); the loader names those people through staff_display_names (`staffNames`).
 */
function view(
  mode: DocumentsMode,
  company: CompanyRow = COMPANY,
  options: { staffNames?: StaffNames; months?: MonthRecord[]; accountsBytes?: number } = {},
) {
  const hidden = mode === "company";
  return buildCompanyDocumentsView({
    mode,
    company,
    closes: [Q3, { ...Q2_CONFIRMED, confirmer: hidden ? null : FUND_ADMIN }],
    // `staffNames: undefined` in the options: the names could not be loaded.
    staffNames: "staffNames" in options ? options.staffNames : hidden ? STAFF_NAMES : undefined,
    documents: [
      {
        id: "doc-ma-1",
        period_close_id: Q3.id,
        doc_type: "management_accounts",
        file_name: "Q3 accounts.pdf",
        mime_type: "application/pdf",
        size_bytes: options.accountsBytes ?? 1_258_291,
        version: 1,
        uploaded_at: "2026-10-05T06:00:00Z",
        uploaded_by: "fund-admin-id",
        uploader: hidden ? null : FUND_ADMIN,
      },
      {
        id: "doc-general",
        period_close_id: null,
        doc_type: "supporting",
        file_name: "Board pack.docx",
        mime_type: null,
        size_bytes: 2048,
        version: 1,
        uploaded_at: "2026-10-06T06:00:00Z",
        uploaded_by: "owner-id",
        uploader: OWNER_PROFILE,
      },
    ],
    months: options.months ?? MONTHS,
    financials: [
      { month: "2026-07-01", status: "approved", revenue_total: 100, gross_profit: 40, net_profit: -10, cash_in_bank: 1000, burn_rate: 30, headcount_ft: 10, headcount_pt: 2 },
      { month: "2026-08-01", status: "submitted", revenue_total: 200, gross_profit: 90, net_profit: 20, cash_in_bank: 900, burn_rate: 20, headcount_ft: 11, headcount_pt: 3 },
    ],
  });
}

function subject(overrides: Partial<PermissionSubject>): PermissionSubject {
  return { userId: "user-id", scaleupRole: null, memberships: [], ...overrides };
}

const owner = subject({
  memberships: [{ companyId: COMPANY.id, companyName: COMPANY.name, companyStatus: "active", role: "owner" }],
});
const contributor = subject({
  memberships: [{ companyId: COMPANY.id, companyName: COMPANY.name, companyStatus: "active", role: "contributor" }],
});

const UPLOAD_BUTTON = />Upload<\/button>/;
const UPLOAD_OTHER_BUTTON = />Upload a file<\/button>/;

async function render(
  mode: DocumentsMode,
  ctx: PermissionSubject,
  company: CompanyRow = COMPANY,
  focusCloseId?: string,
  options: { staffNames?: StaffNames; months?: MonthRecord[]; accountsBytes?: number } = {},
): Promise<string> {
  loadCompanyDocuments.mockResolvedValueOnce(view(mode, company, options));
  const element = await PeriodClosePanel({ company, mode, ctx, focusCloseId });
  return renderToStaticMarkup(createElement("div", null, element));
}

beforeEach(() => {
  loadCompanyDocuments.mockReset();
});

describe("PeriodClosePanel (company side)", () => {
  it("shows closes, months, live totals and documents, naming ScaleUp staff '<name> (ScaleUp)' (B28)", async () => {
    const html = await render("company", owner);
    expect(loadCompanyDocuments).toHaveBeenCalledWith({}, COMPANY, "company");
    expect(html).toContain("Q3 2026");
    expect(html).toContain("Jul–Sep 2026");
    expect(html).toContain("2 of 3 months submitted");
    expect(html).toContain("To confirm: submit Sep 2026 (changes requested).");
    expect(html).toContain("Overdue");
    expect(html).toContain("RM 300"); // live revenue of the two submitted months
    expect(html).toContain('href="/api/documents/doc-ma-1/download"');
    expect(html).toContain('href="/portal/c0000000-0000-4000-8000-000000000001/updates/2026-07"');
    // The Fund Admin confirmed Q2 and uploaded Q3's accounts on the company's behalf.
    expect(html).toContain("Confirmed 10 Jul 2026, 10:00 by Fay Fund (ScaleUp)");
    expect(html).toContain("Uploaded by Fay Fund (ScaleUp)");
    // Never a ScaleUp email or role on the company side.
    expect(html).not.toContain("fund@scaleup.test");
    expect(html).not.toContain("(Fund Admin)");
    expect(html).toContain("Restated");
    // The confirmed close is folded away: its details render once expanded.
    expect(html).not.toContain("Year-end accruals");
    // The owner confirms (disabled until ready) and uploads; nobody on the company side reopens.
    expect(html).toContain("Confirm Q3 2026");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Confirm Q3 2026/);
    expect(html).toMatch(UPLOAD_BUTTON);
    expect(html).toMatch(UPLOAD_OTHER_BUTTON);
    expect(html).not.toContain("Reopen");
    // Document pack (M9) for owners.
    expect(html).toContain(`/api/exports/documents/${COMPANY.id}?closeId=${Q3.id}`);
    expect(html).toContain("Board pack.docx");
    expect(html).toContain("Bea Batik");
  });

  it("offers no document pack for a close whose files are over the pack limit (module M9's 100 MB)", async () => {
    const html = await render("company", owner, COMPANY, undefined, { accountsBytes: 120 * 1024 * 1024 });
    expect(html).not.toContain(`/api/exports/documents/${COMPANY.id}?closeId=${Q3.id}`);
    expect(html).toContain("Too large to download as one pack (120 MB): download the files one at a time");
    expect(html).toContain("The documents of Q3 2026 are too large to download as one pack");
  });

  it("shows a confirmed close's calculated and restated totals, reason and confirmer when expanded", async () => {
    const html = await render("company", owner, COMPANY, Q2_CONFIRMED.id);
    expect(html).toContain("Calculated");
    expect(html).toContain("As confirmed");
    expect(html).toContain("RM 600");
    expect(html).toContain("RM 610");
    expect(html).toContain("45.9%");
    expect(html).toContain("Year-end accruals");
    expect(html).toContain("Yes, to match the management accounts");
    expect(html).toMatch(/<dt[^>]*>By<\/dt><dd[^>]*>Fay Fund \(ScaleUp\)<\/dd>/);
    expect(html).not.toContain("fund@scaleup.test");
    expect(html).not.toContain("(Fund Admin)");
    // Q3 is folded away when another close is requested.
    expect(html).not.toContain("Live total");
  });

  it("shows ScaleUp staff as 'ScaleUp' when their names could not be loaded", async () => {
    const html = await render("company", owner, COMPANY, undefined, { staffNames: undefined });
    expect(html).toContain("Confirmed 10 Jul 2026, 10:00 by ScaleUp");
    expect(html).toContain("Uploaded by ScaleUp");
    expect(html).not.toContain("Fay Fund");
  });

  it("contributors upload but do not confirm or download the pack", async () => {
    const html = await render("company", contributor);
    expect(html).not.toContain("Confirm Q3 2026");
    expect(html).toMatch(UPLOAD_BUTTON);
    expect(html).not.toContain("/api/exports/documents/");
  });

  it("is read-only for an exited company", async () => {
    const exited: CompanyRow = { ...COMPANY, status: "exited" };
    const html = await render("company", subject({
      memberships: [{ companyId: COMPANY.id, companyName: COMPANY.name, companyStatus: "exited", role: "owner" }],
    }), exited);
    expect(html).toContain("Read-only");
    expect(html).not.toContain("Confirm Q3 2026");
    expect(html).not.toMatch(UPLOAD_BUTTON);
    expect(html).not.toMatch(UPLOAD_OTHER_BUTTON);
    expect(html).not.toContain("To confirm:");
  });

  it("never calls an exited company's complete open close 'Ready to confirm' (either side)", async () => {
    const exited: CompanyRow = { ...COMPANY, status: "exited" };
    const allIn: MonthRecord[] = MONTHS.map((month) => ({ ...month, status: "approved", is_overdue: false }));
    const viewers: [DocumentsMode, PermissionSubject][] = [
      ["company", subject({ memberships: [{ companyId: COMPANY.id, companyName: COMPANY.name, companyStatus: "exited", role: "owner" }] })],
      ["scaleup", subject({ scaleupRole: "fund_admin" })],
    ];
    for (const [mode, ctx] of viewers) {
      const html = await render(mode, ctx, exited, undefined, { months: allIn });
      expect(html).toContain("3 of 3 months submitted");
      expect(html).toContain("Management accounts: version 1");
      expect(html).toContain("Not confirmed");
      expect(html).toContain("Batik Boutique is no longer an active portfolio company (Exited), so this close can no longer be confirmed.");
      expect(html).not.toContain("Ready to confirm");
      expect(html).not.toContain("Confirm Q3 2026");
      expect(html).toContain("Checklist");
      expect(html).not.toContain("Before confirming");
    }
  });
});

describe("PeriodClosePanel (ScaleUp side)", () => {
  it("names staff with their role and lets Fund Admins act on behalf and reopen", async () => {
    const html = await render("scaleup", subject({ scaleupRole: "fund_admin" }));
    expect(html).toContain("Fay Fund (Fund Admin)");
    expect(html).toContain("on behalf of Batik Boutique");
    expect(html).toContain("Confirm Q3 2026");
    expect(html).toContain("Reopen");
    expect(html).toContain('href="/admin/review/s7"');
  });

  it("partners and viewers only look", async () => {
    for (const role of ["partner", "viewer"] as const) {
      const html = await render("scaleup", subject({ scaleupRole: role }));
      expect(html).not.toContain("Confirm Q3 2026");
      expect(html).not.toContain("Reopen");
      expect(html).not.toMatch(UPLOAD_BUTTON);
      expect(html).toContain('href="/api/documents/doc-ma-1/download"');
    }
  });

  it("Super Admins reopen but do not upload or confirm", async () => {
    const html = await render("scaleup", subject({ scaleupRole: "super_admin" }));
    expect(html).toContain("Reopen");
    expect(html).not.toContain("Confirm Q3 2026");
    expect(html).not.toMatch(UPLOAD_BUTTON);
    expect(html).not.toContain("on behalf of");
  });

  it("explains a company that is not yet reporting", async () => {
    const notReporting: CompanyRow = { ...COMPANY, reporting_start_month: null };
    loadCompanyDocuments.mockResolvedValueOnce(
      buildCompanyDocumentsView({ mode: "scaleup", company: notReporting, closes: [], documents: [], months: [], financials: [] }),
    );
    const element = await PeriodClosePanel({ company: notReporting, mode: "scaleup", ctx: subject({ scaleupRole: "viewer" }) });
    const html = renderToStaticMarkup(createElement("div", null, element));
    expect(html).toContain("Not yet reporting");
    expect(html).toContain(`href="/admin/companies/${COMPANY.id}"`);
  });
});

describe("PortfolioTable (ScaleUp)", () => {
  it("lists each company's close with months, management accounts, restatement and a link to its documents", () => {
    const period = quarterOf("2026-09");
    const rows = buildPortfolioRows({
      period,
      companies: [
        { id: "a", name: "Batik Boutique", status: "active", reporting_start_month: "2026-07-01" },
        { id: "b", name: "RECQA", status: "active", reporting_start_month: "2026-07-01" },
        { id: "c", name: "StayHere", status: "written_off", reporting_start_month: null },
        { id: "d", name: "Mamakhaus", status: "exited", reporting_start_month: "2026-07-01" },
      ],
      closes: [
        { id: "qa", company_id: "a", status: "confirmed", restated_totals: { revenue_total: 1 }, confirmed_at: "2026-10-06T02:00:00Z" },
        { id: "qb", company_id: "b", status: "open", restated_totals: null, confirmed_at: null },
        { id: "qd", company_id: "d", status: "open", restated_totals: null, confirmed_at: null },
      ],
      submissions: [
        ...["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({ company_id: "a", month, status: "approved" as const })),
        { company_id: "b", month: "2026-07-01", status: "submitted" as const },
        ...["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({ company_id: "d", month, status: "approved" as const })),
      ],
      managementAccountCloseIds: ["qa", "qd"],
      funds: [{ company_id: "a", code: "SV1" }],
    });
    const html = renderToStaticMarkup(
      createElement(PortfolioTable, {
        rows,
        period,
        companyHref: (id: string) => `/admin/documents?company=${id}&period=${periodKey(period)}`,
      }),
    );
    expect(html).toContain('href="/admin/documents?company=a&amp;period=Q3-2026"');
    expect(html).toContain("Confirmed");
    expect(html).toContain("3 of 3");
    expect(html).toContain("1 of 3");
    expect(html).toContain("1 file");
    expect(html).toContain("None yet");
    expect(html).toContain("Restated");
    expect(html).toContain("6 Oct 2026");
    expect(html).toContain("SV1");
    expect(html).toContain("Not yet reporting");
    expect(html).toContain("Written off");
    // The exited company's complete open close can no longer be confirmed.
    expect(html).toContain("Not confirmed");
    expect(html).not.toContain("Ready to confirm");
    // Open closes first (read-only companies after the others), then confirmed, then no close.
    expect(html.indexOf("RECQA")).toBeLessThan(html.indexOf("Mamakhaus"));
    expect(html.indexOf("Mamakhaus")).toBeLessThan(html.indexOf("Batik Boutique"));
    expect(html.indexOf("Batik Boutique")).toBeLessThan(html.indexOf("StayHere"));
  });
});
