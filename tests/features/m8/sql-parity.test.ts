// M8's pure helpers against the real migrations (PGlite, tests/db harness; read-only use): the storage
// path of an upload satisfies the storage INSERT policy and the documents trigger, the restatement the
// confirm action derives is accepted by confirm_period_close(), and the live totals shown before
// confirming (liveCloseTotals / closeCountFrom) equal the computed_totals stored at confirmation.
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildDocumentPath, documentMimeType, isDocumentPathFor } from "@/components/documents/document-rules";
import { deriveRestatement, parsePeriodTotals } from "@/components/documents/totals";
import {
  buildCompanyDocumentsView,
  closeCountFrom,
  liveCloseTotals,
  personLabel,
  staffIdsToResolve,
  type CloseRecord,
  type CompanyRecord,
  type FinancialRecord,
  type MonthRecord,
} from "@/components/documents/view-model";
import type { SubmissionStatus } from "@/lib/types/enums";

import { SEED } from "../../db/fixtures";
import { freshDb, type TestDb } from "../../db/harness";
import { fillAndSubmit, fillValid, setupPortfolio, submit, type Portfolio } from "../../db/scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;
const Q3 = { period_start: "2026-07-01", period_end: "2026-09-30" };

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

async function q3Of(companyId: string): Promise<string> {
  return db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [companyId]);
}

/**
 * The M8 upload as `userId`: Storage checks the INSERT policy as the uploader (signing the upload), the
 * object lands at the built path, then saveDocument's insert runs through RLS and the trigger.
 */
async function upload(userId: string, companyId: string, closeId: string | null, fileName: string, docType = "management_accounts") {
  const path = buildDocumentPath(companyId, closeId, randomUUID(), fileName);
  expect(isDocumentPathFor(path, companyId, closeId)).toBe(true);
  await db.asUser(userId, (sql) =>
    sql.query("insert into storage.objects (bucket_id, name, owner, metadata) values ('company-documents', $1, auth.uid(), $2)", [
      path,
      { size: 4096, mimetype: documentMimeType(fileName) },
    ]),
  );
  return db.asUser(userId, (sql) =>
    sql.one<{ version: number; size_bytes: number; mime_type: string; uploaded_by: string; storage_path: string }>(
      `insert into public.documents (company_id, period_close_id, doc_type, file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning version, size_bytes::int as size_bytes, mime_type, uploaded_by, storage_path`,
      [companyId, closeId, docType, fileName, path, documentMimeType(fileName), 1],
    ),
  );
}

/** The company's monthly figures as getFinancialSeries returns them (v_submission_financials, as `userId`). */
async function series(userId: string, companyId: string): Promise<FinancialRecord[]> {
  const rows = await db.asUser(userId, (sql) =>
    sql.query<{
      month: string;
      status: SubmissionStatus;
      revenue_total: number | null;
      gross_profit: number | null;
      net_profit: number | null;
      cash_in_bank: number | null;
      burn_rate: number | null;
      headcount_ft: number | null;
      headcount_pt: number | null;
    }>(
      `select month, status::text as status, revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt
       from public.v_submission_financials where company_id = $1 order by month`,
      [companyId],
    ),
  );
  return rows;
}

async function storedTotals(closeId: string) {
  return db.one<{ computed_totals: unknown; restated_totals: unknown; restatement_reason: string | null }>(
    "select computed_totals, restated_totals, restatement_reason from public.period_closes where id = $1",
    [closeId],
  );
}

