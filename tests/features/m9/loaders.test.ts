// The server-side loaders of the exports (src/lib/exports/*-data.ts, fetch-all.ts) against a fake
// PostgREST + Storage with the real supabase-js client: request shapes, pagination past PostgREST's
// 1000-row cap, filters and shaping. RLS itself is covered by tests/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return {
    ...actual,
    getCompanyConfig: vi.fn(),
    getCurrentTemplateVersion: vi.fn(),
    getTemplateVersion: vi.fn(),
  };
});

import { DataError, getCompanyConfig, getCurrentTemplateVersion, getTemplateVersion } from "@/lib/data";
import { auditCsvStream, countAuditEntries, latestAuditEntryId, listAuditPage } from "@/lib/exports/audit-data";
import { loadC4WorkbookInput } from "@/lib/exports/c4-data";
import { downloadPackFiles, listDocumentPackOptions, loadDocumentPack } from "@/lib/exports/documents-data";
import { planDocumentPack } from "@/lib/exports/documents-zip";
import { EXPORT_CHUNK_CONCURRENCY, fetchAllPages, fetchByIdChunks, mapWithConcurrency } from "@/lib/exports/fetch-all";
import { findFund, loadPortfolioData } from "@/lib/exports/portfolio-data";

import { KPI, MAY, OLD_TOWN, RETAIL, SAAS, T1, T2, c4Tables, config, templateSection, templateVersion } from "./db-fixtures";
import { createFakeSupabase, type Row } from "./fake-supabase";

const BATIK = "c0000000-0000-4000-8000-000000000001";
const KIDDO = "c0000000-0000-4000-8000-000000000003";
const HUDDLE = "c0000000-0000-4000-8000-000000000011";
const SV1 = "f1000000-0000-4000-8000-000000000001";
const SFF = "f1000000-0000-4000-8000-000000000002";

function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// fetch-all helpers
// ---------------------------------------------------------------------------------------------

