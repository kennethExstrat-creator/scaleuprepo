/**
 * Companies without a reporting start month (BRD B16): the whole portfolio is loaded at launch, but a
 * company only starts monthly reporting once ScaleUp sets `companies.reporting_start_month`. Until then
 * (null) it is "Not yet reporting":
 *   - open_due_periods() / open_period() open nothing for it (no submissions, no period closes);
 *   - setting the start month later opens the missing months and closes on the next open_due_periods()
 *     call (tracker / portal page load, daily pg_cron job), with the backfill grace period;
 *   - clearing the start month again keeps the company's history (submissions, values, closes) but
 *     opens nothing new, and its months are never overdue;
 *   - months stay in order (prior_months counts every earlier draft) and a period close counts the
 *     months the company has in the period.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PILOT_COMPANY_IDS, SEED } from "./fixtures";
import { expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, fillValid, setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" }); // Jul–Sep open for the pilot, Q3 closes created
});

afterEach(async () => {
  await db?.close();
});

const HUDDLE = SEED.companies.huddle;
const AONE = SEED.companies.aone;

const submissionsOf = (company: string) =>
  db.query<{ month: string; status: string; due_date: string; template_version_id: string }>(
    "select month, status::text as status, due_date, template_version_id from public.submissions where company_id = $1 order by month",
    [company],
  );
const closesOf = (company: string) =>
  db.query<{ period_type: string; period_start: string; period_end: string; label: string; status: string }>(
    `select period_type::text as period_type, period_start, period_end, label, status::text as status
       from public.period_closes where company_id = $1 order by period_end, period_start desc`,
    [company],
  );
const setStart = (company: string, month: string | null) =>
  db.asUser(p.superAdmin, (sql) =>
    sql.query("update public.companies set reporting_start_month = $2 where id = $1 returning id", [company, month]),
  );

describe("reporting start month (BRD B16)", () => {
  it("is optional: null means not yet reporting; a date is normalised to the 1st", async () => {
    expect(await db.value("select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'companies' and column_name = 'reporting_start_month'")).toBe("YES");
    // Only the pilot companies are reporting in the seeded portfolio.
    const reporting = await db.query<{ id: string }>(
      "select id from public.companies where reporting_start_month is not null order by id",
    );
    expect(reporting.map((r) => r.id)).toEqual([...PILOT_COMPANY_IDS].sort());
    const created = await db.asUser(p.superAdmin, (sql) =>
      sql.one<{ id: string; reporting_start_month: string | null }>(
        "insert into public.companies (name) values ('Newco') returning id, reporting_start_month",
      ),
    );
    expect(created.reporting_start_month).toBeNull();
    await setStart(created.id, "2026-11-17");
    expect(await db.value("select reporting_start_month from public.companies where id = $1", [created.id])).toBe("2026-11-01");
  });

  it("companies that are not yet reporting get no months and no period closes", async () => {
    // setupPortfolio opened Jul–Sep: submissions and closes exist for the three pilot companies only.
    const companies = await db.query<{ company_id: string }>("select distinct company_id from public.submissions order by 1");
    expect(companies.map((c) => c.company_id)).toEqual([...PILOT_COMPANY_IDS].sort());
    expect(await db.count("select 1 from public.submissions")).toBe(9);
    const closeCompanies = await db.query<{ company_id: string }>("select distinct company_id from public.period_closes order by 1");
    expect(closeCompanies.map((c) => c.company_id)).toEqual([...PILOT_COMPANY_IDS].sort());
    // A later month (open_due_periods, open_period) still only opens for the pilot companies.
    await db.setToday("2026-11-02");
    expect(await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_due_periods"))).toBe(1 + 3); // Oct period + 3 submissions
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-11-01" }));
    expect(await db.count("select 1 from public.submissions where company_id <> all($1::uuid[])", [[...PILOT_COMPANY_IDS]])).toBe(0);
    expect(await db.count("select 1 from public.submissions where month = '2026-11-01'")).toBe(3);
    // Companies without a start month never pull the earliest month back.
    await expectRule(
      db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-06-01" })),
      "Months before Jul 2026 cannot be opened.",
    );
  });

  it("setting the start month later opens the missing months and closes with the backfill grace period", async () => {
    expect(await submissionsOf(HUDDLE)).toEqual([]);
    expect(await setStart(HUDDLE, "2026-07-01")).toHaveLength(1);
    // The next open_due_periods() (page load or the daily job) creates Jul–Sep and the Q3 close.
    expect(await db.asUser(p.viewer, (sql) => sql.rpc("open_due_periods"))).toBe(3 + 1);
    expect(await submissionsOf(HUDDLE)).toEqual(
      ["2026-07-01", "2026-08-01", "2026-09-01"].map((month) => ({
        month,
        status: "draft",
        due_date: "2026-11-03", // opened on 20 Oct, after the normal due dates: 14 days from today
        template_version_id: SEED.template.v1,
      })),
    );
    expect(await closesOf(HUDDLE)).toEqual([
      { period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", label: "Q3 2026", status: "open" },
    ]);
    // Idempotent.
    expect(await db.rpc("open_due_periods")).toBe(0);
    // Its members see and fill the new months like any reporting company.
    const owner = await db.createUser({ email: "owner@huddle.test" });
    await db.addMember(HUDDLE, owner, "owner");
    expect(await db.asUser(owner, (sql) => sql.count("select 1 from public.v_submission_overview"))).toBe(3);
  });

  it("clearing the start month keeps the history, opens nothing new and is never overdue", async () => {
    await setStart(HUDDLE, "2026-07-01");
    await db.rpc("open_due_periods");
    const owner = await db.createUser({ email: "owner@huddle.test" });
    await db.addMember(HUDDLE, owner, "owner");
    const jul = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-07-01'", [HUDDLE]);
    await db.asUser(owner, (sql) =>
      sql.rpc("save_submission_values", { p_submission_id: jul, p_values: [{ key: "revenue_total", value_number: 1234 }] }),
    );

    expect(await setStart(HUDDLE, null)).toHaveLength(1);
    // History is kept: submissions, their values and the close.
    expect((await submissionsOf(HUDDLE)).map((s) => s.month)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(await db.value("select value_number from public.submission_values where submission_id = $1 and field_key = 'revenue_total'", [jul])).toBe(1234);
    expect(await closesOf(HUDDLE)).toHaveLength(1);
    // Nothing new is opened for it (October and December open for the pilot companies only).
    await db.setToday("2026-11-10");
    await db.rpc("open_due_periods");
    await db.setToday("2027-01-05");
    await db.rpc("open_due_periods");
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2027-01-01" }));
    expect((await submissionsOf(HUDDLE)).map((s) => s.month)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(await closesOf(HUDDLE)).toHaveLength(1);
    expect(await db.count("select 1 from public.submissions where month = '2026-12-01'")).toBe(3);
    // Its months are no longer required, so never overdue (the pilot's drafts are).
    const overdue = (company: string) =>
      db.asUser(p.viewer, (sql) =>
        sql.query<{ is_overdue: boolean; days_overdue: number }>(
          "select is_overdue, days_overdue from public.v_submission_overview where company_id = $1 and month = '2026-07-01'",
          [company],
        ),
      );
    expect(await overdue(HUDDLE)).toEqual([{ is_overdue: false, days_overdue: 0 }]);
    expect(await overdue(SEED.companies.recqa)).toEqual([{ is_overdue: true, days_overdue: 63 }]);
    // Its members still see its history.
    expect(await db.asUser(owner, (sql) => sql.count("select 1 from public.submissions"))).toBe(3);

    // Setting a start month again opens the months from there; the earlier history stays.
    await setStart(HUDDLE, "2026-11-01");
    await db.rpc("open_due_periods");
    expect((await submissionsOf(HUDDLE)).map((s) => s.month)).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
    expect((await closesOf(HUDDLE)).map((c) => c.label)).toEqual(["Q3 2026", "Q4 2026", "H2 2026"]);
  });

  it("without a start month, months still have to be submitted in order", async () => {
    await setStart(AONE, "2026-07-01");
    await db.rpc("open_due_periods");
    await setStart(AONE, null);
    const owner = await db.createUser({ email: "owner@aone.test" });
    await db.addMember(AONE, owner, "owner");
    const months = Object.fromEntries(
      (await db.query<{ month: string; id: string }>("select month, id from public.submissions where company_id = $1", [AONE])).map(
        (r) => [r.month, r.id],
      ),
    );
    await fillValid(db, owner, months["2026-09-01"], "recqa"); // AOne has no KPIs, like RECQA
    const validation = await db.asUser(owner, (sql) =>
      sql.rpc<{ ok: boolean; errors: { code: string; message: string }[] }>("get_submission_validation", {
        p_submission_id: months["2026-09-01"],
      }),
    );
    expect(validation.errors).toEqual([
      { target: "general", code: "prior_months", message: "Submit earlier months first: Jul 2026, Aug 2026." },
    ]);
    await expectRule(
      db.asUser(owner, (sql) => sql.rpc("submit_submission", { p_submission_id: months["2026-09-01"], p_declaration_accepted: true })),
      "Submit earlier months first: Jul 2026, Aug 2026.",
    );
    await fillAndSubmit(db, owner, "recqa", [months["2026-07-01"], months["2026-08-01"], months["2026-09-01"]]);
    expect(await db.count("select 1 from public.submissions where company_id = $1 and status = 'submitted'", [AONE])).toBe(3);
  });

  it("without a start month, a period close counts the months the company has in the period", async () => {
    await setStart(AONE, "2026-08-01");
    await db.rpc("open_due_periods"); // Aug, Sep and the Q3 close
    await setStart(AONE, null);
    const owner = await db.createUser({ email: "owner@aone.test" });
    await db.addMember(AONE, owner, "owner");
    const close = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [AONE]);
    const confirm = () => db.asUser(owner, (sql) => sql.rpc("confirm_period_close", { p_close_id: close }));
    // July was never a month of this company: only August and September are asked for.
    await expectRule(confirm(), "Submit every month of Q3 2026 before confirming it. Still to submit: Aug 2026, Sep 2026.");
    const subs = await db.query<{ id: string }>("select id from public.submissions where company_id = $1 order by month", [AONE]);
    await fillAndSubmit(db, owner, "recqa", subs.map((s) => s.id));
    const path = `${AONE}/${close}/${randomUUID()}-accounts.pdf`;
    await db.asUser(owner, async (sql) => {
      await sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
      await sql.query("insert into public.documents (company_id, period_close_id, file_name, storage_path) values ($1, $2, 'accounts.pdf', $3)", [
        AONE,
        close,
        path,
      ]);
    });
    await confirm();
    expect(await db.value("select computed_totals ->> 'months_count' from public.period_closes where id = $1", [close])).toBe("2");
  });
});
