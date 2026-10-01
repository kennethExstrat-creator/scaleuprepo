import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type TestDb } from "./harness";

let db: TestDb;
let superAdmin: string;
let fundAdmin: string;
let partner: string;

beforeEach(async () => {
  db = await freshDb();
  superAdmin = await db.createUser({ scaleupRole: "super_admin" });
  fundAdmin = await db.createUser({ scaleupRole: "fund_admin" });
  partner = await db.createUser({ scaleupRole: "partner" });
});

afterEach(async () => {
  await db?.close();
});

const createDraft = (user = fundAdmin, templateId: string = SEED.template.id) =>
  db.asUser(user, (sql) => sql.rpc<string>("create_template_draft", { p_template_id: templateId }));
const publish = (versionId: string, user = fundAdmin) =>
  db.asUser(user, (sql) => sql.rpc("publish_template_version", { p_version_id: versionId }));
const fieldOf = (versionId: string, key: string) =>
  db.value<string>("select id from public.template_fields where template_version_id = $1 and key = $2", [versionId, key]);
const sectionOf = (versionId: string, key: string) =>
  db.value<string>("select id from public.template_sections where template_version_id = $1 and key = $2", [versionId, key]);

const IMMUTABLE = /^This template version is (published|archived), so it cannot be changed\. Create a new draft instead\.$/;

