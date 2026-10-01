import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, save, setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type AuditRow = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  company_id: string | null;
  on_behalf: boolean;
  summary: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

const maxId = () => db.value<number>("select coalesce(max(id), 0)::int from public.audit_log");
const since = (id: number) => db.query<AuditRow>("select * from public.audit_log where id > $1 order by id", [id]);

describe("audit trigger", () => {
  it("logs inserts, updates (changed columns only) and deletes with the actor and company", async () => {
    const start = await maxId();
    const segment = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name, sort_order) values ($1, 'Retail', 1) returning id", [A]),
    );
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.revenue_segments set name = 'Retail stores' where id = $1", [segment]));
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.revenue_segments set name = name, sort_order = sort_order where id = $1", [segment]));
    await db.asUser(p.superAdmin, (sql) => sql.query("delete from public.revenue_segments where id = $1", [segment]));
    const rows = await since(start);
    expect(rows.map((r) => [r.action, r.entity, r.entity_id, r.company_id, r.actor_id, r.actor_role])).toEqual([
      ["insert", "revenue_segments", segment, A, p.fundAdmin, "fund_admin"],
      ["update", "revenue_segments", segment, A, p.fundAdmin, "fund_admin"],
      ["delete", "revenue_segments", segment, A, p.superAdmin, "super_admin"],
    ]);
    expect(rows[0]).toMatchObject({ actor_email: "fund@scaleup.test", on_behalf: false, old_data: null });
    expect(rows[0].new_data).toMatchObject({ id: segment, company_id: A, name: "Retail", sort_order: 1, is_active: true });
    expect(rows[1].old_data).toEqual({ name: "Retail" });
    expect(rows[1].new_data).toEqual({ name: "Retail stores" });
    expect(rows[2].old_data).toMatchObject({ id: segment, name: "Retail stores" });
    expect(rows[2].new_data).toBeNull();
  });

  it("ignores updated_at when diffing and skips no-op updates", async () => {
    const start = await maxId();
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.company_kpis set description = 'Per outlet' where id = $1", [SEED.kpis.revenuePerOutlet]));
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.company_kpis set description = 'Per outlet' where id = $1", [SEED.kpis.revenuePerOutlet]));
    const rows = await since(start);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "update", entity: "company_kpis", old_data: { description: null }, new_data: { description: "Per outlet" } });
  });

  it("records composite keys, company ids resolved through parents, and the system actor", async () => {
    const start = await maxId();
    const jul = p.subs.batik["2026-07-01"];
    await db.asUser(p.batikContributor, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 5 }] }));
    await db.query("update public.kpi_dimension_members set sort_order = 9 where id = $1", [SEED.outlets.theRow]);
    const rows = await since(start);
    expect(rows.map((r) => [r.entity, r.entity_id, r.company_id, r.actor_role])).toEqual([
      ["submission_values", `${jul}:revenue_total`, A, "company_contributor"],
      ["kpi_dimension_members", SEED.outlets.theRow, A, "system"],
    ]);
    expect(rows[1].actor_id).toBeNull();
  });

  it("names RPC actions and summaries", async () => {
    const start = await maxId();
    const jul = p.subs.batik["2026-07-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Fix" }));
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Restated" }));
    await db.asUser(p.fundAdmin, (sql) =>
      sql.rpc("extend_due_date", { p_submission_id: jul, p_new_due_date: "2026-12-01", p_reason: "Audit" }),
    );
    await db.asUser(p.superAdmin, (sql) => sql.rpc("set_company_status", { p_company_id: SEED.companies.recqa, p_status: "exited", p_reason: "Trade sale" }));
    const submissionActions = (await since(start))
      .filter((r) => r.entity === "submissions" && r.action !== "update")
      .map((r) => [r.action, r.summary]);
    expect(submissionActions).toEqual([
      ["submit", "Submitted Jul 2026"],
      ["request_changes", "Changes requested for Jul 2026"],
      ["submit", "Resubmitted Jul 2026 (revision 2)"],
      ["approve", "Approved Jul 2026"],
      ["reopen", "Reopened Jul 2026: Restated"],
      ["extend_due_date", "Due date for Jul 2026 extended to 1 Dec 2026"],
    ]);
    const status = (await since(start)).find((r) => r.entity === "companies");
    expect(status).toMatchObject({
      action: "status_change",
      summary: "RECQA: active → exited (Trade sale)",
      company_id: SEED.companies.recqa,
      actor_role: "super_admin",
      old_data: { status: "active", status_reason: null },
      new_data: { status: "exited", status_reason: "Trade sale" },
    });
    // The audit context never leaks into later statements of the same transaction.
    const after = await maxId();
    await db.asUser(p.fundAdmin, async (sql) => {
      await sql.rpc("extend_due_date", { p_submission_id: p.subs.batik["2026-08-01"], p_new_due_date: "2026-12-02", p_reason: null });
      await sql.query("update public.company_kpis set unit = 'MYR' where id = $1", [SEED.kpis.revenuePerOutlet]);
    });
    const last = (await since(after)).at(-1);
    expect(last).toMatchObject({ entity: "company_kpis", action: "update", summary: null });
  });
});

