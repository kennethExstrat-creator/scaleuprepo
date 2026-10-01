import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findTransactionControl } from "../../scripts/sql-transaction-control";
import { fundInvestmentId, PILOT_COMPANY_IDS, PORTFOLIO, SEED, SYSTEM_FIELD_KEYS } from "./fixtures";
import { freshDb, type TestDb } from "./harness";
import {
  createMigratedDatabase,
  migrationVersion,
  planMigrations,
  readMigrations,
  readSeed,
  runSqlFile,
  statementsMatchFile,
} from "./schema";

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});

afterAll(async () => {
  await db?.close();
});

/** Tables whose rows are written only by security definer RPCs / triggers. */
const RPC_ONLY_TABLES = [
  "profiles",
  "reporting_periods",
  "submissions",
  "submission_values",
  "submission_segment_values",
  "submission_kpi_values",
  "submission_events",
  "period_closes",
  "audit_log",
];

/** Private helpers the authenticated role needs for RLS policies, views and storage policies. */
const AUTHENTICATED_HELPERS = [
  "can_edit_submission",
  "can_upload_company_document",
  "can_upload_document_object",
  "can_view_company",
  "company_role",
  "dimension_company",
  "has_role",
  "is_active_company",
  "is_active_user",
  "is_company_member",
  "is_company_user",
  "is_partner_of",
  "is_scaleup",
  "mfa_ok",
  "scaleup_role",
  "shares_company_with",
  "submission_company",
  "template_version_is_draft",
  "today_myt",
  "try_uuid",
];

/**
 * The migrations deployed to the Supabase project (sha256 of each file): the 20260930… files on 30 Sep
 * 2026, 20261001000100 (BRD B28, B29) on 1 Oct 2026. `db push` never applies a recorded version again, so
 * an edit would silently never reach the database: changes go in a NEW migration file (supabase/README.md).
 */
const DEPLOYED_MIGRATIONS: Record<string, string> = {
  "20260930000100_schema.sql": "7c8734c3b3add6daebccce9e9a5e73332a6c2419282ee4a440195aae2e0dfbe1",
  "20260930000200_helpers.sql": "9796ec88d4170fc85daac92b0cccfa260168601b43572ad640e00c93bb7b7499",
  "20260930000300_audit.sql": "0cff8a0fcd2a219a19b0beed17832ad8f52544b3178c9a1ebbf47cfdf984eb2e",
  "20260930000400_rls.sql": "c0e6e4915925a2d03c4bfa08f25be3e3555ad31765448fe454844b8dbddc10c7",
  "20260930000500_rpc.sql": "0f6a98d018b3f4c58d1a084c7a94772eec068ae6b4590c381189388398eeb364",
  "20260930000600_views.sql": "89799bf9b28af7b9ad23c7bcbf51621f384e15421d1d0299af1b6352c477da31",
  "20260930000700_storage.sql": "0d32976ca9916169916019cabd9d38d19856ef22813cf4f0c55f0c14b5a79d89",
  "20260930000800_grants.sql": "e8e6a19176dce90953e03e00458abbf2851a307ba9ce292d0d0c5d682d2dad04",
  "20260930000900_cron.sql": "c68fcd8a6ab807ab3321a39120d503438e157d84f5e1f26cb0bc488607a486c4",
  "20261001000100_decisions_b28_b29.sql": "dc2d835487a7083f0c5796d372aafe86fc4bdb37867d2b973b7dcc96cd4e971b",
};

