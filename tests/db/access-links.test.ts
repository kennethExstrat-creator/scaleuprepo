/**
 * public.access_links (BRD B14): our own single-use invitation and sign-in links. Auth plumbing, not
 * business data: only server code with the secret (service-role) key reads and writes it. RLS is on
 * with no policies, and anon / authenticated have no privileges at all. No row-audit trigger (token
 * hashes must never be copied into audit_log); the app logs invite / sign_in_link / invite_revoke
 * with log_audit_event().
 *
 * The database also guards the link itself (private.access_links_guard, public.claim_access_link):
 * - validity at most 7 days (invitations) / 24 hours (sign-in links) from a creation time that is never
 *   in the future;
 * - who may hold a link for whom: a Super Admin for anyone; a company owner only for a contributor who
 *   belongs to none but that owner's own active companies (whoever holds a link can sign in as its
 *   account, so an owner must never get one for an account that also reaches another company);
 * - a link never changes once issued (used_at and revoked_at are set once);
 * - it is used through claim_access_link() only: one conditional UPDATE (single use, database time),
 *   re-checking the account and the issuer, for the service role only.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type Sql, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const BATIK = SEED.companies.batikBoutique;
const KIDDO = SEED.companies.kiddocare;
const RECQA = SEED.companies.recqa;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

/** sha256 hex of 32 random bytes, like the app stores it (the raw token only ever goes into the URL). */
function tokenHash(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

async function createLink(
  sql: Pick<Sql, "value">,
  userId: string,
  options: { purpose?: string; createdBy?: string | null; expiresIn?: string; hash?: string } = {},
): Promise<string> {
  return sql.value<string>(
    `insert into public.access_links (user_id, purpose, token_hash, expires_at, created_by)
     values ($1, $2, $3, now() + $4::interval, $5) returning id`,
    [userId, options.purpose ?? "invite", options.hash ?? tokenHash(), options.expiresIn ?? "7 days", options.createdBy ?? null],
  );
}

/** Issues a link as server code does (service role) on behalf of `issuer`. */
const issue = (issuer: string | null, userId: string, purpose: "invite" | "signin" = "signin", hash = tokenHash()) =>
  db.asService((sql) =>
    createLink(sql, userId, { purpose, createdBy: issuer, expiresIn: purpose === "invite" ? "7 days" : "24 hours", hash }),
  );

type Claimed = { user_id: string; purpose: string; email: string };
/** The accept action: claim_access_link as the service role. */
const claim = (hash: string | null) =>
  db.asService((sql) => sql.query<Claimed>("select * from public.claim_access_link($1)", [hash]));

const usedAt = (hash: string) => db.value<string | null>("select used_at from public.access_links where token_hash = $1", [hash]);

const OWNERS_ONLY_OWN_CONTRIBUTORS =
  "Only ScaleUp can send this person a link, because they are not just a contributor of your company. Ask them to sign in as usual.";
const ISSUERS = "Only Super Admins and company owners can issue invitation and sign-in links.";

describe("access_links", () => {
  it("has the contract columns, keys and checks", async () => {
    const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'access_links' order by ordinal_position`,
    );
    expect(columns.map((c) => [c.column_name, c.data_type, c.is_nullable])).toEqual([
      ["id", "uuid", "NO"],
      ["user_id", "uuid", "NO"],
      ["purpose", "text", "NO"],
      ["token_hash", "text", "NO"],
      ["expires_at", "timestamp with time zone", "NO"],
      ["created_by", "uuid", "YES"],
      ["created_at", "timestamp with time zone", "NO"],
      ["used_at", "timestamp with time zone", "YES"],
      ["revoked_at", "timestamp with time zone", "YES"],
    ]);
    expect(columns.find((c) => c.column_name === "id")?.column_default).toBe("gen_random_uuid()");
    expect(columns.find((c) => c.column_name === "created_at")?.column_default).toBe("now()");
    const fks = await db.query<{ conname: string; target: string; on_delete: string }>(
      `select conname, confrelid::regclass::text as target, confdeltype::text as on_delete
         from pg_constraint where conrelid = 'public.access_links'::regclass and contype = 'f' order by conname`,
    );
    expect(fks).toEqual([
      { conname: "access_links_created_by_fkey", target: "profiles", on_delete: "a" },
      { conname: "access_links_user_id_fkey", target: "profiles", on_delete: "c" },
    ]);
    const indexes = (await db.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename = 'access_links'")).map((r) => r.indexdef);
    expect(indexes.some((d) => /\(user_id\)/.test(d))).toBe(true);
    expect(indexes.some((d) => /UNIQUE INDEX .* \(token_hash\)/.test(d))).toBe(true);

    const link = await createLink(db, p.batikOwner, { purpose: "signin", expiresIn: "24 hours", createdBy: p.superAdmin });
    expect(await db.one("select purpose, used_at, revoked_at, created_by from public.access_links where id = $1", [link])).toEqual({
      purpose: "signin",
      used_at: null,
      revoked_at: null,
      created_by: p.superAdmin,
    });
    // purpose is 'invite' or 'signin'; the token hash is a lower-case hex sha256 and unique.
    await expectPgError(createLink(db, p.batikOwner, { purpose: "reset" }), { code: "23514" });
    await expectPgError(
      db.query("insert into public.access_links (user_id, purpose, token_hash, expires_at) values ($1, 'invite', 'not-a-hash', now() + interval '1 day')", [
        p.batikOwner,
      ]),
      { code: "23514" },
    );
    const hash = tokenHash();
    const insertHash = () =>
      db.query("insert into public.access_links (user_id, purpose, token_hash, expires_at) values ($1, 'invite', $2, now() + interval '1 day')", [
        p.batikOwner,
        hash,
      ]);
    await insertHash();
    await expectPgError(insertHash(), { code: "23505" });
    // A link that is already expired when it is created is refused.
    await expectPgError(createLink(db, p.batikOwner, { expiresIn: "-1 hour" }), { code: "23514" });
  });

  it("invitations last at most 7 days and sign-in links at most 24 hours, from a creation time never in the future", async () => {
    await createLink(db, p.batikOwner, { purpose: "invite", expiresIn: "7 days" });
    await createLink(db, p.batikOwner, { purpose: "signin", expiresIn: "24 hours" });
    await expectPgError(createLink(db, p.batikOwner, { purpose: "invite", expiresIn: "7 days 1 second" }), {
      code: "23514",
      message: /access_links_max_validity/,
    });
    await expectPgError(createLink(db, p.batikOwner, { purpose: "signin", expiresIn: "25 hours" }), {
      code: "23514",
      message: /access_links_max_validity/,
    });
    // Back-dating a link only shortens it; dating it in the future (to stretch the cap) is refused.
    const insertDated = (createdAt: string, expiresAt: string) =>
      db.query(
        `insert into public.access_links (user_id, purpose, token_hash, expires_at, created_at)
         values ($1, 'signin', $2, now() + $3::interval, now() + $4::interval)`,
        [p.batikOwner, tokenHash(), expiresAt, createdAt],
      );
    await insertDated("-2 days", "-1 day");
    await expectPgError(insertDated("30 days", "30 days 12 hours"), { code: "23514", message: "An access link cannot be dated in the future." });
    expect(
      await db.value("select count(*)::int from pg_constraint where conrelid = 'public.access_links'::regclass and conname = 'access_links_max_validity'"),
    ).toBe(1);
  });

  it("is locked away from the API: RLS on, no policies, no privileges for anon or authenticated", async () => {
    expect(await db.value("select relrowsecurity from pg_class where oid = 'public.access_links'::regclass")).toBe(true);
    expect(await db.count("select 1 from pg_policies where schemaname = 'public' and tablename = 'access_links'")).toBe(0);
    for (const role of ["anon", "authenticated"]) {
      expect(
        await db.value("select has_table_privilege($1, 'public.access_links', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')", [role]),
        role,
      ).toBe(false);
      expect(await db.value("select has_function_privilege($1, 'public.claim_access_link(text)', 'EXECUTE')", [role]), role).toBe(false);
    }
    expect(await db.value("select has_table_privilege('service_role', 'public.access_links', 'SELECT, INSERT, UPDATE, DELETE')")).toBe(true);
    expect(await db.value("select has_function_privilege('service_role', 'public.claim_access_link(text)', 'EXECUTE')")).toBe(true);
  });

  it("no signed-in user of any role, and not anon, can read or write links, or claim one", async () => {
    const hash = tokenHash();
    const link = await createLink(db, p.batikOwner, { createdBy: p.superAdmin, hash });
    const statements = [
      "select * from public.access_links",
      `select count(*) from public.access_links where id = '${link}'`,
      `insert into public.access_links (user_id, purpose, token_hash, expires_at) values ('${p.batikOwner}', 'signin', '${tokenHash()}', now() + interval '1 day')`,
      `update public.access_links set used_at = now() where id = '${link}'`,
      `update public.access_links set expires_at = now() + interval '1 year'`,
      `delete from public.access_links where id = '${link}'`,
    ];
    const users = [
      p.superAdmin,
      p.fundAdmin,
      p.partner,
      p.otherPartner,
      p.viewer,
      p.batikOwner,
      p.batikContributor,
      p.kiddoOwner,
      p.kiddoContributor,
      p.recqaOwner,
    ];
    for (const statement of statements) {
      for (const user of users) {
        await expectDenied(db.asUser(user, (sql) => sql.query(statement)), /permission denied for table access_links/);
      }
      await expectDenied(db.asUser(p.batikOwner, (sql) => sql.query(statement), { aal: "aal1" }), /permission denied/);
      await expectDenied(db.asAnon((sql) => sql.query(statement)), /permission denied for table access_links/);
    }
    const claimStatement = `select * from public.claim_access_link('${hash}')`;
    for (const user of users) {
      await expectDenied(db.asUser(user, (sql) => sql.query(claimStatement)), /permission denied for function claim_access_link/);
    }
    await expectDenied(db.asAnon((sql) => sql.query(claimStatement)), /permission denied for function claim_access_link/);
    expect(await db.one("select used_at, revoked_at from public.access_links where id = $1", [link])).toEqual({ used_at: null, revoked_at: null });
  });

  it("server code with the service-role key manages links, and nothing is copied into the audit log", async () => {
    const before = await db.value<number>("select count(*)::int from public.audit_log");
    const link = await db.asService(async (sql) => {
      const id = await createLink(sql, p.kiddoContributor, { createdBy: p.kiddoOwner });
      await sql.query("update public.access_links set used_at = now() where id = $1", [id]);
      const other = await createLink(sql, p.kiddoContributor, { purpose: "signin", expiresIn: "24 hours" });
      await sql.query("update public.access_links set revoked_at = now() where id = $1", [other]);
      await sql.query("delete from public.access_links where id = $1", [other]);
      return id;
    });
    expect(await db.one("select purpose, used_at is not null as used from public.access_links where id = $1", [link])).toEqual({
      purpose: "invite",
      used: true,
    });
    const hash = tokenHash();
    await issue(p.superAdmin, p.kiddoContributor, "signin", hash);
    expect(await claim(hash)).toHaveLength(1);
    expect(await db.value<number>("select count(*)::int from public.audit_log")).toBe(before);
    expect(await db.count("select 1 from public.audit_log where entity = 'access_links'")).toBe(0);
    // Its only trigger is the guard; no row-audit trigger (token hashes must never reach audit_log).
    expect(
      await db.query(
        `select t.tgname, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
          where t.tgrelid = 'public.access_links'::regclass and not t.tgisinternal`,
      ),
    ).toEqual([{ tgname: "access_links_guard", proname: "access_links_guard" }]);
  });

  it("links go with their user (on delete cascade)", async () => {
    const user = await db.createUser({ email: "invitee@batik.test" });
    await db.addMember(BATIK, user, "contributor");
    await createLink(db, user, { createdBy: p.batikOwner });
    await createLink(db, user, { purpose: "signin", expiresIn: "24 hours" });
    expect(await db.count("select 1 from public.access_links where user_id = $1", [user])).toBe(2);
    await db.query("delete from auth.users where id = $1", [user]);
    expect(await db.count("select 1 from public.access_links where user_id = $1", [user])).toBe(0);
  });
});

describe("who may hold a link for whom (BRD B14: the inviter copies and sends it)", () => {
  it("Super Admins issue links for anyone; trusted scripts (no issuer) too", async () => {
    for (const user of [p.batikOwner, p.batikContributor, p.kiddoOwner, p.partner, p.superAdmin]) {
      await issue(p.superAdmin, user);
      await issue(null, user, "invite");
    }
  });

  it("an owner issues links only for contributors who belong to none but the owner's own active companies", async () => {
    // Their own contributor (only in Batik Boutique): yes, both kinds.
    await issue(p.batikOwner, p.batikContributor, "invite");
    await issue(p.batikOwner, p.batikContributor, "signin");
    // A brand-new account the owner just added as a contributor: yes.
    const invitee = await db.createUser({ email: "new@batik.test" });
    await db.asUser(p.batikOwner, (sql) =>
      sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [BATIK, invitee]),
    );
    await issue(p.batikOwner, invitee, "invite");

    // Not for: themselves, a co-owner, ScaleUp staff, someone of another company, an account with no
    // membership of theirs.
    const coOwner = await db.createUser({ email: "cofounder@batik.test" });
    await db.addMember(BATIK, coOwner, "owner");
    const loner = await db.createUser({ email: "loner@example.test" });
    for (const target of [p.batikOwner, coOwner, p.partner, p.kiddoContributor, p.kiddoOwner, loner]) {
      await expectDenied(issue(p.batikOwner, target), OWNERS_ONLY_OWN_CONTRIBUTORS);
    }
  });

  it("an existing account that also reaches another company gets no owner-issued link (ScaleUp issues it)", async () => {
    // A company owner may add the Batik Boutique owner as a Kiddocare contributor (people can work for
    // several portfolio companies), but must not receive a link that signs in as that account.
    await db.asUser(p.kiddoOwner, (sql) =>
      sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor')", [KIDDO, p.batikOwner]),
    );
    await expectDenied(issue(p.kiddoOwner, p.batikOwner), OWNERS_ONLY_OWN_CONTRIBUTORS);
    await expectDenied(issue(p.kiddoOwner, p.batikOwner, "invite"), OWNERS_ONLY_OWN_CONTRIBUTORS);
    // A finance lead shared by two companies with different owners: neither owner, only ScaleUp.
    const shared = await db.createUser({ email: "shared-finance@example.test" });
    await db.addMember(BATIK, shared, "contributor");
    await db.addMember(KIDDO, shared, "contributor");
    await expectDenied(issue(p.batikOwner, shared), OWNERS_ONLY_OWN_CONTRIBUTORS);
    await expectDenied(issue(p.kiddoOwner, shared), OWNERS_ONLY_OWN_CONTRIBUTORS);
    await issue(p.superAdmin, shared);
    // An inactive membership elsewhere still counts (it can be switched back on).
    await db.query("update public.company_members set is_active = false where company_id = $1 and user_id = $2", [KIDDO, shared]);
    await expectDenied(issue(p.batikOwner, shared), OWNERS_ONLY_OWN_CONTRIBUTORS);
    // A contributor of two companies that the same person owns: that owner may.
    await db.addMember(RECQA, p.batikOwner, "owner");
    const both = await db.createUser({ email: "both@example.test" });
    await db.addMember(BATIK, both, "contributor");
    await db.addMember(RECQA, both, "contributor");
    await issue(p.batikOwner, both);
    await expectDenied(issue(p.recqaOwner, both), OWNERS_ONLY_OWN_CONTRIBUTORS);
  });

  it("nobody else issues links: other ScaleUp roles, contributors, owners of read-only companies, inactive accounts", async () => {
    for (const issuer of [p.fundAdmin, p.partner, p.viewer, p.batikContributor]) {
      await expectDenied(issue(issuer, p.batikContributor), ISSUERS);
    }
    // An owner whose company has exited, or whose membership is switched off.
    await db.query("update public.companies set status = 'exited' where id = $1", [KIDDO]);
    await expectDenied(issue(p.kiddoOwner, p.kiddoContributor), ISSUERS);
    await db.query("update public.company_members set is_active = false where company_id = $1 and user_id = $2", [BATIK, p.batikOwner]);
    await expectDenied(issue(p.batikOwner, p.batikContributor), ISSUERS);
    // A deactivated Super Admin.
    await db.query("update public.profiles set is_active = false where id = $1", [p.superAdmin]);
    await expectDenied(issue(p.superAdmin, p.recqaOwner), ISSUERS);
    expect(await db.count("select 1 from public.access_links")).toBe(0);
  });
});

describe("a link never changes once issued", () => {
  it("only used_at and revoked_at are set, each once", async () => {
    const hash = tokenHash();
    const link = await issue(p.superAdmin, p.batikContributor, "invite", hash);
    const update = (set: string, params: unknown[] = []) =>
      db.asService((sql) => sql.query(`update public.access_links set ${set} where id = $1`, [link, ...params]));
    for (const [set, params] of [
      ["expires_at = expires_at + interval '1 hour'", []],
      ["expires_at = now() + interval '1 hour'", []],
      ["token_hash = $2", [tokenHash()]],
      ["user_id = $2", [p.batikOwner]],
      ["purpose = 'signin'", []],
      ["created_by = null", []],
      ["created_at = created_at - interval '1 day'", []],
    ] as [string, unknown[]][]) {
      await expectRule(update(set, params), "An access link cannot be changed. Revoke it and issue a new one.");
    }
    await update("revoked_at = now()");
    await expectRule(update("revoked_at = null"), "This link has already been revoked.");
    await expectRule(update("revoked_at = now() + interval '1 minute'"), "This link has already been revoked.");
    await update("used_at = now()");
    await expectRule(update("used_at = null"), "This link has already been used.");
  });
});

describe("claim_access_link (the accept action of /access/[token])", () => {
  it("claims a valid link exactly once and returns the account to sign in", async () => {
    const hash = tokenHash();
    await issue(p.superAdmin, p.batikContributor, "invite", hash);
    expect(await claim(hash)).toEqual([{ user_id: p.batikContributor, purpose: "invite", email: "finance@batik.test" }]);
    expect(await usedAt(hash)).not.toBeNull();
    // A second use (a double submit, a replayed link) gets nothing.
    expect(await claim(hash)).toEqual([]);
    // The hash is matched in lower case; unknown, malformed or missing tokens get nothing.
    const upper = tokenHash();
    await issue(p.superAdmin, p.batikOwner, "signin", upper);
    expect(await claim(upper.toUpperCase())).toEqual([{ user_id: p.batikOwner, purpose: "signin", email: "owner@batik.test" }]);
    expect(await claim(tokenHash())).toEqual([]);
    expect(await claim("not-a-hash")).toEqual([]);
    expect(await claim(null)).toEqual([]);
  });

  it("gets nothing for revoked or expired links, or deactivated accounts (without using the link up)", async () => {
    const revoked = tokenHash();
    await issue(p.superAdmin, p.batikContributor, "invite", revoked);
    await db.asService((sql) => sql.query("update public.access_links set revoked_at = now() where token_hash = $1", [revoked]));
    expect(await claim(revoked)).toEqual([]);
    expect(await usedAt(revoked)).toBeNull();

    const expired = tokenHash();
    await db.query(
      `insert into public.access_links (user_id, purpose, token_hash, expires_at, created_at, created_by)
       values ($1, 'signin', $2, now() - interval '1 second', now() - interval '1 day', $3)`,
      [p.batikContributor, expired, p.superAdmin],
    );
    expect(await claim(expired)).toEqual([]);
    expect(await usedAt(expired)).toBeNull();

    const deactivated = tokenHash();
    await issue(p.superAdmin, p.kiddoContributor, "signin", deactivated);
    await db.query("update public.profiles set is_active = false where id = $1", [p.kiddoContributor]);
    expect(await claim(deactivated)).toEqual([]);
    await db.query("update public.profiles set is_active = true where id = $1", [p.kiddoContributor]);
    expect(await claim(deactivated)).toHaveLength(1);
  });

  it("re-checks the issuer: an owner's link stops working once its account also reaches another company", async () => {
    const hash = tokenHash();
    await issue(p.batikOwner, p.batikContributor, "signin", hash);
    await db.addMember(KIDDO, p.batikContributor, "contributor"); // e.g. added by a Super Admin later
    expect(await claim(hash)).toEqual([]);
    expect(await usedAt(hash)).toBeNull();
    await db.query("delete from public.company_members where company_id = $1 and user_id = $2", [KIDDO, p.batikContributor]);
    expect(await claim(hash)).toHaveLength(1);
    // Links issued by a Super Admin who has since been deactivated no longer work either.
    const orphan = tokenHash();
    await issue(p.superAdmin, p.recqaOwner, "invite", orphan);
    await db.query("update public.profiles set is_active = false where id = $1", [p.superAdmin]);
    expect(await claim(orphan)).toEqual([]);
  });

  it("is claimed in ONE conditional statement (no read-then-write), so concurrent claims cannot both succeed", async () => {
    const source = await db.value<string>("select prosrc from pg_proc where oid = 'public.claim_access_link(text)'::regprocedure");
    const statements = source.replace(/--[^\n]*/g, "").match(/\b(select|update|insert|delete)\b/gi) ?? [];
    // The UPDATE carries every condition; the only other statements are the sub-select inside it and
    // the final lookup of the claimed account's email.
    expect(source).toMatch(/update public\.access_links l\s+set used_at = now\(\)\s+where l\.token_hash = lower\(p_token_hash\)\s+and l\.used_at is null\s+and l\.revoked_at is null\s+and l\.expires_at > now\(\)/);
    expect(statements.map((s) => s.toLowerCase())).toEqual(["update", "select", "select"]);
  });
});
