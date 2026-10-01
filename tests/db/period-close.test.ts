import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, fillValid, setupPortfolio, submit, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
let q3: string;
const A = SEED.companies.batikBoutique;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
  q3 = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [A]);
});

afterEach(async () => {
  await db?.close();
});

type DocType = "management_accounts" | "supporting";

/** Puts a file into the company-documents bucket (as the database owner, like the Storage API does). */
async function storeObject(path: string, metadata: Record<string, unknown> | null = null): Promise<string> {
  await db.query("insert into storage.objects (bucket_id, name, metadata) values ('company-documents', $1, $2)", [path, metadata]);
  return path;
}

/** Uploads a file and then adds its documents row as `user` (the M8 flow). */
async function upload(user: string, company: string, closeId: string | null, docType: DocType = "management_accounts", name = "accounts.pdf") {
  const path = await storeObject(`${company}/${closeId ?? "general"}/${randomUUID()}-${name}`);
  return db.asUser(user, (sql) =>
    sql.one<{ id: string; version: number }>(
      `insert into public.documents (company_id, period_close_id, doc_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
       values ($1, $2, $3, $4, $5, 'application/pdf', 2048, auth.uid()) returning id, version`,
      [company, closeId, docType, name, path],
    ),
  );
}

const confirm = (user: string, closeId: string, restated: unknown = null, reason: string | null = null) =>
  db.asUser(user, (sql) => sql.rpc("confirm_period_close", { p_close_id: closeId, p_restated_totals: restated, p_reason: reason }));

const MONTHS = ["2026-07-01", "2026-08-01", "2026-09-01"];

async function submitQuarter() {
  const figures = [
    { revenue_total: 100, gross_profit: 40, net_profit: -10, cash_in_bank: 1000, burn_rate: 30, headcount_ft: 10, headcount_pt: 2 },
    { revenue_total: 200, gross_profit: 90, net_profit: 20, cash_in_bank: 900, burn_rate: 20, headcount_ft: 11, headcount_pt: 3 },
    { revenue_total: 300, gross_profit: 150, net_profit: 60, cash_in_bank: 800, burn_rate: 10, headcount_ft: 12, headcount_pt: 4 },
  ];
  for (const [i, month] of MONTHS.entries()) {
    await fillValid(db, p.batikOwner, p.subs.batik[month], "batik", figures[i]);
    await submit(db, p.batikOwner, p.subs.batik[month]);
  }
}

