/**
 * Independent review of the foundation contract patch (docs/build-notes/pending-contract-changes.md A–L),
 * kept as permanent regression tests.
 *
 * - `it("contract: …")` states behaviour the contract / BRD asks for that the review found broken; the
 *   second patch fixed it (the tests were `it.fails` until then).
 * - `it("ok: …")` pins behaviour the review probed and found correct.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, setupPortfolio, status, type Portfolio } from "./scenario";
import { createMigratedDatabase, readSeed, runSqlFile } from "./schema";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique; // p.partner is its partner-in-charge (scenario.ts)
const HUDDLE = SEED.companies.huddle;
const AONE = SEED.companies.aone;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Actor = { event: string; actor: string | null; role: string | null };

/** What a company user can read about who acted on a month (the data layer's timeline select, as SQL). */
const actorsSeenBy = (user: string, submissionId: string) =>
  db.asUser(user, (sql) =>
    sql.query<Actor>(
      `select e.event, pr.id as actor, pr.scaleup_role::text as role
         from public.submission_events e left join public.profiles pr on pr.id = e.actor_id
        where e.submission_id = $1 and e.event in ('approved', 'reopened')
        union all
       select 'approved_by', pr.id, pr.scaleup_role::text
         from public.submissions s join public.profiles pr on pr.id = s.approved_by
        where s.id = $1
        order by 1`,
      [submissionId],
    ),
  );

// ---------------------------------------------------------------------------------------------
// D. Partner-in-charge (BRD §6.3, B24; docs/ARCHITECTURE.md §1: "no table, view, embed or RPC
//    exposes it to company users")
// ---------------------------------------------------------------------------------------------
describe("partner-in-charge on the company side", () => {
  it(
    "contract: company users cannot identify their partner-in-charge once the partner approves or reopens a month",
    async () => {
      const jul = p.subs.batik["2026-07-01"];
      await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
      await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
      await db.asUser(p.partner, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Restated cash" }));
      await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
      await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
      // Only the partner-in-charge (or a Super Admin) can approve or reopen, so an actor whose visible
      // scaleup_role is 'partner' IS the partner-in-charge. submissions.approved_by and
      // submission_events.actor_id are company-visible ids, so ScaleUp profiles must not be: before the
      // fix this returned the partner three times (approved ×2, reopened) plus approved_by.
      const seen = await actorsSeenBy(p.batikContributor, jul);
      expect(seen.filter((row) => row.role === "partner")).toEqual([]);
      // No profile resolves the ids (no email or role). Since BRD B28 (1 Oct 2026) the company side names
      // them "<full name> (ScaleUp)" through staff_display_names() only (decisions-2026-10-01.test.ts).
      expect(seen).toEqual([
        { event: "approved", actor: null, role: null },
        { event: "approved", actor: null, role: null },
        { event: "reopened", actor: null, role: null },
      ]);
    },
  );

  it("ok: company users still cannot read company_internal, reverse-embed it from profiles, or probe it with the helper", async () => {
    await db.asUser(p.batikOwner, async (sql) => {
      expect(
        await sql.count(
          `select 1 from public.profiles pr
            where exists (select 1 from public.company_internal ci where ci.partner_in_charge_id = pr.id)`,
        ),
      ).toBe(0);
      expect(await sql.value("select private.is_partner_of($1)", [A])).toBe(false);
    });
  });

  it("ok: Fund Admins and the partner-in-charge cannot reassign it with other statement shapes", async () => {
    for (const user of [p.fundAdmin, p.partner]) {
      await expectDenied(
        db.asUser(user, (sql) =>
          sql.query(
            "update public.company_internal ci set (partner_in_charge_id, notes) = (select $2::uuid, 'x') where ci.company_id = $1",
            [A, p.otherPartner],
          ),
        ),
        "Only Super Admins can assign the partner-in-charge.",
      );
      await expectDenied(
        db.asUser(user, (sql) =>
          sql.query(
            `update public.company_internal ci set partner_in_charge_id = pr.id
               from public.profiles pr where pr.id = $2 and ci.company_id = $1`,
            [A, p.otherPartner],
          ),
        ),
        "Only Super Admins can assign the partner-in-charge.",
      );
    }
    expect(await db.value("select partner_in_charge_id from public.company_internal where company_id = $1", [A])).toBe(p.partner);
  });
});

// ---------------------------------------------------------------------------------------------
// G. Exited / written-off companies are read-only (BRD B15, B21)
// ---------------------------------------------------------------------------------------------
describe("period closes of exited companies", () => {
  it(
    "contract: a confirmed close of an exited company is not left unconfirmable (reopen refused, or it can be confirmed again)",
    async () => {
      const months = ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.batik[m]);
      await fillAndSubmit(db, p.batikOwner, "batik", months);
      const close = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [A]);
      const path = `${A}/${close}/${randomUUID()}-accounts.pdf`;
      await db.asUser(p.batikOwner, async (sql) => {
        await sql.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
        await sql.query(
          "insert into public.documents (company_id, period_close_id, file_name, storage_path) values ($1, $2, 'accounts.pdf', $3)",
          [A, close, path],
        );
      });
      await db.asUser(p.batikOwner, (sql) => sql.rpc("confirm_period_close", { p_close_id: close }));
      await db.asUser(p.superAdmin, (sql) =>
        sql.rpc("set_company_status", { p_company_id: A, p_status: "exited", p_reason: "Trade sale" }),
      );
      // Before the fix reopen_period_close succeeded for the exited company (status open, computed_totals
      // and confirmed_at/by cleared) … (now it is refused with the read-only P0001)
      const reopened = await db
        .asUser(p.fundAdmin, (sql) => sql.rpc("reopen_period_close", { p_close_id: close, p_reason: "Check" }))
        .then(
          () => true,
          () => false,
        );
      if (!reopened) return; // refusing the reopen would satisfy the contract
      // … and then nobody can confirm it again: the owner and a Fund Admin on behalf both get P0001
      // "Batik Boutique is no longer an active portfolio company, so its records are read-only."
      for (const user of [p.fundAdmin, p.batikOwner]) {
        await db.asUser(user, (sql) => sql.rpc("confirm_period_close", { p_close_id: close })).catch(() => undefined);
      }
      expect(await db.value("select status::text from public.period_closes where id = $1", [close])).toBe("confirmed");
    },
  );
});

