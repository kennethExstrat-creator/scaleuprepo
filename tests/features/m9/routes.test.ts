// The export route handlers (/api/exports/*) with the session guards, the Supabase client and the
// data-layer functions mocked: permissions, validation, audit logging, file headers and error statuses.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, assertCanViewCompany: vi.fn(), assertScaleUp: vi.fn() };
});
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return { ...actual, getCompanyConfig: vi.fn(), getCurrentTemplateVersion: vi.fn(), getTemplateVersion: vi.fn() };
});

import { GET as auditGet, HEAD as auditHead } from "@/app/api/exports/audit/route";
import { GET as c4Get, HEAD as c4Head } from "@/app/api/exports/c4/[companyId]/route";
import { GET as documentsGet, HEAD as documentsHead } from "@/app/api/exports/documents/[companyId]/route";
import { GET as portfolioGet, HEAD as portfolioHead } from "@/app/api/exports/portfolio/route";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import type { CompanyViewContext, ScaleUpAccessContext } from "@/lib/auth/types";
import { assertCanViewCompany, assertScaleUp } from "@/lib/auth/session";
import { DataError, getCompanyConfig, getCurrentTemplateVersion, getTemplateVersion } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { BATIK, RETAIL, T2, c4Tables, config, templateSection, templateVersion } from "./db-fixtures";
import { createFakeSupabase, type Row, type Tables } from "./fake-supabase";

const BASE = {
  userId: "u0000000-0000-4000-8000-000000000001",
  email: "someone@example.com",
  fullName: "Someone",
  isActive: true,
  aal: "aal2" as const,
  mfaRequired: true,
  termsAccepted: true,
};
const VIEWER: CompanyViewContext = { ...BASE, scaleupRole: "viewer", memberships: [], companyRole: null };
const PARTNER: ScaleUpAccessContext = { ...BASE, scaleupRole: "partner", memberships: [] };
const membership = (role: "owner" | "contributor") => ({
  companyId: BATIK,
  companyName: "Batik Boutique",
  companyStatus: "active" as const,
  role,
});
const OWNER: CompanyViewContext = { ...BASE, scaleupRole: null, memberships: [membership("owner")], companyRole: "owner" };
const CONTRIBUTOR: CompanyViewContext = {
  ...BASE,
  scaleupRole: null,
  memberships: [membership("contributor")],
  companyRole: "contributor",
};

type AuditCall = Record<string, unknown>;

function useFake(tables: Tables, options: { storage?: Record<string, Uint8Array | null>; auditError?: boolean } = {}) {
  const audit: AuditCall[] = [];
  const fake = createFakeSupabase(tables, {
    storage: options.storage,
    rpc: {
      log_audit_event: (args) => {
        audit.push(args);
        return options.auditError
          ? { status: 500, body: { code: "XX000", message: "audit failed", details: null, hint: null } }
          : { status: 204, body: null };
      },
    },
  });
  vi.mocked(createClient).mockResolvedValue(fake.sb);
  return { ...fake, audit };
}

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

beforeEach(() => {
  vi.mocked(assertCanViewCompany).mockReset().mockResolvedValue(VIEWER);
  vi.mocked(assertScaleUp).mockReset().mockResolvedValue({ ...PARTNER });
  vi.mocked(getCompanyConfig).mockReset().mockResolvedValue(config());
  vi.mocked(getCurrentTemplateVersion)
    .mockReset()
    .mockResolvedValue(
      templateVersion(T2, 2, [
        templateSection(T2, "company_summary", "Company Summary", "narrative", [["key_milestones", "Key milestones", "long_text"]], 4),
      ]),
    );
  vi.mocked(getTemplateVersion)
    .mockReset()
    .mockImplementation(async (_sb, id) => templateVersion(id, 1, []));
});

// ---------------------------------------------------------------------------------------------