describe("confirm_period_close()", () => {
  it("needs every month of the period submitted", async () => {
    await expectRule(confirm(p.batikOwner, q3), "Submit every month of Q3 2026 before confirming it. Still to submit: Jul 2026, Aug 2026, Sep 2026.");
    await fillAndSubmit(db, p.batikOwner, "batik", [p.subs.batik["2026-07-01"], p.subs.batik["2026-08-01"]]);
    await expectRule(confirm(p.batikOwner, q3), "Submit every month of Q3 2026 before confirming it. Still to submit: Sep 2026.");
  });

  it("needs a management accounts document linked to the close", async () => {
    await submitQuarter();
    await expectRule(confirm(p.batikOwner, q3), "Upload the management accounts for Q3 2026 before confirming it.");
    await upload(p.batikContributor, A, q3, "supporting", "notes.pdf");
    await upload(p.batikContributor, A, null, "management_accounts");
    await expectRule(confirm(p.batikOwner, q3), "Upload the management accounts for Q3 2026 before confirming it.");
    await upload(p.batikContributor, A, q3);
    await confirm(p.batikOwner, q3);
  });

  it("stores the computed totals: flows summed, cash and headcount at period end, average burn", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3);
    const close = await db.one(
      `select status::text as status, confirmed_by, confirmed_at is not null as has_time, computed_totals, restated_totals, restatement_reason
       from public.period_closes where id = $1`,
      [q3],
    );
    expect(close).toEqual({
      status: "confirmed",
      confirmed_by: p.batikOwner,
      has_time: true,
      computed_totals: {
        months_count: 3,
        revenue_total: 600,
        gross_profit: 280,
        net_profit: 70,
        gp_pct: 46.6667,
        np_pct: 11.6667,
        cash_in_bank: 800,
        avg_burn_rate: 20,
        headcount_ft: 12,
        headcount_pt: 4,
      },
      restated_totals: null,
      restatement_reason: null,
    });
    const audit = await db.one("select action, summary, on_behalf, actor_role from public.audit_log where entity = 'period_closes' and action = 'confirm'");
    expect(audit).toEqual({ action: "confirm", summary: "Confirmed Q3 2026", on_behalf: false, actor_role: "company_owner" });
    await expectRule(confirm(p.batikOwner, q3), "Q3 2026 is already confirmed.");
  });

  it("restated totals need a reason and may only contain the PeriodTotals figures", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await expectRule(confirm(p.batikOwner, q3, { revenue_total: 610 }), "Please give a reason for restating the totals.");
    await expectRule(
      confirm(p.batikOwner, q3, { bogus: 1 }, "x"),
      'Restated totals can only contain figures such as revenue_total or cash_in_bank (problem with "bogus").',
    );
    await expectRule(
      confirm(p.batikOwner, q3, { revenue_total: "610" }, "x"),
      'Restated totals can only contain figures such as revenue_total or cash_in_bank (problem with "revenue_total").',
    );
    await expectRule(confirm(p.batikOwner, q3, [610], "x"), "Restated totals must be a set of named figures.");
    await confirm(p.batikOwner, q3, { revenue_total: 610, cash_in_bank: 805.5 }, "  Year-end accrual  ");
    expect(await db.one("select restated_totals, restatement_reason from public.period_closes where id = $1", [q3])).toEqual({
      restated_totals: { revenue_total: 610, cash_in_bank: 805.5 },
      restatement_reason: "Year-end accrual",
    });
  });

  it("an empty restatement counts as none", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3, {}, null);
    expect(await db.value("select restated_totals from public.period_closes where id = $1", [q3])).toBeNull();
  });

  it("is for the company owner, or a Fund Admin on behalf (audited)", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    for (const user of [p.batikContributor, p.partner, p.superAdmin, p.viewer]) {
      await expectDenied(confirm(user, q3), "Only the company owner (or a Fund Admin on their behalf) can confirm a period close.");
    }
    await expectDenied(confirm(p.kiddoOwner, q3), "This period close was not found or you do not have access to it.");
    await confirm(p.fundAdmin, q3);
    const audit = await db.one("select on_behalf, actor_role from public.audit_log where entity = 'period_closes' and action = 'confirm'");
    expect(audit).toEqual({ on_behalf: true, actor_role: "fund_admin" });
  });

  it("counts months from the company's reporting start only", async () => {
    const company = await db.createCompany({ name: "Late Starter", reportingStartMonth: "2026-08-01" });
    const owner = await db.createUser();
    await db.addMember(company, owner, "owner");
    await db.rpc("open_due_periods");
    const subs = await db.query<{ id: string }>("select id from public.submissions where company_id = $1 order by month", [company]);
    await fillAndSubmit(db, owner, "recqa", subs.map((s) => s.id));
    const close = await db.value<string>("select id from public.period_closes where company_id = $1", [company]);
    await upload(owner, company, close);
    await confirm(owner, close);
    expect(await db.value("select computed_totals ->> 'months_count' from public.period_closes where id = $1", [close])).toBe("2");
  });

  it("exited companies cannot confirm", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await db.rpc("set_company_status", { p_company_id: A, p_status: "exited", p_reason: "Sold" });
    await expectRule(confirm(p.batikOwner, q3), "Batik Boutique is no longer an active portfolio company, so its records are read-only.");
  });

  it("a month sent back for changes has to be resubmitted first (BRD B13)", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    const sep = p.subs.batik["2026-09-01"];
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: sep, p_message: "Redo September" }));
    await expectRule(
      confirm(p.batikOwner, q3),
      "Submit every month of Q3 2026 before confirming it. Still to submit: Sep 2026 (changes requested).",
    );
    await submit(db, p.batikOwner, sep);
    await confirm(p.batikOwner, q3);
    expect(await db.value("select computed_totals ->> 'months_count' from public.period_closes where id = $1", [q3])).toBe("3");
  });

  it("only counts management accounts whose file is in storage", async () => {
    await submitQuarter();
    const doc = await upload(p.batikOwner, A, q3);
    // The stored file disappears (e.g. removed by an operator): the row alone is not enough.
    await db.query("delete from storage.objects where name = (select storage_path from public.documents where id = $1)", [doc.id]);
    await expectRule(confirm(p.batikOwner, q3), "Upload the management accounts for Q3 2026 before confirming it.");
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3);
  });
});

