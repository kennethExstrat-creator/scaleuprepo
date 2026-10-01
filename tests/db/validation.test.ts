import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OUTLET_IDS, SEED } from "./fixtures";
import { expectDenied, freshDb, type TestDb } from "./harness";
import { fillValid, save, setupPortfolio, submit, type Portfolio } from "./scenario";

type Issue = { target: string; code: string; message: string };
type Validation = { ok: boolean; errors: Issue[] };

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

function validate(submissionId: string, userId = p.batikOwner): Promise<Validation> {
  return db.asUser(userId, (sql) => sql.rpc<Validation>("get_submission_validation", { p_submission_id: submissionId }));
}

const OUTLET_NAMES = ["Mont Kiara", "The Row", "IOI City Mall", "Westin Desaru", "Merdeka 118"];

describe("get_submission_validation()", () => {
  it("lists every missing system number and KPI cell with targets and messages", async () => {
    const result = await validate(p.subs.batik["2026-07-01"]);
    expect(result.ok).toBe(false);
    expect(result.errors.slice(0, 7)).toEqual([
      { target: "field:revenue_total", code: "required", message: "Total revenue is required." },
      { target: "field:gross_profit", code: "required", message: "Gross profit is required." },
      { target: "field:net_profit", code: "required", message: "Net profit is required." },
      { target: "field:cash_in_bank", code: "required", message: "Cash in bank (month end) is required." },
      { target: "field:burn_rate", code: "required", message: "Burn rate (per month) is required." },
      { target: "field:headcount_ft", code: "required", message: "Full-time headcount is required." },
      { target: "field:headcount_pt", code: "required", message: "Part-time headcount is required." },
    ]);
    const kpiErrors = result.errors.slice(7);
    expect(kpiErrors).toHaveLength(15);
    const expected: Issue[] = [];
    for (const [kpiId, name] of [
      [SEED.kpis.revenuePerOutlet, "Revenue per outlet"],
      [SEED.kpis.monthlyBreakEven, "Monthly break-even"],
      [SEED.kpis.profitable, "Profitable"],
    ]) {
      OUTLET_IDS.forEach((memberId, i) =>
        expected.push({ target: `kpi:${kpiId}:${memberId}`, code: "required", message: `${name} (${OUTLET_NAMES[i]}) is required.` }),
      );
    }
    expect(kpiErrors).toEqual(expected);

    // Kiddocare's KPIs have no dimension: target kpi:<id>.
    const kiddo = await validate(p.subs.kiddo["2026-07-01"], p.kiddoOwner);
    expect(kiddo.errors.filter((e) => e.target.startsWith("kpi:"))).toEqual([
      { target: `kpi:${SEED.kpis.appDownloads}`, code: "required", message: "App downloads is required." },
      { target: `kpi:${SEED.kpis.bookings}`, code: "required", message: "Bookings is required." },
      { target: `kpi:${SEED.kpis.activeCarers}`, code: "required", message: "Active carers is required." },
      { target: `kpi:${SEED.kpis.payoutsToCarers}`, code: "required", message: "Payouts to carers is required." },
    ]);
    // RECQA has no KPIs: only the system numbers.
    expect((await validate(p.subs.recqa["2026-07-01"], p.recqaOwner)).errors).toHaveLength(7);
  });

  it("is ok once the numbers and KPIs are complete (narrative stays optional)", async () => {
    await fillValid(db, p.batikOwner, p.subs.batik["2026-07-01"], "batik");
    expect(await validate(p.subs.batik["2026-07-01"])).toEqual({ ok: true, errors: [] });
    await fillValid(db, p.kiddoContributor, p.subs.kiddo["2026-07-01"], "kiddo");
    expect(await validate(p.subs.kiddo["2026-07-01"], p.kiddoOwner)).toEqual({ ok: true, errors: [] });
  });

  it("flags negative amounts and fractional headcounts, but allows negative profit", async () => {
    const id = p.subs.recqa["2026-07-01"];
    await fillValid(db, p.recqaOwner, id, "recqa", {
      revenue_total: -1,
      gross_profit: -10,
      net_profit: -20,
      cash_in_bank: -1,
      burn_rate: -0.5,
      headcount_ft: -1.5,
      headcount_pt: 1.5,
    });
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: "field:revenue_total", code: "negative", message: "Total revenue cannot be negative." },
      { target: "field:cash_in_bank", code: "negative", message: "Cash in bank (month end) cannot be negative." },
      { target: "field:burn_rate", code: "negative", message: "Burn rate (per month) cannot be negative." },
      { target: "field:headcount_ft", code: "negative", message: "Full-time headcount cannot be negative." },
      { target: "field:headcount_ft", code: "not_integer", message: "Full-time headcount must be a whole number." },
      { target: "field:headcount_pt", code: "not_integer", message: "Part-time headcount must be a whole number." },
    ]);
    await fillValid(db, p.recqaOwner, id, "recqa", { burn_rate: 0, revenue_total: 0 });
    expect((await validate(id, p.recqaOwner)).ok).toBe(true);
  });

  it("requires every active company segment and checks that total revenue equals their sum (±0.01) (BRD B30)", async () => {
    const id = p.subs.recqa["2026-07-01"];
    // The company's own segments (set by its owner), plus a retired one that no longer counts.
    const [legacy] = await db.asUser(p.recqaOwner, (sql) =>
      sql.query<{ id: string }>("select id from public.set_company_revenue_segments($1, $2)", [SEED.companies.recqa, [{ name: "Legacy" }]]),
    );
    const [a, b] = (
      await db.asUser(p.recqaOwner, (sql) =>
        sql.query<{ id: string }>("select id from public.set_company_revenue_segments($1, $2)", [
          SEED.companies.recqa,
          [{ name: "Hardware" }, { name: "Services" }],
        ]),
      )
    ).map((row) => row.id);
    expect(await db.value("select is_active from public.revenue_segments where id = $1", [legacy.id])).toBe(false);
    await fillValid(db, p.recqaOwner, id, "recqa", { revenue_total: 300.01 });
    await db.asUser(p.recqaOwner, (sql) => save(sql, id, { segments: [{ segment_id: a, amount: 100 }] }));
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: `segment:${b}`, code: "required", message: "Revenue for Services is required." },
    ]);

    await db.asUser(p.recqaOwner, (sql) => save(sql, id, { segments: [{ segment_id: b, amount: 200 }] }));
    expect(await validate(id, p.recqaOwner)).toEqual({ ok: true, errors: [] }); // 300.01 vs 300.00: within tolerance

    await db.asUser(p.recqaOwner, (sql) => save(sql, id, { values: [{ key: "revenue_total", value_number: 300.02 }] }));
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (300.02) must equal the sum of your revenue segments (300.00).",
      },
    ]);

    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, id, {
        values: [{ key: "revenue_total", value_number: 1234567.5 }],
        segments: [
          { segment_id: a, amount: -5 },
          { segment_id: b, amount: 1234572.5 },
        ],
      }),
    );
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: `segment:${a}`, code: "negative", message: "Revenue for Hardware cannot be negative." },
    ]);

    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, id, { values: [{ key: "revenue_total", value_number: 999 }], segments: [{ segment_id: a, amount: 5 }] }),
    );
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (999.00) must equal the sum of your revenue segments (1,234,577.50).",
      },
    ]);
  });

  it("requires every active ScaleUp revenue line, never negative, but they need not add up (BRD B30)", async () => {
    const id = p.subs.recqa["2026-07-01"];
    const line = (name: string, order: number, active = true) =>
      db.asUser(p.fundAdmin, (sql) =>
        sql.value<string>(
          "insert into public.revenue_segments (company_id, name, sort_order, is_active) values ($1, $2, $3, $4) returning id",
          [SEED.companies.recqa, name, order, active],
        ),
      );
    const drones = await line("Inspection drones", 1);
    const software = await line("Software", 2);
    await line("Old line", 3, false);
    await fillValid(db, p.recqaOwner, id, "recqa", { revenue_total: 100 });
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: `segment:${drones}`, code: "required", message: "Revenue for Inspection drones is required." },
      { target: `segment:${software}`, code: "required", message: "Revenue for Software is required." },
    ]);
    // More than total revenue between them: fine (no sum rule for ScaleUp lines).
    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, id, { segments: [{ segment_id: drones, amount: 90 }, { segment_id: software, amount: 80 }] }),
    );
    expect(await validate(id, p.recqaOwner)).toEqual({ ok: true, errors: [] });
    await db.asUser(p.recqaOwner, (sql) => save(sql, id, { segments: [{ segment_id: software, amount: -1 }] }));
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: `segment:${software}`, code: "negative", message: "Revenue for Software cannot be negative." },
    ]);
  });

  it("checks company segments (and their sum) before ScaleUp lines when a company has both (BRD B30)", async () => {
    const id = p.subs.recqa["2026-07-01"];
    const [own] = await db.asUser(p.recqaOwner, (sql) =>
      sql.query<{ id: string }>("select id from public.set_company_revenue_segments($1, $2)", [SEED.companies.recqa, [{ name: "Services" }]]),
    );
    const scaleupLine = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name, sort_order) values ($1, 'Services', 0) returning id", [
        SEED.companies.recqa,
      ]),
    );
    await fillValid(db, p.recqaOwner, id, "recqa", { revenue_total: 50 });
    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, id, { segments: [{ segment_id: own.id, amount: 40 }, { segment_id: scaleupLine, amount: -3 }] }),
    );
    expect((await validate(id, p.recqaOwner)).errors).toEqual([
      { target: "field:revenue_total", code: "sum_mismatch", message: "Total revenue (50.00) must equal the sum of your revenue segments (40.00)." },
      { target: `segment:${scaleupLine}`, code: "negative", message: "Revenue for Services cannot be negative." },
    ]);
  });

  it("requires half-yearly KPIs in June and December only", async () => {
    await db.query("update public.company_kpis set frequency = 'half_yearly' where id = $1", [SEED.kpis.bookings]);
    const jul = await validate(p.subs.kiddo["2026-07-01"], p.kiddoOwner);
    expect(jul.errors.map((e) => e.target)).not.toContain(`kpi:${SEED.kpis.bookings}`);
    await db.setToday("2027-01-10");
    await db.rpc("open_due_periods");
    const dec = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-12-01'", [
      SEED.companies.kiddocare,
    ]);
    const result = await validate(dec, p.kiddoOwner);
    expect(result.errors.map((e) => e.target)).toContain(`kpi:${SEED.kpis.bookings}`);
  });

  it("ignores inactive KPIs, optional KPIs and inactive dimension members", async () => {
    await db.query("update public.kpi_dimension_members set is_active = false where id = $1", [SEED.outlets.merdeka118]);
    await db.query("update public.company_kpis set is_active = false where id = $1", [SEED.kpis.profitable]);
    await db.query("update public.company_kpis set is_required = false where id = $1", [SEED.kpis.monthlyBreakEven]);
    const result = await validate(p.subs.batik["2026-07-01"]);
    expect(result.errors.filter((e) => e.target.startsWith("kpi:")).map((e) => e.message)).toEqual([
      "Revenue per outlet (Mont Kiara) is required.",
      "Revenue per outlet (The Row) is required.",
      "Revenue per outlet (IOI City Mall) is required.",
      "Revenue per outlet (Westin Desaru) is required.",
    ]);
    // A KPI whose dimension has no active member asks for nothing.
    await db.query("update public.kpi_dimension_members set is_active = false where dimension_id = $1", [SEED.dimensions.batikOutlet]);
    expect((await validate(p.subs.batik["2026-07-01"])).errors.filter((e) => e.target.startsWith("kpi:"))).toEqual([]);
  });

  it("requires other template fields marked as required", async () => {
    const draft = await db.rpc<string>("create_template_draft", { p_template_id: SEED.template.id });
    await db.query("update public.template_fields set is_required = true where template_version_id = $1 and key in ('key_milestones', 'help_tags')", [
      draft,
    ]);
    await db.rpc("publish_template_version", { p_version_id: draft });
    await db.setToday("2026-11-02");
    await db.rpc("open_due_periods");
    const oct = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-10-01'", [
      SEED.companies.recqa,
    ]);
    await fillValid(db, p.recqaOwner, oct, "recqa");
    const errors = (await validate(oct, p.recqaOwner)).errors.filter((e) => e.code === "required");
    expect(errors).toEqual([
      { target: "field:key_milestones", code: "required", message: "Key milestones is required." },
      { target: "field:help_tags", code: "required", message: "Help needed (tags) is required." },
    ]);
    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, oct, {
        values: [
          { key: "key_milestones", value_text: "Signed two distributors" },
          { key: "help_tags", value_json: ["Hiring"] },
        ],
      }),
    );
    expect((await validate(oct, p.recqaOwner)).errors.filter((e) => e.code === "required")).toEqual([]);
    // Earlier months keep template v1, where those fields are optional.
    await fillValid(db, p.recqaOwner, p.subs.recqa["2026-09-01"], "recqa");
    expect((await validate(p.subs.recqa["2026-09-01"], p.recqaOwner)).errors.filter((e) => e.code === "required")).toEqual([]);
  });

  it("applies the integer type and validation settings of every number field (custom fields included)", async () => {
    const draft = await db.rpc<string>("create_template_draft", { p_template_id: SEED.template.id });
    const section = await db.value<string>(
      `insert into public.template_sections (template_version_id, key, title, kind, sort_order)
       values ($1, 'unit_economics', 'Unit economics', 'custom_numbers', 3) returning id`,
      [draft],
    );
    await db.query(
      `insert into public.template_fields (template_version_id, section_id, key, label, field_type, validation, sort_order) values
         ($1, $2, 'outlets_open', 'Outlets open', 'integer', '{"min": 0}', 1),
         ($1, $2, 'cac', 'Customer acquisition cost', 'currency', '{"allow_negative": false}', 2),
         ($1, $2, 'nps', 'Net promoter score', 'number', '{"min": -100, "max": 100}', 3),
         ($1, $2, 'churn_pct', 'Churn', 'percent', '{"max": 100}', 4),
         ($1, $2, 'margin_target', 'Margin target', 'percent', '{"min": 5.5}', 5),
         ($1, $2, 'ignored', 'Badly configured', 'number', '{"min": "zero", "max": null}', 6)`,
      [draft, section],
    );
    // The validation settings of system fields count too.
    await db.query(`update public.template_fields set validation = '{"min": 0, "max": 500}' where template_version_id = $1 and key = 'headcount_ft'`, [
      draft,
    ]);
    await db.rpc("publish_template_version", { p_version_id: draft });
    await db.setToday("2026-11-02");
    await db.rpc("open_due_periods");
    const oct = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-10-01'", [
      SEED.companies.recqa,
    ]);
    const issues = async () =>
      (await validate(oct, p.recqaOwner)).errors.filter((e) => e.code !== "prior_months" && e.code !== "required");
    const saveNumbers = (values: Record<string, number | null>) =>
      db.asUser(p.recqaOwner, (sql) => save(sql, oct, { values: Object.entries(values).map(([key, value_number]) => ({ key, value_number })) }));

    await fillValid(db, p.recqaOwner, oct, "recqa", { headcount_ft: 501 });
    // Out-of-range values are saved (autosave never loses input) and reported by validation.
    await saveNumbers({ outlets_open: 2.5, cac: -1, nps: 150, churn_pct: 120.5, margin_target: 1.25, ignored: -1e9 });
    expect(await issues()).toEqual([
      { target: "field:headcount_ft", code: "out_of_range", message: "Full-time headcount must be between 0 and 500." },
      { target: "field:outlets_open", code: "not_integer", message: "Outlets open must be a whole number." },
      { target: "field:cac", code: "negative", message: "Customer acquisition cost cannot be negative." },
      { target: "field:nps", code: "out_of_range", message: "Net promoter score must be between -100 and 100." },
      { target: "field:churn_pct", code: "out_of_range", message: "Churn must be at most 100." },
      { target: "field:margin_target", code: "out_of_range", message: "Margin target must be at least 5.5." },
    ]);
    // {"min": 0} means "cannot be negative" (like the system figures); the range is not repeated.
    await saveNumbers({ outlets_open: -2 });
    expect((await issues()).filter((e) => e.target === "field:outlets_open")).toEqual([
      { target: "field:outlets_open", code: "negative", message: "Outlets open cannot be negative." },
    ]);
    await saveNumbers({ headcount_ft: 12, outlets_open: 3, cac: 0, nps: -100, churn_pct: 2.5, margin_target: 5.5 });
    expect(await issues()).toEqual([]);
  });

  it("requires earlier months (from the reporting start) to be submitted first", async () => {
    const { batik } = p.subs;
    await fillValid(db, p.batikOwner, batik["2026-09-01"], "batik");
    expect((await validate(batik["2026-09-01"])).errors).toEqual([
      { target: "general", code: "prior_months", message: "Submit earlier months first: Jul 2026, Aug 2026." },
    ]);
    await fillValid(db, p.batikOwner, batik["2026-07-01"], "batik");
    await submit(db, p.batikOwner, batik["2026-07-01"]);
    expect((await validate(batik["2026-09-01"])).errors).toEqual([
      { target: "general", code: "prior_months", message: "Submit earlier months first: Aug 2026." },
    ]);
    // Changes requested on an earlier month still counts as submitted.
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: batik["2026-07-01"], p_message: "Fix it" }));
    expect((await validate(batik["2026-09-01"])).errors.map((e) => e.message)).toEqual(["Submit earlier months first: Aug 2026."]);
    // Months before a (moved) reporting start month no longer block later ones.
    await db.query("update public.companies set reporting_start_month = '2026-09-01' where id = $1", [SEED.companies.batikBoutique]);
    expect(await validate(batik["2026-09-01"])).toEqual({ ok: true, errors: [] });
  });

  it("is available to everyone who can view the month and to no one else", async () => {
    const id = p.subs.batik["2026-07-01"];
    for (const user of [p.batikOwner, p.batikContributor, p.viewer, p.partner, p.otherPartner, p.fundAdmin, p.superAdmin]) {
      expect((await validate(id, user)).ok).toBe(false);
    }
    await expectDenied(validate(id, p.kiddoOwner), "This monthly update was not found or you do not have access to it.");
    await expectDenied(
      db.asUser(p.batikOwner, (sql) => sql.rpc("get_submission_validation", { p_submission_id: id }), { aal: "aal1" }),
    );
    await expectDenied(db.asAnon((sql) => sql.rpc("get_submission_validation", { p_submission_id: id })));
  });
});
