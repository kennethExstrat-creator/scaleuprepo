/**
 * Tenant isolation matrix: company users never see another company's rows (in any table, view or
 * storage object) nor any ScaleUp-internal data (including the platform settings and the
 * partner-in-charge); MFA, deactivation, pending terms of use and anon lock everything down.
 * access_links is not reachable through the API at all (service role only).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, freshDb, type Sql, type TestDb } from "./harness";
import { fillValid, save, setupPortfolio, submit, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;
const B = SEED.companies.kiddocare;
const ids: Record<string, string> = {};

/** How to identify a row, and which rows belong to a company (evaluated as the superuser). */
type Scope = { key: string; owned: (company: string) => string; scaleupOnly?: boolean };

const subOf = (company: string) => `submission_id in (select id from public.submissions where company_id = '${company}')`;

/** "global": readable by every signed-in user; "service": no API privileges at all (access-links.test.ts). */
const TABLES: Record<string, Scope | "global" | "service"> = {
  "public.access_links": "service",
  "public.platform_settings": { key: "id::text", owned: () => "true", scaleupOnly: true },
  "public.templates": "global",
  "public.template_versions": "global",
  "public.template_sections": "global",
  "public.template_fields": "global",
  "public.reporting_periods": "global",
  "public.profiles": {
    key: "id::text",
    owned: (c) => `id in (select user_id from public.company_members where company_id = '${c}')`,
  },
  "public.funds": { key: "id::text", owned: () => "true", scaleupOnly: true },
  "public.fund_investments": { key: "id::text", owned: () => "true", scaleupOnly: true },
  "public.company_internal": { key: "company_id::text", owned: () => "true", scaleupOnly: true },
  "public.fx_rates": { key: "currency || ':' || month", owned: () => "true", scaleupOnly: true },
  "public.audit_log": { key: "id::text", owned: () => "true", scaleupOnly: true },
  "public.companies": { key: "id::text", owned: (c) => `id = '${c}'` },
  "public.company_members": { key: "company_id::text || ':' || user_id::text", owned: (c) => `company_id = '${c}'` },
  "public.revenue_segments": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.kpi_dimensions": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.kpi_dimension_members": {
    key: "id::text",
    owned: (c) => `dimension_id in (select id from public.kpi_dimensions where company_id = '${c}')`,
  },
  "public.company_kpis": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.submissions": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.submission_values": { key: "submission_id::text || ':' || field_key", owned: subOf },
  "public.submission_segment_values": { key: "submission_id::text || ':' || segment_id::text", owned: subOf },
  "public.submission_kpi_values": { key: "id::text", owned: subOf },
  "public.submission_events": { key: "id::text", owned: subOf },
  "public.comments": { key: "id::text", owned: subOf },
  "public.period_closes": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.documents": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "public.v_submission_financials": { key: "submission_id::text", owned: (c) => `company_id = '${c}'` },
  "public.v_submission_overview": { key: "id::text", owned: (c) => `company_id = '${c}'` },
  "storage.objects": { key: "id::text", owned: (c) => `bucket_id = 'company-documents' and name like '${c}/%'` },
};

async function keysOf(table: string, scope: Scope, where: string): Promise<string[]> {
  const rows = await db.query<{ k: string }>(`select ${scope.key} as k from ${table} where ${where}`);
  return rows.map((r) => r.k);
}

async function visible(sql: Sql, table: string, scope: Scope, keys: string[]): Promise<number> {
  return sql.count(`select 1 from ${table} where (${scope.key}) = any($1::text[])`, [keys]);
}

async function uploadDocument(user: string, company: string, closeId: string | null, name: string): Promise<string> {
  const path = `${company}/${closeId ?? "general"}/${randomUUID()}-${name}`;
  return db.asUser(user, async (sql) => {
    await sql.query("insert into storage.objects (bucket_id, name, owner, owner_id) values ('company-documents', $1, auth.uid(), auth.uid()::text)", [
      path,
    ]);
    return sql.value<string>(
      `insert into public.documents (company_id, period_close_id, doc_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
       values ($1, $2, 'management_accounts', $3, $4, 'application/pdf', 1234, auth.uid()) returning id`,
      [company, closeId, name, path],
    );
  });
}

