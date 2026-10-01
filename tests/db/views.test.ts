import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, save, setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

describe("v_submission_financials", () => {
  it("pivots the system numbers with the currency and MYR rate", async () => {
    const jul = p.subs.batik["2026-07-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul], { revenue_total: 123456.78, net_profit: -42 });
    const row = await db.asUser(p.batikContributor, (sql) =>
      sql.one("select * from public.v_submission_financials where submission_id = $1", [jul]),
    );
    expect(row).toMatchObject({
      submission_id: jul,
      company_id: SEED.companies.batikBoutique,
      month: "2026-07-01",
      status: "submitted",
      due_date: "2026-11-03",
      approved_at: null,
      currency: "MYR",
      fx_rate_to_myr: 1,
      revenue_total: 123456.78,
      gross_profit: 40000,
      net_profit: -42,
      cash_in_bank: 500000,
      burn_rate: 20000,
      headcount_ft: 10,
      headcount_pt: 2,
    });
    expect(row.submitted_at).not.toBeNull();
    // Months without values still get a row, with nulls.
    const empty = await db.asUser(p.viewer, (sql) =>
      sql.one("select revenue_total, headcount_pt from public.v_submission_financials where submission_id = $1", [p.subs.recqa["2026-07-01"]]),
    );
    expect(empty).toEqual({ revenue_total: null, headcount_pt: null });
  });

  it("uses the monthly FX rate for non-MYR companies (visible to ScaleUp only)", async () => {
    // i-Motorbike reports in USD (seeded, not yet reporting): start it in July 2026.
    const usd = SEED.companies.iMotorbike;
    await db.query("update public.companies set reporting_start_month = '2026-07-01' where id = $1", [usd]);
    const owner = await db.createUser();
    await db.addMember(usd, owner, "owner");
    await db.rpc("open_due_periods");
    const rate = () =>
      db.asUser(p.fundAdmin, (sql) =>
        sql.query("select month, currency, fx_rate_to_myr from public.v_submission_financials where company_id = $1 order by month", [usd]),
      );
    expect((await rate())[0]).toEqual({ month: "2026-07-01", currency: "USD", fx_rate_to_myr: null });
    await db.asUser(p.fundAdmin, (sql) =>
      sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('USD', '2026-07-01', 4.2125), ('USD', '2026-08-01', 4.25)"),
    );
    expect(await rate()).toEqual([
      { month: "2026-07-01", currency: "USD", fx_rate_to_myr: 4.2125 },
      { month: "2026-08-01", currency: "USD", fx_rate_to_myr: 4.25 },
      { month: "2026-09-01", currency: "USD", fx_rate_to_myr: null },
    ]);
    // FX rates are ScaleUp-only, so the company sees its currency without the rate.
    const own = await db.asUser(owner, (sql) =>
      sql.query("select currency, fx_rate_to_myr from public.v_submission_financials where month = '2026-07-01'"),
    );
    expect(own).toEqual([{ currency: "USD", fx_rate_to_myr: null }]);
  });
});

describe("v_submission_overview", () => {
  it("flags overdue drafts and changes-requested months in Malaysian days", async () => {
    const { batik } = p.subs;
    await fillAndSubmit(db, p.batikOwner, "batik", [batik["2026-07-01"], batik["2026-08-01"]]);
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: batik["2026-08-01"], p_message: "Fix" }));
    const overview = () =>
      db.asUser(p.batikOwner, (sql) =>
        sql.query("select month, status::text as status, is_overdue, days_overdue, revision from public.v_submission_overview order by month"),
      );
    expect(await overview()).toEqual([
      { month: "2026-07-01", status: "submitted", is_overdue: false, days_overdue: 0, revision: 1 },
      { month: "2026-08-01", status: "changes_requested", is_overdue: false, days_overdue: 0, revision: 1 },
      { month: "2026-09-01", status: "draft", is_overdue: false, days_overdue: 0, revision: 0 },
    ]);
    await db.setToday("2026-11-03"); // due today: not overdue yet
    expect((await overview()).every((r) => !r.is_overdue)).toBe(true);
    await db.setToday("2026-11-10");
    expect(await overview()).toEqual([
      { month: "2026-07-01", status: "submitted", is_overdue: false, days_overdue: 0, revision: 1 },
      { month: "2026-08-01", status: "changes_requested", is_overdue: true, days_overdue: 7, revision: 1 },
      { month: "2026-09-01", status: "draft", is_overdue: true, days_overdue: 7, revision: 0 },
    ]);
  });

  it("is never overdue for exited or written-off companies, or for months before the reporting start", async () => {
    const overdue = (company: string) =>
      db.asUser(p.viewer, (sql) =>
        sql.query<{ month: string; is_overdue: boolean; days_overdue: number }>(
          "select month, is_overdue, days_overdue from public.v_submission_overview where company_id = $1 order by month",
          [company],
        ),
      );
    await db.setToday("2026-11-10"); // Jul–Sep were opened on 20 Oct with 14 days' grace: due 3 Nov
    expect((await overdue(SEED.companies.batikBoutique)).map((r) => r.days_overdue)).toEqual([7, 7, 7]);
    await db.rpc("set_company_status", { p_company_id: SEED.companies.batikBoutique, p_status: "exited", p_reason: "Sold" });
    await db.rpc("set_company_status", { p_company_id: SEED.companies.kiddocare, p_status: "written_off", p_reason: "Closed" });
    for (const company of [SEED.companies.batikBoutique, SEED.companies.kiddocare]) {
      expect((await overdue(company)).every((r) => !r.is_overdue && r.days_overdue === 0)).toBe(true);
    }
    // RECQA's reporting start moves to September: July and August are no longer required.
    await db.query("update public.companies set reporting_start_month = '2026-09-01' where id = $1", [SEED.companies.recqa]);
    expect(await overdue(SEED.companies.recqa)).toEqual([
      { month: "2026-07-01", is_overdue: false, days_overdue: 0 },
      { month: "2026-08-01", is_overdue: false, days_overdue: 0 },
      { month: "2026-09-01", is_overdue: true, days_overdue: 7 },
    ]);
    // Company users see the same flags for their own months.
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.v_submission_overview where is_overdue"))).toBe(0);
  });

  it("gives a month sent back or reopened after its due date a fresh due date instead of making it overdue at once", async () => {
    const { batik } = p.subs;
    const jul = batik["2026-07-01"];
    const aug = batik["2026-08-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul, aug]);
    // Sent back before the due date (3 Nov): the due date stays.
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: aug, p_message: "Fix cash" }));
    const dates = (id: string) => db.one("select due_date, original_due_date from public.submissions where id = $1", [id]);
    expect(await dates(aug)).toEqual({ due_date: "2026-11-03", original_due_date: null });
    // Reopened on 10 Jan, long after its due date: due 14 days later (backfill_grace_days), not 68 days overdue.
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await db.setToday("2027-01-10");
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Audit adjustment" }));
    const row = (id: string) =>
      db.asUser(p.batikOwner, (sql) =>
        sql.one("select status::text as status, due_date, original_due_date, is_overdue, days_overdue from public.v_submission_overview where id = $1", [id]),
      );
    expect(await row(jul)).toEqual({
      status: "changes_requested",
      due_date: "2027-01-24",
      original_due_date: "2026-11-03",
      is_overdue: false,
      days_overdue: 0,
    });
    // August was sent back in October and never fixed: it is overdue.
    expect(await row(aug)).toMatchObject({ status: "changes_requested", due_date: "2026-11-03", is_overdue: true, days_overdue: 68 });
    await db.setToday("2027-01-25");
    expect(await row(jul)).toMatchObject({ is_overdue: true, days_overdue: 1 });
    // An extension later on keeps the first original due date.
    await db.asUser(p.fundAdmin, (sql) =>
      sql.rpc("extend_due_date", { p_submission_id: jul, p_new_due_date: "2027-02-15", p_reason: "Auditor delay" }),
    );
    expect(await dates(jul)).toEqual({ due_date: "2027-02-15", original_due_date: "2026-11-03" });
  });

  it("reports whether any narrative or pulse field was filled, and the open threads", async () => {
    const jul = p.subs.batik["2026-07-01"];
    const aug = p.subs.batik["2026-08-01"];
    const sep = p.subs.batik["2026-09-01"];
    await db.asUser(p.batikOwner, async (sql) => {
      await save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] });
      await save(sql, aug, { values: [{ key: "partnerships", value_text: "Signed with a mall" }] });
      await save(sql, sep, { values: [{ key: "team_morale", value_number: 3 }] });
    });
    const rows = await db.asUser(p.viewer, (sql) =>
      sql.query<{ id: string; has_narrative: boolean; open_threads: number }>(
        "select id, has_narrative, open_threads from public.v_submission_overview where company_id = $1 order by month",
        [SEED.companies.batikBoutique],
      ),
    );
    expect(rows.map((r) => r.has_narrative)).toEqual([false, true, true]);
    const root = await db.asUser(p.partner, (sql) =>
      sql.value<string>("insert into public.comments (submission_id, author_id, body) values ($1, auth.uid(), 'Q') returning id", [jul]),
    );
    await db.asUser(p.batikOwner, (sql) =>
      sql.query("insert into public.comments (submission_id, parent_id, author_id, body) values ($1, $2, auth.uid(), 'A')", [jul, root]),
    );
    const threads = () =>
      db.asUser(p.batikOwner, (sql) => sql.value<number>("select open_threads from public.v_submission_overview where id = $1", [jul]));
    expect(await threads()).toBe(1); // replies are not threads
    await db.asUser(p.batikOwner, (sql) => sql.rpc("resolve_comment", { p_comment_id: root, p_resolved: true }));
    expect(await threads()).toBe(0);
  });
});

describe("view privileges", () => {
  it("views are read-only for API users (v_submission_overview is auto-updatable in Postgres)", async () => {
    for (const user of [p.batikOwner, p.superAdmin]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.query("update public.v_submission_overview set status = 'approved'")),
        /permission denied for view v_submission_overview/,
      );
      await expectDenied(
        db.asUser(user, (sql) => sql.query("delete from public.v_submission_overview")),
        /permission denied for view v_submission_overview/,
      );
    }
    expect(await db.value("select status::text from public.submissions where id = $1", [p.subs.batik["2026-07-01"]])).toBe("draft");
  });
});