describe("migrations", () => {
  it("apply cleanly in filename order on a fresh database, and the seed is idempotent", async () => {
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(10);
    expect(migrations.map((m) => m.name)).toEqual([...migrations.map((m) => m.name)].sort());
    for (const m of migrations) expect(m.name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);

    const pg = await createMigratedDatabase({ seed: true });
    try {
      const before = await pg.query<{ n: number }>(
        `select (select count(*) from public.template_fields)::int
              + (select count(*) from public.companies)::int
              + (select count(*) from public.company_kpis)::int
              + (select count(*) from public.funds)::int as n`,
      );
      await runSqlFile(pg, readSeed()); // second run changes nothing
      const after = await pg.query<{ n: number }>(
        `select (select count(*) from public.template_fields)::int
              + (select count(*) from public.companies)::int
              + (select count(*) from public.company_kpis)::int
              + (select count(*) from public.funds)::int as n`,
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      // pg_cron is not available in PGlite: the cron migration is a no-op.
      const cron = await pg.query("select 1 from pg_extension where extname = 'pg_cron'");
      expect(cron.rows).toHaveLength(0);
    } finally {
      await pg.close();
    }
  });

  it("never change once deployed: new database changes go in new files, later than the deployed ones", () => {
    const migrations = readMigrations();
    const hashes = Object.fromEntries(
      migrations
        .filter((m) => m.name in DEPLOYED_MIGRATIONS)
        .map((m) => [m.name, createHash("sha256").update(m.sql).digest("hex")]),
    );
    expect(hashes).toEqual(DEPLOYED_MIGRATIONS);
    const lastDeployed = Object.keys(DEPLOYED_MIGRATIONS).sort().at(-1) ?? "";
    for (const m of migrations.filter((file) => !(file.name in DEPLOYED_MIGRATIONS))) {
      expect(m.name > lastDeployed, `${m.name} must sort after ${lastDeployed}`).toBe(true);
    }
  });

  it("uses UTC sessions like Supabase", async () => {
    expect(await db.value("show timezone")).toBe("UTC");
  });

  it("contain no top-level transaction control (db push wraps each file; db:verify replays all in one rolled-back transaction)", () => {
    // A COMMIT / END in a file would commit `npm run db:verify`'s dry run part-way through on the real
    // database (and a ROLLBACK would let what follows autocommit). db-verify refuses such files too.
    const found = [...readMigrations(), readSeed()].flatMap((file) =>
      findTransactionControl(file.sql).map((t) => `${file.name}:${t.line} ${t.statement}`),
    );
    expect(found).toEqual([]);
  });
});

describe("db:verify against a deployed database (scripts/db-verify.ts)", () => {
  const file = (name: string, sql = "select 1;") => ({ name, sql });
  const names = (files: { name: string }[]) => files.map((f) => f.name);

  it("replays only the migrations the database has not recorded, in order", () => {
    const files = [file("20260930000100_schema.sql"), file("20260930000200_helpers.sql"), file("20261001000100_decisions.sql")];
    expect(migrationVersion("20261001000100_decisions.sql")).toBe("20261001000100");
    expect(planMigrations(files, [])).toEqual({ deployed: [], pending: files, unknown: [], outOfOrder: [] });
    const plan = planMigrations(files, ["20260930000200", "20260930000100"]);
    expect(names(plan.deployed)).toEqual(["20260930000100_schema.sql", "20260930000200_helpers.sql"]);
    expect(names(plan.pending)).toEqual(["20261001000100_decisions.sql"]);
    expect(plan.unknown).toEqual([]);
    expect(plan.outOfOrder).toEqual([]);
    // A version recorded by another checkout (db push refuses to run), and a file older than what is deployed.
    const odd = planMigrations([file("20260930000100_schema.sql"), file("20260930000150_late.sql")], [
      "20260930000100",
      "20260930000200",
    ]);
    expect(odd.unknown).toEqual(["20260930000200"]);
    expect(names(odd.outOfOrder)).toEqual(["20260930000150_late.sql"]);
    // This repository: everything up to 20261001000100 is deployed; the B30 migration is pending.
    const repo = planMigrations(readMigrations(), Object.keys(DEPLOYED_MIGRATIONS).map(migrationVersion));
    expect(repo.pending.map((m) => m.name)).toContain("20261001000200_revenue_segments_b30.sql");
    expect(repo.deployed).toHaveLength(10);
    expect([repo.unknown, repo.outOfOrder]).toEqual([[], []]);
  });

  it("recognises a deployed file from the statements db push recorded, ignoring whitespace and semicolons", () => {
    const sql = [
      "-- header",
      "create table t (id int);",
      "",
      "create function f() returns int language plpgsql as $$ begin return 1; end; $$;",
      "",
    ].join("\n");
    const recorded = ["-- header\ncreate table t (id int)", "create function f() returns int language plpgsql as $$ begin return 1; end; $$"];
    expect(statementsMatchFile(recorded, sql)).toBe(true);
    expect(statementsMatchFile(recorded, sql.replace("id int", "id bigint"))).toBe(false);
    expect(statementsMatchFile(recorded.slice(1), sql)).toBe(false);
  });
});

describe("row level security and privileges", () => {
  it("enables RLS on every public table (and storage.objects)", async () => {
    const missing = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(missing).toEqual([]);
    const tables = await db.count(
      "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    expect(tables).toBe(27);
    expect(await db.value("select relrowsecurity from pg_class where oid = 'storage.objects'::regclass")).toBe(true);
  });

  it("gives anon no privilege on any public table, view, sequence or function", async () => {
    const relations = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
         and has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(relations).toEqual([]);
    const sequences = await db.query(
      `select s.relname
       from (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'S' offset 0) as s
       where has_sequence_privilege('anon', s.oid, 'USAGE, SELECT, UPDATE')`,
    );
    expect(await db.count("select 1 from pg_class c where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace")).toBe(2);
    expect(sequences).toEqual([]);
    const functions = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(functions).toEqual([]);
    expect(await db.value("select has_schema_privilege('anon', 'private', 'USAGE')")).toBe(false);
  });

  it("never lets PUBLIC execute a public or private function", async () => {
    const rows = await db.query<{ proname: string }>(
      `select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and (p.proacl is null or exists (
           select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps RPC-written tables read-only for authenticated", async () => {
    for (const table of RPC_ONLY_TABLES) {
      const privileges = await db.value<string[]>(
        `select array_agg(p) filter (where has_table_privilege('authenticated', $1::regclass, p))
         from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p`,
        [`public.${table}`],
      );
      expect(privileges, table).toBeNull();
      expect(await db.value("select has_table_privilege('authenticated', $1::regclass, 'SELECT')", [`public.${table}`]), table).toBe(
        true,
      );
    }
    // Template versions: only the notes column is updatable (status changes go through publish).
    expect(await db.value("select has_column_privilege('authenticated', 'public.template_versions', 'status', 'UPDATE')")).toBe(false);
    expect(await db.value("select has_column_privilege('authenticated', 'public.template_versions', 'notes', 'UPDATE')")).toBe(true);
    // Comments / documents are append-only; companies are deleted through delete_company().
    for (const [table, privilege] of [
      ["comments", "UPDATE"],
      ["comments", "DELETE"],
      ["documents", "UPDATE"],
      ["documents", "DELETE"],
      ["companies", "DELETE"],
    ]) {
      expect(await db.value("select has_table_privilege('authenticated', $1::regclass, $2)", [`public.${table}`, privilege])).toBe(
        false,
      );
    }
  });

  it("keeps objects created by later migrations closed to anon and authenticated until they are granted", async () => {
    await db.pg.transaction(async (tx) => {
      await tx.exec(`
        create table public.zz_future_table (id int primary key);
        create sequence public.zz_future_seq;
        create function public.zz_future_rpc() returns int language sql as 'select 1';
        create function private.zz_future_helper() returns int language sql as 'select 1';
      `);
      const check = async (sql: string) => (await tx.query<{ ok: boolean }>(sql)).rows[0].ok;
      for (const role of ["anon", "authenticated"]) {
        expect(
          await check(`select has_table_privilege('${role}', 'public.zz_future_table', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as ok`),
          `${role} on a new table`,
        ).toBe(false);
        expect(await check(`select has_sequence_privilege('${role}', 'public.zz_future_seq', 'USAGE, SELECT, UPDATE') as ok`), role).toBe(false);
        expect(await check(`select has_function_privilege('${role}', 'public.zz_future_rpc()', 'EXECUTE') as ok`), role).toBe(false);
        expect(await check(`select has_function_privilege('${role}', 'private.zz_future_helper()', 'EXECUTE') as ok`), role).toBe(false);
      }
      // Nothing reaches them through PUBLIC either; service_role keeps Supabase's default access.
      expect(
        await check(`select not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname like 'zz_future_%' and a.grantee = 0) as ok`),
      ).toBe(true);
      expect(await check("select has_table_privilege('service_role', 'public.zz_future_table', 'SELECT, INSERT, UPDATE, DELETE') as ok")).toBe(true);
      expect(await check("select has_function_privilege('service_role', 'public.zz_future_rpc()', 'EXECUTE') as ok")).toBe(true);
      await tx.rollback();
    });
    expect(await db.value("select has_table_privilege('authenticated', 'private.seed_markers', 'SELECT')")).toBe(false);
  });

  it("never grants TRUNCATE, REFERENCES or TRIGGER to authenticated", async () => {
    const rows = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it("lets authenticated execute every public RPC (but the service-role-only claim_access_link) and only the policy helpers in private", async () => {
    const privateFns = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`,
    );
    expect(privateFns.map((r) => r.proname)).toEqual(AUTHENTICATED_HELPERS);
    const publicFns = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    );
    // Access links are claimed by server code with the secret key only (BRD B14).
    expect(publicFns).toEqual([{ proname: "claim_access_link" }]);
    expect(await db.value("select has_function_privilege('service_role', 'public.claim_access_link(text)', 'EXECUTE')")).toBe(true);
  });

  it("pins search_path = '' on every security definer function", async () => {
    const rows = await db.query<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not coalesce(p.proconfig @> array['search_path=""'], false)`,
    );
    expect(rows).toEqual([]);
    const definers = await db.count(
      "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef",
    );
    expect(definers).toBeGreaterThanOrEqual(21);
  });

  it("creates only security_invoker views", async () => {
    const views = await db.query<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' order by 1`,
    );
    expect(views.map((v) => v.relname)).toEqual(["v_submission_financials", "v_submission_overview"]);
    for (const view of views) expect(view.reloptions).toContain("security_invoker=true");
  });

  it("gives service_role full access, except that the audit log stays append-only", async () => {
    const missing = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
         and not has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
    );
    expect(missing).toEqual([]);
    expect(await db.value("select has_table_privilege('service_role', 'public.audit_log', 'SELECT, INSERT')")).toBe(true);
    expect(await db.value("select has_table_privilege('service_role', 'public.audit_log', 'UPDATE')")).toBe(false);
    expect(await db.value("select has_table_privilege('service_role', 'public.audit_log', 'DELETE')")).toBe(false);
    expect(await db.value("select has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE')")).toBe(false);
    expect(await db.value("select rolbypassrls from pg_roles where rolname = 'service_role'")).toBe(true);
  });

  it("indexes every foreign key (leading index columns)", async () => {
    const unindexed = await db.query<{ conname: string }>(
      `select c.conname
       from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where n.nspname = 'public' and c.contype = 'f'
         and not exists (
           select 1 from pg_index i
           where i.indrelid = c.conrelid
             and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey
         )`,
    );
    expect(unindexed).toEqual([]);
  });

  it("has the requested query indexes", async () => {
    const defs = (await db.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public'")).map(
      (r) => r.indexdef,
    );
    const has = (pattern: RegExp) => defs.some((d) => pattern.test(d));
    expect(has(/ON public\.submissions USING btree \(company_id, month\)/)).toBe(true);
    expect(has(/ON public\.comments USING btree \(submission_id\)/)).toBe(true);
    expect(has(/ON public\.audit_log USING btree \(company_id, occurred_at DESC\)/)).toBe(true);
    expect(has(/ON public\.audit_log USING btree \(occurred_at DESC\)/)).toBe(true);
    expect(has(/ON public\.audit_log USING btree \(entity, entity_id\)/)).toBe(true);
    expect(has(/ON public\.documents USING btree \(company_id\)/)).toBe(true);
  });
});