beforeAll(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });

  // Configuration for both companies.
  ids.segA = await db.value("insert into public.revenue_segments (company_id, name) values ($1, 'Retail') returning id", [A]);
  ids.segB = await db.value("insert into public.revenue_segments (company_id, name) values ($1, 'Subscriptions') returning id", [B]);
  ids.dimB = await db.value("insert into public.kpi_dimensions (company_id, name) values ($1, 'City') returning id", [B]);
  ids.memberB = await db.value("insert into public.kpi_dimension_members (dimension_id, name) values ($1, 'Penang') returning id", [ids.dimB]);
  ids.kpiB = await db.value(
    "insert into public.company_kpis (company_id, name, value_type, dimension_id, is_required) values ($1, 'Carers per city', 'integer', $2, false) returning id",
    [B, ids.dimB],
  );

  // A month of data for each company, submitted.
  for (const [owner, company, sub, seg] of [
    [p.batikOwner, "batik", p.subs.batik["2026-07-01"], ids.segA],
    [p.kiddoOwner, "kiddo", p.subs.kiddo["2026-07-01"], ids.segB],
  ] as const) {
    await fillValid(db, owner, sub, company);
    await db.asUser(owner, (sql) =>
      save(sql, sub, {
        values: [{ key: "key_milestones", value_text: `${company} milestone` }],
        segments: [{ segment_id: seg, amount: 100000 }],
      }),
    );
    await submit(db, owner, sub);
  }
  await db.asUser(p.kiddoOwner, (sql) =>
    save(sql, p.subs.kiddo["2026-08-01"], { kpis: [{ kpi_id: ids.kpiB, dimension_member_id: ids.memberB, value_number: 7 }] }),
  );

  // Comments (shared + internal) on both companies.
  for (const sub of [p.subs.batik["2026-07-01"], p.subs.kiddo["2026-07-01"]]) {
    for (const visibility of ["shared", "internal"]) {
      await db.asUser(p.partner, (sql) =>
        sql.query("insert into public.comments (submission_id, visibility, author_id, body) values ($1, $2, auth.uid(), $3)", [
          sub,
          visibility,
          `${visibility} note`,
        ]),
      );
    }
  }

  // Documents + storage objects for both companies' Q3 closes.
  const q3 = async (company: string) =>
    db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [company]);
  ids.closeA = await q3(A);
  ids.closeB = await q3(B);
  ids.docA = await uploadDocument(p.batikOwner, A, ids.closeA, "batik-q3.pdf");
  ids.docB = await uploadDocument(p.kiddoContributor, B, ids.closeB, "kiddo-q3.pdf");

  // ScaleUp-internal data.
  await db.asUser(p.partner, (sql) =>
    sql.query("update public.company_internal set internal_rating = 'watch', notes = 'Keep an eye on churn' where company_id = $1", [B]),
  );
  // (Every company is mapped to its fund by the seed: Batik Boutique → SV1, Kiddocare → SFF.)
  await db.asUser(p.superAdmin, async (sql) => {
    await sql.query("update public.fund_investments set ownership_pct = 12.5 where fund_id = $1 and company_id = $2", [SEED.funds.SV1, A]);
    await sql.query("update public.fund_investments set ownership_pct = 8 where fund_id = $1 and company_id = $2", [SEED.funds.SFF, B]);
  });
  await db.asUser(p.fundAdmin, (sql) => sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('USD', '2026-07-01', 4.2)"));
  await db.asUser(p.fundAdmin, (sql) =>
    sql.rpc("extend_due_date", { p_submission_id: p.subs.kiddo["2026-08-01"], p_new_due_date: "2026-12-01", p_reason: "Holiday" }),
  );
});

afterAll(async () => {
  await db?.close();
});