describe("audit_log is append-only", () => {
  it("rejects UPDATE, DELETE and TRUNCATE for every role, even when no row matches", async () => {
    const APPEND_ONLY = "The audit log is append-only: entries cannot be changed or deleted.";
    await expectDenied(db.query("update public.audit_log set summary = 'x'"), APPEND_ONLY);
    await expectDenied(db.query("delete from public.audit_log"), APPEND_ONLY);
    await expectDenied(db.query("delete from public.audit_log where false"), APPEND_ONLY);
    await expectDenied(db.query("truncate public.audit_log"), APPEND_ONLY);
    for (const run of [
      (s: string) => db.asService((sql) => sql.query(s)),
      (s: string) => db.asUser(p.superAdmin, (sql) => sql.query(s)),
      (s: string) => db.asUser(p.batikOwner, (sql) => sql.query(s)),
    ]) {
      await expectDenied(run("update public.audit_log set summary = 'x'"));
      await expectDenied(run("delete from public.audit_log"));
      await expectDenied(run("truncate public.audit_log"));
    }
    await expectDenied(
      db.asUser(p.superAdmin, (sql) => sql.query("insert into public.audit_log (action, entity) values ('approve', 'submissions')")),
    );
    expect(await db.count("select 1 from public.audit_log")).toBeGreaterThan(0);
  });
});

