/**
 * Security review of supabase/migrations (module F-DB).
 *
 * Every test states the behaviour the database SHOULD have (BRD §5, §11, B13, B15 and
 * docs/ARCHITECTURE.md §2). The gaps found in the review (documents not tied to an uploaded file,
 * unchecked storage paths, back-dated documents, exited companies still writable by their members,
 * look-alike audit actions, open default privileges) were fixed in the F-DB second pass; all tests
 * are kept as regression tests, together with the probes that were found safe.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, Sql, type TestDb } from "./harness";
import { fillAndSubmit, setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
let q3: string;
const A = SEED.companies.batikBoutique;
const B = SEED.companies.kiddocare;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
  q3 = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [A]);
});

afterEach(async () => {
  await db?.close();
});

/** Runs fn as a DB role with arbitrary JWT claims (like PostgREST, but without the harness defaults). */
function asClaims<T>(role: "anon" | "authenticated", claims: Record<string, unknown>, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return db.pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query(`set local role ${role}`);
    return fn(new Sql(tx));
  });
}

/** Inserts a documents row only (no storage object is uploaded). */
function insertDocumentRow(user: string, company: string, closeId: string | null, storagePath: string, extra = "") {
  return db.asUser(user, (sql) =>
    sql.value<string>(
      `insert into public.documents (company_id, period_close_id, doc_type, file_name, storage_path, mime_type, size_bytes, uploaded_by${extra ? ", created_at" : ""})
       values ($1, $2, 'management_accounts', 'accounts.pdf', $3, 'application/pdf', 2048, auth.uid()${extra ? ", $4::timestamptz" : ""})
       returning id`,
      extra ? [company, closeId, storagePath, extra] : [company, closeId, storagePath],
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Documents and the "management accounts uploaded" rule (B13)
// ---------------------------------------------------------------------------------------------
describe("documents must describe a real upload in the company's folder", () => {
  it("a documents row needs a matching object in the company-documents bucket", async () => {
    const path = `${A}/${q3}/${randomUUID()}-accounts.pdf`;
    expect(await db.count("select 1 from storage.objects where name = $1", [path])).toBe(0);
    await expectPgError(insertDocumentRow(p.batikContributor, A, q3, path));
  });

  it("a period close cannot be confirmed with a documents row that has no uploaded file", async () => {
    await fillAndSubmit(db, p.batikOwner, "batik", ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.batik[m]));
    // A documents row pointing at a file that was never uploaded (refused by the fix; tolerated here).
    await insertDocumentRow(p.batikOwner, A, q3, `${A}/${q3}/${randomUUID()}-accounts.pdf`).catch(() => undefined);
    await expectRule(
      db.asUser(p.batikOwner, (sql) => sql.rpc("confirm_period_close", { p_close_id: q3, p_restated_totals: null, p_reason: null })),
      /Upload the management accounts/,
    );
  });

  it("storage_path cannot contain '..' or empty path segments", async () => {
    const accepted: string[] = [];
    for (const path of [
      `${A}/general/../../${B}/general/${randomUUID()}-x.pdf`,
      `${A}/../${B}/general/${randomUUID()}-x.pdf`,
      `${A}//${randomUUID()}-x.pdf`,
    ]) {
      try {
        await insertDocumentRow(p.batikOwner, A, null, path);
        accepted.push(path);
      } catch {
        // refused: expected
      }
    }
    expect(accepted, "document paths with '..' or empty segments were accepted").toEqual([]);
  });

  it("clients cannot back-date a document's created_at", async () => {
    const path = `${A}/general/${randomUUID()}-old.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
    const id = await insertDocumentRow(p.batikOwner, A, null, path, "2020-01-01T00:00:00Z");
    expect(await db.value("select created_at > now() - interval '1 hour' from public.documents where id = $1", [id])).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Exited / written-off companies are read-only for company users (B15)
// ---------------------------------------------------------------------------------------------
describe("exited companies are read-only for company users", () => {
  let sharedRoot: string;

  beforeEach(async () => {
    sharedRoot = await db.asUser(p.partner, (sql) =>
      sql.value<string>(
        "insert into public.comments (submission_id, visibility, author_id, body) values ($1, 'shared', auth.uid(), 'Please explain July') returning id",
        [p.subs.batik["2026-07-01"]],
      ),
    );
    await db.query("update public.companies set status = 'exited' where id = $1", [A]);
  });

  it("owners cannot add contributors to an exited company", async () => {
    const newcomer = await db.createUser();
    await expectPgError(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [A, newcomer]),
      ),
    );
    expect(await db.asUser(newcomer, (sql) => sql.count("select 1 from public.submissions"))).toBe(0);
  });

  it("company members cannot reply to comments on an exited company", async () => {
    await expectPgError(
      db.asUser(p.batikOwner, (sql) =>
        sql.query(
          "insert into public.comments (submission_id, parent_id, author_id, body) values ($1, $2, auth.uid(), 'Reply after exit')",
          [p.subs.batik["2026-07-01"], sharedRoot],
        ),
      ),
    );
  });

  it("company members cannot resolve threads on an exited company", async () => {
    await expectPgError(
      db.asUser(p.batikContributor, (sql) => sql.rpc("resolve_comment", { p_comment_id: sharedRoot, p_resolved: true })),
    );
    expect(await db.value("select resolved_at from public.comments where id = $1", [sharedRoot])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Audit log integrity
// ---------------------------------------------------------------------------------------------
describe("log_audit_event() cannot be used to write look-alike workflow entries", () => {
  it("refuses action names that mimic database-recorded workflow events", async () => {
    const accepted: string[] = [];
    for (const action of ["approved", "submitted", "resubmitted", "reopened", "changes_requested", "deleted", "confirmed"]) {
      try {
        await db.asUser(p.batikOwner, (sql) =>
          sql.rpc("log_audit_event", {
            p_action: action,
            p_entity: "submissions",
            p_entity_id: p.subs.batik["2026-07-01"],
            p_company_id: A,
            p_summary: `Jul 2026 ${action}`,
          }),
        );
        accepted.push(action);
      } catch {
        // refused: expected
      }
    }
    expect(accepted, "look-alike workflow actions written by a company owner").toEqual([]);
  });

  it("(regression) entries always carry the real caller, whatever the payload says", async () => {
    await db.asUser(p.batikOwner, (sql) =>
      sql.rpc("log_audit_event", {
        p_action: "export",
        p_entity: "submissions",
        p_company_id: A,
        p_data: { actor_id: p.superAdmin, actor_role: "super_admin" },
      }),
    );
    expect(
      await db.one("select actor_id, actor_role, on_behalf from public.audit_log where action = 'export' order by id desc limit 1"),
    ).toEqual({ actor_id: p.batikOwner, actor_role: "company_owner", on_behalf: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Privileges for objects created by later migrations
// ---------------------------------------------------------------------------------------------
describe("default privileges keep new objects away from anon", () => {
  it("a function added by a later migration is not executable by anon", async () => {
    // Simulates a future migration run as postgres that forgets its own revoke.
    await db.exec("create function public.sr_future_rpc() returns int language sql as 'select 1'");
    expect(await db.value("select has_function_privilege('anon', 'public.sr_future_rpc()', 'EXECUTE')")).toBe(false);
    await expectDenied(db.asAnon((sql) => sql.query("select public.sr_future_rpc()")), /permission denied/);
  });

  it("(regression) a table added by a later migration is not readable by anon", async () => {
    await db.exec("create table public.sr_future_table (id int primary key)");
    expect(await db.value("select has_table_privilege('anon', 'public.sr_future_table', 'SELECT')")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Regression tests for probes that turned out safe
// ---------------------------------------------------------------------------------------------
describe("regression: probes that were found safe", () => {
  it("an API session without a user id is never treated as a trusted system caller", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      await expectDenied(
        asClaims(role, { role, aal: "aal2" }, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" })),
      );
      await expectDenied(
        asClaims(role, { role, aal: "aal2" }, (sql) => sql.rpc("log_audit_event", { p_action: "export", p_entity: "x" })),
      );
    }
  });

  it("storage folders spelled in upper case still belong only to their company", async () => {
    const name = `${A.toUpperCase()}/general/${randomUUID()}-upper.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [name]);
    expect(await db.asUser(p.kiddoOwner, (sql) => sql.count("select 1 from storage.objects where name = $1", [name]))).toBe(0);
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from storage.objects where name = $1", [name]))).toBe(1);
    // …and a documents row cannot claim it for the wrong company (string match on the folder).
    await expectPgError(insertDocumentRow(p.kiddoOwner, B, null, name));
  });

  it("RPC errors do not reveal whether another company's rows exist", async () => {
    const messageFor = async (id: string) =>
      (await expectDenied(db.asUser(p.batikOwner, (sql) => sql.rpc("get_submission_validation", { p_submission_id: id })))).message;
    expect(await messageFor(p.subs.kiddo["2026-07-01"])).toBe(await messageFor(randomUUID()));
  });

  it("company users cannot read internal data through view columns or joins", async () => {
    await db.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('USD', '2026-07-01', 4.2)");
    await db.query("update public.companies set reporting_currency = 'USD' where id = $1", [A]);
    const rows = await db.asUser(p.batikOwner, (sql) =>
      sql.query<{ fx: number | null; internal: number; investments: number }>(
        `select v.fx_rate_to_myr as fx,
                (select count(*)::int from public.company_internal ci where ci.company_id = v.company_id) as internal,
                (select count(*)::int from public.fund_investments fi where fi.company_id = v.company_id) as investments
         from public.v_submission_financials v where v.month = '2026-07-01'`,
      ),
    );
    expect(rows).toEqual([{ fx: null, internal: 0, investments: 0 }]);
  });

  it("a company user's reply cannot land in an internal thread or on another submission", async () => {
    const internalRoot = await db.asUser(p.partner, (sql) =>
      sql.value<string>(
        "insert into public.comments (submission_id, visibility, author_id, body) values ($1, 'internal', auth.uid(), 'Internal only') returning id",
        [p.subs.batik["2026-07-01"]],
      ),
    );
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("insert into public.comments (submission_id, parent_id, author_id, body) values ($1, $2, auth.uid(), 'hi')", [
          p.subs.batik["2026-07-01"],
          internalRoot,
        ]),
      ),
      /row-level security/,
    );
    await expectRule(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("insert into public.comments (submission_id, parent_id, author_id, body) values ($1, $2, auth.uid(), 'hi')", [
          p.subs.batik["2026-08-01"],
          internalRoot,
        ]),
      ),
      "You can only reply to a comment on the same monthly update.",
    );
  });
});