describe("tenant isolation matrix", () => {
  it("covers every public table and view", async () => {
    const relations = await db.query<{ name: string }>(
      `select 'public.' || c.relname as name from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') order by 1`,
    );
    const covered = new Set(Object.keys(TABLES));
    expect(relations.map((r) => r.name).filter((name) => !covered.has(name))).toEqual([]);
  });

  for (const [label, own, other, users] of [
    ["Batik Boutique users", A, B, () => [p.batikOwner, p.batikContributor]],
    ["Kiddocare users", B, A, () => [p.kiddoOwner, p.kiddoContributor]],
  ] as const) {
    it(`${label} read nothing of the other company and nothing ScaleUp-internal`, async () => {
      for (const [table, scope] of Object.entries(TABLES)) {
        if (scope === "global" || scope === "service") continue;
        const forbidden = await keysOf(table, scope, scope.owned(other));
        // Every company-scoped table has rows for the other company, so the check is meaningful.
        expect(forbidden.length, `${table} should have rows for the other company`).toBeGreaterThan(0);
        if (table === "public.comments") {
          forbidden.push(...(await keysOf(table, scope, `${scope.owned(own)} and visibility = 'internal'`)));
        }
        for (const user of users()) {
          const seen = await db.asUser(user, (sql) => visible(sql, table, scope, forbidden));
          expect(seen, `${table} leaked ${seen} row(s) to a ${label}`).toBe(0);
        }
      }
    });

    it(`${label} still see their own company's rows`, async () => {
      for (const [table, scope] of Object.entries(TABLES)) {
        if (scope === "global" || scope === "service" || scope.scaleupOnly) continue;
        let where = scope.owned(own);
        if (table === "public.comments") where += " and visibility = 'shared'";
        const allowed = await keysOf(table, scope, where);
        expect(allowed.length, `${table} should have rows for the own company`).toBeGreaterThan(0);
        for (const user of users()) {
          const seen = await db.asUser(user, (sql) => visible(sql, table, scope, allowed));
          expect(seen, `${table} for a ${label}`).toBe(allowed.length);
        }
      }
    });
  }

  it("ScaleUp roles (including viewers) read every company's rows", async () => {
    for (const user of [p.viewer, p.otherPartner, p.fundAdmin, p.superAdmin]) {
      for (const [table, scope] of Object.entries(TABLES)) {
        if (scope === "global" || scope === "service" || table === "public.audit_log" || table === "public.profiles") continue;
        const all = await keysOf(table, scope, "true");
        const seen = await db.asUser(user, (sql) => visible(sql, table, scope, all));
        expect(seen, table).toBe(all.length);
      }
    }
    // Audit log: Super Admin, Fund Admin and Partners only.
    expect(await db.asUser(p.otherPartner, (sql) => sql.count("select 1 from public.audit_log"))).toBeGreaterThan(0);
    expect(await db.asUser(p.viewer, (sql) => sql.count("select 1 from public.audit_log"))).toBe(0);
  });

  it("company users see their co-members' profiles only: never ScaleUp staff (BRD B24) or other companies' people", async () => {
    // ScaleUp staff profiles stay hidden from company users: only the partner-in-charge (or a Super Admin)
    // approves, so an approver's role would reveal the partner-in-charge. (BRD B28: the company side names
    // ScaleUp people "<full name> (ScaleUp)" through staff_display_names() only.)
    const names = await db.asUser(p.batikContributor, (sql) =>
      sql.query<{ email: string }>("select email from public.profiles order by email"),
    );
    expect(names.map((n) => n.email)).toEqual(["finance@batik.test", "owner@batik.test"]);
    // ScaleUp staff still see everyone, with roles.
    expect(await db.asUser(p.viewer, (sql) => sql.count("select 1 from public.profiles where scaleup_role is not null"))).toBe(5);
  });

  it("company users cannot write to another company", async () => {
    const newUser = await db.createUser();
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [B, newUser]),
      ),
      /row-level security/,
    );
    const updated = await db.asUser(p.batikOwner, (sql) =>
      sql.query("update public.companies set name = 'Hijacked' where id = $1 returning id", [B]),
    );
    expect(updated).toEqual([]);
    const segments = await db.asUser(p.batikOwner, (sql) =>
      sql.query("update public.revenue_segments set name = 'Hijacked' returning id"),
    );
    expect(segments).toEqual([]);
    await expectDenied(uploadDocument(p.batikOwner, B, ids.closeB, "evil.pdf"), /row-level security/);
    // A document row pointing at the other company's folder is refused too.
    await expectPgError(
      db.asUser(p.batikOwner, (sql) =>
        sql.query(
          `insert into public.documents (company_id, file_name, storage_path, uploaded_by)
           values ($1, 'x.pdf', $2, auth.uid())`,
          [A, `${B}/general/${randomUUID()}-x.pdf`],
        ),
      ),
      { message: "The file must be stored in the company's own folder." },
    );
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.rpc("confirm_period_close", { p_close_id: ids.closeB, p_restated_totals: null, p_reason: null }),
      ),
      "This period close was not found or you do not have access to it.",
    );
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.rpc("log_audit_event", { p_action: "export", p_entity: "companies", p_entity_id: B, p_company_id: B, p_summary: "x" }),
      ),
      "You do not have access to that company.",
    );
    for (const fn of ["get_submission_validation", "submit_submission", "request_amendment"]) {
      const args: Record<string, unknown> = { p_submission_id: p.subs.kiddo["2026-07-01"] };
      if (fn === "submit_submission") args.p_declaration_accepted = true;
      if (fn === "request_amendment") args.p_reason = "x";
      await expectDenied(db.asUser(p.batikOwner, (sql) => sql.rpc(fn, args)));
    }
  });

  it("ScaleUp viewers cannot write anything", async () => {
    await expectDenied(
      db.asUser(p.viewer, (sql) => sql.query("insert into public.companies (name, reporting_start_month) values ('X', '2026-07-01')")),
      /row-level security/,
    );
    await expectDenied(
      db.asUser(p.viewer, (sql) => sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('SGD', '2026-07-01', 3.3)")),
      /row-level security/,
    );
    expect(
      await db.asUser(p.viewer, (sql) => sql.query("update public.company_internal set notes = 'x' returning company_id")),
    ).toEqual([]);
    expect(await db.asUser(p.viewer, (sql) => sql.query("update public.platform_settings set due_day = 1 returning id"))).toEqual([]);
  });

  it("company_internal is writable by Super/Fund Admins and the partner-in-charge only", async () => {
    expect(
      await db.asUser(p.otherPartner, (sql) => sql.query("update public.company_internal set notes = 'x' where company_id = $1 returning company_id", [B])),
    ).toEqual([]);
    expect(
      await db.asUser(p.partner, (sql) => sql.query("update public.company_internal set notes = 'ok' where company_id = $1 returning company_id", [B])),
    ).toEqual([{ company_id: B }]);
    expect(
      await db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.company_internal set exit_strategy_status = 'IPO' where company_id = $1 returning company_id", [SEED.companies.recqa]),
      ),
    ).toEqual([{ company_id: SEED.companies.recqa }]);
    expect(await db.value("select updated_by from public.company_internal where company_id = $1", [SEED.companies.recqa])).toBe(p.fundAdmin);
  });
});