describe("log_audit_event()", () => {
  const log = (user: string, args: Record<string, unknown>, aal: "aal1" | "aal2" = "aal2") =>
    db.asUser(user, (sql) => sql.rpc("log_audit_event", args), { aal });

  it("appends an event for the caller", async () => {
    const start = await maxId();
    await log(p.partner, {
      p_action: "export",
      p_entity: "c4_workbook",
      p_entity_id: A,
      p_company_id: A,
      p_summary: "C4 workbook for Batik Boutique",
      p_data: { format: "xlsx" },
    });
    await log(p.batikOwner, { p_action: "download", p_entity: "documents", p_entity_id: "doc-1", p_company_id: A, p_summary: null });
    await log(p.superAdmin, { p_action: "mfa_reset", p_entity: "profiles", p_entity_id: p.batikOwner });
    await db.asService((sql) => sql.rpc("log_audit_event", { p_action: "invite", p_entity: "profiles" }));
    const rows = await since(start);
    expect(rows.map((r) => [r.action, r.entity, r.entity_id, r.company_id, r.actor_id, r.actor_role, r.summary, r.new_data])).toEqual([
      ["export", "c4_workbook", A, A, p.partner, "partner", "C4 workbook for Batik Boutique", { format: "xlsx" }],
      ["download", "documents", "doc-1", A, p.batikOwner, "company_owner", null, null],
      ["mfa_reset", "profiles", p.batikOwner, null, p.superAdmin, "super_admin", null, null],
      ["invite", "profiles", null, null, null, "system", null, null],
    ]);
  });

  it("only accepts the app events it knows (no forged or look-alike workflow actions), and checks its input", async () => {
    const NOT_AN_APP_EVENT = (action: string) =>
      `The audit action "${action}" cannot be logged by the app. Use one of: export, download, invite, invite_revoke, sign_in_link, mfa_reset.`;
    for (const action of ["approve", "approved", "submit", "insert", "delete", "reopen", "confirmed", "Export!", "export "]) {
      await expectRule(log(p.superAdmin, { p_action: action, p_entity: "submissions" }), NOT_AN_APP_EVENT(action));
    }
    await expectRule(log(p.superAdmin, { p_action: null, p_entity: "submissions" }), NOT_AN_APP_EVENT(""));
    const ENTITY = 'The audit entity must be a lower-case name of up to 64 characters, such as "documents".';
    for (const entity of [" ", "Documents", "c4 workbook", "x".repeat(65)]) {
      await expectRule(log(p.superAdmin, { p_action: "export", p_entity: entity }), ENTITY);
    }
    await expectRule(
      log(p.superAdmin, { p_action: "export", p_entity: "x", p_data: { blob: "x".repeat(70000) } }),
      "The audit details are too large (64 KB maximum).",
    );
    await expectDenied(
      log(p.kiddoOwner, { p_action: "export", p_entity: "x", p_company_id: A }),
      "You do not have access to that company.",
    );
    await expectDenied(log(p.partner, { p_action: "export", p_entity: "x" }, "aal1"), "Please sign in first.");
    await expectDenied(db.asAnon((sql) => sql.rpc("log_audit_event", { p_action: "export", p_entity: "x" })));
  });

  it("keeps staff events to the people who can perform them", async () => {
    const start = await maxId();
    // MFA resets: Super Admins only.
    for (const user of [p.fundAdmin, p.partner, p.batikOwner]) {
      await expectDenied(
        log(user, { p_action: "mfa_reset", p_entity: "profiles", p_entity_id: p.viewer }),
        "Only Super Admins can reset two-factor authentication.",
      );
    }
    // Invitations: Super Admins, or a company owner for their own company.
    const INVITES = "Only Super Admins and company owners can manage invitations.";
    for (const action of ["invite", "invite_revoke", "sign_in_link"]) {
      await log(p.batikOwner, { p_action: action, p_entity: "profiles", p_company_id: A });
      await log(p.superAdmin, { p_action: action, p_entity: "profiles" });
      await expectDenied(log(p.batikOwner, { p_action: action, p_entity: "profiles" }), INVITES);
      await expectDenied(log(p.batikContributor, { p_action: action, p_entity: "profiles", p_company_id: A }), INVITES);
      await expectDenied(log(p.fundAdmin, { p_action: action, p_entity: "profiles", p_company_id: A }), INVITES);
    }
    // Exports and downloads: any active user (company users for their own companies).
    await log(p.viewer, { p_action: "export", p_entity: "portfolio", p_data: { format: "csv" } });
    await log(p.batikContributor, { p_action: "download", p_entity: "documents", p_company_id: A });
    expect((await since(start)).map((r) => [r.action, r.actor_role])).toEqual([
      ["invite", "company_owner"],
      ["invite", "super_admin"],
      ["invite_revoke", "company_owner"],
      ["invite_revoke", "super_admin"],
      ["sign_in_link", "company_owner"],
      ["sign_in_link", "super_admin"],
      ["export", "viewer"],
      ["download", "company_contributor"],
    ]);
  });
});