describe("uploads (docs/ARCHITECTURE.md §2.8)", () => {
  it("a member's upload to a close passes the storage policy and the documents trigger", async () => {
    const q3 = await q3Of(A);
    const first = await upload(p.batikContributor, A, q3, "Q3 accounts (final).PDF");
    expect(first).toMatchObject({ version: 1, size_bytes: 4096, mime_type: "application/pdf", uploaded_by: p.batikContributor });
    expect(first.storage_path).toMatch(new RegExp(`^${A}/${q3}/[0-9a-f-]{36}-Q3-accounts-final\\.pdf$`));
    const second = await upload(p.batikOwner, A, q3, "Q3 accounts v2.xlsx");
    expect(second).toMatchObject({
      version: 2,
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("a Fund Admin's upload to the general folder works on behalf (audited)", async () => {
    const saved = await upload(p.fundAdmin, A, null, "Board pack Oct.docx", "supporting");
    expect(saved).toMatchObject({ version: 1, uploaded_by: p.fundAdmin });
    const audit = await db.one("select on_behalf, actor_role from public.audit_log where entity = 'documents' and action = 'insert'");
    expect(audit).toEqual({ on_behalf: true, actor_role: "fund_admin" });
  });

  it("a partner cannot upload (the upload is refused at signing time)", async () => {
    const path = buildDocumentPath(A, null, randomUUID(), "notes.pdf");
    await expect(
      db.asUser(p.partner, (sql) =>
        sql.query("insert into storage.objects (bucket_id, name, owner) values ('company-documents', $1, auth.uid())", [path]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("period totals parity (liveCloseTotals = computed_totals)", () => {
  it("the live totals before confirming are what confirm_period_close stores; the restatement is accepted", async () => {
    const q3 = await q3Of(A);
    const figures = [
      { revenue_total: 1000.25, gross_profit: 400.1, net_profit: -100.75, cash_in_bank: 50000, burn_rate: 10, headcount_ft: 10, headcount_pt: 1 },
      { revenue_total: 2000.5, gross_profit: -50, net_profit: 20.5, cash_in_bank: 45000.5, burn_rate: 20, headcount_ft: 11, headcount_pt: 2 },
      { revenue_total: 3333.3333, gross_profit: 1234.5678, net_profit: 60, cash_in_bank: 40000.25, burn_rate: 25, headcount_ft: 12, headcount_pt: 0 },
    ];
    for (const [i, month] of ["2026-07-01", "2026-08-01", "2026-09-01"].entries()) {
      await fillValid(db, p.batikOwner, p.subs.batik[month], "batik", figures[i]);
      await submit(db, p.batikOwner, p.subs.batik[month]);
    }
    await upload(p.batikOwner, A, q3, "accounts.pdf");

    const live = liveCloseTotals(Q3, "2026-07-01", await series(p.batikOwner, A));
    expect(live.months_count).toBe(3);
    const restated = deriveRestatement(live, { revenue_total: 6400, cash_in_bank: 39999 });
    expect(restated).toMatchObject({ revenue_total: 6400, cash_in_bank: 39999 });
    expect(restated).toHaveProperty("gp_pct");

    await db.asUser(p.batikOwner, (sql) =>
      sql.rpc("confirm_period_close", { p_close_id: q3, p_restated_totals: restated, p_reason: "Year-end accruals" }),
    );
    const stored = await storedTotals(q3);
    expect(parsePeriodTotals(stored.computed_totals)).toEqual(live);
    expect(stored.restated_totals).toEqual(restated);
    expect(stored.restatement_reason).toBe("Year-end accruals");
  });

  it("only submitted and approved months count; a month sent back is left out of the live totals", async () => {
    const q3 = await q3Of(A);
    await fillAndSubmit(db, p.batikOwner, "batik", [p.subs.batik["2026-07-01"], p.subs.batik["2026-08-01"]]);
    await fillValid(db, p.batikOwner, p.subs.batik["2026-09-01"], "batik", { revenue_total: 999 });
    const live = liveCloseTotals(Q3, "2026-07-01", await series(p.batikOwner, A));
    expect(live.months_count).toBe(2);
    await submit(db, p.batikOwner, p.subs.batik["2026-09-01"]);
    await upload(p.batikOwner, A, q3, "accounts.pdf");
    const complete = liveCloseTotals(Q3, "2026-07-01", await series(p.batikOwner, A));
    await db.asUser(p.batikOwner, (sql) => sql.rpc("confirm_period_close", { p_close_id: q3 }));
    expect(parsePeriodTotals((await storedTotals(q3)).computed_totals)).toEqual(complete);
  });

  it("counts from a later reporting start, and from the first submitted month once the start is cleared", async () => {
    const company = await db.createCompany({ name: "Late Starter", reportingStartMonth: "2026-08-01" });
    const owner = await db.createUser();
    await db.addMember(company, owner, "owner");
    await db.rpc("open_due_periods");
    const subs = await db.query<{ id: string }>("select id from public.submissions where company_id = $1 order by month", [company]);
    await fillAndSubmit(db, owner, "recqa", subs.map((s) => s.id), { revenue_total: 777.77, burn_rate: 33 });
    const close = await q3Of(company);
    await upload(owner, company, close, "accounts.pdf");

    const withStart = liveCloseTotals(Q3, "2026-08-01", await series(owner, company));
    expect(withStart.months_count).toBe(2);
    expect(closeCountFrom(Q3, "2026-08-01", [])).toBe("2026-08");

    // "Not yet reporting" again (BRD B16): the close counts from the first month with a submission.
    await db.query("update public.companies set reporting_start_month = null where id = $1", [company]);
    const months = (await series(owner, company)).map((point) => point.month);
    expect(closeCountFrom(Q3, null, months)).toBe("2026-08");
    const withoutStart = liveCloseTotals(Q3, null, await series(owner, company));
    expect(withoutStart).toEqual(withStart);

    const view = buildCompanyDocumentsView({
      mode: "company",
      company: { id: company, name: "Late Starter", status: "active", reporting_currency: "MYR", reporting_start_month: null },
      closes: [
        {
          id: close,
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
        },
      ],
      documents: [
        {
          id: "doc",
          period_close_id: close,
          doc_type: "management_accounts",
          file_name: "accounts.pdf",
          mime_type: "application/pdf",
          size_bytes: 4096,
          version: 1,
          uploaded_at: "2026-10-20T01:00:00Z",
          uploaded_by: owner,
          uploader: null,
        },
      ],
      months: subs.map((s, i) => ({ id: s.id, month: i === 0 ? "2026-08-01" : "2026-09-01", status: "submitted", is_overdue: false })),
      financials: await series(owner, company),
    });
    expect(view.closes[0]).toMatchObject({ countFrom: "2026-08", countedMonths: 2, submittedMonths: 2, readyToConfirm: true });

    await db.asUser(owner, (sql) => sql.rpc("confirm_period_close", { p_close_id: close }));
    expect(parsePeriodTotals((await storedTotals(close)).computed_totals)).toEqual(withoutStart);
  });
});

describe("company side: ScaleUp names and read-only closes (BRD B28, B15)", () => {
  it("names a Fund Admin uploader '<full name> (ScaleUp)' through staff_display_names; their profile stays hidden", async () => {
    const q3 = await q3Of(A);
    await upload(p.fundAdmin, A, q3, "accounts.pdf");

    // As the owner: the document is visible, its uploader's profile is not (RLS: the embed is null).
    const docs = await db.asUser(p.batikOwner, (sql) =>
      sql.query<{ uploaded_by: string | null }>("select uploaded_by from public.documents where period_close_id = $1", [q3]),
    );
    expect(docs).toEqual([{ uploaded_by: p.fundAdmin }]);
    expect(await db.asUser(p.batikOwner, (sql) => sql.query("select id from public.profiles where id = $1", [p.fundAdmin]))).toEqual([]);

    const ids = staffIdsToResolve([], docs.map((doc) => ({ uploaded_by: doc.uploaded_by, uploader: null })));
    expect(ids).toEqual([p.fundAdmin.toLowerCase()]);
    const rows = await db.asUser(p.batikOwner, (sql) =>
      sql.query<{ id: string; display_name: string }>("select id, display_name from public.staff_display_names($1::uuid[])", [ids]),
    );
    const staffNames = Object.fromEntries(rows.map((row) => [row.id.toLowerCase(), row.display_name]));
    expect(personLabel(null, p.fundAdmin, "company", staffNames)).toBe("Fay Fund (ScaleUp)");
  });

  it("names a removed contributor's upload 'Former team member', not ScaleUp", async () => {
    const q3 = await q3Of(A);
    await upload(p.batikContributor, A, q3, "bank.pdf", "supporting");
    await db.asUser(p.batikOwner, (sql) =>
      sql.query("delete from public.company_members where company_id = $1 and user_id = $2", [A, p.batikContributor]),
    );

    // The owner can no longer read the contributor's profile, and staff_display_names does not name them.
    expect(await db.asUser(p.batikOwner, (sql) => sql.query("select id from public.profiles where id = $1", [p.batikContributor]))).toEqual([]);
    const ids = staffIdsToResolve([], [{ uploaded_by: p.batikContributor, uploader: null }]);
    const rows = await db.asUser(p.batikOwner, (sql) =>
      sql.query<{ id: string; display_name: string }>("select id, display_name from public.staff_display_names($1::uuid[])", [ids]),
    );
    expect(rows).toEqual([]);
    expect(personLabel(null, p.batikContributor, "company", {})).toBe("Former team member");
  });

  it("confirm_period_close refuses an exited company's complete close, so the view never calls it ready", async () => {
    const q3 = await q3Of(A);
    await fillAndSubmit(db, p.batikOwner, "batik", ["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => p.subs.batik[month]));
    await upload(p.batikOwner, A, q3, "accounts.pdf");
    await db.asUser(p.superAdmin, (sql) => sql.rpc("set_company_status", { p_company_id: A, p_status: "exited", p_reason: "Sold" }));

    for (const user of [p.batikOwner, p.fundAdmin]) {
      await expect(db.asUser(user, (sql) => sql.rpc("confirm_period_close", { p_close_id: q3 }))).rejects.toThrow(
        /no longer an active portfolio company/,
      );
    }

    const company = await db.one<CompanyRecord>(
      `select id, name, status::text as status, reporting_currency, reporting_start_month::text as reporting_start_month
       from public.companies where id = $1`,
      [A],
    );
    expect(company.status).toBe("exited");
    const months = await db.asUser(p.batikOwner, (sql) =>
      sql.query<MonthRecord>(
        "select id, month::text as month, status::text as status, is_overdue from public.v_submission_overview where company_id = $1",
        [A],
      ),
    );
    const close: CloseRecord = {
      id: q3,
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
    const input = {
      mode: "company" as const,
      closes: [close],
      documents: [
        {
          id: "doc",
          period_close_id: q3,
          doc_type: "management_accounts" as const,
          file_name: "accounts.pdf",
          mime_type: "application/pdf",
          size_bytes: 4096,
          version: 1,
          uploaded_at: "2026-10-20T01:00:00Z",
          uploaded_by: p.batikOwner,
          uploader: null,
        },
      ],
      months,
      financials: await series(p.batikOwner, A),
    };
    expect(buildCompanyDocumentsView({ ...input, company }).closes[0]).toMatchObject({
      countedMonths: 3,
      submittedMonths: 3,
      allSubmitted: true,
      readyToConfirm: false,
    });
    // The same close of an active company is ready.
    expect(buildCompanyDocumentsView({ ...input, company: { ...company, status: "active" } }).closes[0].readyToConfirm).toBe(true);
  });
});
