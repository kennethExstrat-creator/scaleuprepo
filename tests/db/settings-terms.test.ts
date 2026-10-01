/**
 * Platform settings and the terms of use.
 *
 * - platform_settings is ScaleUp-only (BRD B27): flag thresholds and escalation rules stay internal.
 *   Every signed-in session — including aal1 (before MFA), terms-pending and deactivated ones, so the
 *   app can route them — reads what it needs through public.get_client_settings():
 *   require_mfa, terms_version, declaration_text, due_day and (BRD B29, decisions 2026-10-01)
 *   owner_contributor_limit.
 * - The terms of use are enforced by the database (BRD B25): until a user has accepted the CURRENT
 *   platform_settings.terms_version (private.terms_ok()), the access helpers give them nothing apart
 *   from their own profile, get_client_settings() and accept_terms(). Bumping the version makes every
 *   user accept again.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, Sql, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

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

type ClientSettings = {
  require_mfa: boolean;
  terms_version: string;
  declaration_text: string;
  due_day: number;
  owner_contributor_limit: number;
};

const DEFAULTS: ClientSettings = {
  require_mfa: true,
  terms_version: "2026-09",
  declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
  due_day: 15,
  owner_contributor_limit: 4,
};

const clientSettings = (sql: Sql) => sql.query<ClientSettings>("select * from public.get_client_settings()");

/** Every public table and view. */
async function publicRelations(): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "select 'public.' || relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1",
  );
  return rows.map((r) => r.name);
}

describe("platform_settings (BRD B27)", () => {
  it("is readable by every ScaleUp role and by no company user", async () => {
    for (const user of [p.superAdmin, p.fundAdmin, p.partner, p.otherPartner, p.viewer]) {
      expect(await db.asUser(user, (sql) => sql.count("select 1 from public.platform_settings")), user).toBe(1);
    }
    for (const user of [p.batikOwner, p.batikContributor, p.kiddoOwner, p.recqaOwner]) {
      expect(await db.asUser(user, (sql) => sql.count("select 1 from public.platform_settings")), user).toBe(0);
      expect(
        await db.asUser(user, (sql) => sql.query("update public.platform_settings set revenue_swing_pct = 1 returning id")),
      ).toEqual([]);
    }
  });

  it("get_client_settings() returns exactly require_mfa, terms_version, declaration_text, due_day and owner_contributor_limit", async () => {
    expect(await db.value("select pg_get_function_result('public.get_client_settings()'::regprocedure)")).toBe(
      "TABLE(require_mfa boolean, terms_version text, declaration_text text, due_day smallint, owner_contributor_limit smallint)",
    );
    expect(
      await db.one("select prosecdef, provolatile::text as volatility, proconfig from pg_proc where oid = 'public.get_client_settings()'::regprocedure"),
    ).toEqual({ prosecdef: true, volatility: "s", proconfig: ['search_path=""'] });
    await db.query("update public.platform_settings set due_day = 10, declaration_text = 'Signed off by the CEO.', revenue_swing_pct = 25");
    expect(await db.asUser(p.kiddoContributor, clientSettings)).toEqual([
      { ...DEFAULTS, due_day: 10, declaration_text: "Signed off by the CEO." },
    ]);
  });

  it("get_client_settings() works for every signed-in session, however far it got, but not for anon", async () => {
    const pending = await db.createUser({ acceptTerms: false });
    await db.addMember(A, pending, "owner");
    const inactive = await db.createUser({ isActive: false });
    const noProfile = randomUUID(); // a JWT whose user has no profile (yet)
    const sessions: [string, () => Promise<ClientSettings[]>][] = [
      ["company owner", () => db.asUser(p.batikOwner, clientSettings)],
      ["contributor", () => db.asUser(p.batikContributor, clientSettings)],
      ["super admin", () => db.asUser(p.superAdmin, clientSettings)],
      ["viewer", () => db.asUser(p.viewer, clientSettings)],
      ["aal1 (before MFA)", () => db.asUser(p.fundAdmin, clientSettings, { aal: "aal1" })],
      ["terms pending", () => db.asUser(pending, clientSettings)],
      ["deactivated", () => db.asUser(inactive, clientSettings)],
      ["no profile", () => db.asUser(noProfile, clientSettings)],
      ["service role", () => db.asService(clientSettings)],
    ];
    for (const [label, run] of sessions) {
      expect(await run(), label).toEqual([DEFAULTS]);
    }
    await expectDenied(db.asAnon(clientSettings), /permission denied for function get_client_settings/);
    // An API session without a user id is refused.
    await expectDenied(
      db.pg.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", aal: "aal2" })]);
        await tx.query("set local role authenticated");
        return clientSettings(new Sql(tx));
      }),
      "Please sign in first.",
    );
  });
});