describe("seed", () => {
  it("creates the settings singleton with the contract defaults", async () => {
    const settings = await db.one("select * from public.platform_settings");
    expect(settings).toMatchObject({
      id: 1,
      due_day: 15,
      escalation_days: 14,
      backfill_grace_days: 14,
      revenue_swing_pct: 30,
      min_runway_months: 6,
      require_mfa: true,
      default_reporting_start: "2026-07-01",
      declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
      terms_version: "2026-09",
    });
  });

  it("creates the SV1 and SFF funds", async () => {
    const funds = await db.query("select id, code, name, is_active from public.funds order by code desc");
    expect(funds).toEqual([
      { id: SEED.funds.SV1, code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd", is_active: true },
      { id: SEED.funds.SFF, code: "SFF", name: "ScaleUp Founders Fund LP", is_active: true },
    ]);
  });

  it("publishes the default Portfolio Update template v1", async () => {
    const template = await db.one("select id, name, is_default from public.templates");
    expect(template).toEqual({ id: SEED.template.id, name: "Portfolio Update", is_default: true });
    const version = await db.one<{ id: string; version_no: number; status: string; published_at: string | null }>(
      "select id, version_no, status::text, published_at from public.template_versions",
    );
    expect(version).toMatchObject({ id: SEED.template.v1, version_no: 1, status: "published" });
    expect(version.published_at).not.toBeNull();
  });

  it("has the 13 sections of §3 in order", async () => {
    const sections = await db.query("select key, title, kind::text as kind, sort_order from public.template_sections order by sort_order");
    expect(sections).toEqual([
      { key: "financials", title: "Financials", kind: "financials", sort_order: 1 },
      { key: "headcount", title: "Headcount", kind: "headcount", sort_order: 2 },
      { key: "kpis", title: "Company KPIs", kind: "kpis", sort_order: 3 },
      { key: "company_summary", title: "Company Summary", kind: "narrative", sort_order: 4 },
      { key: "revenue_financial", title: "Revenue and Financial Metrics", kind: "narrative", sort_order: 5 },
      { key: "partnerships_market", title: "Partnerships and Market Updates", kind: "narrative", sort_order: 6 },
      { key: "operation", title: "Operation", kind: "narrative", sort_order: 7 },
      { key: "product_development", title: "Product Development", kind: "narrative", sort_order: 8 },
      { key: "customer_acquisition", title: "Customer Acquisition Strategies", kind: "narrative", sort_order: 9 },
      { key: "investment", title: "Investment", kind: "narrative", sort_order: 10 },
      { key: "compliance_regulation", title: "Compliance and Regulation", kind: "narrative", sort_order: 11 },
      { key: "other_mentionables", title: "Other Mentionables", kind: "narrative", sort_order: 12 },
      { key: "founder_pulse", title: "Founder Pulse", kind: "pulse", sort_order: 13 },
    ]);
    const ids = await db.query<{ key: string; id: string }>("select key, id from public.template_sections");
    for (const row of ids) expect(row.id).toBe(SEED.sections[row.key as keyof typeof SEED.sections]);
  });

  it("has every field of §3 with its type, flags, options and validation", async () => {
    const fields = await db.query<Record<string, unknown>>(
      `select f.id, s.key as section, f.key, f.label, f.help_text, f.field_type::text as type, f.is_required, f.is_system,
              f.options, f.validation
       from public.template_fields f join public.template_sections s on s.id = f.section_id
       order by s.sort_order, f.sort_order`,
    );
    const byKey = Object.fromEntries(fields.map((f) => [f.key as string, f]));
    expect(fields.map((f) => f.key)).toEqual([
      "revenue_total",
      "gross_profit",
      "net_profit",
      "cash_in_bank",
      "burn_rate",
      "headcount_ft",
      "headcount_pt",
      "key_milestones",
      "financial_commentary",
      "partnerships",
      "operations_highlights",
      "team_highlights",
      "product_highlights",
      "sales_highlights",
      "marketing_highlights",
      "fundraising_status",
      "fundraising_commentary",
      "compliance_updates",
      "other_updates",
      "team_morale",
      "next_month_goals",
      "help_needed",
      "help_tags",
    ]);
    for (const f of fields) expect(f.id).toBe(SEED.fields[f.key as keyof typeof SEED.fields]);

    // System fields: required + system; GP/NP may be negative; burn has help text.
    for (const key of SYSTEM_FIELD_KEYS) {
      expect(byKey[key]).toMatchObject({ is_required: true, is_system: true });
    }
    expect(byKey.revenue_total).toMatchObject({ section: "financials", label: "Total revenue", type: "currency" });
    expect(byKey.gross_profit).toMatchObject({ label: "Gross profit", type: "currency", validation: { allow_negative: true } });
    expect(byKey.net_profit).toMatchObject({ label: "Net profit", type: "currency", validation: { allow_negative: true } });
    expect(byKey.cash_in_bank).toMatchObject({ label: "Cash in bank (month end)", type: "currency" });
    expect(byKey.burn_rate).toMatchObject({
      label: "Burn rate (per month)",
      type: "currency",
      help_text: "Enter 0 if cash-flow positive",
    });
    expect(byKey.headcount_ft).toMatchObject({ section: "headcount", label: "Full-time headcount", type: "integer" });
    expect(byKey.headcount_pt).toMatchObject({ section: "headcount", label: "Part-time headcount", type: "integer" });

    // Narrative and pulse fields are optional and not system fields.
    for (const f of fields.filter((x) => !SYSTEM_FIELD_KEYS.includes(x.key as never))) {
      expect(f, f.key as string).toMatchObject({ is_required: false, is_system: false });
    }
    expect(byKey.key_milestones).toMatchObject({ section: "company_summary", label: "Key milestones", type: "long_text" });
    expect(byKey.financial_commentary).toMatchObject({
      section: "revenue_financial",
      label: "Commentary on the month's numbers",
      type: "long_text",
    });
    expect(byKey.partnerships).toMatchObject({ section: "partnerships_market", label: "Partnerships and market updates" });
    expect(byKey.operations_highlights).toMatchObject({ section: "operation", label: "Operations highlights" });
    expect(byKey.team_highlights).toMatchObject({ section: "operation", label: "Team highlights" });
    expect(byKey.product_highlights).toMatchObject({ section: "product_development", label: "Product highlights" });
    expect(byKey.sales_highlights).toMatchObject({ section: "customer_acquisition", label: "Sales highlights" });
    expect(byKey.marketing_highlights).toMatchObject({ section: "customer_acquisition", label: "Marketing highlights" });
    expect(byKey.fundraising_status).toMatchObject({
      section: "investment",
      label: "Fundraising status",
      type: "picklist",
      options: {
        options: ["Not raising", "Preparing to raise", "Actively raising", "Term sheet received", "Closing round", "Round closed"],
      },
    });
    expect(byKey.fundraising_commentary).toMatchObject({ section: "investment", label: "Fundraising commentary", type: "long_text" });
    expect(byKey.compliance_updates).toMatchObject({
      section: "compliance_regulation",
      label: "Licences and regulatory matters",
    });
    expect(byKey.other_updates).toMatchObject({ section: "other_mentionables", label: "Anything else" });
    expect(byKey.team_morale).toMatchObject({
      section: "founder_pulse",
      label: "Team morale",
      type: "rating",
      options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } },
    });
    expect(byKey.next_month_goals).toMatchObject({ section: "founder_pulse", label: "Next month goals", type: "long_text" });
    expect(byKey.help_needed).toMatchObject({ section: "founder_pulse", label: "Help needed from ScaleUp", type: "long_text" });
    expect(byKey.help_tags).toMatchObject({
      section: "founder_pulse",
      label: "Help needed (tags)",
      type: "tags",
      options: {
        options: [
          "Fundraising",
          "Hiring",
          "Sales introductions",
          "Partnerships",
          "Legal and regulatory",
          "Finance",
          "Product and technology",
          "Marketing",
          "Other",
        ],
      },
    });
    // The KPI section renders company KPIs: it has no template fields.
    expect(await db.count("select 1 from public.template_fields where section_id = $1", [SEED.sections.kpis])).toBe(0);
  });

  it("loads the launch portfolio (BRD Appendix A): 18 companies, the pilot reporting from July 2026", async () => {
    const companies = await db.query<Record<string, unknown>>(
      `select id, name, legal_name, country, reporting_currency, status::text as status, status_reason,
              status_changed_at is not null as status_changed, description, reporting_start_month, sector
       from public.companies order by id`,
    );
    expect(companies.map((c) => [c.id, c.name])).toEqual(PORTFOLIO.map((c) => [c.id, c.name]));
    const byName = Object.fromEntries(companies.map((c) => [c.name as string, c]));
    // The pilot reports from July 2026; everyone else is "Not yet reporting" (BRD B16).
    for (const c of companies) {
      const pilot = (PILOT_COMPANY_IDS as readonly string[]).includes(c.id as string);
      expect(c.reporting_start_month, c.name as string).toBe(pilot ? "2026-07-01" : null);
      expect(c.sector, c.name as string).toBeNull();
    }
    // Defaults: Malaysian, MYR, active, no legal name.
    const plain = companies.filter((c) => !["StayHere", "i-Motorbike", "AOne", "Buzz"].includes(c.name as string));
    expect(plain).toHaveLength(14);
    for (const c of plain) {
      expect(c, c.name as string).toMatchObject({
        legal_name: null,
        country: "Malaysia",
        reporting_currency: "MYR",
        status: "active",
        status_reason: null,
        status_changed: false,
        description: null,
      });
    }
    expect(byName.AOne).toMatchObject({ status: "active", description: "Formerly AOne Schools." });
    expect(byName.Buzz).toMatchObject({ status: "active", description: "Formerly BeeBag." });
    expect(byName.StayHere).toMatchObject({
      status: "written_off",
      status_changed: true,
      status_reason: "Fully impaired and written down; voluntary strike-off in progress (H1 2026 SFF report).",
      reporting_currency: "MYR",
    });
    expect(byName["i-Motorbike"]).toMatchObject({
      legal_name: "iMotorbike Pte Ltd",
      country: "Singapore",
      reporting_currency: "USD",
      status: "active",
      description: "Reports in USD (H1 2026 SFF report).",
    });
    // Every company has its ScaleUp-internal row, with no partner-in-charge yet (no users are seeded).
    expect(await db.count("select 1 from public.company_internal")).toBe(18);
    expect(await db.count("select 1 from public.company_internal where partner_in_charge_id is not null")).toBe(0);
  });

  it("maps every company to its fund (SV1 7, SFF 11), without investment details yet", async () => {
    const investments = await db.query<{ id: string; fund: string; company_id: string }>(
      `select fi.id, f.code as fund, fi.company_id from public.fund_investments fi join public.funds f on f.id = fi.fund_id
        order by fi.company_id`,
    );
    expect(investments).toEqual(PORTFOLIO.map((c) => ({ id: fundInvestmentId(c.id), fund: c.fund, company_id: c.id })));
    expect(investments.filter((i) => i.fund === "SV1")).toHaveLength(7);
    expect(investments.filter((i) => i.fund === "SFF")).toHaveLength(11);
    expect(
      await db.count("select 1 from public.fund_investments where investment_date is not null or instrument is not null or ownership_pct is not null"),
    ).toBe(0);
  });

  it("configures the Batik Boutique outlet dimension and per-outlet KPIs", async () => {
    expect(await db.one("select id, company_id, name from public.kpi_dimensions")).toEqual({
      id: SEED.dimensions.batikOutlet,
      company_id: SEED.companies.batikBoutique,
      name: "Outlet",
    });
    const outlets = await db.query("select id, name, is_active from public.kpi_dimension_members order by sort_order");
    expect(outlets).toEqual([
      { id: SEED.outlets.montKiara, name: "Mont Kiara", is_active: true },
      { id: SEED.outlets.theRow, name: "The Row", is_active: true },
      { id: SEED.outlets.ioiCityMall, name: "IOI City Mall", is_active: true },
      { id: SEED.outlets.westinDesaru, name: "Westin Desaru", is_active: true },
      { id: SEED.outlets.merdeka118, name: "Merdeka 118", is_active: true },
    ]);
    const kpis = await db.query(
      `select id, name, value_type::text as value_type, frequency::text as frequency, dimension_id, is_required, is_active
       from public.company_kpis where company_id = $1 order by sort_order`,
      [SEED.companies.batikBoutique],
    );
    expect(kpis).toEqual([
      {
        id: SEED.kpis.revenuePerOutlet,
        name: "Revenue per outlet",
        value_type: "currency",
        frequency: "monthly",
        dimension_id: SEED.dimensions.batikOutlet,
        is_required: true,
        is_active: true,
      },
      {
        id: SEED.kpis.monthlyBreakEven,
        name: "Monthly break-even",
        value_type: "currency",
        frequency: "monthly",
        dimension_id: SEED.dimensions.batikOutlet,
        is_required: true,
        is_active: true,
      },
      {
        id: SEED.kpis.profitable,
        name: "Profitable",
        value_type: "boolean",
        frequency: "monthly",
        dimension_id: SEED.dimensions.batikOutlet,
        is_required: true,
        is_active: true,
      },
    ]);
  });

  it("configures the Huddle KPIs (BRD §6.2), ready for when Huddle starts reporting", async () => {
    const kpis = await db.query(
      `select id, name, unit, value_type::text as value_type, frequency::text as frequency, dimension_id, is_required, is_active, sort_order
       from public.company_kpis where company_id = $1 order by sort_order`,
      [SEED.companies.huddle],
    );
    const kpi = (id: string, name: string, unit: string, value_type: string, sort_order: number) => ({
      id,
      name,
      unit,
      value_type,
      frequency: "monthly",
      dimension_id: null,
      is_required: true,
      is_active: true,
      sort_order,
    });
    expect(kpis).toEqual([
      kpi(SEED.kpis.camerasDeployed, "Cameras deployed", "cameras", "integer", 1),
      kpi(SEED.kpis.gamesRecorded, "Games recorded", "games", "integer", 2),
      kpi(SEED.kpis.gamesPerCamera, "Games per camera", "games", "number", 3),
      kpi(SEED.kpis.gamesBrokenDown, "Games broken down for statistics", "games", "integer", 4),
    ]);
    // Only Batik Boutique, Kiddocare and Huddle have KPIs.
    const withKpis = await db.query<{ company_id: string }>("select distinct company_id from public.company_kpis order by 1");
    expect(withKpis.map((r) => r.company_id)).toEqual(
      [SEED.companies.batikBoutique, SEED.companies.kiddocare, SEED.companies.huddle].sort(),
    );
  });

  it("configures the Kiddocare KPIs and leaves RECQA without KPIs", async () => {
    const kpis = await db.query(
      `select id, name, value_type::text as value_type, frequency::text as frequency, dimension_id
       from public.company_kpis where company_id = $1 order by sort_order`,
      [SEED.companies.kiddocare],
    );
    expect(kpis).toEqual([
      { id: SEED.kpis.appDownloads, name: "App downloads", value_type: "integer", frequency: "monthly", dimension_id: null },
      { id: SEED.kpis.bookings, name: "Bookings", value_type: "integer", frequency: "monthly", dimension_id: null },
      { id: SEED.kpis.activeCarers, name: "Active carers", value_type: "integer", frequency: "monthly", dimension_id: null },
      { id: SEED.kpis.payoutsToCarers, name: "Payouts to carers", value_type: "currency", frequency: "monthly", dimension_id: null },
    ]);
    expect(await db.count("select 1 from public.company_kpis where company_id = $1", [SEED.companies.recqa])).toBe(0);
    expect(await db.count("select 1 from public.revenue_segments")).toBe(0);
  });

  it("re-running a changed seed never re-creates bootstrap rows that admins deleted", async () => {
    const pg = await createMigratedDatabase({ seed: true });
    try {
      const count = async (sql: string) => Number((await pg.query<{ n: number }>(`select count(*)::int as n from (${sql}) as x`)).rows[0].n);
      expect((await pg.query<{ key: string }>("select key from private.seed_markers order by key")).rows.map((r) => r.key)).toEqual([
        "funds_v1",
        "pilot_companies_v1",
        "portfolio_h1_2026_v1",
      ]);
      // Admins remove a pilot company, a portfolio company, a Huddle KPI, an unused outlet and a fund …
      await pg.query("select public.delete_company($1, 'Not in the pilot after all')", [SEED.companies.recqa]);
      await pg.query("select public.delete_company($1, 'Duplicate record')", [SEED.companies.fefifo]);
      await pg.query("delete from public.company_kpis where id = $1", [SEED.kpis.gamesPerCamera]);
      await pg.query("delete from public.kpi_dimension_members where id = $1", [SEED.outlets.merdeka118]);
      await pg.query("delete from public.fund_investments where fund_id = $1", [SEED.funds.SFF]);
      await pg.query("delete from public.funds where id = $1", [SEED.funds.SFF]);
      // … a company's internal row goes missing (e.g. a data fix) …
      await pg.query("delete from public.company_internal where company_id = $1", [SEED.companies.kabel]);
      // … and the settings row goes missing.
      await pg.query("delete from public.platform_settings");
      await runSqlFile(pg, readSeed()); // e.g. `db push --include-seed` after the seed file changed
      expect(await count(`select 1 from public.companies where id = '${SEED.companies.recqa}'`)).toBe(0);
      expect(await count(`select 1 from public.companies where id = '${SEED.companies.fefifo}'`)).toBe(0);
      expect(await count(`select 1 from public.company_kpis where id = '${SEED.kpis.gamesPerCamera}'`)).toBe(0);
      expect(await count(`select 1 from public.kpi_dimension_members where id = '${SEED.outlets.merdeka118}'`)).toBe(0);
      expect(await count(`select 1 from public.funds where id = '${SEED.funds.SFF}'`)).toBe(0);
      expect(await count("select 1 from public.fund_investments")).toBe(6); // SV1 without RECQA
      // Rows that must always exist are ensured.
      expect(await count("select 1 from public.platform_settings")).toBe(1);
      expect(await count("select 1 from public.templates where is_default")).toBe(1);
      expect(await count(`select 1 from public.template_fields where template_version_id = '${SEED.template.v1}'`)).toBe(23);
      expect(await count("select 1 from public.companies")).toBe(16);
      expect(await count("select 1 from public.company_internal")).toBe(16);
      expect(await count(`select 1 from public.company_internal where company_id = '${SEED.companies.kabel}'`)).toBe(1);
    } finally {
      await pg.close();
    }
  });

  it("seeds no users, periods or submissions", async () => {
    expect(await db.count("select 1 from auth.users")).toBe(0);
    expect(await db.count("select 1 from public.profiles")).toBe(0);
    expect(await db.count("select 1 from public.reporting_periods")).toBe(0);
    expect(await db.count("select 1 from public.submissions")).toBe(0);
  });

  it("creates the private company-documents bucket (25 MB; PDF, Excel, CSV, Word)", async () => {
    const bucket = await db.one("select id, public, file_size_limit, allowed_mime_types from storage.buckets");
    expect(bucket).toEqual({
      id: "company-documents",
      public: false,
      file_size_limit: 26214400,
      allowed_mime_types: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
  });
});