describe("storage.objects policies", () => {
  it("members and Fund Admins upload into their company folder; others cannot", async () => {
    const put = (user: string, name: string) =>
      db.asUser(user, (sql) =>
        sql.query("insert into storage.objects (bucket_id, name, owner) values ('company-documents', $1, auth.uid())", [name]),
      );
    await put(p.batikContributor, `${A}/general/${randomUUID()}-notes.pdf`);
    await put(p.fundAdmin, `${B}/${ids.closeB}/${randomUUID()}-accounts.xlsx`);
    for (const [user, name] of [
      [p.partner, `${A}/general/${randomUUID()}-x.pdf`],
      [p.superAdmin, `${A}/general/${randomUUID()}-x.pdf`],
      [p.viewer, `${A}/general/${randomUUID()}-x.pdf`],
      [p.kiddoOwner, `${A}/general/${randomUUID()}-x.pdf`],
      [p.batikOwner, `not-a-uuid/general/${randomUUID()}-x.pdf`],
      [p.batikOwner, `${randomUUID()}-top-level.pdf`],
    ]) {
      await expectDenied(put(user, name), /row-level security/);
    }
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("insert into storage.objects (bucket_id, name) values ('other-bucket', $1)", [`${A}/general/x.pdf`]),
      ),
    );
  });

  it("objects are never updated or deleted through the API", async () => {
    const renamed = await db.asUser(p.batikOwner, (sql) =>
      sql.query("update storage.objects set name = name || '.bak' returning id"),
    );
    expect(renamed).toEqual([]);
    const deleted = await db.asUser(p.fundAdmin, (sql) => sql.query("delete from storage.objects returning id"));
    expect(deleted).toEqual([]);
  });

  it("exited companies' members can still download but no longer upload", async () => {
    const company = await db.createCompany({ name: "Exited Co", status: "exited" });
    const member = await db.createUser();
    await db.addMember(company, member, "owner");
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [`${company}/general/old.pdf`]);
    expect(await db.asUser(member, (sql) => sql.count("select 1 from storage.objects"))).toBe(1);
    await expectDenied(
      db.asUser(member, (sql) =>
        sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [`${company}/general/new.pdf`]),
      ),
      /row-level security/,
    );
  });

  it("try_uuid() returns null for anything that is not a uuid", async () => {
    const rows = await db.query<{ v: string | null }>(
      "select private.try_uuid(x) as v from unnest(array['', 'general', '123', null, 'C0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000g']) as x",
    );
    expect(rows.map((r) => r.v)).toEqual([null, null, null, null, "c0000000-0000-4000-8000-000000000001", null]);
  });
});