describe("terms of use are enforced by the database (BRD B25)", () => {
  it("a user who has not accepted the current terms sees nothing but their own profile", async () => {
    const owner = await db.createUser({ email: "new-owner@batik.test", acceptTerms: false });
    await db.addMember(A, owner, "owner");
    const admin = await db.createUser({ email: "new-admin@scaleup.test", scaleupRole: "super_admin", acceptTerms: false });
    const relations = await publicRelations();
    for (const user of [owner, admin]) {
      await db.asUser(user, async (sql) => {
        for (const name of relations) {
          if (name === "public.access_links") continue; // no privileges at all (access-links.test.ts)
          expect(await sql.count(`select 1 from ${name}`), `${name} before accepting the terms`).toBe(name === "public.profiles" ? 1 : 0);
        }
        expect(await sql.value("select id from public.profiles")).toBe(user);
        expect(await sql.count("select 1 from storage.objects")).toBe(0);
        expect(await clientSettings(sql)).toEqual([DEFAULTS]);
      });
      // RPCs that need an active user refuse (the app routes the user to /terms first).
      await expectDenied(db.asUser(user, (sql) => sql.rpc("open_due_periods")), "Please sign in first.");
      await expectDenied(db.asUser(user, (sql) => sql.rpc("get_submission_validation", { p_submission_id: p.subs.batik["2026-07-01"] })));
      await expectDenied(
        db.asUser(user, (sql) => sql.rpc("save_submission_values", { p_submission_id: p.subs.batik["2026-07-01"] })),
      );
      await expectDenied(db.asUser(user, (sql) => sql.rpc("log_audit_event", { p_action: "export", p_entity: "companies" })));
      await expectDenied(db.asUser(user, (sql) => sql.rpc("update_my_profile", { p_full_name: "New Name" })));
    }
    // Writes are refused as well.
    await expectDenied(
      db.asUser(admin, (sql) => sql.query("insert into public.funds (code, name) values ('SV2', 'ScaleUp Ventures 2')")),
      /row-level security/,
    );
    expect(await db.asUser(admin, (sql) => sql.query("update public.companies set website = 'x' returning id"))).toEqual([]);

    // Accepting the terms (exempt from the check) gives access.
    for (const user of [owner, admin]) {
      await db.asUser(user, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" }));
    }
    expect(await db.asUser(owner, (sql) => sql.count("select 1 from public.companies"))).toBe(1);
    expect(await db.asUser(owner, (sql) => sql.count("select 1 from public.submissions"))).toBe(3);
    expect(await db.asUser(admin, (sql) => sql.count("select 1 from public.companies"))).toBe(18);
    expect(await db.asUser(admin, (sql) => sql.count("select 1 from public.platform_settings"))).toBe(1);
  });

  it("changing the terms version makes every user accept again", async () => {
    await db.query("update public.platform_settings set terms_version = '2026-10'");
    for (const user of [p.superAdmin, p.fundAdmin, p.partner, p.viewer, p.batikOwner, p.kiddoContributor]) {
      await db.asUser(user, async (sql) => {
        expect(await sql.count("select 1 from public.companies"), user).toBe(0);
        expect(await sql.count("select 1 from public.submissions"), user).toBe(0);
        expect(await sql.count("select 1 from public.templates"), user).toBe(0);
        expect(await sql.count("select 1 from public.platform_settings"), user).toBe(0);
        expect((await clientSettings(sql))[0].terms_version).toBe("2026-10");
      });
    }
    // The old version can no longer be accepted.
    await expectRule(
      db.asUser(p.batikOwner, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" })),
      "The terms of use have been updated. Please reload the page and review the latest version.",
    );
    await db.asUser(p.batikOwner, (sql) => sql.rpc("accept_terms", { p_version: "2026-10" }));
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.submissions"))).toBe(3);
    expect(await db.asUser(p.batikContributor, (sql) => sql.count("select 1 from public.submissions"))).toBe(0);
    await db.asUser(p.superAdmin, (sql) => sql.rpc("accept_terms", { p_version: "2026-10" }));
    expect(await db.asUser(p.superAdmin, (sql) => sql.count("select 1 from public.companies"))).toBe(18);
    // Accepting is audited as the user.
    expect(
      await db.one("select actor_id, action, summary from public.audit_log where action = 'accept_terms' order by id desc limit 1"),
    ).toEqual({ actor_id: p.superAdmin, action: "accept_terms", summary: "Accepted terms of use 2026-10" });
  });

  it("a Super Admin publishes a new terms version from the settings page, then has to accept it too", async () => {
    // The update itself goes through (its policy checks run against the terms in force when it starts) …
    expect(
      await db.asUser(p.superAdmin, (sql) =>
        sql.query("update public.platform_settings set terms_version = '2026-11' returning terms_version, updated_by"),
      ),
    ).toEqual([{ terms_version: "2026-11", updated_by: p.superAdmin }]);
    // … and from the next statement on, the Super Admin is in the same position as everyone else.
    for (const user of [p.superAdmin, p.fundAdmin, p.batikOwner]) {
      await db.asUser(user, async (sql) => {
        expect(await sql.count("select 1 from public.companies"), user).toBe(0);
        expect(await sql.count("select 1 from public.platform_settings"), user).toBe(0);
        expect((await clientSettings(sql))[0].terms_version, user).toBe("2026-11");
      });
    }
    expect(await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set due_day = 20 returning id"))).toEqual([]);
    await db.asUser(p.superAdmin, (sql) => sql.rpc("accept_terms", { p_version: "2026-11" }));
    expect(await db.asUser(p.superAdmin, (sql) => sql.count("select 1 from public.platform_settings"))).toBe(1);
    // The change is in the (ScaleUp-only) audit log, as the Super Admin.
    expect(
      await db.one(
        `select actor_id, old_data ->> 'terms_version' as old_version, new_data ->> 'terms_version' as new_version
           from public.audit_log where entity = 'platform_settings' and new_data ? 'terms_version' order by id desc limit 1`,
      ),
    ).toEqual({ actor_id: p.superAdmin, old_version: "2026-09", new_version: "2026-11" });
  });

  it("accept_terms() still needs an active account with MFA", async () => {
    const pending = await db.createUser({ acceptTerms: false });
    await expectDenied(
      db.asUser(pending, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" }), { aal: "aal1" }),
      "Please sign in with an active account first.",
    );
    const inactive = await db.createUser({ acceptTerms: false, isActive: false });
    await expectDenied(
      db.asUser(inactive, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" })),
      "Please sign in with an active account first.",
    );
    await expectDenied(db.asAnon((sql) => sql.rpc("accept_terms", { p_version: "2026-09" })));
    await db.asUser(pending, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" }));
    expect(await db.value("select terms_version from public.profiles where id = $1", [pending])).toBe("2026-09");
  });
});