describe("GET /api/exports/c4/[companyId]", () => {
  it("sends the workbook to ScaleUp staff and logs the export", async () => {
    const { audit } = useFake(c4Tables());
    const response = await c4Get(request(`/api/exports/c4/${BATIK}`), params({ companyId: BATIK }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="Batik Boutique C4 workbook \d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(["C4", "Revenue Lines", "KPIs", "Monthly Grid"]);
    // Both revenue breakdowns (BRD B30): Retail (the company's own) and SaaS (a ScaleUp line, retired).
    const lines = workbook.getWorksheet("Revenue Lines");
    expect(lines?.getColumn(1).values).toEqual(
      expect.arrayContaining([
        "Company revenue segments (add up to total revenue)",
        "Retail",
        "Total revenue",
        "ScaleUp revenue lines (need not add up to total revenue)",
        "SaaS (no longer used)",
      ]),
    );
    expect(audit).toEqual([
      {
        p_action: "export",
        p_entity: "c4_workbook",
        p_entity_id: BATIK,
        p_company_id: BATIK,
        p_summary: "Exported the C4 workbook of Batik Boutique (approved months only)",
        p_data: { format: "xlsx", include: "approved", months: 2, months_included: 1 },
      },
    ]);
  });

  it("lets owners export their company, but not contributors", async () => {
    const { audit } = useFake(c4Tables());
    vi.mocked(assertCanViewCompany).mockResolvedValue(OWNER);
    const ok = await c4Get(request(`/api/exports/c4/${BATIK}?include=all`), params({ companyId: BATIK }));
    expect(ok.status).toBe(200);
    expect(audit[0]?.p_summary).toBe("Exported the C4 workbook of Batik Boutique (all months)");

    vi.mocked(assertCanViewCompany).mockResolvedValue(CONTRIBUTOR);
    const denied = await c4Get(request(`/api/exports/c4/${BATIK}`), params({ companyId: BATIK }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Only ScaleUp and the company's owners can export its data." });
    expect(audit).toHaveLength(1);
  });

  it("answers JSON errors: bad input 400, signed out 401, unknown company 404, audit failure 500", async () => {
    const { audit } = useFake(c4Tables(), { auditError: true });
    const bad = await c4Get(request(`/api/exports/c4/${BATIK}?include=draft`), params({ companyId: BATIK }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "include must be “approved” or “all”." });

    vi.mocked(assertCanViewCompany).mockRejectedValueOnce(new ActionError(MESSAGES.session));
    const signedOut = await c4Get(request(`/api/exports/c4/${BATIK}`), params({ companyId: BATIK }));
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ error: MESSAGES.session });

    vi.mocked(getCompanyConfig).mockRejectedValueOnce(
      new DataError("getCompanyConfig", "not found", { code: "PGRST116", notFound: true }),
    );
    const missing = await c4Get(request(`/api/exports/c4/${BATIK}`), params({ companyId: BATIK }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "We couldn't find that company." });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await c4Get(request(`/api/exports/c4/${BATIK}`), params({ companyId: BATIK }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: MESSAGES.generic });
    expect(audit).toHaveLength(1);
  });

  it("checks owners against the company id whatever its case", async () => {
    useFake(c4Tables());
    vi.mocked(assertCanViewCompany).mockResolvedValue(OWNER);
    const response = await c4Get(request(`/api/exports/c4/${BATIK.toUpperCase()}`), params({ companyId: BATIK.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(vi.mocked(assertCanViewCompany)).toHaveBeenCalledWith(BATIK);
  });

  it("shows a followed link's error as a page with a way back, not as JSON", async () => {
    useFake(c4Tables());
    vi.mocked(assertCanViewCompany).mockResolvedValue(CONTRIBUTOR);
    const response = await c4Get(
      new NextRequest(`http://localhost/api/exports/c4/${BATIK}`, {
        headers: {
          "sec-fetch-mode": "navigate",
          accept: "text/html",
          referer: `http://localhost/portal/${BATIK}/history`,
        },
      }),
      params({ companyId: BATIK }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("Only ScaleUp and the company&#39;s owners can export its data.");
    expect(html).toContain(`<a href="/portal/${BATIK}/history">Go back</a>`);
  });
});

// ---------------------------------------------------------------------------------------------

const SV1 = "f1000000-0000-4000-8000-000000000001";

function portfolioTables(): Tables {
  const row = (month: string, status: string, n: number): Row => ({
    submission_id: `5b000000-0000-4000-8000-00000000000${n}`,
    company_id: BATIK,
    month,
    status,
    currency: "MYR",
    fx_rate_to_myr: 1,
    revenue_total: 100_000,
    gross_profit: 40_000,
    net_profit: 10_000,
    cash_in_bank: 500_000,
    burn_rate: 25_000,
    headcount_ft: 10,
    headcount_pt: 1,
  });
  return {
    funds: [{ id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd" }],
    fund_investments: [{ fund_id: SV1, company_id: BATIK }],
    companies: [{ id: BATIK, name: "Batik Boutique" }],
    v_submission_financials: [row("2026-07-01", "approved", 1), row("2026-08-01", "submitted", 2)],
    revenue_segments: [
      { id: RETAIL, company_id: BATIK, name: "Retail", kind: "company", is_active: true, sort_order: 1 },
    ],
    submission_segment_values: [
      { submission_id: "5b000000-0000-4000-8000-000000000001", segment_id: RETAIL, amount: 100_000 },
      { submission_id: "5b000000-0000-4000-8000-000000000002", segment_id: RETAIL, amount: 100_000 },
    ],
  };
}

describe("GET /api/exports/portfolio", () => {
  it("sends CSV with a BOM and logs the export with its filters", async () => {
    const { audit } = useFake(portfolioTables());
    const response = await portfolioGet(
      request("/api/exports/portfolio?format=csv&fund=SV1&from=2026-07&to=2026-09&status=approved"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="Portfolio data SV1 2026-07 to 2026-09 (approved).csv"',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.split("\r\n")).toHaveLength(3); // header, one approved month, trailing CRLF
    expect(vi.mocked(assertScaleUp)).toHaveBeenCalledWith();
    expect(audit[0]).toEqual({
      p_action: "export",
      p_entity: "portfolio_data",
      p_entity_id: "SV1",
      p_summary: "Exported portfolio data (SV1 · Jul 2026 to Sep 2026 · approved months only) as CSV: 1 row",
      p_data: { format: "csv", fund: "SV1", from: "2026-07", to: "2026-09", status: "approved", rows: 1, companies: 1 },
    });
  });

  it("sends Excel by default for every fund, with the revenue segments sheet", async () => {
    const { audit, requests } = useFake(portfolioTables());
    const response = await portfolioGet(request("/api/exports/portfolio?status=all&fund=all"));
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(["Portfolio data", "Revenue segments", "About"]);
    expect(workbook.getWorksheet("Portfolio data")?.rowCount).toBe(3);
    expect(workbook.getWorksheet("Revenue segments")?.rowCount).toBe(3);
    expect(audit[0]).toMatchObject({
      p_summary: "Exported portfolio data (All funds · All months · all statuses) as XLSX: 2 rows",
      p_data: { format: "xlsx", fund: null, status: "all", rows: 2, companies: 1, segment_rows: 2 },
    });
    expect(requests.some((r) => r.path === "submission_segment_values")).toBe(true);
  });

  it("validates the choices and explains empty results", async () => {
    const { audit } = useFake(portfolioTables());
    const reversed = await portfolioGet(request("/api/exports/portfolio?from=2026-09&to=2026-07"));
    expect(reversed.status).toBe(400);
    expect(await reversed.json()).toEqual({ error: "The first month must be on or before the last month." });
    const badMonth = await portfolioGet(request("/api/exports/portfolio?from=2026-13"));
    expect(await badMonth.json()).toEqual({ error: "from must be a month in the form YYYY-MM." });
    const badFormat = await portfolioGet(request("/api/exports/portfolio?format=pdf"));
    expect(badFormat.status).toBe(400);
    const unknownFund = await portfolioGet(request("/api/exports/portfolio?fund=XYZ"));
    expect(unknownFund.status).toBe(404);
    expect(await unknownFund.json()).toEqual({ error: "That fund was not found." });
    const empty = await portfolioGet(request("/api/exports/portfolio?from=2027-01"));
    expect(empty.status).toBe(404);
    expect((await empty.json()).error).toMatch(/^No approved monthly figures match these choices/);
    expect(audit).toHaveLength(0);
  });

  it("is for ScaleUp staff only", async () => {
    useFake(portfolioTables());
    vi.mocked(assertScaleUp).mockRejectedValueOnce(new ActionError(MESSAGES.permission));
    const response = await portfolioGet(request("/api/exports/portfolio"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: MESSAGES.permission });
  });
});

// ---------------------------------------------------------------------------------------------

const Q3 = "a0000000-0000-4000-8000-000000000003";
const H2 = "a0000000-0000-4000-8000-000000000012";

function documentTables(sizes: number[] = [1000, 2000]): Tables {
  return {
    companies: [{ id: BATIK, name: "Batik Boutique" }],
    period_closes: [
      { id: Q3, company_id: BATIK, label: "Q3 2026", period_start: "2026-07-01", period_end: "2026-09-30", period_type: "quarter", status: "open" },
      { id: H2, company_id: BATIK, label: "H2 2026", period_start: "2026-07-01", period_end: "2026-12-31", period_type: "half", status: "open" },
    ],
    documents: sizes.map((size, index) => ({
      id: `d0000000-0000-4000-8000-00000000000${index + 1}`,
      company_id: BATIK,
      period_close_id: Q3,
      doc_type: "management_accounts",
      file_name: `accounts ${index + 1}.pdf`,
      storage_path: `${BATIK}/${Q3}/d${index + 1}-accounts.pdf`,
      mime_type: "application/pdf",
      size_bytes: size,
      version: index + 1,
      uploaded_at: `2026-10-0${index + 1}T02:00:00Z`,
      uploaded_by: null,
    })),
    profiles: [],
  };
}

const STORAGE = {
  [`company-documents/${BATIK}/${Q3}/d1-accounts.pdf`]: new TextEncoder().encode("PDF one"),
  [`company-documents/${BATIK}/${Q3}/d2-accounts.pdf`]: new TextEncoder().encode("PDF two"),
};

describe("GET /api/exports/documents/[companyId]", () => {
  it("streams the zip of a period close and logs the export", async () => {
    const { audit } = useFake(documentTables(), { storage: STORAGE });
    const response = await documentsGet(
      request(`/api/exports/documents/${BATIK}?closeId=${Q3.toUpperCase()}`),
      params({ companyId: BATIK }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toMatch(/filename="Batik Boutique documents Q3 2026 \d{4}-\d{2}-\d{2}\.zip"/);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
    expect(names).toEqual([
      "Batik Boutique documents/Contents.csv",
      "Batik Boutique documents/Q3 2026/Management accounts v1 - accounts 1.pdf",
      "Batik Boutique documents/Q3 2026/Management accounts v2 - accounts 2.pdf",
    ]);
    expect(audit[0]).toMatchObject({
      p_action: "export",
      p_entity: "documents",
      p_entity_id: Q3,
      p_company_id: BATIK,
      p_summary: "Downloaded the document pack of Batik Boutique (Q3 2026): 2 files",
      p_data: { format: "zip", close_id: Q3, close_label: "Q3 2026", files: 2, missing: 0 },
    });
  });

  it("explains empty, unreadable and oversized packs", async () => {
    useFake(documentTables(), { storage: STORAGE });
    const empty = await documentsGet(request(`/api/exports/documents/${BATIK}?closeId=${H2}`), params({ companyId: BATIK }));
    expect(empty.status).toBe(404);
    expect(await empty.json()).toEqual({ error: "No documents have been uploaded for H2 2026 yet." });
    const badClose = await documentsGet(request(`/api/exports/documents/${BATIK}?closeId=nope`), params({ companyId: BATIK }));
    expect(badClose.status).toBe(400);

    useFake(documentTables(), { storage: {} });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unreadable = await documentsGet(request(`/api/exports/documents/${BATIK}`), params({ companyId: BATIK }));
    expect(unreadable.status).toBe(502);

    useFake(documentTables([60 * 1024 * 1024, 50 * 1024 * 1024]), { storage: STORAGE });
    const large = await documentsGet(request(`/api/exports/documents/${BATIK}`), params({ companyId: BATIK }));
    expect(large.status).toBe(413);
    expect((await large.json()).error).toBe(
      "This document pack is too large to download in one go (110 MB; the limit is 100 MB). Download one period close at a time instead.",
    );
    const largeClose = await documentsGet(
      request(`/api/exports/documents/${BATIK}?closeId=${Q3}`),
      params({ companyId: BATIK }),
    );
    expect(largeClose.status).toBe(413);
    expect((await largeClose.json()).error).toBe(
      "The documents of Q3 2026 are too large to download as one pack (110 MB; the limit is 100 MB). Download the files one at a time instead.",
    );
  });

  it("is for ScaleUp and the company's owners", async () => {
    useFake(documentTables(), { storage: STORAGE });
    vi.mocked(assertCanViewCompany).mockResolvedValue(CONTRIBUTOR);
    const response = await documentsGet(request(`/api/exports/documents/${BATIK}`), params({ companyId: BATIK }));
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------

function auditRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    occurred_at: "2026-09-30T06:00:00+00:00",
    created_at: "2026-09-30T06:00:00+00:00",
    actor_id: null,
    actor_email: null,
    actor_role: "system",
    action: "insert",
    entity: "submissions",
    entity_id: null,
    company_id: null,
    on_behalf: false,
    summary: "Opened automatically",
    old_data: null,
    new_data: null,
  }));
}

describe("GET /api/exports/audit", () => {
  it("streams the filtered log as CSV for audit viewers and logs the export", async () => {
    const { audit } = useFake({ audit_log: auditRows(3), companies: [{ id: BATIK, name: "Batik Boutique" }] });
    const response = await auditGet(request("/api/exports/audit?action=insert&from=2026-09-01"));
    expect(vi.mocked(assertScaleUp)).toHaveBeenCalledWith(["super_admin", "fund_admin", "partner"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/filename="Audit log 2026-09-01 to \d{4}-\d{2}-\d{2}\.csv"/);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(text.startsWith("﻿Entry,")).toBe(true);
    expect(text.split("\r\n")).toHaveLength(5);
    expect(audit[0]).toEqual({
      p_action: "export",
      p_entity: "audit_log",
      p_summary: "Exported the audit log as CSV: 3 entries (filters: action=insert&from=2026-09-01)",
      p_data: { format: "csv", filters: { action: "insert", from: "2026-09-01" }, rows: 3 },
    });
  });

  it("leaves its own export entry out of the file", async () => {
    const rows = auditRows(3);
    const fake = createFakeSupabase(
      { audit_log: rows, companies: [] },
      {
        rpc: {
          log_audit_event: () => {
            rows.push({ ...rows[0], id: 4, action: "export", entity: "audit_log", summary: "Exported the audit log" });
            return { status: 204, body: null };
          },
        },
      },
    );
    vi.mocked(createClient).mockResolvedValue(fake.sb);
    const response = await auditGet(request("/api/exports/audit"));
    expect(response.status).toBe(200);
    const lines = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()).split("\r\n");
    expect(lines).toHaveLength(3 + 2);
    expect(lines.slice(1, 4).map((line) => line.split(",")[0])).toEqual(["3", "2", "1"]);
  });

  it("refuses exports above the row limit", async () => {
    const { audit } = useFake({ audit_log: auditRows(50_001), companies: [] });
    const response = await auditGet(request("/api/exports/audit"));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe(
      "50,001 entries match these filters, more than the 50,000 one export can hold. Narrow the filters, for example to a shorter date range.",
    );
    expect(audit).toHaveLength(0);
  });
});

describe("HEAD", () => {
  it("never runs an export", () => {
    for (const head of [c4Head, portfolioHead, documentsHead, auditHead]) {
      const response = head();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
    }
    expect(vi.mocked(assertScaleUp)).not.toHaveBeenCalled();
    expect(vi.mocked(assertCanViewCompany)).not.toHaveBeenCalled();
  });
});