describe("template guard", () => {
  it("published versions cannot be changed by anyone, not even the database owner", async () => {
    await expectRule(
      db.query("update public.template_fields set label = 'Revenue' where id = $1", [SEED.fields.revenue_total]),
      IMMUTABLE,
    );
    await expectRule(
      db.query("insert into public.template_sections (template_version_id, key, title, kind) values ($1, 'extra', 'Extra', 'narrative')", [
        SEED.template.v1,
      ]),
      IMMUTABLE,
    );
    await expectRule(db.query("delete from public.template_fields where id = $1", [SEED.fields.other_updates]), IMMUTABLE);
    await expectRule(db.query("update public.template_sections set title = 'X' where id = $1", [SEED.sections.operation]), IMMUTABLE);
    await expectRule(
      db.asService((sql) => sql.query("update public.template_fields set label = 'Revenue' where id = $1", [SEED.fields.revenue_total])),
      IMMUTABLE,
    );
    // Through the API the rows are simply out of reach.
    expect(
      await db.asUser(fundAdmin, (sql) => sql.query("update public.template_fields set label = 'X' where template_version_id = $1 returning id", [SEED.template.v1])),
    ).toEqual([]);
    // (The guard trigger fires before the RLS check.)
    await expectRule(
      db.asUser(fundAdmin, (sql) =>
        sql.query(
          "insert into public.template_fields (template_version_id, section_id, key, label, field_type) values ($1, $2, 'extra', 'Extra', 'text')",
          [SEED.template.v1, SEED.sections.operation],
        ),
      ),
      IMMUTABLE,
    );
    expect(await db.value("select label from public.template_fields where id = $1", [SEED.fields.revenue_total])).toBe("Total revenue");
  });

  it("create_template_draft copies the published version (sections and fields) and is idempotent", async () => {
    const draft = await createDraft();
    expect(await db.one("select version_no, status::text as status, created_by from public.template_versions where id = $1", [draft])).toEqual({
      version_no: 2,
      status: "draft",
      created_by: fundAdmin,
    });
    const snapshot = (version: string) =>
      db.query(
        `select s.key as section, s.title, s.kind::text as kind, s.sort_order as s_order, f.key, f.label, f.help_text,
                f.field_type::text as type, f.is_required, f.is_system, f.options, f.validation, f.sort_order
         from public.template_sections s left join public.template_fields f on f.section_id = s.id
         where s.template_version_id = $1 order by s.sort_order, f.sort_order`,
        [version],
      );
    expect(await snapshot(draft)).toEqual(await snapshot(SEED.template.v1));
    expect(await db.count("select 1 from public.template_fields where template_version_id = $1", [draft])).toBe(23);
    // Fields point at the draft's own sections.
    expect(
      await db.count(
        `select 1 from public.template_fields f join public.template_sections s on s.id = f.section_id
         where f.template_version_id = $1 and s.template_version_id <> $1`,
        [draft],
      ),
    ).toBe(0);
    expect(await createDraft(superAdmin)).toBe(draft);
    await expectDenied(createDraft(partner), "Only Super Admins and Fund Admins can edit templates.");
    await expectRule(createDraft(fundAdmin, "00000000-0000-4000-8000-000000000001"), "That template was not found.");
  });

  it("drafts can be edited, within the system field and section rules", async () => {
    const draft = await createDraft();
    const revenue = await fieldOf(draft, "revenue_total");
    const financials = await sectionOf(draft, "financials");
    const operation = await sectionOf(draft, "operation");
    await db.asUser(fundAdmin, async (sql) => {
      await sql.query("update public.template_fields set label = 'Revenue (total)', help_text = 'All revenue', sort_order = 9 where id = $1", [
        revenue,
      ]);
      await sql.query("update public.template_sections set title = 'Money', sort_order = 20 where id = $1", [financials]);
      await sql.query("update public.template_fields set is_required = true where template_version_id = $1 and key = 'key_milestones'", [
        draft,
      ]);
    });
    const change = (statement: string, params: unknown[] = []) => db.asUser(fundAdmin, (sql) => sql.query(statement, params));
    const SYSTEM_RULE = "System fields keep their key and type. You can change the label, help text and order.";
    await expectRule(change("update public.template_fields set key = 'revenue' where id = $1", [revenue]), SYSTEM_RULE);
    await expectRule(change("update public.template_fields set field_type = 'number' where id = $1", [revenue]), SYSTEM_RULE);
    await expectRule(change("update public.template_fields set is_system = false where id = $1", [revenue]), SYSTEM_RULE);
    await expectRule(change("delete from public.template_fields where id = $1", [revenue]), '"Revenue (total)" is a system field and cannot be deleted.');
    await expectRule(change("delete from public.template_sections where id = $1", [financials]), 'The "Money" section is a system section and cannot be deleted.');
    await expectRule(
      change("delete from public.template_sections where template_version_id = $1 and key = 'kpis'", [draft]),
      'The "Company KPIs" section is a system section and cannot be deleted.',
    );
    await expectRule(change("update public.template_sections set kind = 'narrative' where id = $1", [financials]), "The type of a system section cannot be changed.");
    await expectRule(
      change("update public.template_fields set is_system = true where template_version_id = $1 and key = 'key_milestones'", [draft]),
      "Only the built-in financial and headcount fields can be system fields.",
    );
    await expectRule(
      change(
        "insert into public.template_fields (template_version_id, section_id, key, label, field_type) values ($1, $2, 'headcount_ft', 'Staff', 'integer')",
        [draft, operation],
      ),
      'The key "headcount_ft" is reserved for a system field.',
    );
    await expectRule(
      change(
        "insert into public.template_fields (template_version_id, section_id, key, label, field_type) values ($1, $2, 'extra', 'Extra', 'text')",
        [draft, SEED.sections.operation],
      ),
      "The section belongs to a different template version.",
    );
    await expectPgError(
      change("insert into public.template_sections (template_version_id, key, title, kind) values ($1, 'more_money', 'More money', 'financials')", [draft]),
      { code: "23505" },
    );
    await expectPgError(
      change("insert into public.template_sections (template_version_id, key, title, kind) values ($1, 'Bad Key', 'Bad', 'narrative')", [draft]),
      { code: "23514" },
    );

    // Custom sections and fields come and go freely.
    const custom = await db.asUser(fundAdmin, (sql) =>
      sql.value<string>(
        "insert into public.template_sections (template_version_id, key, title, kind, sort_order) values ($1, 'unit_economics', 'Unit economics', 'custom_numbers', 14) returning id",
        [draft],
      ),
    );
    await db.asUser(fundAdmin, (sql) =>
      sql.query(
        `insert into public.template_fields (template_version_id, section_id, key, label, field_type, is_required, validation)
         values ($1, $2, 'cac', 'Customer acquisition cost', 'currency', true, '{"min": 0}')`,
        [draft, custom],
      ),
    );
    await db.asUser(fundAdmin, (sql) => sql.query("delete from public.template_sections where id = $1", [operation]));
    // Deleting the Operation section removed its two fields; three highlights fields remain elsewhere.
    expect(await db.count("select 1 from public.template_fields where template_version_id = $1 and key like '%highlights'", [draft])).toBe(3);
    // Non-admins cannot edit drafts either.
    expect(await db.asUser(partner, (sql) => sql.query("update public.template_fields set label = 'X' returning id"))).toEqual([]);
  });

  it("publishing archives the previous version; opened months keep their version", async () => {
    await db.setToday("2026-09-02");
    await db.rpc("open_due_periods");
    const draft = await createDraft();
    await publish(draft);
    const versions = await db.query("select version_no, status::text as status, published_by from public.template_versions order by version_no");
    expect(versions).toEqual([
      { version_no: 1, status: "archived", published_by: null },
      { version_no: 2, status: "published", published_by: fundAdmin },
    ]);
    // Archived versions are immutable too.
    await expectRule(db.query("update public.template_fields set label = 'X' where id = $1", [SEED.fields.revenue_total]), IMMUTABLE);
    await expectRule(publish(draft), "Only draft versions can be published.");
    await expectDenied(publish(SEED.template.v1, partner), "Only Super Admins and Fund Admins can publish templates.");
    expect(await db.count("select 1 from public.submissions where template_version_id = $1", [SEED.template.v1])).toBe(6);
    await db.setToday("2026-10-02");
    await db.rpc("open_due_periods");
    expect(await db.count("select 1 from public.submissions where template_version_id = $1", [draft])).toBe(3);
    // A new draft now starts from v2.
    const v3 = await createDraft();
    expect(await db.value("select version_no from public.template_versions where id = $1", [v3])).toBe(3);
  });

  it("status only changes through publish_template_version(), and only drafts can be deleted", async () => {
    const draft = await createDraft();
    await expectDenied(
      db.asUser(fundAdmin, (sql) => sql.query("update public.template_versions set status = 'published' where id = $1", [draft])),
      /permission denied/,
    );
    await db.asUser(fundAdmin, (sql) => sql.query("update public.template_versions set notes = 'Adds CAC' where id = $1", [draft]));
    expect(
      await db.asUser(superAdmin, (sql) => sql.query("delete from public.template_versions where id = $1 returning id", [SEED.template.v1])),
    ).toEqual([]);
    await expectRule(db.query("delete from public.template_versions where id = $1", [SEED.template.v1]), "Published and archived template versions cannot be deleted.");
    expect(await db.asUser(fundAdmin, (sql) => sql.query("delete from public.template_versions where id = $1 returning id", [draft]))).toEqual([
      { id: draft },
    ]);
  });

  it("new templates start with an empty draft that needs every system field before publishing", async () => {
    const template = await db.asUser(fundAdmin, (sql) =>
      sql.value<string>("insert into public.templates (name, description) values ('Board pack', 'Quarterly') returning id"),
    );
    // Direct inserts are forced to drafts with the next version number.
    const direct = await db.asUser(fundAdmin, (sql) =>
      sql.one<{ id: string; version_no: number; status: string }>(
        "insert into public.template_versions (template_id, version_no, status) values ($1, 7, 'published') returning id, version_no, status::text",
        [template],
      ),
    );
    expect(direct).toMatchObject({ version_no: 1, status: "draft" });
    expect(await createDraft(fundAdmin, template)).toBe(direct.id);
    await expectRule(
      publish(direct.id),
      "This draft is missing required system fields: revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt.",
    );
    // A template without a published version cannot become the default …
    await expectRule(
      db.asUser(fundAdmin, (sql) => sql.query("update public.templates set is_default = true where id = $1", [template])),
      "Publish a version of this template before making it the default.",
    );
    // … and the partial unique index still allows only one default.
    await expectPgError(db.query("insert into public.templates (name, is_default) values ('Second default', true)"), { code: "23505" });
    await expectDenied(
      db.asUser(partner, (sql) => sql.query("insert into public.templates (name) values ('Nope')")),
      /row-level security/,
    );
  });

  it("the default template always has a published version and is switched in one step", async () => {
    const setDefault = (user: string, templateId: string, value = true) =>
      db.asUser(user, (sql) => sql.query("update public.templates set is_default = $2 where id = $1", [templateId, value]));
    const NEEDS_VERSION = "Publish a version of this template before making it the default.";
    const boardPack = await db.asUser(fundAdmin, (sql) =>
      sql.value<string>("insert into public.templates (name) values ('Board pack') returning id"),
    );
    await expectRule(setDefault(fundAdmin, boardPack), NEEDS_VERSION);
    await expectRule(
      db.asUser(superAdmin, (sql) => sql.query("insert into public.templates (name, is_default) values ('Other', true)")),
      NEEDS_VERSION,
    );
    await expectRule(
      setDefault(superAdmin, SEED.template.id, false),
      "There must always be a default template. Make another template the default instead.",
    );

    // Give Board pack a published version (a copy of v1's sections and fields).
    const draft = await createDraft(fundAdmin, boardPack);
    await db.query(
      `insert into public.template_sections (template_version_id, key, title, kind, sort_order)
       select $1, key, title, kind, sort_order from public.template_sections where template_version_id = $2`,
      [draft, SEED.template.v1],
    );
    await db.query(
      `insert into public.template_fields (template_version_id, section_id, key, label, field_type, is_required, is_system, options, validation, sort_order)
       select $1, ns.id, f.key, f.label, f.field_type, f.is_required, f.is_system, f.options, f.validation, f.sort_order
       from public.template_fields f
       join public.template_sections os on os.id = f.section_id
       join public.template_sections ns on ns.template_version_id = $1 and ns.key = os.key
       where f.template_version_id = $2`,
      [draft, SEED.template.v1],
    );
    await publish(draft);

    // One statement switches the default; the previous default steps down (both changes audited).
    const start = await db.value<number>("select max(id)::int from public.audit_log");
    await setDefault(fundAdmin, boardPack);
    expect(await db.query("select name, is_default from public.templates order by name")).toEqual([
      { name: "Board pack", is_default: true },
      { name: "Portfolio Update", is_default: false },
    ]);
    expect(
      await db.query("select entity_id, new_data from public.audit_log where id > $1 and entity = 'templates' order by id", [start]),
    ).toEqual([
      { entity_id: SEED.template.id, new_data: { is_default: false } },
      { entity_id: boardPack, new_data: { is_default: true } },
    ]);
    // New months use the new default's published version.
    await db.setToday("2026-08-03");
    await db.rpc("open_due_periods");
    expect(await db.value("select template_version_id from public.reporting_periods where month = '2026-07-01'")).toBe(draft);
    // Switching back works the same way; partners cannot switch at all.
    expect(await db.asUser(partner, (sql) => sql.query("update public.templates set is_default = true where id = $1 returning id", [SEED.template.id]))).toEqual([]);
    await setDefault(superAdmin, SEED.template.id);
    expect(await db.value("select name from public.templates where is_default")).toBe("Portfolio Update");
  });

  it("keeps system fields in their Financials / Headcount section", async () => {
    const draft = await createDraft();
    const change = (statement: string, params: unknown[]) => db.asUser(fundAdmin, (sql) => sql.query(statement, params));
    const move = (key: string, sectionKey: string) =>
      change(
        `update public.template_fields set section_id = (select id from public.template_sections where template_version_id = $1 and key = $3)
         where template_version_id = $1 and key = $2`,
        [draft, key, sectionKey],
      );
    await expectRule(move("revenue_total", "company_summary"), "System fields must stay in the Financials section.");
    await expectRule(move("gross_profit", "headcount"), "System fields must stay in the Financials section.");
    await expectRule(move("headcount_ft", "financials"), "System fields must stay in the Headcount section.");
    await expectRule(move("headcount_pt", "founder_pulse"), "System fields must stay in the Headcount section.");
    // Relabelling and reordering within the section still work.
    await change("update public.template_fields set label = 'Revenue', sort_order = 9 where template_version_id = $1 and key = 'revenue_total'", [draft]);
    await move("revenue_total", "financials");
  });
});
