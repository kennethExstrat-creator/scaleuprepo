/**
 * Parity between the SQL source of truth and the TypeScript mirrors the app uses for instant feedback:
 *
 * 1. private.validate_submission() (via get_submission_validation) vs src/lib/validation.ts, fed through
 *    toValidationInput (src/lib/types/domain.ts). Every scenario stores data through the real RPCs, then
 *    requires both to return exactly the same issues (targets, codes, messages and order), apart from
 *    `prior_months`, which only the server checks. The client input is shaped the way the data layer
 *    (src/lib/data) shapes it: template sections and fields by sort_order then key, segments and KPIs
 *    active first then sort_order then name, active dimension members only.
 * 2. private.compute_period_totals() (period_closes.computed_totals, stored by confirm_period_close) vs
 *    periodTotals() in src/lib/metrics.ts over the same months (v_submission_financials rows).
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { periodTotals } from "@/lib/metrics";
import { kpiCellKey } from "@/lib/targets";
import { toMonthlyFinancials, toValidationInput, type FinancialColumns, type SubmissionBundle } from "@/lib/types/domain";
import { validateSubmissionDraft, type ValidationIssue } from "@/lib/validation";
import { SEED } from "./fixtures";
import { freshDb, type Row, type TestDb } from "./harness";
import { batikKpis, fillValid, save, setupPortfolio, submit, type Portfolio, type SavePayload } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type BundleInput = Pick<SubmissionBundle, "submission" | "config" | "template" | "current">;

async function serverIssues(submissionId: string, userId: string): Promise<ValidationIssue[]> {
  const result = await db.asUser(userId, (sql) =>
    sql.rpc<{ ok: boolean; errors: ValidationIssue[] }>("get_submission_validation", { p_submission_id: submissionId }),
  );
  return result.errors.filter((issue) => issue.code !== "prior_months");
}

/** The client mirror on the same stored rows. */
async function clientIssues(submissionId: string): Promise<ValidationIssue[]> {
  const submission = await db.one("select * from public.submissions where id = $1", [submissionId]);
  const versionId = submission.template_version_id;
  const companyId = submission.company_id;
  const sections = await db.query(
    "select * from public.template_sections where template_version_id = $1 order by sort_order, key, id",
    [versionId],
  );
  const fields = await db.query(
    "select * from public.template_fields where template_version_id = $1 order by sort_order, key, id",
    [versionId],
  );
  const segments = await db.query(
    "select * from public.revenue_segments where company_id = $1 order by is_active desc, sort_order, name, id",
    [companyId],
  );
  const kpis = await db.query(
    "select * from public.company_kpis where company_id = $1 order by is_active desc, sort_order, name, id",
    [companyId],
  );
  const members = await db.query(
    `select m.* from public.kpi_dimension_members m
       join public.kpi_dimensions d on d.id = m.dimension_id
      where d.company_id = $1 and m.is_active
      order by m.sort_order, m.name, m.id`,
    [companyId],
  );
  const values = await db.query("select * from public.submission_values where submission_id = $1", [submissionId]);
  const segmentValues = await db.query("select * from public.submission_segment_values where submission_id = $1", [
    submissionId,
  ]);
  const kpiValues = await db.query("select * from public.submission_kpi_values where submission_id = $1", [submissionId]);

  const bundle = {
    submission,
    template: { sections: sections.map((section) => ({ ...section, fields: fields.filter((f) => f.section_id === section.id) })) },
    config: {
      segments,
      kpis: kpis.map((kpi) => ({ ...kpi, members: members.filter((m) => m.dimension_id === kpi.dimension_id) })),
    },
    current: {
      values: Object.fromEntries(values.map((row) => [row.field_key as string, row])),
      segments: Object.fromEntries(segmentValues.map((row) => [row.segment_id as string, row.amount as number | null])),
      kpis: Object.fromEntries(
        kpiValues.map((row: Row) => [kpiCellKey(row.kpi_id as string, row.dimension_member_id as string | null), row]),
      ),
    },
  } as unknown as BundleInput;
  return validateSubmissionDraft(toValidationInput(bundle));
}

/** Both sides agree; returns the (common) issues for further assertions. */
async function expectParity(submissionId: string, userId: string): Promise<ValidationIssue[]> {
  const [server, client] = await Promise.all([serverIssues(submissionId, userId), clientIssues(submissionId)]);
  expect(client).toEqual(server);
  return server;
}

