// The historical months import against the real migrations in PGlite (scripts/lib/history-import.ts;
// BRD §6.1, §12, B3): months before a company's reporting start month become approved monthly updates,
// written as a system caller and audited as "import"; months already on the platform are never touched.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyImport,
  loadImportContext,
  planImport,
  type ImportOptions,
  type SqlExecutor,
} from "../../../scripts/lib/history-import";
import { csvTable } from "../../../scripts/lib/tabular";
import { SEED } from "../../db/fixtures";
import { freshDb, type TestDb } from "../../db/harness";
import { setupPortfolio } from "../../db/scenario";

let db: TestDb;
let exec: SqlExecutor;

const OPTIONS: ImportOptions = { allowMissing: false, createSegments: false, templateVersionId: null, today: "2026-10-20" };
const CORE = "revenue_total,gross_profit,net_profit,cash_in_bank,burn_rate,headcount_ft,headcount_pt";
const BATIK = SEED.companies.batikBoutique;

beforeEach(async () => {
  db = await freshDb();
  // The pilot reports from Jul 2026 (Jul–Sep 2026 are open as of 20 Oct 2026); the rest is not reporting yet.
  await setupPortfolio(db, { today: "2026-10-20" });
  exec = { query: (text, params) => db.query(text, params ?? []) };
});

afterEach(async () => {
  await db?.close();
});

async function plan(csv: string, options: Partial<ImportOptions> = {}) {
  const context = await loadImportContext(exec, { templateVersionId: null });
  return { context, plan: planImport(context, [csvTable("history.csv", csv)], { ...OPTIONS, ...options }) };
}

/** Runs the writes in one transaction, as the CLI does (the audit context is transaction-local). */
async function apply(result: Awaited<ReturnType<typeof plan>>) {
  return db.pg.transaction((tx) =>
    applyImport({ query: async (text, params) => (await tx.query(text, (params ?? []) as never[])).rows as never[] }, result.plan, result.context),
  );
}

function messages(list: { source: string; message: string }[]): string[] {
  return list.map((entry) => `${entry.source}: ${entry.message}`);
}