describe("fetchAllPages", () => {
  it("reads page after page until an empty one", async () => {
    const data = Array.from({ length: 5 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await fetchAllPages("test", "read", (from, to) => {
      calls.push([from, to]);
      // A server cap of 2 rows, below the requested page size.
      return Promise.resolve({ data: data.slice(from, Math.min(to + 1, from + 2)), error: null });
    }, { pageSize: 3 });
    expect(rows).toEqual([0, 1, 2, 3, 4]);
    expect(calls).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [5, 7],
    ]);
  });

  it("throws a DataError that keeps the database code, and stops runaway reads", async () => {
    await expect(
      fetchAllPages("test", "read things", () =>
        Promise.resolve({ data: null, error: { message: "permission denied for table x", code: "42501" } }),
      ),
    ).rejects.toMatchObject({ name: "DataError", code: "42501" });
    await expect(
      fetchAllPages("test", "read", () => Promise.resolve({ data: [1, 2], error: null }), { maxRows: 5 }),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe("fetchByIdChunks and mapWithConcurrency", () => {
  it("deduplicates and chunks ids", async () => {
    const seen: string[][] = [];
    const rows = await fetchByIdChunks(["a", "b", "a", "c", "d", "e"], async (chunk) => {
      seen.push(chunk);
      return chunk.map((id) => id.toUpperCase());
    }, 2);
    expect(seen).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
    expect(rows).toEqual(["A", "B", "C", "D", "E"]);
    expect(await fetchByIdChunks([], async () => ["never"])).toEqual([]);
  });

  it("keeps the order and the concurrency limit", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (delay, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      return index * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it("reads at most a few chunks at a time", async () => {
    let running = 0;
    let peak = 0;
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);
    const rows = await fetchByIdChunks(
      ids,
      async (chunk) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return chunk;
      },
      2,
    );
    expect(rows).toEqual(ids);
    expect(peak).toBe(EXPORT_CHUNK_CONCURRENCY);
  });
});

// ---------------------------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------------------------

function viewRow(companyId: string, month: string, status: string, n = 1): Row {
  return {
    submission_id: uuid("5b000000", n),
    company_id: companyId,
    month,
    status,
    due_date: "2026-10-15",
    submitted_at: null,
    approved_at: null,
    currency: "MYR",
    fx_rate_to_myr: 1,
    revenue_total: 1000 * n,
    gross_profit: 400 * n,
    net_profit: 100 * n,
    cash_in_bank: 50_000,
    burn_rate: 1000,
    headcount_ft: 5,
    headcount_pt: 1,
  };
}

function portfolioTables(view: Row[]) {
  return {
    funds: [
      { id: SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd" },
      { id: SFF, code: "SFF", name: "ScaleUp Founders Fund LP" },
    ],
    fund_investments: [
      { fund_id: SV1, company_id: BATIK },
      { fund_id: SFF, company_id: KIDDO },
      { fund_id: SFF, company_id: HUDDLE },
    ],
    companies: [
      { id: BATIK, name: "Batik Boutique" },
      { id: KIDDO, name: "Kiddocare" },
      { id: HUDDLE, name: "Huddle" },
    ],
    v_submission_financials: view,
  };
}

describe("loadPortfolioData", () => {
  it("filters by fund (code or id), months and approval", async () => {
    const { sb, requests } = createFakeSupabase(
      portfolioTables([
        viewRow(BATIK, "2026-07-01", "approved", 1),
        viewRow(KIDDO, "2026-07-01", "approved", 2),
        viewRow(KIDDO, "2026-08-01", "submitted", 3),
        viewRow(HUDDLE, "2026-09-01", "approved", 4),
        viewRow(KIDDO, "2026-06-01", "approved", 5),
      ]),
    );
    const data = await loadPortfolioData(sb, { fund: "sff", from: "2026-07", to: "2026-09", status: "approved" });
    if (!data.found) throw new Error("expected the fund");
    expect(data.fund?.code).toBe("SFF");
    expect(data.rows.map((row) => [row.company, row.month, row.funds])).toEqual([
      ["Huddle", "2026-09", "SFF"],
      ["Kiddocare", "2026-07", "SFF"],
    ]);
    const viewRequest = requests.find((request) => request.path === "v_submission_financials");
    expect(viewRequest?.params.get("status")).toBe("eq.approved");
    expect(viewRequest?.params.getAll("month")).toEqual(["gte.2026-07-01", "lte.2026-09-01"]);
    expect(viewRequest?.params.get("company_id")).toMatch(/^in\.\(/);

    const byId = await loadPortfolioData(sb, { fund: SFF.toUpperCase(), from: null, to: null, status: "all" });
    expect(byId.found && byId.rows).toHaveLength(4);
    expect(await loadPortfolioData(sb, { fund: "SV2", from: null, to: null, status: "all" })).toEqual({ found: false });
  });

  it("reads every page past the 1000-row cap for a full-portfolio export", async () => {
    const view = Array.from({ length: 2_500 }, (_, i) =>
      viewRow([BATIK, KIDDO, HUDDLE][i % 3], `20${String(10 + Math.floor(i / 36)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`, "approved", i + 1),
    );
    const { sb, requests } = createFakeSupabase(portfolioTables(view));
    const data = await loadPortfolioData(sb, { fund: null, from: null, to: null, status: "all" });
    expect(data.found && data.rows).toHaveLength(2_500);
    const pages = requests.filter((request) => request.path === "v_submission_financials");
    expect(pages.map((request) => [request.params.get("offset"), request.params.get("limit")])).toEqual([
      ["0", "1000"],
      ["1000", "1000"],
      ["2000", "1000"],
      ["2500", "1000"],
    ]);
  });

  it("finds funds by id or code", () => {
    const funds = [{ id: SV1, code: "SV1", name: "SV1" }];
    expect(findFund(funds, " sv1 ")?.id).toBe(SV1);
    expect(findFund(funds, SV1.toUpperCase())?.code).toBe("SV1");
    expect(findFund(funds, "SFF")).toBeUndefined();
  });

  it("adds the months' revenue segment figures of both kinds for the Excel file (BRD B30)", async () => {
    const segment = (n: number) => uuid("a2000000", n);
    const tables = {
      ...portfolioTables([viewRow(BATIK, "2026-07-01", "approved", 1), viewRow(KIDDO, "2026-07-01", "draft", 2)]),
      revenue_segments: [
        { id: segment(1), company_id: BATIK, name: "Retail", kind: "company", is_active: true, sort_order: 1 },
        { id: segment(2), company_id: BATIK, name: "Wholesale", kind: "company", is_active: false, sort_order: 2 },
        { id: segment(3), company_id: BATIK, name: "Corporate gifting", kind: "scaleup", is_active: true, sort_order: 1 },
        { id: segment(4), company_id: KIDDO, name: "Bookings", kind: "company", is_active: false, sort_order: 1 },
      ],
      submission_segment_values: [
        { submission_id: uuid("5b000000", 1), segment_id: segment(3), amount: 300 },
        { submission_id: uuid("5b000000", 1), segment_id: segment(1), amount: 700 },
        { submission_id: uuid("5b000000", 1), segment_id: segment(2), amount: 300 },
        // The Kiddocare month is still a draft, so the retired segment's figure is not shown.
        { submission_id: uuid("5b000000", 2), segment_id: segment(4), amount: 50 },
        // A month outside the extract.
        { submission_id: uuid("5b000000", 9), segment_id: segment(1), amount: 1 },
      ],
    };
    const { sb, requests } = createFakeSupabase(tables);
    const data = await loadPortfolioData(sb, { fund: null, from: null, to: null, status: "all", withSegments: true });
    if (!data.found) throw new Error("expected the data");
    expect(data.segmentRows?.map((r) => [r.company, r.month, r.kind, r.segment, r.inUse, r.amount])).toEqual([
      ["Batik Boutique", "2026-07", "company", "Retail", true, 700],
      ["Batik Boutique", "2026-07", "company", "Wholesale", false, 300],
      ["Batik Boutique", "2026-07", "scaleup", "Corporate gifting", true, 300],
    ]);
    const valueRequest = requests.find((request) => request.path === "submission_segment_values");
    expect(valueRequest?.params.get("submission_id")).toBe(`in.(${uuid("5b000000", 1)},${uuid("5b000000", 2)})`);
    const segmentRequest = requests.find((request) => request.path === "revenue_segments");
    expect(segmentRequest?.params.get("company_id")).toBe(`in.(${BATIK},${KIDDO})`);

    // The CSV has no segment sheet: it reads only the figures of months still open for changes, whose
    // revenue follows the company's own segments (here Kiddocare's draft).
    const plain = createFakeSupabase(tables);
    const csvData = await loadPortfolioData(plain.sb, { fund: null, from: null, to: null, status: "all" });
    expect(csvData.found && csvData.segmentRows).toBeNull();
    const csvValueRequests = plain.requests.filter((request) => request.path === "submission_segment_values");
    expect(csvValueRequests.length).toBeGreaterThan(0);
    expect(csvValueRequests.every((request) => request.params.get("submission_id") === `in.(${uuid("5b000000", 2)})`)).toBe(true);
    expect(plain.requests.find((request) => request.path === "revenue_segments")?.params.get("company_id")).toBe(
      `in.(${KIDDO})`,
    );
    // Approved months only: nothing to calculate, nothing read.
    const approved = createFakeSupabase(tables);
    await loadPortfolioData(approved.sb, { fund: null, from: null, to: null, status: "approved" });
    expect(approved.requests.some((request) => /^(revenue_segments|submission_segment_values)$/.test(request.path))).toBe(
      false,
    );
  });

  it("calculates the revenue of open months from the company's own segments, also for the CSV (BRD B30)", async () => {
    const segment = (n: number) => uuid("a2000000", n);
    // Sent back after the owner removed Wholesale: the stored 1,300 still includes its 400.
    const reopened = { ...viewRow(BATIK, "2026-08-01", "changes_requested", 2), revenue_total: 1_300 };
    const tables = {
      ...portfolioTables([viewRow(BATIK, "2026-07-01", "approved", 1), reopened]),
      revenue_segments: [
        { id: segment(1), company_id: BATIK, name: "Retail", kind: "company", is_active: true, sort_order: 1 },
        { id: segment(2), company_id: BATIK, name: "Wholesale", kind: "company", is_active: false, sort_order: 2 },
        { id: segment(3), company_id: BATIK, name: "Corporate gifting", kind: "scaleup", is_active: true, sort_order: 1 },
      ],
      submission_segment_values: [
        { submission_id: uuid("5b000000", 1), segment_id: segment(1), amount: 1_000 },
        { submission_id: uuid("5b000000", 2), segment_id: segment(1), amount: 900 },
        { submission_id: uuid("5b000000", 2), segment_id: segment(2), amount: 400 },
        { submission_id: uuid("5b000000", 2), segment_id: segment(3), amount: 50 },
      ],
    };
    const { sb } = createFakeSupabase(tables);
    const data = await loadPortfolioData(sb, { fund: null, from: null, to: null, status: "all" });
    if (!data.found) throw new Error("expected the data");
    expect(data.rows.map((row) => [row.month, row.status, row.revenue, row.gpPct])).toEqual([
      ["2026-07", "approved", 1_000, 40],
      ["2026-08", "changes_requested", 900, (800 * 100) / 900],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Document pack
// ---------------------------------------------------------------------------------------------

const Q3 = "a0000000-0000-4000-8000-000000000003";
const H2 = "a0000000-0000-4000-8000-000000000012";
const AISHA = "11111111-1111-4111-8111-111111111111";

function documentTables() {
  const doc = (id: string, closeId: string | null, version: number, size: number, uploadedAt: string): Row => ({
    id,
    company_id: BATIK,
    period_close_id: closeId,
    doc_type: "management_accounts",
    file_name: `accounts v${version}.pdf`,
    storage_path: `${BATIK}/${closeId ?? "general"}/${id}-accounts.pdf`,
    mime_type: "application/pdf",
    size_bytes: size,
    version,
    uploaded_at: uploadedAt,
    uploaded_by: AISHA,
  });
  return {
    companies: [{ id: BATIK, name: "Batik Boutique" }],
    period_closes: [
      { id: Q3, company_id: BATIK, label: "Q3 2026", period_start: "2026-07-01", period_end: "2026-09-30", period_type: "quarter", status: "confirmed" },
      { id: H2, company_id: BATIK, label: "H2 2026", period_start: "2026-07-01", period_end: "2026-12-31", period_type: "half", status: "open" },
    ],
    documents: [
      doc("d0000000-0000-4000-8000-000000000001", Q3, 1, 1000, "2026-10-02T02:00:00Z"),
      doc("d0000000-0000-4000-8000-000000000002", Q3, 2, 2000, "2026-10-03T02:00:00Z"),
      doc("d0000000-0000-4000-8000-000000000003", null, 1, 500, "2026-10-04T02:00:00Z"),
    ],
    profiles: [{ id: AISHA, full_name: "Aisha Rahman", email: "aisha@scaleup.my", scaleup_role: "fund_admin" }],
  };
}

describe("document pack loading", () => {
  it("loads one period close's documents with uploader names and roles for ScaleUp", async () => {
    const { sb, requests } = createFakeSupabase(documentTables());
    const pack = await loadDocumentPack(sb, BATIK, Q3, { audience: "scaleup" });
    if (!pack.found) throw new Error("expected the pack");
    expect(pack.close?.label).toBe("Q3 2026");
    expect(pack.documents.map((d) => [d.version, d.uploaded_by_name])).toEqual([
      [1, "Aisha Rahman (Fund Admin)"],
      [2, "Aisha Rahman (Fund Admin)"],
    ]);
    const documentRequest = requests.find((request) => request.path === "documents");
    expect(documentRequest?.params.get("period_close_id")).toBe(`eq.${Q3}`);
    expect(requests.some((request) => request.path === "rpc/staff_display_names")).toBe(false);
  });

  it("names ScaleUp uploaders “<name> (ScaleUp)” for company owners (BRD B28)", async () => {
    // RLS hides ScaleUp staff profiles from company users: only staff_display_names names them.
    const { sb, requests } = createFakeSupabase(
      { ...documentTables(), profiles: [] },
      { rpc: { staff_display_names: () => ({ body: [{ id: AISHA, display_name: "Aisha Rahman (ScaleUp)" }] }) } },
    );
    const pack = await loadDocumentPack(sb, BATIK, null, { audience: "company" });
    expect(pack.found && pack.documents.map((d) => d.uploaded_by_name)).toEqual([
      "Aisha Rahman (ScaleUp)",
      "Aisha Rahman (ScaleUp)",
      "Aisha Rahman (ScaleUp)",
    ]);
    const rpc = requests.find((request) => request.path === "rpc/staff_display_names");
    expect(rpc?.body).toEqual({ p_ids: [AISHA] });
  });

  it("falls back to “ScaleUp” when the names cannot be loaded", async () => {
    const { sb } = createFakeSupabase(
      { ...documentTables(), profiles: [] },
      {
        rpc: {
          staff_display_names: () => ({ status: 401, body: { code: "42501", message: "Please sign in first.", details: null, hint: null } }),
        },
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pack = await loadDocumentPack(sb, BATIK, Q3, { audience: "company" });
    expect(pack.found && pack.documents.map((d) => d.uploaded_by_name)).toEqual(["ScaleUp", "ScaleUp"]);
  });

  it("reports an unknown company or period close", async () => {
    const { sb } = createFakeSupabase(documentTables());
    expect(await loadDocumentPack(sb, KIDDO, null, { audience: "scaleup" })).toEqual({ found: false, what: "company" });
    expect(await loadDocumentPack(sb, BATIK, "a0000000-0000-4000-8000-000000000099", { audience: "scaleup" })).toEqual({
      found: false,
      what: "close",
    });
  });

  it("downloads the files with the caller's storage access and marks missing ones", async () => {
    const tables = documentTables();
    const [first, second] = tables.documents;
    const { sb, requests } = createFakeSupabase(tables, {
      storage: { [`company-documents/${String(first.storage_path)}`]: new TextEncoder().encode("PDF 1") },
    });
    const pack = await loadDocumentPack(sb, BATIK, Q3, { audience: "scaleup" });
    if (!pack.found) throw new Error("expected the pack");
    const plan = planDocumentPack(pack.company.name, pack.documents, pack.closes);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = await downloadPackFiles(sb, plan.entries);
    expect(files.map((file) => (file ? new TextDecoder().decode(file) : null))).toEqual(["PDF 1", null]);
    expect(requests.filter((request) => request.path.startsWith("storage/")).map((request) => request.path)).toEqual([
      `storage/company-documents/${String(first.storage_path)}`,
      `storage/company-documents/${String(second.storage_path)}`,
    ]);
  });

  it("counts documents per period close for the export form", async () => {
    const { sb } = createFakeSupabase(documentTables());
    expect(await listDocumentPackOptions(sb, BATIK)).toEqual({
      // Newest period end first.
      closes: [
        { id: H2, label: "H2 2026", status: "open", count: 0, bytes: 0 },
        { id: Q3, label: "Q3 2026", status: "confirmed", count: 2, bytes: 3000 },
      ],
      generalCount: 1,
      totalCount: 3,
      totalBytes: 3500,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------

/** The stream as text, keeping the byte-order mark (Response.text() would drop it). */
async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const bytes = await new Response(stream).arrayBuffer();
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

function auditRow(id: number, overrides: Row = {}): Row {
  const minute = String(id % 60).padStart(2, "0");
  return {
    id,
    occurred_at: `2026-09-${String(1 + Math.floor(id / 1440) % 28).padStart(2, "0")}T0${Math.floor(id / 60) % 10}:${minute}:00+00:00`,
    created_at: "2026-09-01T00:00:00+00:00",
    actor_id: AISHA,
    actor_email: id % 2 === 0 ? "aisha@scaleup.my" : "a_b@company.com",
    actor_role: "fund_admin",
    action: id % 3 === 0 ? "export" : "update",
    entity: "submissions",
    entity_id: null,
    company_id: BATIK,
    on_behalf: false,
    summary: `Entry ${id}`,
    old_data: null,
    new_data: null,
    ...overrides,
  };
}

describe("audit log reads", () => {
  it("filters, orders and pages the log, with the total", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => auditRow(i + 1));
    const { sb, requests } = createFakeSupabase({ audit_log: rows });
    const page = await listAuditPage(
      sb,
      { company: BATIK, actor: "a_b", action: "update", entity: "submissions", from: "2026-09-01", to: "2026-09-30" },
      1,
    );
    const request = requests[0];
    expect(request.params.get("company_id")).toBe(`eq.${BATIK}`);
    expect(request.params.get("actor_email")).toBe("ilike.%a\\_b%");
    expect(request.params.get("action")).toBe("eq.update");
    expect(request.params.getAll("occurred_at")).toEqual([
      "gte.2026-08-31T16:00:00.000Z",
      "lt.2026-09-30T16:00:00.000Z",
    ]);
    expect(request.params.get("order")).toBe("occurred_at.desc,id.desc");
    expect([request.params.get("offset"), request.params.get("limit")]).toEqual(["0", "50"]);
    // Odd ids that are not multiples of 3: "a_b@company.com" (the underscore is literal), action update.
    const expected = rows.filter((r) => Number(r.id) % 2 === 1 && Number(r.id) % 3 !== 0).length;
    expect(page.total).toBe(expected);
    expect(page.rows).toHaveLength(Math.min(50, expected));
  });

  it("treats a page past the end as empty and still counts", async () => {
    const { sb } = createFakeSupabase({ audit_log: [auditRow(1), auditRow(2)] });
    expect(await listAuditPage(sb, {}, 3)).toEqual({ rows: [], total: 2 });
    expect(await countAuditEntries(sb, { action: "update" })).toBe(2);
  });

  it("streams the CSV newest first, 1000 entries at a time by entry number", async () => {
    const rows = Array.from({ length: 2_345 }, (_, i) => auditRow(i + 1));
    const { sb, requests } = createFakeSupabase({ audit_log: rows });
    const text = await readText(auditCsvStream(sb, {}, new Map([[BATIK, "Batik Boutique"]]), 50_000));
    const lines = text.split("\r\n");
    expect(lines[0].startsWith("﻿Entry,Time (Malaysia),Actor email")).toBe(true);
    expect(lines).toHaveLength(2_345 + 2);
    expect(lines[1].startsWith("2345,")).toBe(true);
    expect(lines[2_345].startsWith("1,")).toBe(true);
    expect(lines[1]).toContain(",Batik Boutique,");
    expect(requests.map((request) => request.params.get("id"))).toEqual([null, "lt.1346", "lt.346", "lt.1"]);
    expect(requests.every((request) => request.params.get("order") === "id.desc")).toBe(true);
  });

  it("stops the CSV at the row limit and says so in its last record", async () => {
    const { sb } = createFakeSupabase({ audit_log: Array.from({ length: 30 }, (_, i) => auditRow(i + 1)) });
    const lines = (await readText(auditCsvStream(sb, {}, new Map(), 12, { total: 30 }))).split("\r\n");
    // Header, entries 30 to 19, the final record, and the empty string after the last CRLF.
    expect(lines).toHaveLength(1 + 12 + 1 + 1);
    expect(lines[12].startsWith("19,")).toBe(true);
    expect(lines[13]).toBe(
      `"Export incomplete: this file holds the newest 12 of the 30 matching entries because one export can hold at most 12 entries. Entries numbered below 19 (logged up to 2026-09-01 08:19:00, Malaysia time) are not included. Narrow the filters, for example to an earlier date range, and export again for the rest.",,,,,,,,,,,,,`,
    );
    // Exactly at the limit with nothing left: no final record.
    const exact = createFakeSupabase({ audit_log: Array.from({ length: 12 }, (_, i) => auditRow(i + 1)) });
    expect((await readText(auditCsvStream(exact.sb, {}, new Map(), 12))).split("\r\n")).toHaveLength(1 + 12 + 1);
  });

  it("stops before the file would pass its size limit and says so in its last record", async () => {
    const long = { value_text: "Narrative ".repeat(100) };
    const rows = Array.from({ length: 40 }, (_, i) => auditRow(i + 1, { old_data: long, new_data: long }));
    const { sb } = createFakeSupabase({ audit_log: rows });
    const maxBytes = 16 * 1024;
    const text = await readText(auditCsvStream(sb, {}, new Map(), 50_000, { total: 40, maxBytes }));
    const marker = text.lastIndexOf('"Export incomplete:');
    expect(marker).toBeGreaterThan(0);
    // Everything before the final record fits in the limit; the final record is the last line.
    expect(new TextEncoder().encode(text.slice(0, marker)).byteLength).toBeLessThanOrEqual(maxBytes);
    const lines = text.split("\r\n");
    const written = lines.length - 3; // header, final record, empty string after the last CRLF
    expect(written).toBeGreaterThan(3);
    expect(written).toBeLessThan(40);
    expect(lines[lines.length - 2]).toContain(
      `this file holds the newest ${written} of the 40 matching entries because the file reached the size limit of one export (16 KB).`,
    );
  });

  it("stops when the export runs out of time and says so, unless nothing is left", async () => {
    const { sb } = createFakeSupabase({ audit_log: Array.from({ length: 2_500 }, (_, i) => auditRow(i + 1)) });
    // Each read of the clock is 20 seconds later: two pages fit in the 45-second budget.
    let reads = 0;
    const now = () => 20_000 * reads++;
    const lines = (await readText(auditCsvStream(sb, {}, new Map(), 50_000, { total: 2_500, now }))).split("\r\n");
    expect(lines).toHaveLength(1 + 2_000 + 1 + 1);
    expect(lines[2_000].startsWith("501,")).toBe(true);
    expect(lines[2_001]).toContain(
      "this file holds the newest 2,000 of the 2,500 matching entries because the export reached its time limit. Entries numbered below 501 ",
    );

    // Out of time just as the last entry was written: the file is complete, so no final record.
    const small = createFakeSupabase({ audit_log: Array.from({ length: 1_000 }, (_, i) => auditRow(i + 1)) });
    const clock = [0, 20_000, 60_000];
    let tick = 0;
    const later = () => clock[Math.min(tick++, clock.length - 1)];
    const complete = (await readText(auditCsvStream(small.sb, {}, new Map(), 50_000, { now: later }))).split("\r\n");
    expect(complete).toHaveLength(1 + 1_000 + 1);
    expect(complete[1_000].startsWith("1,")).toBe(true);
  });

  it("holds the entries that existed when the export started", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => auditRow(i + 1));
    const { sb, requests } = createFakeSupabase({ audit_log: rows });
    const upToId = await latestAuditEntryId(sb);
    expect(upToId).toBe(5);
    expect([requests[0].params.get("order"), requests[0].params.get("limit")]).toEqual(["id.desc", "1"]);
    // The export's own entry, logged before the file is read, is not in it.
    rows.push(auditRow(6, { action: "export", entity: "audit_log" }));
    const lines = (await readText(auditCsvStream(sb, {}, new Map(), 50_000, { upToId }))).split("\r\n");
    expect(lines).toHaveLength(5 + 2);
    expect(lines[1].startsWith("5,")).toBe(true);
    expect(await latestAuditEntryId(createFakeSupabase({ audit_log: [] }).sb)).toBe(0);
    const empty = await readText(auditCsvStream(createFakeSupabase({ audit_log: [] }).sb, {}, new Map(), 50_000, { upToId: 0 }));
    expect(empty.split("\r\n")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// C4 workbook input
// ---------------------------------------------------------------------------------------------

describe("loadC4WorkbookInput", () => {
  beforeEach(() => {
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
      .mockImplementation(async (_sb, id) =>
        templateVersion(id, 1, [
          templateSection(id, "summary_v1", "Company Summary", "narrative", [["milestones_old", "Milestones", "long_text"]], 4),
        ]),
      );
  });

  it("lists every month but loads only the approved months' values by default", async () => {
    const { sb, requests } = createFakeSupabase(c4Tables());
    const input = await loadC4WorkbookInput(sb, BATIK, {
      include: "approved",
      fxVisible: true,
      generatedAt: "2026-09-30T06:05:00Z",
      today: "2026-09-30",
    });
    if (!input) throw new Error("expected the input");
    expect(input.company).toEqual({ name: "Batik Boutique", legal_name: "Batik Boutique Sdn Bhd", reporting_currency: "MYR" });
    expect(input.months.map((m) => [m.month, m.status, Object.keys(m.values).sort()])).toEqual([
      ["2026-05-01", "approved", ["milestones_old", "revenue_total"]],
      ["2026-06-01", "submitted", []],
    ]);
    expect(input.months[0].segments).toEqual({ [RETAIL]: 100_000, [SAAS]: 2_500 });
    // Half-year closes only (their confirmed totals go under the half-year columns).
    expect(input.closes?.map((close) => [close.label, close.status])).toEqual([["H1 2026", "confirmed"]]);
    // Both revenue breakdowns (BRD B30), retired ones included.
    expect(input.segments.map((s) => [s.name, s.kind, s.is_active])).toEqual([
      ["Retail", "company", true],
      ["SaaS", "scaleup", false],
    ]);
    expect(input.months[0].kpis).toEqual({ [`${KPI}:${OLD_TOWN}`]: { value_number: 5_000, value_text: null, value_bool: null } });
    const valueRequest = requests.find((request) => request.path === "submission_values");
    expect(valueRequest?.params.get("submission_id")).toBe(`in.(${MAY})`);
    // The month's own template (v1) is loaded next to the current one; KPI members include inactive ones.
    expect(vi.mocked(getTemplateVersion)).toHaveBeenCalledWith(sb, T1);
    expect(input.templates.map((t) => t.id)).toEqual([T2, T1]);
    expect(input.kpis[0].members.map((m) => [m.name, m.is_active])).toEqual([
      ["Mont Kiara", true],
      ["Old Town", false],
    ]);
  });

  it("loads every month's values when all months are included", async () => {
    const { sb } = createFakeSupabase(c4Tables());
    const input = await loadC4WorkbookInput(sb, BATIK, { include: "all", fxVisible: false, generatedAt: "2026-09-30T06:05:00Z" });
    expect(input?.months[1].values.revenue_total?.value_number).toBe(110_000);
    expect(input?.fxVisible).toBe(false);
    // The current template is already loaded; only v1 is fetched.
    expect(vi.mocked(getTemplateVersion)).toHaveBeenCalledTimes(1);
  });

  it("returns null for a company that does not exist or is not visible", async () => {
    vi.mocked(getCompanyConfig).mockRejectedValue(
      new DataError("getCompanyConfig", "company was not found", { code: "PGRST116", notFound: true }),
    );
    const { sb } = createFakeSupabase(c4Tables());
    expect(await loadC4WorkbookInput(sb, BATIK, { include: "approved", fxVisible: true, generatedAt: "2026-09-30T06:05:00Z" })).toBeNull();
  });
});