describe("audit actors", () => {
  it("months opened automatically are recorded as the system, whoever's page load opened them", async () => {
    await db.setToday("2026-11-02"); // October is due to open
    const start = await maxId();
    await db.asUser(p.batikOwner, (sql) => sql.rpc("open_due_periods"));
    const rows = await since(start);
    expect(rows.length).toBe(1 + 3); // the October period and one submission per company
    for (const row of rows) {
      expect(row).toMatchObject({ actor_id: null, actor_email: null, actor_role: "system", summary: "Opened automatically", on_behalf: false });
    }
    expect(new Set(rows.map((r) => r.company_id))).toEqual(new Set([null, A, SEED.companies.recqa, SEED.companies.kiddocare]));
  });

  it("a company role is only ever taken from the row's own company", async () => {
    const actorOf = (userId: string, companyId: string | null) =>
      db.pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
        return (await tx.query("select actor_id, actor_role from private.audit_actor($1)", [companyId])).rows[0];
      });
    expect(await actorOf(p.batikOwner, A)).toEqual({ actor_id: p.batikOwner, actor_role: "company_owner" });
    // No membership in Kiddocare: no role at all (never "company_owner" from Batik Boutique).
    expect(await actorOf(p.batikOwner, SEED.companies.kiddocare)).toEqual({ actor_id: p.batikOwner, actor_role: null });
    // Rows without a company (e.g. accepting the terms) use the user's memberships.
    expect(await actorOf(p.batikOwner, null)).toEqual({ actor_id: p.batikOwner, actor_role: "company_owner" });
    // A Kiddocare owner who also contributes to Batik Boutique acts on Batik Boutique rows as a contributor.
    await db.addMember(A, p.kiddoOwner, "contributor");
    const start = await maxId();
    await db.asUser(p.kiddoOwner, (sql) => save(sql, p.subs.batik["2026-07-01"], { values: [{ key: "revenue_total", value_number: 5 }] }));
    await db.asUser(p.kiddoOwner, (sql) => save(sql, p.subs.kiddo["2026-07-01"], { values: [{ key: "revenue_total", value_number: 6 }] }));
    expect((await since(start)).filter((r) => r.entity === "submission_values").map((r) => [r.company_id, r.actor_role])).toEqual([
      [A, "company_contributor"],
      [SEED.companies.kiddocare, "company_owner"],
    ]);
  });

  it("members deleted with their KPI dimension keep the company in the audit log", async () => {
    const dimension = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.kpi_dimensions (company_id, name) values ($1, 'Product') returning id", [A]),
    );
    await db.asUser(p.fundAdmin, (sql) =>
      sql.query("insert into public.kpi_dimension_members (dimension_id, name) values ($1, 'Scarves'), ($1, 'Shirts')", [dimension]),
    );
    const start = await maxId();
    await db.asUser(p.fundAdmin, (sql) => sql.query("delete from public.kpi_dimensions where id = $1", [dimension]));
    expect((await since(start)).map((r) => [r.entity, r.action, r.company_id, r.actor_role])).toEqual([
      ["kpi_dimension_members", "delete", A, "fund_admin"],
      ["kpi_dimension_members", "delete", A, "fund_admin"],
      ["kpi_dimensions", "delete", A, "fund_admin"],
    ]);
    // Members with stored KPI values still block the delete (ON DELETE RESTRICT) and nothing is removed.
    await db.asUser(p.batikOwner, (sql) =>
      save(sql, p.subs.batik["2026-07-01"], {
        kpis: [{ kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: SEED.outlets.theRow, value_number: 5 }],
      }),
    );
    await db.query("update public.company_kpis set dimension_id = null where dimension_id = $1", [SEED.dimensions.batikOutlet]);
    const error = await expectPgError(
      db.asUser(p.fundAdmin, (sql) => sql.query("delete from public.kpi_dimensions where id = $1", [SEED.dimensions.batikOutlet])),
    );
    expect(["23001", "23503"]).toContain(error.code); // 23001 on Postgres 18 (PGlite), 23503 on Postgres 17
    expect(await db.count("select 1 from public.kpi_dimension_members where dimension_id = $1", [SEED.dimensions.batikOutlet])).toBe(5);
  });
});