async function saveAs(userId: string, submissionId: string, payload: SavePayload): Promise<void> {
  await db.asUser(userId, (sql) => save(sql, submissionId, payload));
}

describe("validateSubmissionDraft mirrors private.validate_submission()", () => {
  it("agrees on a blank month (system numbers and per-outlet KPIs) and on a complete one", async () => {
    const id = p.subs.batik["2026-07-01"];
    expect((await expectParity(id, p.batikOwner)).length).toBe(7 + 15);
    await fillValid(db, p.batikOwner, id, "batik");
    expect(await expectParity(id, p.batikOwner)).toEqual([]);
  });

  it("agrees on the system number rules (negative, whole numbers, negative GP/NP allowed)", async () => {
    const id = p.subs.kiddo["2026-07-01"];
    await saveAs(p.kiddoOwner, id, {
      values: [
        { key: "revenue_total", value_number: -1 },
        { key: "gross_profit", value_number: -5 },
        { key: "net_profit", value_number: -5 },
        { key: "cash_in_bank", value_number: -1 },
        { key: "burn_rate", value_number: -1 },
        { key: "headcount_ft", value_number: 1.5 },
        { key: "headcount_pt", value_number: -0.5 },
      ],
    });
    const issues = await expectParity(id, p.kiddoOwner);
    expect(issues.map((issue) => issue.code)).toContain("not_integer");
  });

  it("agrees on company revenue segments: required, negative, sum mismatch and rounding (BRD B30)", async () => {
    const id = p.subs.recqa["2026-07-01"];
    const setSegments = (list: unknown[]) =>
      db.asUser(p.recqaOwner, (sql) =>
        sql.query<{ id: string }>("select id from public.set_company_revenue_segments($1, $2)", [SEED.companies.recqa, list]),
      );
    await setSegments([{ name: "Legacy" }]);
    const [hardware, services] = (await setSegments([{ name: "Hardware" }, { name: "Services" }])).map((row) => row.id);

    await expectParity(id, p.recqaOwner); // nothing entered yet
    await fillValid(db, p.recqaOwner, id, "recqa", { revenue_total: 300.01 });
    await saveAs(p.recqaOwner, id, { segments: [{ segment_id: hardware, amount: 100 }] });
    await expectParity(id, p.recqaOwner);
    await saveAs(p.recqaOwner, id, { segments: [{ segment_id: services, amount: 200 }] });
    expect(await expectParity(id, p.recqaOwner)).toEqual([]); // within ±0.01
    await saveAs(p.recqaOwner, id, { values: [{ key: "revenue_total", value_number: 300.02 }] });
    expect((await expectParity(id, p.recqaOwner)).map((issue) => issue.code)).toEqual(["sum_mismatch"]);
    await saveAs(p.recqaOwner, id, {
      values: [{ key: "revenue_total", value_number: -1234567.5 }],
      segments: [
        { segment_id: hardware, amount: -5.25 },
        { segment_id: services, amount: 1234572.5 },
      ],
    });
    await expectParity(id, p.recqaOwner);
    await saveAs(p.recqaOwner, id, { values: [{ key: "revenue_total", value_number: 0.004 }], segments: [{ segment_id: hardware, amount: 0.5 }] });
    await expectParity(id, p.recqaOwner);
    await saveAs(p.recqaOwner, id, { values: [{ key: "revenue_total", value_number: null }] });
    await expectParity(id, p.recqaOwner);
  });

  it("agrees on ScaleUp revenue lines next to company segments: required, negative, no sum rule (BRD B30)", async () => {
    const id = p.subs.recqa["2026-07-01"];
    const line = (name: string, order: number, active = true) =>
      db.asUser(p.fundAdmin, (sql) =>
        sql.value<string>(
          "insert into public.revenue_segments (company_id, name, sort_order, is_active) values ($1, $2, $3, $4) returning id",
          [SEED.companies.recqa, name, order, active],
        ),
      );
    // ScaleUp lines sort before the company segments here (sort_order 0): issues still list company
    // segments and their sum first.
    const drones = await line("Drones", 0);
    const software = await line("Software", 0);
    await line("Retired line", 0, false);
    await expectParity(id, p.recqaOwner); // only ScaleUp lines, nothing entered
    const [services] = (
      await db.asUser(p.recqaOwner, (sql) =>
        sql.query<{ id: string }>("select id from public.set_company_revenue_segments($1, $2)", [
          SEED.companies.recqa,
          [{ name: "Services" }, { name: "Software" }],
        ]),
      )
    ).map((row) => row.id);

    await expectParity(id, p.recqaOwner); // both kinds, blank
    await fillValid(db, p.recqaOwner, id, "recqa", { revenue_total: 1000 });
    await saveAs(p.recqaOwner, id, { segments: [{ segment_id: drones, amount: 5000 }, { segment_id: software, amount: -1 }] });
    const issues = await expectParity(id, p.recqaOwner);
    expect(issues.map((issue) => issue.target)).toEqual([
      `segment:${services}`,
      expect.stringMatching(/^segment:/), // the company's "Software"
      `segment:${software}`,
    ]);
    await saveAs(p.recqaOwner, id, { segments: [{ segment_id: services, amount: 400 }] });
    await expectParity(id, p.recqaOwner);
  });

  it("agrees on custom template fields, their validation settings and the issue order", async () => {
    const draft = await db.rpc<string>("create_template_draft", { p_template_id: SEED.template.id });
    // A custom section placed before Financials: its issues still come after the system numbers.
    const section = await db.value<string>(
      `insert into public.template_sections (template_version_id, key, title, kind, sort_order)
       values ($1, 'unit_economics', 'Unit economics', 'custom_numbers', 0) returning id`,
      [draft],
    );
    await db.query(
      `insert into public.template_fields (template_version_id, section_id, key, label, field_type, is_required, validation, sort_order) values
         ($1, $2, 'outlets_open', 'Outlets open', 'integer', false, '{"min": 0}', 1),
         ($1, $2, 'cac', 'Customer acquisition cost', 'currency', false, '{"allow_negative": false}', 2),
         ($1, $2, 'nps', 'Net promoter score', 'number', false, '{"min": -100, "max": 100}', 3),
         ($1, $2, 'churn_pct', 'Churn', 'percent', false, '{"max": 100}', 4),
         ($1, $2, 'margin_target', 'Margin target', 'percent', false, '{"min": 5.5}', 5),
         ($1, $2, 'ignored', 'Badly configured', 'number', false, '{"min": "zero", "max": null}', 6),
         ($1, $2, 'is_profitable', 'Profitable this month', 'boolean', true, null, 7)`,
      [draft, section],
    );
    await db.query(
      `update public.template_fields set is_required = true
        where template_version_id = $1 and key in ('key_milestones', 'help_tags', 'fundraising_status', 'team_morale')`,
      [draft],
    );
    await db.query(`update public.template_fields set validation = '{"min": 0, "max": 500}' where template_version_id = $1 and key = 'headcount_ft'`, [
      draft,
    ]);
    await db.query(`update public.template_fields set validation = '{"min": 0}' where template_version_id = $1 and key = 'gross_profit'`, [draft]);
    await db.query(
      `update public.template_fields set validation = '{"allow_negative": false}' where template_version_id = $1 and key = 'net_profit'`,
      [draft],
    );
    await db.rpc("publish_template_version", { p_version_id: draft });
    await db.setToday("2026-11-02");
    await db.rpc("open_due_periods");
    const oct = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-10-01'", [
      SEED.companies.recqa,
    ]);

    await expectParity(oct, p.recqaOwner); // blank
    await fillValid(db, p.recqaOwner, oct, "recqa", { headcount_ft: 501, gross_profit: -1, net_profit: -1 });
    const numbers = (values: Record<string, number | null>) =>
      saveAs(p.recqaOwner, oct, { values: Object.entries(values).map(([key, value_number]) => ({ key, value_number })) });
    await numbers({ outlets_open: 2.5, cac: -1, nps: 150, churn_pct: 120.5, margin_target: 1.25, ignored: -1e9, team_morale: 4 });
    const issues = await expectParity(oct, p.recqaOwner);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["negative", "not_integer", "out_of_range", "required"]),
    );
    await numbers({ outlets_open: -2.5, headcount_ft: -3, nps: -100 });
    await expectParity(oct, p.recqaOwner);
    await saveAs(p.recqaOwner, oct, {
      values: [
        { key: "key_milestones", value_text: "Signed two distributors" },
        { key: "help_tags", value_json: ["Hiring"] },
        { key: "fundraising_status", value_text: "Not raising" },
        { key: "is_profitable", value_json: false },
        { key: "headcount_ft", value_number: 12 },
        { key: "gross_profit", value_number: 0 },
        { key: "net_profit", value_number: 5 },
        { key: "outlets_open", value_number: 3 },
        { key: "cac", value_number: 0 },
        { key: "nps", value_number: 100 },
        { key: "churn_pct", value_number: 2.5 },
        { key: "margin_target", value_number: 5.5 },
      ],
    });
    expect(await expectParity(oct, p.recqaOwner)).toEqual([]);
  });

  it("agrees on KPIs: half-yearly months, inactive KPIs and members, optional KPIs", async () => {
    await db.query("update public.kpi_dimension_members set is_active = false where id = $1", [SEED.outlets.merdeka118]);
    await db.query("update public.company_kpis set is_active = false where id = $1", [SEED.kpis.profitable]);
    await db.query("update public.company_kpis set is_required = false where id = $1", [SEED.kpis.monthlyBreakEven]);
    await db.query("update public.company_kpis set frequency = 'half_yearly' where id = $1", [SEED.kpis.revenuePerOutlet]);
    await db.query("update public.company_kpis set frequency = 'half_yearly' where id = $1", [SEED.kpis.bookings]);

    await expectParity(p.subs.batik["2026-07-01"], p.batikOwner);
    await expectParity(p.subs.kiddo["2026-07-01"], p.kiddoOwner);

    await db.setToday("2027-01-10");
    await db.rpc("open_due_periods");
    const dec = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-12-01'", [
      SEED.companies.batikBoutique,
    ]);
    const decIssues = await expectParity(dec, p.batikOwner);
    expect(decIssues.some((issue) => issue.target.startsWith(`kpi:${SEED.kpis.revenuePerOutlet}:`))).toBe(true);
    // Values for part of the grid (an inactive member's value is ignored by both).
    await saveAs(p.batikOwner, dec, { kpis: batikKpis().filter((_, i) => i % 2 === 0) });
    await expectParity(dec, p.batikOwner);

    const kiddoDec = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-12-01'", [
      SEED.companies.kiddocare,
    ]);
    await expectParity(kiddoDec, p.kiddoOwner);
  });
});