describe("sending a month back reopens its confirmed closes", () => {
  const closeState = () =>
    db.one("select status::text as status, confirmed_at, confirmed_by, computed_totals from public.period_closes where id = $1", [q3]);

  it("request_changes on a month of a confirmed quarter reopens the close (audited); it can be confirmed again", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3, { revenue_total: 610 }, "Accrual");
    const sep = p.subs.batik["2026-09-01"];
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: sep, p_message: "Wrong cash" }));
    expect(await closeState()).toEqual({ status: "open", confirmed_at: null, confirmed_by: null, computed_totals: null });
    // Like reopen_period_close(), the restatement is kept until the next confirmation.
    expect(await db.value("select restatement_reason from public.period_closes where id = $1", [q3])).toBe("Accrual");
    const audit = await db.one(
      "select action, summary, actor_id, company_id from public.audit_log where entity = 'period_closes' and action = 'reopen'",
    );
    expect(audit).toEqual({ action: "reopen", summary: "Reopened Q3 2026: Sep 2026 was sent back for changes", actor_id: p.partner, company_id: A });
    // Other companies' closes are untouched.
    expect(await db.count("select 1 from public.period_closes where status = 'confirmed'")).toBe(0);

    await fillValid(db, p.batikOwner, sep, "batik", { revenue_total: 350, cash_in_bank: 750 });
    await submit(db, p.batikOwner, sep);
    await confirm(p.batikOwner, q3);
    expect(
      await db.one(
        `select (computed_totals ->> 'revenue_total')::numeric as revenue, (computed_totals ->> 'cash_in_bank')::numeric as cash
         from public.period_closes where id = $1`,
        [q3],
      ),
    ).toEqual({ revenue: 650, cash: 750 });
  });

  it("reopening an approved month of a confirmed quarter reopens the close too", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3);
    const jul = p.subs.batik["2026-07-01"];
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Audit adjustment" }));
    expect((await closeState()).status).toBe("open");
    expect(await db.value("select summary from public.audit_log where entity = 'period_closes' and action = 'reopen'")).toBe(
      "Reopened Q3 2026: Jul 2026 was reopened",
    );
  });
});

describe("reopen_period_close()", () => {
  it("Super Admins and Fund Admins reopen a confirmed close with a reason", async () => {
    await submitQuarter();
    await upload(p.batikOwner, A, q3);
    await confirm(p.batikOwner, q3);
    const reopen = (user: string, reason: string | null) =>
      db.asUser(user, (sql) => sql.rpc("reopen_period_close", { p_close_id: q3, p_reason: reason }));
    for (const user of [p.batikOwner, p.partner, p.viewer]) {
      await expectDenied(reopen(user, "x"), "Only Super Admins and Fund Admins can reopen a period close.");
    }
    await expectRule(reopen(p.fundAdmin, "  "), "Please give a reason for reopening this period.");
    await reopen(p.fundAdmin, "Wrong accounts uploaded");
    expect(await db.one("select status::text as status, confirmed_at, confirmed_by, computed_totals from public.period_closes where id = $1", [q3])).toEqual({
      status: "open",
      confirmed_at: null,
      confirmed_by: null,
      computed_totals: null,
    });
    const audit = await db.one("select action, summary from public.audit_log where entity = 'period_closes' and action = 'reopen'");
    expect(audit).toEqual({ action: "reopen", summary: "Reopened Q3 2026: Wrong accounts uploaded" });
    await expectRule(reopen(p.superAdmin, "Again"), "Q3 2026 is not confirmed.");
    // It can be confirmed again.
    await confirm(p.batikOwner, q3);
  });
});

