/**
 * F-DB conformance review (2026-09-30): each test states the behaviour the contract / BRD expects.
 * They failed against the first version of the migrations and are kept as regression tests for the
 * fixes (F-DB second pass):
 *
 *   R1  open_due_periods() failed for everyone while the default template had no published version
 *       → the template is only needed for months that must be created; users cannot remove the
 *         default or make a template without a published version the default
 *   R2  confirm_period_close() snapshotted totals from a month whose numbers were being corrected
 *       → every month must be submitted or approved (not sent back)
 *   R3  audit rows of dimension members deleted with their dimension lost the company id
 *   R4  months opened by a company user's page load were attributed to that user in other companies'
 *       audit trails → recorded as the system
 *   R5  a system field moved into a narrative section made has_narrative true for plain numbers
 *       → system fields must stay in their Financials / Headcount section
 *   R6  integer type and validation.min of custom template fields were never enforced
 *       → get_submission_validation reports not_integer / negative / out_of_range
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectRule, freshDb, type PgError, type TestDb } from "./harness";
import { fillAndSubmit, save, setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;
const R = SEED.companies.recqa;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" }); // Jul–Sep open, Q3 closes created
});

afterEach(async () => {
  await db?.close();
});

type Validation = { ok: boolean; errors: { target: string; code: string; message: string }[] };

/** Runs a statement that a fix may legitimately refuse with a business-rule error (P0001). */
async function refusedByRule(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (error) {
    if ((error as PgError).code === "P0001") return true;
    throw error;
  }
}

/** Creates a draft of the default template (as a Fund Admin) and returns its id. */
function draftOfDefaultTemplate(): Promise<string> {
  return db.asUser(p.fundAdmin, (sql) => sql.rpc<string>("create_template_draft", { p_template_id: SEED.template.id }));
}

/** Publishes a draft, opens October (today 2 Nov) and returns RECQA's October submission. */
async function publishAndOpenOctober(draft: string): Promise<string> {
  await db.asUser(p.fundAdmin, (sql) => sql.rpc("publish_template_version", { p_version_id: draft }));
  await db.setToday("2026-11-02");
  await db.rpc("open_due_periods");
  return db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-10-01'", [R]);
}