describe("delete_company()", () => {
  it("writes the reason to the audit log first, then removes the company and its data", async () => {
    const jul = p.subs.batik["2026-07-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) =>
      sql.query("insert into public.comments (submission_id, author_id, body) values ($1, auth.uid(), 'Hello')", [jul]),
    );
    const q3 = await db.value<string>("select id from public.period_closes where company_id = $1", [A]);
    const path = `${A}/${q3}/${randomUUID()}-a.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
    await db.asUser(p.batikOwner, (sql) =>
      sql.query(
        "insert into public.documents (company_id, period_close_id, file_name, storage_path, uploaded_by) values ($1, $2, 'a.pdf', $3, auth.uid())",
        [A, q3, path],
      ),
    );
    // (The seed maps Batik Boutique to SV1: that fund_investments row goes with the company too.)
    expect(await db.count("select 1 from public.fund_investments where fund_id = $1 and company_id = $2", [SEED.funds.SV1, A])).toBe(1);

    await expectRule(
      db.asUser(p.superAdmin, (sql) => sql.rpc("delete_company", { p_company_id: A, p_reason: "  " })),
      "Please give a reason for deleting this company.",
    );
    for (const user of [p.fundAdmin, p.partner, p.batikOwner]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.rpc("delete_company", { p_company_id: A, p_reason: "x" })),
        "Only Super Admins can delete companies.",
      );
    }
    const start = await maxId();
    await db.asUser(p.superAdmin, (sql) => sql.rpc("delete_company", { p_company_id: A, p_reason: "Duplicate record" }));
    const rows = await since(start);
    expect(rows[0]).toMatchObject({
      action: "delete",
      entity: "companies",
      entity_id: A,
      company_id: A,
      actor_id: p.superAdmin,
      actor_role: "super_admin",
      summary: 'Deleted company "Batik Boutique". Reason: Duplicate record',
    });
    expect(rows[0].old_data).toMatchObject({ id: A, name: "Batik Boutique" });
    // Every cascaded row is logged against the deleted company.
    expect(rows.every((r) => r.company_id === A)).toBe(true);
    expect(new Set(rows.map((r) => r.entity))).toEqual(
      new Set([
        "companies",
        "submissions",
        "submission_values",
        "submission_kpi_values",
        "submission_events",
        "comments",
        "company_kpis",
        "kpi_dimensions",
        "kpi_dimension_members",
        "company_members",
        "company_internal",
        "fund_investments",
        "period_closes",
        "documents",
      ]),
    );
    for (const table of ["companies", "submissions", "company_kpis", "kpi_dimensions", "company_members", "period_closes", "documents", "fund_investments"]) {
      const column = table === "companies" ? "id" : "company_id";
      expect(await db.count(`select 1 from public.${table} where ${column} = $1`, [A]), table).toBe(0);
    }
    expect(await db.count("select 1 from public.kpi_dimension_members where dimension_id = $1", [SEED.dimensions.batikOutlet])).toBe(0);
    // The audit history survives the delete.
    expect(await db.count("select 1 from public.audit_log where company_id = $1", [A])).toBeGreaterThan(rows.length);
    await expectRule(db.asUser(p.superAdmin, (sql) => sql.rpc("delete_company", { p_company_id: A, p_reason: "Again" })), "That company was not found.");
  });
});

describe("set_company_status()", () => {
  it("is for Super Admins only and records the reason", async () => {
    await expectDenied(
      db.asUser(p.fundAdmin, (sql) => sql.rpc("set_company_status", { p_company_id: A, p_status: "exited", p_reason: "x" })),
      "Only Super Admins can change a company's status.",
    );
    await db.asUser(p.superAdmin, (sql) => sql.rpc("set_company_status", { p_company_id: A, p_status: "written_off", p_reason: " Wound up " }));
    const row = await db.one<{ status: string; status_reason: string; changed: boolean }>(
      "select status::text as status, status_reason, status_changed_at is not null as changed from public.companies where id = $1",
      [A],
    );
    expect(row).toEqual({ status: "written_off", status_reason: "Wound up", changed: true });
    await expectPgError(
      db.asUser(p.superAdmin, (sql) => sql.rpc("set_company_status", { p_company_id: A, p_status: "sold", p_reason: null })),
      { code: "22P02" },
    );
  });
});