describe("documents", () => {
  it("numbers versions per company, period close and document type", async () => {
    expect((await upload(p.batikOwner, A, q3)).version).toBe(1);
    expect((await upload(p.batikContributor, A, q3)).version).toBe(2);
    expect((await upload(p.fundAdmin, A, q3)).version).toBe(3);
    expect((await upload(p.batikOwner, A, q3, "supporting")).version).toBe(1);
    expect((await upload(p.batikOwner, A, null)).version).toBe(1);
    expect((await upload(p.batikOwner, A, null)).version).toBe(2);
    const kiddoQ3 = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [
      SEED.companies.kiddocare,
    ]);
    expect((await upload(p.kiddoOwner, SEED.companies.kiddocare, kiddoQ3)).version).toBe(1);
    // A client-supplied version is ignored.
    const forcedPath = await storeObject(`${A}/${q3}/${randomUUID()}-x.pdf`);
    const forced = await db.asUser(p.batikOwner, (sql) =>
      sql.value<number>(
        `insert into public.documents (company_id, period_close_id, file_name, storage_path, version, uploaded_by)
         values ($1, $2, 'x.pdf', $3, 99, auth.uid()) returning version`,
        [A, q3, forcedPath],
      ),
    );
    expect(forced).toBe(4);
  });

  it("are uploaded by company members or Fund Admins, as themselves, into the right folder and close", async () => {
    for (const user of [p.partner, p.superAdmin, p.viewer, p.kiddoOwner]) {
      await expectDenied(upload(user, A, q3), /row-level security/);
    }
    const spoofedPath = await storeObject(`${A}/general/${randomUUID()}-x.pdf`);
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query(`insert into public.documents (company_id, file_name, storage_path, uploaded_by) values ($1, 'x.pdf', $2, $3)`, [
          A,
          spoofedPath,
          p.batikContributor,
        ]),
      ),
      /row-level security/,
    );
    const kiddoQ3 = await db.value<string>("select id from public.period_closes where company_id = $1", [SEED.companies.kiddocare]);
    await expectRule(upload(p.batikOwner, A, kiddoQ3), "That period close belongs to a different company.");
    const fundAdminDoc = await upload(p.fundAdmin, A, q3);
    const audit = await db.one("select actor_role, on_behalf from public.audit_log where entity = 'documents' and entity_id = $1", [fundAdminDoc.id]);
    expect(audit).toEqual({ actor_role: "fund_admin", on_behalf: true });
    const own = await upload(p.batikOwner, A, q3);
    expect(await db.one("select uploaded_by, on_behalf from public.documents d join public.audit_log l on l.entity_id = d.id::text where d.id = $1", [own.id])).toEqual({
      uploaded_by: p.batikOwner,
      on_behalf: false,
    });
  });

  it("are never updated or deleted in-app", async () => {
    const doc = await upload(p.batikOwner, A, q3);
    await expectDenied(db.asUser(p.batikOwner, (sql) => sql.query("update public.documents set file_name = 'y.pdf' where id = $1", [doc.id])));
    await expectDenied(db.asUser(p.superAdmin, (sql) => sql.query("delete from public.documents where id = $1", [doc.id])));
  });

  it("must describe an uploaded file at <company>/<period close or 'general'>/<file name>", async () => {
    const insert = (user: string, closeId: string | null, path: string) =>
      db.asUser(user, (sql) =>
        sql.query("insert into public.documents (company_id, period_close_id, file_name, storage_path) values ($1, $2, 'x.pdf', $3)", [
          A,
          closeId,
          path,
        ]),
      );
    const SHAPE = 'The file must be stored as <company>/<period close or "general">/<file name>.';
    await expectRule(insert(p.batikOwner, q3, `${A}/${q3}/${randomUUID()}-x.pdf`), "The file has not been uploaded yet. Upload it first, then save the document.");
    // The folder must match the row's period close (or 'general' without one), exactly three segments.
    for (const [closeId, path] of [
      [null, `${A}/${q3}/${randomUUID()}-x.pdf`],
      [q3, `${A}/general/${randomUUID()}-x.pdf`],
      [null, `${A}/general/sub/${randomUUID()}-x.pdf`],
      [null, `${A}/general/..`],
      [null, `${A}/general/`],
      [q3, `${A}/${q3.toUpperCase()}/${randomUUID()}-x.pdf`],
    ] as const) {
      await storeObject(path);
      await expectRule(insert(p.batikOwner, closeId, path), SHAPE);
    }
    const upper = await storeObject(`${A.toUpperCase()}/general/${randomUUID()}-x.pdf`);
    await expectRule(insert(p.batikOwner, null, upper), "The file must be stored in the company's own folder.");
    // Even the database owner cannot record a file that is not in storage.
    await expectRule(
      db.query("insert into public.documents (company_id, file_name, storage_path) values ($1, 'x.pdf', $2)", [A, `${A}/general/${randomUUID()}-x.pdf`]),
      "The file has not been uploaded yet. Upload it first, then save the document.",
    );
  });

  it("take their size and type from the stored file's metadata", async () => {
    const path = await storeObject(`${A}/general/${randomUUID()}-pack.xls`, {
      size: 40960,
      mimetype: "application/vnd.ms-excel",
      eTag: '"abc"',
    });
    const id = await db.asUser(p.batikContributor, (sql) =>
      sql.value<string>(
        `insert into public.documents (company_id, doc_type, file_name, storage_path, mime_type, size_bytes)
         values ($1, 'supporting', 'pack.xls', $2, 'application/pdf', 1) returning id`,
        [A, path],
      ),
    );
    expect(await db.one("select mime_type, size_bytes, uploaded_by from public.documents where id = $1", [id])).toEqual({
      mime_type: "application/vnd.ms-excel",
      size_bytes: 40960,
      uploaded_by: p.batikContributor,
    });
    // Without storage metadata the client's values are kept.
    expect(await db.one("select mime_type, size_bytes from public.documents where id = $1", [(await upload(p.batikOwner, A, null)).id])).toEqual({
      mime_type: "application/pdf",
      size_bytes: 2048,
    });
  });
});