// ---------------------------------------------------------------------------------------------
// A. Nullable reporting_start_month (BRD B16): onboarding opens exactly the right months
// ---------------------------------------------------------------------------------------------
describe("onboarding a company that is not yet reporting", () => {
  const monthsOf = (company: string) =>
    db.query<{ month: string; due_date: string }>(
      "select month, due_date from public.submissions where company_id = $1 order by month",
      [company],
    );
  const closeLabels = async (company: string) =>
    (
      await db.query<{ label: string }>(
        "select label from public.period_closes where company_id = $1 order by period_end, period_start desc",
        [company],
      )
    ).map((c) => c.label);

  it("ok: opens the missing months from the start month, the month opened early included, with the backfill grace", async () => {
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" })); // Oct opened early
    await db.asUser(p.superAdmin, (sql) =>
      sql.query("update public.companies set reporting_start_month = '2026-08-17' where id = $1", [HUDDLE]),
    );
    expect(await db.asUser(p.superAdmin, (sql) => sql.rpc<number>("open_due_periods"))).toBe(3 + 1);
    expect(await monthsOf(HUDDLE)).toEqual([
      { month: "2026-08-01", due_date: "2026-11-03" }, // past its due date on 20 Oct: 14 days from today
      { month: "2026-09-01", due_date: "2026-11-03" },
      { month: "2026-10-01", due_date: "2026-11-15" }, // not yet due: the period's own due date
    ]);
    expect(await closeLabels(HUDDLE)).toEqual(["Q3 2026"]);
    // Idempotent, for every caller.
    expect(await db.rpc("open_due_periods")).toBe(0);
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" }));
    expect(await monthsOf(HUDDLE)).toHaveLength(3);
  });

  it("ok: a start month before every open period opens those months for that company only", async () => {
    const others = () => db.count("select 1 from public.submissions where company_id <> $1", [AONE]);
    const before = await others();
    await db.asUser(p.superAdmin, (sql) =>
      sql.query("update public.companies set reporting_start_month = '2026-05-01' where id = $1", [AONE]),
    );
    await db.asUser(p.superAdmin, (sql) => sql.rpc("open_due_periods"));
    expect(await others()).toBe(before);
    expect((await monthsOf(AONE)).map((m) => m.month)).toEqual([
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(await closeLabels(AONE)).toEqual(["Q2 2026", "H1 2026", "Q3 2026"]);
  });

  it("ok: a written-off company gets no months even with a start month; a future start month opens nothing yet", async () => {
    await db.asUser(p.superAdmin, async (sql) => {
      await sql.query("update public.companies set reporting_start_month = '2026-07-01' where id = $1", [SEED.companies.stayHere]);
      await sql.query("update public.companies set reporting_start_month = '2027-01-01' where id = $1", [HUDDLE]);
    });
    await db.asUser(p.superAdmin, (sql) => sql.rpc("open_due_periods"));
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-10-01" }));
    expect(await monthsOf(SEED.companies.stayHere)).toEqual([]);
    expect(await monthsOf(HUDDLE)).toEqual([]);
    expect(await status(db, p.subs.batik["2026-07-01"])).toBe("draft");
    await expectRule(
      db.asUser(p.fundAdmin, (sql) => sql.rpc("open_period", { p_month: "2026-06-01" })),
      "Months before Jul 2026 cannot be opened.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// B. Seed: re-running it never undoes what admins changed
// ---------------------------------------------------------------------------------------------
describe("seed re-runs", () => {
  it("ok: keep partner assignments, internal fields, start months, statuses, currencies, investments and KPIs", async () => {
    const pg = await createMigratedDatabase({ seed: true });
    try {
      const partner = randomUUID();
      await pg.query(
        `insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
         values ($1, 'partner@seed.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb)`,
        [partner],
      );
      await pg.query("update public.profiles set scaleup_role = 'partner' where id = $1", [partner]);
      await pg.query("update public.company_internal set partner_in_charge_id = $1, notes = 'Board seat' where company_id = $2", [partner, HUDDLE]);
      await pg.query("update public.companies set reporting_start_month = '2026-08-01' where id = $1", [HUDDLE]);
      await pg.query("update public.companies set status = 'active', status_reason = null where id = $1", [SEED.companies.stayHere]);
      await pg.query("update public.companies set reporting_currency = 'SGD' where id = $1", [SEED.companies.iMotorbike]);
      await pg.query("update public.fund_investments set ownership_pct = 12.5 where company_id = $1", [HUDDLE]);
      await pg.query("update public.company_kpis set is_required = false where company_id = $1", [HUDDLE]);
      const snapshot = async () =>
        (
          await pg.query(
            `select (select json_agg(c order by c.id) from public.companies c) as companies,
                    (select json_agg(i order by i.company_id) from public.company_internal i) as internal,
                    (select json_agg(f order by f.id) from public.fund_investments f) as investments,
                    (select json_agg(k order by k.id) from public.company_kpis k) as kpis,
                    (select json_agg(f order by f.id) from public.funds f) as funds`,
          )
        ).rows[0];
      const before = await snapshot();
      await runSqlFile(pg, readSeed());
      await runSqlFile(pg, readSeed());
      expect(await snapshot()).toEqual(before);
    } finally {
      await pg.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// C. access_links: nothing but the service role reaches it
// ---------------------------------------------------------------------------------------------
describe("access-link flow of the contract (M2)", () => {
  it("ok (database backstop): an owner can attach another company's owner as a contributor, but never hold a link for that account", async () => {
    // The contract's invite flow is "admin.createUser (or reuse) → membership (insert as the caller) →
    // insert the link → show the URL to the inviter", and owners may re-issue sign-in links for their
    // contributors. Whoever holds a link can sign in as its account, so for an EXISTING account that
    // belongs to another company the database refuses the owner's link (private.access_links_guard):
    // the person signs in as usual, or ScaleUp issues the link. (Before the second patch nothing did.)
    const K = SEED.companies.kiddocare;
    expect(
      await db.asUser(p.kiddoOwner, (sql) =>
        sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor') returning role", [
          K,
          p.batikOwner,
        ]),
      ),
    ).toEqual([{ role: "contributor" }]);
    await db.asUser(p.kiddoOwner, (sql) =>
      sql.rpc("log_audit_event", {
        p_action: "sign_in_link",
        p_entity: "access_links",
        p_company_id: K,
        p_summary: "Sign-in link for a contributor",
      }),
    );
    // The account the Kiddocare owner would receive a link for is the Batik Boutique owner's.
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.companies where id = $1", [A]))).toBe(1);
    const link = (createdBy: string, purpose: "invite" | "signin") =>
      db.asService((sql) =>
        sql.query(
          `insert into public.access_links (user_id, purpose, token_hash, expires_at, created_by)
           values ($1, $2, $3, now() + interval '1 day', $4)`,
          [p.batikOwner, purpose, createHash("sha256").update(randomBytes(32)).digest("hex"), createdBy],
        ),
      );
    for (const purpose of ["invite", "signin"] as const) {
      await expectDenied(
        link(p.kiddoOwner, purpose),
        "Only ScaleUp can send this person a link, because they are not just a contributor of your company. Ask them to sign in as usual.",
      );
    }
    await link(p.superAdmin, "signin");
    expect(await db.count("select 1 from public.access_links where user_id = $1", [p.batikOwner])).toBe(1);
  });
});

describe("access_links reachability", () => {
  it("ok: only the service-role-only claim_access_link() uses it, no view does, and anon / authenticated / PUBLIC hold no table or column privilege", async () => {
    // (Corrected in the second patch: the single-use claim is now an RPC, reachable by the service role
    // only; before, no function used the table at all.)
    const users = await db.query<{ name: string; api: boolean }>(
      `select n.nspname || '.' || p.proname as name,
              has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
                or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            where a.grantee = 0 and a.privilege_type = 'EXECUTE') as api
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and strpos(p.prosrc, 'access_links') > 0
        order by 1`,
    );
    expect(users).toEqual([{ name: "public.claim_access_link", api: false }]);
    expect(
      await db.query(
        `select distinct v.relname as name from pg_depend d
           join pg_rewrite r on r.oid = d.objid
           join pg_class v on v.oid = r.ev_class
          where d.refobjid = 'public.access_links'::regclass`,
      ),
    ).toEqual([]);
    expect(
      await db.query(
        `select grantee, privilege_type from information_schema.table_privileges
          where table_schema = 'public' and table_name = 'access_links' and grantee in ('anon', 'authenticated', 'PUBLIC')
         union all
         select grantee, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'access_links' and grantee in ('anon', 'authenticated', 'PUBLIC')`,
      ),
    ).toEqual([]);
  });
});