describe("MFA, deactivation and anon", () => {
  const everyTable = Object.entries(TABLES).filter(([name, scope]) => name.startsWith("public.") && scope !== "service");

  it("aal1 sessions see no company or ScaleUp data, only their own profile (and the client settings)", async () => {
    for (const user of [p.batikOwner, p.superAdmin, p.partner]) {
      await db.asUser(
        user,
        async (sql) => {
          for (const [table] of everyTable) {
            const n = await sql.count(`select 1 from ${table}`);
            expect(n, `${table} at aal1`).toBe(table === "public.profiles" ? 1 : 0);
          }
          expect(await sql.value("select id from public.profiles")).toBe(user);
          expect(await sql.count("select 1 from storage.objects")).toBe(0);
          // What the app needs to route an aal1 session (to /mfa) comes from get_client_settings().
          expect(await sql.value("select require_mfa from public.get_client_settings()")).toBe(true);
        },
        { aal: "aal1" },
      );
    }
  });

  it("aal1 is enough when require_mfa is switched off", async () => {
    await db.query("update public.platform_settings set require_mfa = false");
    try {
      const n = await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.submissions"), { aal: "aal1" });
      expect(n).toBe(3);
      expect(await db.asUser(p.superAdmin, (sql) => sql.count("select 1 from public.platform_settings"), { aal: "aal1" })).toBe(1);
    } finally {
      await db.query("update public.platform_settings set require_mfa = true");
    }
  });

  it("deactivated users see nothing but their own profile (and the client settings)", async () => {
    const user = await db.createUser({ scaleupRole: "super_admin", isActive: false });
    const member = await db.createUser({ isActive: false });
    await db.addMember(A, member, "owner");
    for (const u of [user, member]) {
      await db.asUser(u, async (sql) => {
        for (const [table] of everyTable) {
          expect(await sql.count(`select 1 from ${table}`), table).toBe(table === "public.profiles" ? 1 : 0);
        }
        expect(await sql.count("select 1 from public.get_client_settings()")).toBe(1);
      });
      await expectDenied(db.asUser(u, (sql) => sql.rpc("open_due_periods")));
    }
  });

  it("inactive memberships give no access to the company", async () => {
    const member = await db.createUser();
    await db.addMember(A, member, "contributor", false);
    expect(await db.asUser(member, (sql) => sql.count("select 1 from public.companies"))).toBe(0);
    expect(await db.asUser(member, (sql) => sql.count("select 1 from public.submissions"))).toBe(0);
  });

  it("anon can do nothing at all", async () => {
    const relations = await db.query<{ name: string }>(
      "select 'public.' || relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')",
    );
    for (const { name } of relations) {
      await expectDenied(db.asAnon((sql) => sql.query(`select * from ${name} limit 1`)), /permission denied/);
    }
    const functions = await db.query<{ sig: string }>(
      "select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace",
    );
    expect(functions.length).toBeGreaterThanOrEqual(21);
    for (const { sig } of functions) {
      expect(await db.value("select has_function_privilege('anon', $1::regprocedure, 'EXECUTE')", [sig]), sig).toBe(false);
    }
    await expectDenied(db.asAnon((sql) => sql.rpc("log_audit_event", { p_action: "export", p_entity: "x" })));
    await expectDenied(db.asAnon((sql) => sql.query("select private.can_view_company($1)", [A])), /permission denied/);
    // Signed-in users can only reach the policy helpers in private, never the internals.
    for (const call of [
      `select private.validate_submission('${p.subs.kiddo["2026-07-01"]}')`,
      `select private.ensure_periods('2027-01-01')`,
      `select private.write_audit('approve', 'submissions', null, null, 'forged', null, null, false)`,
      `select private.compute_period_totals('${B}', '2026-07-01', '2026-09-30')`,
      `select private.set_audit_context('approve', 'forged', true, null)`,
    ]) {
      await expectDenied(db.asUser(p.batikOwner, (sql) => sql.query(call)), /permission denied for function/);
    }
    expect(await db.asAnon((sql) => sql.count("select 1 from storage.objects"))).toBe(0);
    await expectDenied(
      db.asAnon((sql) => sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [`${A}/general/x.pdf`])),
      /row-level security/,
    );
  });
});