describe("storage.objects uploads", () => {
  const put = (user: string, name: string) =>
    db.asUser(user, (sql) => sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [name]));

  it("only accept <company>/<own period close or 'general'>/<file name>", async () => {
    const kiddoQ3 = await db.value<string>("select id from public.period_closes where company_id = $1", [SEED.companies.kiddocare]);
    await put(p.batikOwner, `${A}/general/${randomUUID()}-ok.pdf`);
    await put(p.fundAdmin, `${A}/${q3}/${randomUUID()}-ok.pdf`);
    for (const name of [
      `${A}/general/../../${SEED.companies.kiddocare}/general/${randomUUID()}-x.pdf`,
      `${A}/../${SEED.companies.kiddocare}/general/${randomUUID()}-x.pdf`,
      `${A}//${randomUUID()}-x.pdf`,
      `${A}/general/..`,
      `${A}/general/sub/${randomUUID()}-x.pdf`,
      `${A}/${kiddoQ3}/${randomUUID()}-x.pdf`, // another company's period close
      `${A}/${randomUUID()}/${randomUUID()}-x.pdf`, // not a period close
      `${A}/${q3.toUpperCase()}/${randomUUID()}-x.pdf`,
      `${A.toUpperCase()}/general/${randomUUID()}-x.pdf`,
    ]) {
      await expectDenied(put(p.batikOwner, name), /row-level security/);
    }
  });
});