describe("F-DB conformance review — regressions", () => {
  it("R1 open_due_periods() keeps working when every month is open but the default template has no published version", async () => {
    // (a) A Fund Admin unsets the default (the first of the two statements a default switch needs,
    // because the partial unique index allows one default at a time; the templates UI sends them as
    // separate requests) … A fix may refuse this with a business-rule error instead.
    await refusedByRule(() =>
      db.asUser(p.fundAdmin, (sql) => sql.query("update public.templates set is_default = false where id = $1", [SEED.template.id])),
    );
    // (b) … and/or makes a template that is still being built (draft only) the default.
    await refusedByRule(() =>
      db.asUser(p.fundAdmin, async (sql) => {
        const next = await sql.value<string>("insert into public.templates (name) values ('Portfolio Update 2027') returning id");
        await sql.query("update public.templates set is_default = false where id = $1", [SEED.template.id]);
        await sql.query("update public.templates set is_default = true where id = $1", [next]);
      }),
    );
    // Jul–Sep are already open (today 20 Oct), so nothing needs a template version: the call that
    // every tracker / portal page load makes must not fail for every user.
    expect(await db.asUser(p.batikOwner, (sql) => sql.rpc("open_due_periods"))).toBe(0);
    // A company onboarded now still gets its already-open months.
    const newcomer = await db.createCompany({ name: "Newcomer", reportingStartMonth: "2026-08-01" });
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_due_periods"));
    expect(await db.count("select 1 from public.submissions where company_id = $1", [newcomer])).toBe(2);
  });

  it("R2 confirm_period_close() refuses a period whose month has been sent back and no longer has complete numbers", async () => {
    const q3Months = ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.batik[m]);
    await fillAndSubmit(db, p.batikOwner, "batik", q3Months);
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: q3Months[2], p_message: "Redo September" }));
    // The contributor starts correcting September and clears two figures.
    await db.asUser(p.batikContributor, (sql) =>
      save(sql, q3Months[2], {
        values: [
          { key: "revenue_total", value_number: null },
          { key: "cash_in_bank", value_number: null },
        ],
      }),
    );
    const q3 = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [A]);
    // The owner uploads the management accounts (file first, then its documents row).
    const path = `${A}/${q3}/${randomUUID()}-ma.pdf`;
    await db.asUser(p.batikOwner, async (sql) => {
      await sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
      await sql.query("insert into public.documents (company_id, period_close_id, file_name, storage_path) values ($1, $2, 'ma.pdf', $3)", [
        A,
        q3,
        path,
      ]);
    });
    // Before the fix this confirmed and stored revenue_total 200,000 (Jul + Aug only) and cash_in_bank null.
    await expectRule(
      db.asUser(p.batikOwner, (sql) => sql.rpc("confirm_period_close", { p_close_id: q3 })),
      "Submit every month of Q3 2026 before confirming it. Still to submit: Sep 2026 (changes requested).",
    );
    expect(await db.value("select status::text from public.period_closes where id = $1", [q3])).toBe("open");
  });

  it("R3 audit rows of dimension members deleted with their dimension keep the company id", async () => {
    const dimension = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.kpi_dimensions (company_id, name) values ($1, 'Product') returning id", [R]),
    );
    const member = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.kpi_dimension_members (dimension_id, name) values ($1, 'Sensor') returning id", [dimension]),
    );
    await db.asUser(p.fundAdmin, (sql) => sql.query("delete from public.kpi_dimensions where id = $1", [dimension]));
    const row = await db.one(
      "select company_id from public.audit_log where entity = 'kpi_dimension_members' and entity_id = $1 and action = 'delete'",
      [member],
    );
    expect(row).toEqual({ company_id: R }); // today: null (the parent dimension is already gone)
  });

  it("R4 months opened by a company user's page load are not attributed to that user in other companies' audit trails", async () => {
    await db.setToday("2026-11-02"); // October is due to open
    const start = await db.value<number>("select max(id)::int from public.audit_log");
    expect(await db.asUser(p.batikOwner, (sql) => sql.rpc("open_due_periods"))).toBe(0);
    const others = await db.query<{ company_id: string; actor_id: string | null; actor_role: string | null }>(
      "select company_id, actor_id, actor_role from public.audit_log where id > $1 and entity = 'submissions' and company_id <> $2",
      [start, A],
    );
    expect(others).toHaveLength(2); // Kiddocare's and RECQA's October
    for (const row of others) {
      // Today: actor = the Batik Boutique owner, actor_role 'company_owner', on Kiddocare's / RECQA's rows.
      expect(row.actor_id, `audit actor of ${row.company_id}'s October`).not.toBe(p.batikOwner);
    }
  });

  it("R5 plain numbers never count as narrative (a system field cannot be moved into a narrative section)", async () => {
    const draft = await draftOfDefaultTemplate();
    const narrative = await db.value<string>(
      "select id from public.template_sections where template_version_id = $1 and key = 'company_summary'",
      [draft],
    );
    const refused = await refusedByRule(() =>
      db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.template_fields set section_id = $2 where template_version_id = $1 and key = 'revenue_total'", [
          draft,
          narrative,
        ]),
      ),
    );
    if (refused) return; // refusing the move is an acceptable fix
    const oct = await publishAndOpenOctober(draft);
    await db.asUser(p.recqaOwner, (sql) => save(sql, oct, { values: [{ key: "revenue_total", value_number: 5 }] }));
    // Today: true — the tracker would show "narrative filled" for a month with only a revenue figure.
    expect(await db.value("select has_narrative from public.v_submission_overview where id = $1", [oct])).toBe(false);
  });

  it("R6 integer type and validation.min of custom template fields are enforced (at save or by validation)", async () => {
    const draft = await draftOfDefaultTemplate();
    await db.asUser(p.fundAdmin, async (sql) => {
      const section = await sql.value<string>(
        `insert into public.template_sections (template_version_id, key, title, kind, sort_order)
         values ($1, 'operating_numbers', 'Operating numbers', 'custom_numbers', 3) returning id`,
        [draft],
      );
      await sql.query(
        `insert into public.template_fields (template_version_id, section_id, key, label, field_type, is_required, validation)
         values ($1, $2, 'outlets_open', 'Outlets open', 'integer', true, '{"min": 0}')`,
        [draft, section],
      );
    });
    const oct = await publishAndOpenOctober(draft);
    const codes = async () => {
      const result = await db.asUser(p.recqaOwner, (sql) => sql.rpc<Validation>("get_submission_validation", { p_submission_id: oct }));
      return result.errors.filter((e) => e.target === "field:outlets_open").map((e) => e.code);
    };
    const saveOutlets = (value: number) =>
      refusedByRule(() => db.asUser(p.recqaOwner, (sql) => save(sql, oct, { values: [{ key: "outlets_open", value_number: value }] })));

    // 2.5 outlets: refused at save, or flagged not_integer. Today: accepted and not flagged.
    if (!(await saveOutlets(2.5))) expect(await codes()).toContain("not_integer");
    // -2 outlets with validation {"min": 0}: refused at save, or flagged negative. Today: accepted and not flagged.
    if (!(await saveOutlets(-2))) expect(await codes()).toContain("negative");
  });
});