describe("historical months import", () => {
  it("imports months before the start month as approved updates, with segments, KPIs and narrative", async () => {
    const csv = [
      `company,month,${CORE},segment:Online,segment:Retail,line:Wholesale,kpi:Revenue per outlet [Mont Kiara],kpi:Profitable [The Row],key_milestones,fundraising_status,help_tags,team_morale,# notes`,
      `Batik Boutique,2025-06,,1000,-200,9000,800,3,2,"RM 4,000",500,2500,1000,No,"Opened ""Mont Kiara""",preparing to raise,Hiring; finance,4,ignored`,
      `batik boutique,Jul 2025,5000,1000,250,9000,800,3,2,,,,,,,,,,`,
    ].join("\n");
    const planned = await plan(csv, { createSegments: true });
    const result = planned.plan;
    expect(messages(result.errors)).toEqual([]);
    expect(result.companies.map((company) => company.months.map((month) => month.month))).toEqual([["2025-06", "2025-07"]]);
    expect(result.newPeriods).toEqual(["2025-06", "2025-07"]);

    const written = await apply(planned);
    expect(written).toEqual({
      periodsCreated: 2,
      monthsImported: 2,
      segmentsCreated: [
        { companyName: "Batik Boutique", kind: "company", name: "Online" },
        { companyName: "Batik Boutique", kind: "company", name: "Retail" },
        { companyName: "Batik Boutique", kind: "scaleup", name: "Wholesale" },
      ],
    });

    // New reporting months: the platform's due day, the default template's published version, opened automatically.
    expect(
      await db.query("select month, due_date, template_version_id, opened_by from public.reporting_periods where month < '2026-07-01' order by month"),
    ).toEqual([
      { month: "2025-06-01", due_date: "2025-07-15", template_version_id: SEED.template.v1, opened_by: null },
      { month: "2025-07-01", due_date: "2025-08-15", template_version_id: SEED.template.v1, opened_by: null },
    ]);

    const months = await db.query<{ id: string; month: string; status: string; revision: number; approved_by: string | null }>(
      "select id, month, status, revision, approved_by from public.submissions where company_id = $1 and month < '2026-07-01' order by month",
      [BATIK],
    );
    expect(months.map(({ month, status, revision, approved_by }) => ({ month, status, revision, approved_by }))).toEqual([
      { month: "2025-06-01", status: "approved", revision: 1, approved_by: null },
      { month: "2025-07-01", status: "approved", revision: 1, approved_by: null },
    ]);

    // Total revenue of Jun 2025 is the sum of the company's own segments (ScaleUp lines never count).
    expect(
      await db.query(
        `select month, revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt
           from public.v_submission_financials where company_id = $1 and month < '2026-07-01' order by month`,
        [BATIK],
      ),
    ).toEqual([
      { month: "2025-06-01", revenue_total: 4500, gross_profit: 1000, net_profit: -200, cash_in_bank: 9000, burn_rate: 800, headcount_ft: 3, headcount_pt: 2 },
      { month: "2025-07-01", revenue_total: 5000, gross_profit: 1000, net_profit: 250, cash_in_bank: 9000, burn_rate: 800, headcount_ft: 3, headcount_pt: 2 },
    ]);

    expect(
      await db.query(
        `select field_key, value_number, value_text, value_json from public.submission_values
          where submission_id = $1 and field_key in ('fundraising_status', 'help_tags', 'key_milestones', 'team_morale')
          order by field_key`,
        [months[0].id],
      ),
    ).toEqual([
      { field_key: "fundraising_status", value_number: null, value_text: "Preparing to raise", value_json: null },
      { field_key: "help_tags", value_number: null, value_text: null, value_json: ["Hiring", "Finance"] },
      { field_key: "key_milestones", value_number: null, value_text: 'Opened "Mont Kiara"', value_json: null },
      { field_key: "team_morale", value_number: 4, value_text: null, value_json: null },
    ]);

    // Segments the company did not have are added as no longer in use, retired after their last month.
    expect(
      await db.query(
        `select rs.name, rs.kind, rs.is_active, rs.retired_at = '2025-07-01T00:00:00+08:00'::timestamptz as retired_after_june, ssv.amount
           from public.submission_segment_values ssv join public.revenue_segments rs on rs.id = ssv.segment_id
          where ssv.submission_id = $1 order by rs.kind, rs.name`,
        [months[0].id],
      ),
    ).toEqual([
      { name: "Online", kind: "company", is_active: false, retired_after_june: true, amount: 4000 },
      { name: "Retail", kind: "company", is_active: false, retired_after_june: true, amount: 500 },
      { name: "Wholesale", kind: "scaleup", is_active: false, retired_after_june: true, amount: 2500 },
    ]);

    expect(
      await db.query(
        `select k.name, m.name as member, kv.value_number, kv.value_bool
           from public.submission_kpi_values kv
           join public.company_kpis k on k.id = kv.kpi_id
           left join public.kpi_dimension_members m on m.id = kv.dimension_member_id
          where kv.submission_id = $1 order by k.name`,
        [months[0].id],
      ),
    ).toEqual([
      { name: "Profitable", member: "The Row", value_number: null, value_bool: false },
      { name: "Revenue per outlet", member: "Mont Kiara", value_number: 1000, value_bool: null },
    ]);

    // Timeline and audit: approved by "the system", action "import".
    expect(
      await db.query("select event, actor_id, message from public.submission_events where submission_id = $1", [months[1].id]),
    ).toEqual([{ event: "approved", actor_id: null, message: "Imported from the historical workbook (history.csv)." }]);
    const audit = await db.query<{ action: string; actor_role: string; actor_id: string | null; summary: string; n: number }>(
      `select action, actor_role, actor_id, summary, count(*)::int as n from public.audit_log
        where entity = 'submissions' and company_id = $1 and action = 'import'
        group by action, actor_role, actor_id, summary`,
      [BATIK],
    );
    expect(audit).toEqual([
      {
        action: "import",
        actor_role: "system",
        actor_id: null,
        summary: "Imported from the historical workbook (history.csv): Jun 2025 – Jul 2025",
        n: 2,
      },
    ]);
  });

  it("checks every row and writes nothing while there are errors", async () => {
    const csv = [
      `company,month,${CORE},segment:Online,kpi:Revenue per outlet [Ritz],fundraising_status,# fine`,
      `Batik Boutique,2026-07,1,1,1,1,1,1,1,,,,`,
      `Huddle,2026-10,1,1,1,1,1,1,1,,,,`,
      `Nobody Ltd,2025-07,1,1,1,1,1,1,1,,,,`,
      `RECQA,2025-13,1,1,1,1,1,1,1,,,,`,
      `RECQA,2025-07,100,1,1,1,1,1,1,90,,,`,
      `RECQA,2025-07,1,1,1,1,1,1,1,,,,`,
      `Kiddocare,2025-07,1,1,1,-5,1,1.5,1,,,,`,
      `Kiddocare,2025-08,1,,,1,1,1,1,,,,`,
      `Batik Boutique,2025-07,1,1,1,1,1,1,1,,5,Raising,`,
    ].join("\n");
    const { plan: result } = await plan(csv);
    expect(result.companies).toEqual([]);
    expect(messages(result.errors)).toEqual([
      "history.csv:2: Batik Boutique, Jul 2026: Batik Boutique reports on the platform from Jul 2026, so only earlier months come from the workbooks.",
      "history.csv:3: Huddle, Oct 2026: only months that have ended can be imported (the latest is Sep 2026).",
      'history.csv:4: There is no company called "Nobody Ltd". Add it on the platform first (or check the spelling).',
      'history.csv:5: The month "2025-13" is not a month: use YYYY-MM (e.g. 2025-07) or "Jul 2025".',
      'history.csv:6: RECQA, Jul 2025: RECQA has no revenue segment called "Online" (its revenue segments: none). Run with --create-segments to add it as one no longer in use, or check the spelling.',
      "history.csv:7: RECQA, Jul 2025 is also on history.csv:6: each company and month can only be imported once.",
      "history.csv:8: Kiddocare, Jul 2025: Cash in bank (month end) (cash_in_bank) cannot be negative.",
      "history.csv:8: Kiddocare, Jul 2025: Full-time headcount (headcount_ft) must be a whole number.",
      "history.csv:9: Kiddocare, Aug 2025: Gross profit, Net profit are missing. (Run with --allow-missing to import months with gaps.)",
      'history.csv:10: Batik Boutique, Jul 2025: "Revenue per outlet" has no member called "Ritz" (its members: "Mont Kiara", "The Row", "IOI City Mall", "Westin Desaru", "Merdeka 118").',
      "history.csv:10: Batik Boutique, Jul 2025: Fundraising status (fundraising_status) must be one of: Not raising, Preparing to raise, Actively raising, Term sheet received, Closing round, Round closed (got \"Raising\").",
    ]);
  });

  it("refuses unknown columns and a total that differs from the segments", async () => {
    const unknown = await plan(`company,month,Total revenue\nRECQA,2025-07,1`);
    expect(messages(unknown.plan.errors)[0]).toMatch(/^history\.csv: Unknown column "Total revenue"/);

    await db.query("select * from public.set_company_revenue_segments($1, $2)", [SEED.companies.recqa, [{ name: "Online" }, { name: "Retail" }]]);
    const mismatch = await plan(`company,month,${CORE},segment:online,segment:RETAIL\nRECQA,2025-07,1000,1,1,1,1,1,1,600,300`);
    expect(messages(mismatch.plan.errors)).toEqual([
      "history.csv:2: RECQA, Jul 2025: Total revenue (1,000) does not equal the sum of the revenue segments (900).",
    ]);
  });

  it("uses the company's segments in use by name, accepts gaps with --allow-missing and skips months already on the platform", async () => {
    await db.query("select * from public.set_company_revenue_segments($1, $2)", [SEED.companies.recqa, [{ name: "Online" }]]);
    const [online] = await db.query<{ id: string }>(
      "select id from public.revenue_segments where company_id = $1 and kind = 'company' and is_active",
      [SEED.companies.recqa],
    );
    const csv = `company,month,revenue_total,segment:ONLINE\nRECQA,2025-08,,700\nRECQA,2025-09,800,800`;

    const first = await plan(csv, { allowMissing: true });
    expect(messages(first.plan.errors)).toEqual([]);
    expect(messages(first.plan.warnings)).toEqual([
      "history.csv:2: RECQA, Aug 2025: Gross profit, Net profit, Cash in bank (month end), Burn rate (per month), Full-time headcount, Part-time headcount are missing.",
      "history.csv:3: RECQA, Sep 2025: Gross profit, Net profit, Cash in bank (month end), Burn rate (per month), Full-time headcount, Part-time headcount are missing.",
    ]);
    await apply(first);
    expect(
      await db.query(
        `select s.month, ssv.segment_id, ssv.amount from public.submission_segment_values ssv
           join public.submissions s on s.id = ssv.submission_id where s.company_id = $1 order by s.month`,
        [SEED.companies.recqa],
      ),
    ).toEqual([
      { month: "2025-08-01", segment_id: online.id, amount: 700 },
      { month: "2025-09-01", segment_id: online.id, amount: 800 },
    ]);
    expect(await db.count("select 1 from public.revenue_segments where company_id = $1", [SEED.companies.recqa])).toBe(1);

    // Again: nothing to do, nothing changes.
    const again = await plan(csv, { allowMissing: true });
    expect(again.plan.companies).toEqual([]);
    expect(messages(again.plan.skipped)).toEqual([
      "history.csv:2: RECQA, Aug 2025 is already on the platform (approved): left unchanged.",
      "history.csv:3: RECQA, Sep 2025 is already on the platform (approved): left unchanged.",
    ]);
  });

  it("imports any ended month of a company that is not reporting yet", async () => {
    const csv = `company,month,${CORE},kpi:Cameras deployed\nHuddle,2026-09,1,1,1,1,1,1,1,12\nHuddle,2026-08,1,1,1,1,1,1,1,12.5`;
    const refused = await plan(csv);
    expect(messages(refused.plan.errors)).toEqual(["history.csv:3: Huddle, Aug 2026: Cameras deployed must be a whole number."]);

    const accepted = await plan(csv.replace("12.5", "11"));
    expect(messages(accepted.plan.errors)).toEqual([]);
    // Jul–Sep 2026 exist already (the pilot reports from Jul 2026): the months keep their reporting period.
    expect(accepted.plan.newPeriods).toEqual([]);
    await apply(accepted);
    expect(
      await db.query("select month, status from public.submissions where company_id = $1 order by month", [SEED.companies.huddle]),
    ).toEqual([
      { month: "2026-08-01", status: "approved" },
      { month: "2026-09-01", status: "approved" },
    ]);
    // Still not reporting: the daily job opens nothing for Huddle.
    await db.rpc("open_due_periods");
    expect(await db.count("select 1 from public.submissions where company_id = $1", [SEED.companies.huddle])).toBe(2);
  });
});
