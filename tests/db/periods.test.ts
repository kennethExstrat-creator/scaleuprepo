import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";

let db: TestDb;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await db?.close();
});

const COMPANY_IDS = [SEED.companies.batikBoutique, SEED.companies.recqa, SEED.companies.kiddocare];

async function periods() {
  return db.query<{ month: string; due_date: string; template_version_id: string; opened_by: string | null }>(
    "select month, due_date, template_version_id, opened_by from public.reporting_periods order by month",
  );
}

async function submissionsFor(month: string) {
  return db.query<{ company_id: string; due_date: string; status: string; template_version_id: string; period_id: string }>(
    `select company_id, due_date, status::text as status, template_version_id, period_id
     from public.submissions where month = $1 order by company_id`,
    [month],
  );
}

async function closes() {
  return db.query<{ company_id: string; period_type: string; period_start: string; period_end: string; label: string; status: string }>(
    `select company_id, period_type::text as period_type, period_start, period_end, label, status::text as status
     from public.period_closes order by company_id, (period_type = 'half'), period_start`,
  );
}

describe("open_due_periods()", () => {
  it("opens every month up to the last completed Malaysian month, with due dates and backfill grace", async () => {
    await db.setToday("2026-09-30");
    expect(await db.rpc("open_due_periods")).toBe(8); // 2 periods + 6 submissions

    expect(await periods()).toEqual([
      { month: "2026-07-01", due_date: "2026-08-15", template_version_id: SEED.template.v1, opened_by: null },
      { month: "2026-08-01", due_date: "2026-09-15", template_version_id: SEED.template.v1, opened_by: null },
    ]);
    // Both months were opened after their normal due date, so each gets 14 days from today.
    for (const month of ["2026-07-01", "2026-08-01"]) {
      const subs = await submissionsFor(month);
      expect(subs.map((s) => s.company_id).sort()).toEqual([...COMPANY_IDS].sort());
      for (const s of subs) {
        expect(s).toMatchObject({ due_date: "2026-10-14", status: "draft", template_version_id: SEED.template.v1 });
      }
    }
    expect(await closes()).toEqual([]);
  });

  it("is idempotent", async () => {
    await db.setToday("2026-09-30");
    expect(await db.rpc("open_due_periods")).toBe(8);
    expect(await db.rpc("open_due_periods")).toBe(0);
    expect(await db.count("select 1 from public.submissions")).toBe(6);
  });

  it("opens September at the MYT month boundary and creates the Q3 closes", async () => {
    await db.setToday("2026-09-30");
    await db.rpc("open_due_periods");
    await db.setToday("2026-10-01"); // 30 Sep 16:00 UTC is already 1 Oct in Malaysia
    expect(await db.rpc("open_due_periods")).toBe(7); // 1 period + 3 submissions + 3 quarter closes

    const sep = await submissionsFor("2026-09-01");
    expect(sep).toHaveLength(3);
    for (const s of sep) expect(s.due_date).toBe("2026-10-15"); // opened before the due date: no grace
    // Earlier months keep their backfill due date.
    for (const s of await submissionsFor("2026-07-01")) expect(s.due_date).toBe("2026-10-14");

    expect(await closes()).toEqual(
      COMPANY_IDS.slice()
        .sort()
        .map((company_id) => ({
          company_id,
          period_type: "quarter",
          period_start: "2026-07-01",
          period_end: "2026-09-30",
          label: "Q3 2026",
          status: "open",
        })),
    );
  });

  it("creates quarter and half closes at December", async () => {
    await db.setToday("2027-01-05");
    expect(await db.rpc("open_due_periods")).toBe(6 + 18 + 9); // Jul–Dec; 3 × 6 submissions; Q3, Q4, H2 × 3
    const batik = (await closes()).filter((c) => c.company_id === SEED.companies.batikBoutique);
    expect(batik).toEqual([
      {
        company_id: SEED.companies.batikBoutique,
        period_type: "quarter",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        label: "Q3 2026",
        status: "open",
      },
      {
        company_id: SEED.companies.batikBoutique,
        period_type: "quarter",
        period_start: "2026-10-01",
        period_end: "2026-12-31",
        label: "Q4 2026",
        status: "open",
      },
      {
        company_id: SEED.companies.batikBoutique,
        period_type: "half",
        period_start: "2026-07-01",
        period_end: "2026-12-31",
        label: "H2 2026",
        status: "open",
      },
    ]);
    const due = await db.query<{ month: string; due_date: string }>(
      "select month, due_date from public.submissions where company_id = $1 order by month",
      [SEED.companies.batikBoutique],
    );
    expect(due).toEqual([
      { month: "2026-07-01", due_date: "2027-01-19" },
      { month: "2026-08-01", due_date: "2027-01-19" },
      { month: "2026-09-01", due_date: "2027-01-19" },
      { month: "2026-10-01", due_date: "2027-01-19" },
      { month: "2026-11-01", due_date: "2027-01-19" },
      { month: "2026-12-01", due_date: "2027-01-15" },
    ]);
  });

  it("creates the June quarter and H1 closes for a company reporting from April", async () => {
    const early = await db.createCompany({ name: "Early Co", reportingStartMonth: "2026-04-01" });
    await db.setToday("2026-07-02");
    await db.rpc("open_due_periods");
    expect((await periods()).map((p) => p.month)).toEqual(["2026-04-01", "2026-05-01", "2026-06-01"]);
    const own = (await closes()).filter((c) => c.company_id === early);
    expect(own.map((c) => [c.period_type, c.label, c.period_start, c.period_end])).toEqual([
      ["quarter", "Q2 2026", "2026-04-01", "2026-06-30"],
      ["half", "H1 2026", "2026-01-01", "2026-06-30"],
    ]);
    // The pilot companies start in July: nothing for them yet.
    expect(await db.count("select 1 from public.submissions where company_id <> $1", [early])).toBe(0);
  });

  it("starts each company at its own reporting start month", async () => {
    const late = await db.createCompany({ name: "Late Co", reportingStartMonth: "2026-09-01" });
    await db.setToday("2026-10-20");
    await db.rpc("open_due_periods");
    const months = await db.query<{ month: string }>("select month from public.submissions where company_id = $1", [late]);
    expect(months).toEqual([{ month: "2026-09-01" }]);
  });

  it("gives companies onboarded after a due date 14 days from today (backfill grace)", async () => {
    await db.setToday("2026-10-20");
    await db.rpc("open_due_periods");
    await db.setToday("2026-10-25");
    const newcomer = await db.createCompany({ name: "Newcomer", reportingStartMonth: "2026-08-01" });
    expect(await db.rpc("open_due_periods")).toBe(3); // Aug + Sep submissions and the Q3 close
    const due = await db.query("select month, due_date from public.submissions where company_id = $1 order by month", [newcomer]);
    expect(due).toEqual([
      { month: "2026-08-01", due_date: "2026-11-08" },
      { month: "2026-09-01", due_date: "2026-11-08" },
    ]);
    await db.query("update public.platform_settings set backfill_grace_days = 3");
    const another = await db.createCompany({ name: "Another", reportingStartMonth: "2026-09-01" });
    await db.rpc("open_due_periods");
    expect(await db.value("select due_date from public.submissions where company_id = $1", [another])).toBe("2026-10-28");
  });

  it("excludes exited and written-off companies from new months and closes", async () => {
    await db.setToday("2026-09-30");
    await db.rpc("open_due_periods");
    await db.rpc("set_company_status", { p_company_id: SEED.companies.kiddocare, p_status: "exited", p_reason: "Acquired" });
    await db.rpc("set_company_status", { p_company_id: SEED.companies.recqa, p_status: "written_off", p_reason: "Closed" });
    await db.setToday("2026-10-01");
    expect(await db.rpc("open_due_periods")).toBe(3); // Sep period + Batik's Sep submission + Batik's Q3 close
    expect((await submissionsFor("2026-09-01")).map((s) => s.company_id)).toEqual([SEED.companies.batikBoutique]);
    expect((await closes()).map((c) => c.company_id)).toEqual([SEED.companies.batikBoutique]);
    // History is kept.
    expect(await db.count("select 1 from public.submissions where company_id = $1", [SEED.companies.kiddocare])).toBe(2);
  });

  it("uses the due day from settings and the currently published template for new months only", async () => {
    await db.setToday("2026-09-30");
    await db.rpc("open_due_periods");
    await db.query("update public.platform_settings set due_day = 10");
    const draft = await db.rpc<string>("create_template_draft", { p_template_id: SEED.template.id });
    await db.rpc("publish_template_version", { p_version_id: draft });
    await db.setToday("2026-10-05");
    await db.rpc("open_due_periods");
    expect(await periods()).toEqual([
      { month: "2026-07-01", due_date: "2026-08-15", template_version_id: SEED.template.v1, opened_by: null },
      { month: "2026-08-01", due_date: "2026-09-15", template_version_id: SEED.template.v1, opened_by: null },
      { month: "2026-09-01", due_date: "2026-10-10", template_version_id: draft, opened_by: null },
    ]);
    for (const s of await submissionsFor("2026-09-01")) expect(s.template_version_id).toBe(draft);
    for (const s of await submissionsFor("2026-08-01")) expect(s.template_version_id).toBe(SEED.template.v1);
  });

  it("can be called by any active signed-in user and the service role, but not by anon or aal1 sessions", async () => {
    await db.setToday("2026-09-30");
    const owner = await db.createUser();
    await db.addMember(SEED.companies.recqa, owner, "owner");
    const viewer = await db.createUser({ scaleupRole: "viewer" });
    // Company users trigger the same work but never learn the portfolio-wide count.
    expect(await db.asUser(owner, (sql) => sql.rpc("open_due_periods"))).toBe(0);
    expect(await db.count("select 1 from public.submissions")).toBe(6);
    await db.setToday("2026-10-01");
    expect(await db.asUser(viewer, (sql) => sql.rpc("open_due_periods"))).toBe(7);
    expect(await db.asService((sql) => sql.rpc("open_due_periods"))).toBe(0);
    await expectDenied(db.asUser(owner, (sql) => sql.rpc("open_due_periods"), { aal: "aal1" }), "Please sign in first.");
    await expectDenied(db.asAnon((sql) => sql.rpc("open_due_periods")), /permission denied for function open_due_periods/);
  });

  it("refuses to open months without a published default template", async () => {
    await db.setToday("2026-09-30");
    await db.query("update public.templates set is_default = false");
    await expectRule(db.rpc("open_due_periods"), "Publish the default reporting template before opening reporting months.");
  });

  it("only needs the default template for months that still have to be created", async () => {
    await db.setToday("2026-10-20");
    await db.rpc("open_due_periods");
    // A data fix by the database owner leaves no default template (users cannot do this).
    await db.query("update public.templates set is_default = false");
    const owner = await db.createUser();
    await db.addMember(SEED.companies.recqa, owner, "owner");
    // Every month up to September is open: page loads keep working …
    expect(await db.asUser(owner, (sql) => sql.rpc("open_due_periods"))).toBe(0);
    // … and a company onboarded now still gets its open months and closes.
    const newcomer = await db.createCompany({ name: "Newcomer", reportingStartMonth: "2026-08-01" });
    expect(await db.rpc("open_due_periods")).toBe(3); // Aug + Sep submissions and the Q3 close
    expect(await db.count("select 1 from public.submissions where company_id = $1", [newcomer])).toBe(2);
    // open_period() of an open month still works; a month that must be created needs the template.
    const fundAdmin = await db.createUser({ scaleupRole: "fund_admin" });
    const sep = await db.value<string>("select id from public.reporting_periods where month = '2026-09-01'");
    expect(await db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-09-01" }))).toBe(sep);
    const NO_TEMPLATE = "Publish the default reporting template before opening reporting months.";
    await expectRule(db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" })), NO_TEMPLATE);
    await db.setToday("2026-11-02");
    await expectRule(db.asUser(owner, (sql) => sql.rpc("open_due_periods")), NO_TEMPLATE);
  });
});

describe("Malaysia time", () => {
  it("today_myt() follows Asia/Kuala_Lumpur whatever the session time zone", async () => {
    const expectedNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
    const results: string[] = [];
    for (const zone of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kuala_Lumpur"]) {
      await db.exec(`set timezone to '${zone}'`);
      results.push(await db.value<string>("select private.today_myt()"));
    }
    await db.exec("set timezone to 'UTC'");
    const expected = expectedNow();
    // Guard against the (unlikely) case of the test running across Malaysian midnight.
    expect(results.every((r) => r === results[0])).toBe(true);
    expect([expected, expectedNow()]).toContain(results[0]);
  });

  it("treats 16:00 UTC as midnight in Malaysia", async () => {
    const dates = await db.one(
      `select (timestamptz '2026-09-30 15:59:59+00' at time zone 'Asia/Kuala_Lumpur')::date as before,
              (timestamptz '2026-09-30 16:00:00+00' at time zone 'Asia/Kuala_Lumpur')::date as after`,
    );
    expect(dates).toEqual({ before: "2026-09-30", after: "2026-10-01" });
    const definition = await db.value<string>("select pg_get_functiondef('private.today_myt()'::regprocedure)");
    expect(definition).toContain("current_setting('app.today', true)");
    expect(definition).toContain("'Asia/Kuala_Lumpur'");
  });

  it("the app.today hook overrides the date and can be cleared", async () => {
    await db.setToday("2026-10-20");
    expect(await db.value("select private.today_myt()")).toBe("2026-10-20");
    await db.setToday(null);
    expect(await db.value("select private.today_myt()")).not.toBe("2026-10-20");
  });
});

describe("open_period()", () => {
  let fundAdmin: string;
  let superAdmin: string;

  beforeEach(async () => {
    fundAdmin = await db.createUser({ scaleupRole: "fund_admin" });
    superAdmin = await db.createUser({ scaleupRole: "super_admin" });
    await db.setToday("2026-10-20");
    await db.rpc("open_due_periods");
  });

  it("lets a Fund Admin open the current month early with the same side effects", async () => {
    const periodId = await db.asUser(fundAdmin, (sql) => sql.rpc<string>("open_period", { p_month: "2026-10-17" }));
    const period = await db.one("select id, month, due_date, opened_by from public.reporting_periods where month = '2026-10-01'");
    expect(period).toEqual({ id: periodId, month: "2026-10-01", due_date: "2026-11-15", opened_by: fundAdmin });
    const oct = await submissionsFor("2026-10-01");
    expect(oct).toHaveLength(3);
    for (const s of oct) expect(s).toMatchObject({ due_date: "2026-11-15", period_id: periodId });
    expect(await db.count("select 1 from public.period_closes where period_start = '2026-10-01'")).toBe(0);
    // Idempotent: the same id comes back.
    expect(await db.asUser(superAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" }))).toBe(periodId);
  });

  it("opening a quarter-end month early creates its closes", async () => {
    await db.setToday("2026-12-03");
    await db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-12-01" }));
    expect(await db.count("select 1 from public.period_closes where label = 'Q4 2026'")).toBe(3);
    expect(await db.count("select 1 from public.period_closes where label = 'H2 2026'")).toBe(3);
    expect(await db.count("select 1 from public.submissions where month = '2026-11-01'")).toBe(3);
  });

  it("rejects future months and months before reporting starts", async () => {
    await expectRule(
      db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-11-01" })),
      "Only months up to the current month (Oct 2026) can be opened.",
    );
    await expectRule(
      db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-06-01" })),
      "Months before Jul 2026 cannot be opened.",
    );
  });

  it("is limited to Super Admins and Fund Admins", async () => {
    const partner = await db.createUser({ scaleupRole: "partner" });
    const viewer = await db.createUser({ scaleupRole: "viewer" });
    const owner = await db.createUser();
    await db.addMember(SEED.companies.batikBoutique, owner, "owner");
    for (const user of [partner, viewer, owner]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" })),
        "Only Super Admins and Fund Admins can open reporting months.",
      );
    }
    await expectDenied(db.asAnon((sql) => sql.rpc("open_period", { p_month: "2026-10-01" })));
    await expectDenied(db.asUser(fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" }), { aal: "aal1" }));
  });
});
