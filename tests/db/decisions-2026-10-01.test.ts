/**
 * Product-owner decisions of 1 Oct 2026 (BRD §13 B28, B29; supabase/migrations/20261001000100_decisions_b28_b29.sql).
 *
 * - B28: on the company side ScaleUp people are shown as "<full name> (ScaleUp)" — through
 *   public.staff_display_names(ids) only. Company users still cannot read any ScaleUp staff profile,
 *   email or role, nor company_internal (the partner-in-charge assignment); the function returns a
 *   display name and nothing else, only for ScaleUp staff ids, only to fully signed-in users.
 * - B29: company owners can have at most platform_settings.owner_contributor_limit (default 4) ACTIVE
 *   contributors per company (a pending invitation is an active membership); deactivated contributors
 *   do not count; ScaleUp (Super Admins, system / service-role callers) is not limited; every signed-in
 *   session reads the limit through get_client_settings().
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contributorLimitMessage, contributorSlotsLeft } from "@/lib/types/domain";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, Sql, type TestDb } from "./harness";
import { fillAndSubmit, setupPortfolio, type Portfolio } from "./scenario";
import { createMigratedDatabase, readMigrations, runSqlFile } from "./schema";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique; // p.batikOwner (owner), p.batikContributor (contributor)
const K = SEED.companies.kiddocare; // p.kiddoOwner, p.kiddoContributor
const R = SEED.companies.recqa; // p.recqaOwner only

const MIGRATION = "20261001000100_decisions_b28_b29.sql";

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Named = { id: string; display_name: string };

const namesFor = (sql: Sql, ids: (string | null)[] | null) =>
  sql.query<Named>("select * from public.staff_display_names($1::uuid[]) order by display_name, id", [ids]);

const staffNames = (user: string, ids: (string | null)[] | null, options: { aal?: "aal1" | "aal2" } = {}) =>
  db.asUser(user, (sql) => namesFor(sql, ids), options);

// ---------------------------------------------------------------------------------------------
// B28
// ---------------------------------------------------------------------------------------------
describe("staff_display_names (BRD B28)", () => {
  it("names ScaleUp staff 'Full Name (ScaleUp)' for company users, and nothing else", async () => {
    const ids = [p.partner, p.fundAdmin, p.superAdmin, p.batikContributor, p.kiddoOwner, randomUUID(), null];
    for (const user of [p.batikOwner, p.batikContributor, p.kiddoOwner]) {
      expect(await staffNames(user, ids), user).toEqual([
        { id: p.fundAdmin, display_name: "Fay Fund (ScaleUp)" },
        { id: p.partner, display_name: "Pat Partner (ScaleUp)" },
        { id: p.superAdmin, display_name: "Sue Super (ScaleUp)" },
      ]);
    }
    // ScaleUp staff can call it too (they also read the profiles themselves).
    expect(await staffNames(p.viewer, [p.viewer, p.batikOwner])).toEqual([{ id: p.viewer, display_name: "Vic Viewer (ScaleUp)" }]);
    // Empty and null inputs give nothing.
    expect(await staffNames(p.batikOwner, [])).toEqual([]);
    expect(await staffNames(p.batikOwner, null)).toEqual([]);
  });

  it("trims names, falls back to 'ScaleUp' without one, and keeps naming deactivated staff (history)", async () => {
    const spaced = await db.createUser({ fullName: "  Renuka Sena  ", scaleupRole: "partner" });
    const nameless = await db.createUser({ fullName: null, scaleupRole: "fund_admin" });
    const blank = await db.createUser({ scaleupRole: "viewer" });
    await db.query("update public.profiles set full_name = '   ' where id = $1", [blank]);
    const former = await db.createUser({ fullName: "Fred Former", scaleupRole: "partner", isActive: false });
    // A ScaleUp account whose role was removed is a company-side account now: not named by this.
    const demoted = await db.createUser({ fullName: "Dee Demoted", scaleupRole: null });
    const byId = (a: Named, b: Named) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect((await staffNames(p.batikOwner, [spaced, nameless, blank, former, demoted])).sort(byId)).toEqual(
      [
        { id: former, display_name: "Fred Former (ScaleUp)" },
        { id: spaced, display_name: "Renuka Sena (ScaleUp)" },
        { id: nameless, display_name: "ScaleUp" },
        { id: blank, display_name: "ScaleUp" },
      ].sort(byId),
    );
  });

  it("resolves the people of a real workflow for the company: approvals, send-backs, comments, on-behalf saves", async () => {
    const jul = p.subs.batik["2026-07-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.otherPartner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Check GP" }));
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul, p_message: "Thanks" }));
    await db.asUser(p.partner, (sql) =>
      sql.query("insert into public.comments (submission_id, visibility, body) values ($1, 'shared', 'Well done')", [jul]),
    );
    const seen = await db.asUser(p.batikContributor, async (sql) => {
      // The ids are company-visible; the profiles behind the ScaleUp ones are not.
      const rows = await sql.query<{ source: string; actor: string | null; profile: string | null }>(
        `select 'event:' || e.event as source, e.actor_id as actor, pr.full_name as profile
           from public.submission_events e left join public.profiles pr on pr.id = e.actor_id
          where e.submission_id = $1
         union all
         select 'approved_by', s.approved_by, pr.full_name
           from public.submissions s left join public.profiles pr on pr.id = s.approved_by where s.id = $1
         union all
         select 'comment', c.author_id, pr.full_name
           from public.comments c left join public.profiles pr on pr.id = c.author_id where c.submission_id = $1
         order by 1`,
        [jul],
      );
      const names = new Map(
        (await namesFor(sql, rows.map((r) => r.actor))).map((r) => [r.id, r.display_name] as const),
      );
      return rows.map((r) => [r.source, r.profile ?? (r.actor ? names.get(r.actor) ?? null : null)]);
    });
    expect(seen).toEqual([
      ["approved_by", "Pat Partner (ScaleUp)"],
      ["comment", "Pat Partner (ScaleUp)"],
      ["event:approved", "Pat Partner (ScaleUp)"],
      ["event:changes_requested", "Oli Other (ScaleUp)"],
      ["event:resubmitted", "Bea Batik"],
      ["event:submitted", "Bea Batik"],
    ]);
  });

  it("never reveals an email, a role or the partner-in-charge, and the staff profiles stay hidden", async () => {
    const staff = [p.superAdmin, p.fundAdmin, p.partner, p.otherPartner, p.viewer];
    expect(await db.value("select pg_get_function_result('public.staff_display_names(uuid[])'::regprocedure)")).toBe(
      "TABLE(id uuid, display_name text)",
    );
    const rows = await staffNames(p.batikOwner, staff);
    // Two columns, the display name only (the names of this cast happen to echo their roles).
    expect(rows.map((row) => Object.keys(row).sort())).toEqual(staff.map(() => ["display_name", "id"]));
    expect(rows.map((row) => row.display_name)).toEqual([
      "Fay Fund (ScaleUp)",
      "Oli Other (ScaleUp)",
      "Pat Partner (ScaleUp)",
      "Sue Super (ScaleUp)",
      "Vic Viewer (ScaleUp)",
    ]);
    expect(JSON.stringify(rows)).not.toContain("@");
    await db.asUser(p.batikOwner, async (sql) => {
      expect(await sql.count("select 1 from public.profiles where scaleup_role is not null")).toBe(0);
      expect(await sql.count("select 1 from public.profiles where id = any($1::uuid[])", [staff])).toBe(0);
      expect(await sql.count("select 1 from public.company_internal")).toBe(0);
    });
    // The function reads nothing ScaleUp-internal.
    const source = await db.value<string>("select prosrc from pg_proc where oid = 'public.staff_display_names(uuid[])'::regprocedure");
    for (const word of ["company_internal", "partner_in_charge", "email", "audit_log"]) {
      expect(source, word).not.toContain(word);
    }
  });

  it("is refused without MFA, with the terms pending, for deactivated accounts and callers without a user", async () => {
    const pending = await db.createUser({ acceptTerms: false });
    await db.addMember(A, pending, "owner");
    const inactive = await db.createUser({ isActive: false });
    await db.addMember(A, inactive, "contributor");
    const SIGN_IN = "Please sign in first.";
    await expectDenied(staffNames(p.batikOwner, [p.partner], { aal: "aal1" }), SIGN_IN);
    await expectDenied(staffNames(p.superAdmin, [p.partner], { aal: "aal1" }), SIGN_IN);
    await expectDenied(staffNames(pending, [p.partner]), SIGN_IN);
    await expectDenied(staffNames(inactive, [p.partner]), SIGN_IN);
    await expectDenied(db.asUser(randomUUID(), (sql) => namesFor(sql, [p.partner])), SIGN_IN); // a JWT without a profile
    await expectDenied(db.asService((sql) => namesFor(sql, [p.partner])), SIGN_IN); // signed-in users only
    await expectDenied(
      db.pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", aal: "aal2" })]);
        await tx.query("set local role authenticated");
        return namesFor(new Sql(tx), [p.partner]);
      }),
      SIGN_IN,
    );
    // anon has no EXECUTE at all.
    await expectDenied(db.asAnon((sql) => namesFor(sql, [p.partner])), /permission denied for function staff_display_names/);
  });

  it("takes at most 500 ids per call", async () => {
    const many = Array.from({ length: 499 }, () => randomUUID());
    expect(await staffNames(p.batikOwner, [...many, p.partner])).toEqual([{ id: p.partner, display_name: "Pat Partner (ScaleUp)" }]);
    await expectRule(staffNames(p.batikOwner, [...many, p.partner, p.fundAdmin]), "Ask for at most 500 names at a time.");
  });

  it("is a stable security definer function with a pinned search_path, executable by authenticated only", async () => {
    expect(
      await db.one(
        "select prosecdef, provolatile::text as volatility, proconfig from pg_proc where oid = 'public.staff_display_names(uuid[])'::regprocedure",
      ),
    ).toEqual({ prosecdef: true, volatility: "s", proconfig: ['search_path=""'] });
    const can = (role: string) =>
      db.value<boolean>("select has_function_privilege($1, 'public.staff_display_names(uuid[])', 'EXECUTE')", [role]);
    expect(await can("authenticated")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(
      await db.value(
        `select exists (select 1 from pg_proc pr, aclexplode(pr.proacl) a
                         where pr.oid = 'public.staff_display_names(uuid[])'::regprocedure and a.grantee = 0)`,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// B29: settings
// ---------------------------------------------------------------------------------------------
describe("owner_contributor_limit (BRD B29: a Super Admin setting)", () => {
  it("defaults to 4, allows 0–100 and is changed by Super Admins only (audited)", async () => {
    expect(await db.value("select owner_contributor_limit from public.platform_settings")).toBe(4);
    expect(
      await db.one(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'platform_settings' and column_name = 'owner_contributor_limit'`,
      ),
    ).toEqual({ data_type: "smallint", is_nullable: "NO", column_default: "4" });
    for (const value of [-1, 101]) {
      await expectPgError(
        db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set owner_contributor_limit = $1", [value])),
        { code: "23514", message: /platform_settings_owner_contributor_limit_check/ },
      );
    }
    for (const user of [p.fundAdmin, p.partner, p.viewer, p.batikOwner]) {
      expect(
        await db.asUser(user, (sql) => sql.query("update public.platform_settings set owner_contributor_limit = 10 returning id")),
        user,
      ).toEqual([]);
    }
    expect(
      await db.asUser(p.superAdmin, (sql) =>
        sql.query("update public.platform_settings set owner_contributor_limit = 6 returning owner_contributor_limit"),
      ),
    ).toEqual([{ owner_contributor_limit: 6 }]);
    expect(
      await db.one(
        "select actor_id, old_data, new_data from public.audit_log where entity = 'platform_settings' order by id desc limit 1",
      ),
    ).toMatchObject({
      actor_id: p.superAdmin,
      old_data: { owner_contributor_limit: 4 },
      new_data: { owner_contributor_limit: 6 },
    });
  });

  it("every signed-in session reads it through get_client_settings(); anon cannot", async () => {
    expect(await db.value("select pg_get_function_result('public.get_client_settings()'::regprocedure)")).toBe(
      "TABLE(require_mfa boolean, terms_version text, declaration_text text, due_day smallint, owner_contributor_limit smallint)",
    );
    await db.query("update public.platform_settings set owner_contributor_limit = 2");
    const pending = await db.createUser({ acceptTerms: false });
    const limit = (sql: Sql) => sql.value<number>("select owner_contributor_limit from public.get_client_settings()");
    for (const run of [
      () => db.asUser(p.batikOwner, limit),
      () => db.asUser(p.batikContributor, limit),
      () => db.asUser(p.superAdmin, limit),
      () => db.asUser(p.kiddoOwner, limit, { aal: "aal1" }),
      () => db.asUser(pending, limit),
      () => db.asService(limit),
    ]) {
      expect(await run()).toBe(2);
    }
    await expectDenied(db.asAnon(limit), /permission denied for function get_client_settings/);
    // The same privileges as before the return shape changed: authenticated and service_role, never anon or PUBLIC.
    const can = (role: string) => db.value<boolean>("select has_function_privilege($1, 'public.get_client_settings()', 'EXECUTE')", [role]);
    expect([await can("authenticated"), await can("service_role"), await can("anon")]).toEqual([true, true, false]);
    expect(
      await db.value(
        "select exists (select 1 from pg_proc pr, aclexplode(pr.proacl) a where pr.oid = 'public.get_client_settings()'::regprocedure and a.grantee = 0)",
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// B29: the limit
// ---------------------------------------------------------------------------------------------
describe("owners invite up to owner_contributor_limit active contributors (BRD B29)", () => {
  const invite = (owner: string, company: string, user: string) =>
    db.asUser(owner, (sql) =>
      sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor') returning user_id", [
        company,
        user,
      ]),
    );
  const setActive = (caller: string, company: string, user: string, active: boolean) =>
    db.asUser(caller, (sql) =>
      sql.query("update public.company_members set is_active = $3 where company_id = $1 and user_id = $2 returning is_active", [
        company,
        user,
        active,
      ]),
    );
  const activeContributors = (company: string) =>
    db.count("select 1 from public.company_members where company_id = $1 and role = 'contributor' and is_active", [company]);
  const newUsers = async (n: number) => Promise.all(Array.from({ length: n }, () => db.createUser()));

  it("an owner can have 4 active contributors (pending invitations count); the 5th is refused", async () => {
    expect(await activeContributors(A)).toBe(1); // p.batikContributor
    const [c2, c3, c4, c5] = await newUsers(4);
    for (const user of [c2, c3, c4]) expect(await invite(p.batikOwner, A, user)).toEqual([{ user_id: user }]);
    expect(await activeContributors(A)).toBe(4);
    const error = await expectRule(invite(p.batikOwner, A, c5), "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.");
    // The app's mirror (src/lib/types/domain.ts) words it exactly like the database.
    expect(error.message).toBe(contributorLimitMessage(4));
    expect(contributorSlotsLeft(4, 4)).toBe(0);
    expect(await db.count("select 1 from public.company_members where user_id = $1", [c5])).toBe(0);
    expect(await db.count("select 1 from public.audit_log where entity = 'company_members' and entity_id = $1", [`${A}:${c5}`])).toBe(0);
    // The limit is per company: Kiddocare's owner is not affected.
    expect(await invite(p.kiddoOwner, K, c5)).toEqual([{ user_id: c5 }]);
  });

  it("deactivated contributors do not count; reactivating one over the limit is refused", async () => {
    const [c2, c3, c4, c5] = await newUsers(4);
    for (const user of [c2, c3, c4]) await invite(p.batikOwner, A, user);
    // Free a place, use it, then try to bring the deactivated contributor back.
    expect(await setActive(p.batikOwner, A, c2, false)).toEqual([{ is_active: false }]);
    expect(await activeContributors(A)).toBe(3);
    expect(await invite(p.batikOwner, A, c5)).toEqual([{ user_id: c5 }]);
    await expectRule(setActive(p.batikOwner, A, c2, true), contributorLimitMessage(4));
    // … also as an upsert (insert … on conflict do update).
    await expectRule(
      db.asUser(p.batikOwner, (sql) =>
        sql.query(
          `insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')
           on conflict (company_id, user_id) do update set is_active = true`,
          [A, c2],
        ),
      ),
      contributorLimitMessage(4),
    );
    expect(await db.value("select is_active from public.company_members where company_id = $1 and user_id = $2", [A, c2])).toBe(false);
    // Changes that add no contributor are always fine at the limit: deactivating, re-saving an active row.
    expect(await setActive(p.batikOwner, A, c3, true)).toEqual([{ is_active: true }]);
    expect(await setActive(p.batikOwner, A, c3, false)).toEqual([{ is_active: false }]);
    expect(await setActive(p.batikOwner, A, c2, true)).toEqual([{ is_active: true }]); // a place is free again
    expect(await activeContributors(A)).toBe(4);
  });

  it("ScaleUp can add more: Super Admins and system / service-role callers are not limited", async () => {
    const [c2, c3, c4, c5, c6, c7, c8] = await newUsers(7);
    for (const user of [c2, c3, c4]) await invite(p.batikOwner, A, user);
    expect(await invite(p.superAdmin, A, c5)).toEqual([{ user_id: c5 }]);
    await db.asService((sql) => sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [A, c6]));
    await db.addMember(A, c7, "contributor"); // a direct database session (data fix)
    expect(await activeContributors(A)).toBe(7);
    // The owner is still held to the limit, and the message gives the real number.
    await expectRule(invite(p.batikOwner, A, c8), "Your team already has 7 contributors. Deactivate one, or ask ScaleUp to add more.");
    // A Super Admin can also reactivate over the limit.
    await setActive(p.superAdmin, A, c2, false);
    await invite(p.superAdmin, A, c8);
    expect(await setActive(p.superAdmin, A, c2, true)).toEqual([{ is_active: true }]);
    expect(await activeContributors(A)).toBe(8);
  });

  it("follows the Super Admin setting: 1 (singular message) and 0 (ScaleUp only)", async () => {
    const [c1, c2, c3] = await newUsers(3);
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set owner_contributor_limit = 1"));
    expect(await invite(p.recqaOwner, R, c1)).toEqual([{ user_id: c1 }]);
    await expectRule(invite(p.recqaOwner, R, c2), "Your team already has 1 contributor. Deactivate one, or ask ScaleUp to add more.");
    expect(contributorLimitMessage(1)).toBe("Your team already has 1 contributor. Deactivate one, or ask ScaleUp to add more.");
    await setActive(p.recqaOwner, R, c1, false);
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set owner_contributor_limit = 0"));
    await expectRule(invite(p.recqaOwner, R, c2), "Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.");
    expect(contributorLimitMessage(0)).toBe("Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.");
    // Raising it again lets the owner continue.
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set owner_contributor_limit = 3"));
    expect(await invite(p.recqaOwner, R, c2)).toEqual([{ user_id: c2 }]);
    expect(await invite(p.recqaOwner, R, c3)).toEqual([{ user_id: c3 }]);
    expect(contributorSlotsLeft(2, 3)).toBe(1);
  });

  it("moving a contributor into a full company is refused too (an owner of both)", async () => {
    await db.addMember(A, p.recqaOwner, "owner"); // p.recqaOwner now owns RECQA and Batik Boutique
    const [c2, c3, c4, mover] = await newUsers(4);
    for (const user of [c2, c3, c4]) await invite(p.batikOwner, A, user);
    await invite(p.recqaOwner, R, mover);
    await expectRule(
      db.asUser(p.recqaOwner, (sql) =>
        sql.query("update public.company_members set company_id = $1 where company_id = $2 and user_id = $3", [A, R, mover]),
      ),
      contributorLimitMessage(4),
    );
    expect(await db.value("select company_id from public.company_members where user_id = $1", [mover])).toBe(R);
  });

  it("reveals nothing about other companies' teams: callers who may not manage the team still get the RLS refusal", async () => {
    const [c2, c3, c4, outsider] = await newUsers(4);
    for (const user of [c2, c3, c4]) await invite(p.batikOwner, A, user);
    // The company's own owner learns that the team is full …
    await expectRule(invite(p.batikOwner, A, outsider), contributorLimitMessage(4));
    // … everyone else gets the usual refusal, exactly as for a team with free places.
    const RLS = /row-level security/;
    await expectDenied(invite(p.kiddoOwner, A, outsider), RLS); // another company's owner
    await expectDenied(invite(p.batikContributor, A, outsider), RLS); // a contributor of the company
    await expectDenied(
      db.asUser(
        p.batikOwner,
        (sql) => sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [A, outsider]),
        { aal: "aal1" },
      ),
      RLS,
    ); // the owner without MFA
  });

  it("is enforced by a security definer BEFORE INSERT OR UPDATE trigger that the API roles cannot call", async () => {
    expect(
      await db.one(
        `select t.tgname, pr.proname, (t.tgtype & 2) <> 0 as before, (t.tgtype & 4) <> 0 as on_insert,
                (t.tgtype & 16) <> 0 as on_update, (t.tgtype & 1) <> 0 as for_each_row,
                pr.prosecdef, pr.proconfig
           from pg_trigger t join pg_proc pr on pr.oid = t.tgfoid
          where t.tgrelid = 'public.company_members'::regclass and t.tgname = 'company_members_contributor_limit'`,
      ),
    ).toEqual({
      tgname: "company_members_contributor_limit",
      proname: "company_members_contributor_limit",
      before: true,
      on_insert: true,
      on_update: true,
      for_each_row: true,
      prosecdef: true,
      proconfig: ['search_path=""'],
    });
    for (const role of ["anon", "authenticated"]) {
      expect(
        await db.value("select has_function_privilege($1, 'private.company_members_contributor_limit()', 'EXECUTE')", [role]),
        role,
      ).toBe(false);
    }
    // Concurrent invitations to one company are serialised (PGlite has a single connection, so this
    // can only be checked in the source).
    const source = await db.value<string>("select prosrc from pg_proc where oid = 'private.company_members_contributor_limit()'::regprocedure");
    expect(source).toContain("pg_advisory_xact_lock");
  });
});

// ---------------------------------------------------------------------------------------------
// The migration itself
// ---------------------------------------------------------------------------------------------
describe(`${MIGRATION}`, () => {
  it("comes after the deployed migrations and can run again on a database that already has it", async () => {
    const names = readMigrations().map((m) => m.name);
    const deployed = names.filter((name) => name.startsWith("20260930"));
    expect(deployed).toHaveLength(9);
    expect(deployed.every((name) => name < MIGRATION)).toBe(true);
    const file = readMigrations().find((m) => m.name === MIGRATION);
    expect(file).toBeDefined();
    if (!file) return;

    const pg = await createMigratedDatabase({ seed: true });
    try {
      await pg.query("update public.platform_settings set owner_contributor_limit = 7");
      await runSqlFile(pg, file); // e.g. a repeated `db push`
      await runSqlFile(pg, file);
      const one = async <T>(sql: string) => (await pg.query<T>(sql)).rows[0];
      expect(await one("select owner_contributor_limit from public.platform_settings")).toEqual({ owner_contributor_limit: 7 });
      expect(
        await one(
          `select (select count(*)::int from pg_trigger where tgname = 'company_members_contributor_limit') as triggers,
                  (select count(*)::int from pg_constraint where conname = 'platform_settings_owner_contributor_limit_check') as checks,
                  (select count(*)::int from pg_proc where proname in ('get_client_settings', 'staff_display_names')) as functions,
                  has_function_privilege('authenticated', 'public.get_client_settings()', 'EXECUTE') as settings_auth,
                  has_function_privilege('anon', 'public.get_client_settings()', 'EXECUTE') as settings_anon,
                  has_function_privilege('authenticated', 'public.staff_display_names(uuid[])', 'EXECUTE') as names_auth,
                  has_function_privilege('anon', 'public.staff_display_names(uuid[])', 'EXECUTE') as names_anon`,
        ),
      ).toEqual({
        triggers: 1,
        checks: 1,
        functions: 2,
        settings_auth: true,
        settings_anon: false,
        names_auth: true,
        names_anon: false,
      });
    } finally {
      await pg.close();
    }
  });
});