describe("periodTotals mirrors private.compute_period_totals()", () => {
  it("returns the same totals as the computed_totals stored on confirmation", async () => {
    const company = SEED.companies.batikBoutique;
    const figures = [
      { revenue_total: 100.1234, gross_profit: 40.0001, net_profit: -10.5, cash_in_bank: 1000.25, burn_rate: 30.3333, headcount_ft: 10, headcount_pt: 2 },
      { revenue_total: 200.5, gross_profit: 90.9999, net_profit: 20.25, cash_in_bank: 900.75, burn_rate: 20.1, headcount_ft: 11, headcount_pt: 3 },
      { revenue_total: 300.3333, gross_profit: 150.12, net_profit: 60, cash_in_bank: 800.5, burn_rate: 10.0001, headcount_ft: 12, headcount_pt: 4 },
    ];
    const months = ["2026-07-01", "2026-08-01", "2026-09-01"];
    for (const [i, month] of months.entries()) {
      await fillValid(db, p.batikOwner, p.subs.batik[month], "batik", figures[i]);
      await submit(db, p.batikOwner, p.subs.batik[month]);
    }
    const q3 = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [company]);
    const path = `${company}/${q3}/${randomUUID()}-accounts.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
    await db.asUser(p.batikOwner, (sql) =>
      sql.query(
        `insert into public.documents (company_id, period_close_id, doc_type, file_name, storage_path, uploaded_by)
         values ($1, $2, 'management_accounts', 'accounts.pdf', $3, auth.uid())`,
        [company, q3, path],
      ),
    );
    await db.asUser(p.batikOwner, (sql) => sql.rpc("confirm_period_close", { p_close_id: q3 }));

    const stored = await db.value<Record<string, number | null>>("select computed_totals from public.period_closes where id = $1", [q3]);
    const rows = await db.query(
      "select * from public.v_submission_financials where company_id = $1 and month between '2026-07-01' and '2026-09-01' order by month",
      [company],
    );
    const client = periodTotals(rows.map((row) => toMonthlyFinancials(row as unknown as FinancialColumns)));
    expect(client).toEqual(stored);
    expect(stored.gp_pct).toBe(46.7787); // 281.12 / 600.9567 × 100, rounded to 4 decimals on both sides
  });
});
