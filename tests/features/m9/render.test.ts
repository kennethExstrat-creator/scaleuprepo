// Render smoke tests of /admin/exports and /admin/audit: the server pages (guards and Supabase mocked,
// data from the fake PostgREST) rendered to static markup with their client components, so wording,
// links and states can be checked without a browser.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireScaleUp: vi.fn(), assertScaleUp: vi.fn() };
});
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) };
});
vi.mock("@/app/admin/exports/actions", () => ({ getDocumentPackOptions: vi.fn() }));

import { AuditEntryDetails } from "@/app/admin/audit/_components/audit-table";
import AuditLogPage from "@/app/admin/audit/page";
import { DownloadLink } from "@/app/admin/exports/_components/download-link";
import ExportsPage from "@/app/admin/exports/page";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { auditEntryView } from "@/lib/exports/audit";
import { requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { createFakeSupabase, type Row, type Tables } from "./fake-supabase";

const BATIK = "c0000000-0000-4000-8000-000000000001";
const HUDDLE = "c0000000-0000-4000-8000-000000000011";
const STAYHERE = "c0000000-0000-4000-8000-000000000013";

function context(role: ScaleUpAccessContext["scaleupRole"]): ScaleUpAccessContext {
  return {
    userId: "u0000000-0000-4000-8000-000000000001",
    email: "staff@scaleup.my",
    fullName: "Staff",
    scaleupRole: role,
    isActive: true,
    memberships: [],
    aal: "aal2",
    mfaRequired: true,
    termsAccepted: true,
  };
}

function useTables(tables: Tables) {
  const fake = createFakeSupabase(tables);
  vi.mocked(createClient).mockResolvedValue(fake.sb);
  return fake;
}

beforeEach(() => {
  vi.mocked(requireScaleUp).mockReset().mockResolvedValue(context("partner"));
});

// ---------------------------------------------------------------------------------------------

function exportTables(months: string[] = ["2026-07-01", "2026-08-01"]): Tables {
  return {
    companies: [
      { id: BATIK, name: "Batik Boutique", status: "active", reporting_start_month: "2026-07-01", submissions: [{ id: "s1" }] },
      { id: HUDDLE, name: "Huddle", status: "active", reporting_start_month: null, submissions: [] },
      { id: STAYHERE, name: "StayHere", status: "written_off", reporting_start_month: null, submissions: [] },
    ],
    funds: [
      { id: "f1", code: "SFF", name: "ScaleUp Founders Fund LP", is_active: true },
      { id: "f2", code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", is_active: true },
    ],
    reporting_periods: months.map((month) => ({ month })),
  };
}

describe("/admin/exports", () => {
  it("renders the three export cards for every ScaleUp role", async () => {
    const { requests } = useTables(exportTables());
    const html = renderToStaticMarkup(await ExportsPage());
    expect(vi.mocked(requireScaleUp)).toHaveBeenCalledWith();
    expect(html).toContain("<h1");
    expect(html).toContain("Exports");
    expect(html).toContain("C4 workbook");
    expect(html).toContain("Portfolio data");
    expect(html).toContain("Document pack");
    expect(html).toContain("Include months not yet approved");
    expect(html).toContain("Approved months only");
    expect(html).toContain("Excel (.xlsx)");
    // BRD B30: the Excel extract adds the revenue segments; the C4 card names both breakdowns.
    expect(html).toContain("Excel adds Revenue segments");
    expect(html).toContain("Period closes (quarter and half-year totals, with figures restated to the management accounts)");
    expect(html).toContain("revenue segments, ScaleUp revenue lines and key figures");
    // Nothing is chosen yet, so the downloads are disabled buttons (not links).
    expect(html).not.toContain('href="/api/exports/c4/');
    expect(html).toContain('href="/api/exports/portfolio?format=xlsx&amp;from=2026-07&amp;to=2026-08&amp;status=approved"');
    expect(html).toContain('href="/admin/audit?action=export"');
    const companies = requests.find((request) => request.path === "companies");
    expect(companies?.params.get("select")).toBe("id,name,status,reporting_start_month,submissions(id)");
    expect(companies?.params.get("submissions.limit")).toBe("1");
  });

  it("hides the audit link from viewers and explains when no months are open", async () => {
    vi.mocked(requireScaleUp).mockResolvedValue(context("viewer"));
    useTables(exportTables([]));
    const html = renderToStaticMarkup(await ExportsPage());
    expect(html).not.toContain("/admin/audit");
    expect(html).toContain("No reporting months are open yet");
  });
});

// ---------------------------------------------------------------------------------------------

function auditRow(id: number, overrides: Row = {}): Row {
  return {
    id,
    occurred_at: `2026-09-30T0${id % 10}:00:00+00:00`,
    created_at: "2026-09-30T00:00:00+00:00",
    actor_id: "11111111-1111-4111-8111-111111111111",
    actor_email: "aisha@scaleup.my",
    actor_role: "fund_admin",
    action: "update",
    entity: "submission_values",
    entity_id: `5a000000-0000-4000-8000-000000000001:revenue_total`,
    company_id: BATIK,
    on_behalf: true,
    summary: null,
    old_data: { value_number: 100 },
    new_data: { value_number: 120 },
    ...overrides,
  };
}

function auditTables(rows: Row[]): Tables {
  return { audit_log: rows, companies: [{ id: BATIK, name: "Batik Boutique" }] };
}

async function renderAudit(searchParams: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await AuditLogPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/admin/audit", () => {
  it("lists entries newest first with actor, badges, record, company and paging", async () => {
    const rows = [
      ...Array.from({ length: 58 }, (_, i) => auditRow(i + 3)),
      auditRow(1, {
        occurred_at: "2026-09-29T01:00:00+00:00",
        actor_id: null,
        actor_email: null,
        actor_role: "system",
        action: "insert",
        entity: "submissions",
        entity_id: null,
        on_behalf: false,
        summary: "Opened automatically",
      }),
      auditRow(2, {
        occurred_at: "2026-09-29T02:00:00+00:00",
        action: "export",
        entity: "c4_workbook",
        company_id: "c0000000-0000-4000-8000-000000000099",
        on_behalf: false,
      }),
    ];
    useTables(auditTables(rows));
    const html = await renderAudit();
    expect(vi.mocked(requireScaleUp)).toHaveBeenCalledWith(["super_admin", "fund_admin", "partner"]);
    expect(html).toContain("Audit log");
    expect(html).toContain("60 entries · showing 1–50");
    expect(html).toContain("aisha@scaleup.my");
    expect(html).toContain("Fund Admin");
    expect(html).toContain("On behalf");
    expect(html).toContain("Monthly update values");
    expect(html).toContain('href="/admin/companies/c0000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain('href="/admin/audit?page=2"');
    expect(html).toContain('href="/api/exports/audit"');
    expect(html).toContain('aria-expanded="false"');

    const second = await renderAudit({ page: "2" });
    expect(second).toContain("showing 51–60");
    expect(second).toContain("System");
    expect(second).toContain("Deleted company");
    expect(second).toContain("Exported");
  });

  it("keeps the filters in the export link and explains empty results", async () => {
    useTables(auditTables([auditRow(3)]));
    const filtered = await renderAudit({ action: "approve", from: "2026-09-01" });
    expect(filtered).toContain("No entries match these filters");
    // No entries: the export is a disabled button.
    expect(filtered).not.toContain('href="/api/exports/audit');

    const matching = await renderAudit({ action: "update", company: BATIK });
    expect(matching).toContain(`href="/api/exports/audit?company=${BATIK}&amp;action=update"`);
    expect(matching).toContain("1 entry match these filters");

    const past = await renderAudit({ page: "9" });
    expect(past).toContain("This page is past the last entry");

    useTables(auditTables([]));
    expect(await renderAudit()).toContain("No audit entries yet");
  });
});

// ---------------------------------------------------------------------------------------------

describe("DownloadLink", () => {
  it("is a real link when ready and a disabled button otherwise", () => {
    const ready = renderToStaticMarkup(
      createElement(DownloadLink, { href: "/api/exports/c4/x?include=approved", fallbackFilename: "x.xlsx" }, "Get it"),
    );
    expect(ready).toContain('<a href="/api/exports/c4/x?include=approved"');
    expect(ready).toContain("Get it");
    const waiting = renderToStaticMarkup(
      createElement(DownloadLink, { href: null, fallbackFilename: "x.xlsx" }),
    );
    expect(waiting).toContain("<button");
    expect(waiting).toContain("disabled");
    expect(waiting).not.toContain("<a ");
    expect(waiting).toContain("Download");
  });

  it("stays a real link when the browser downloads the file itself or the file can be cut short", () => {
    const browser = renderToStaticMarkup(
      createElement(
        DownloadLink,
        { href: "/api/exports/documents/x?closeId=y", fallbackFilename: "x.zip", browserDownload: true },
        "Download pack",
      ),
    );
    expect(browser).toContain('<a href="/api/exports/documents/x?closeId=y"');
    const audit = renderToStaticMarkup(
      createElement(
        DownloadLink,
        {
          href: "/api/exports/audit",
          fallbackFilename: "Audit log.csv",
          incomplete: { marker: "Export incomplete:", title: "Incomplete", description: "Narrow the filters." },
        },
        "Export CSV",
      ),
    );
    expect(audit).toContain('<a href="/api/exports/audit"');
  });
});

describe("AuditEntryDetails", () => {
  it("shows the changed fields old → new, the identifiers and the on-behalf note", () => {
    const view = auditEntryView(
      {
        id: 7,
        occurred_at: "2026-09-30T06:05:23+00:00",
        created_at: "2026-09-30T06:05:23+00:00",
        actor_id: "11111111-1111-4111-8111-111111111111",
        actor_email: "aisha@scaleup.my",
        actor_role: "fund_admin",
        action: "update",
        entity: "submission_values",
        entity_id: "5a000000-0000-4000-8000-000000000001:revenue_total",
        company_id: BATIK,
        on_behalf: true,
        summary: "Saved on behalf",
        old_data: { value_number: 100, value_text: null },
        new_data: { value_number: 120, value_text: "" },
      },
      "Batik Boutique",
    );
    const html = renderToStaticMarkup(createElement(AuditEntryDetails, { entry: view, id: "details-7" }));
    expect(html).toContain('id="details-7"');
    expect(html).toContain("Saved on behalf");
    expect(html).toContain("Entered by ScaleUp on behalf of the company.");
    expect(html).toContain("Changed fields");
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain(">100</pre>");
    expect(html).toContain(">120</pre>");
    expect(html).toContain(">empty<");
    expect(html).toContain(">blank<");
    expect(html).toContain("2026-09-30 14:05:23");
    expect(html).toContain("aisha@scaleup.my (Fund Admin)");
    expect(html).toContain("5a000000-0000-4000-8000-000000000001:revenue_total");
  });
});
