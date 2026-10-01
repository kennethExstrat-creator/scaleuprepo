import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;
const B = SEED.companies.kiddocare;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

const RLS = /row-level security/;

describe("profiles", () => {
  it("are created for new auth users from the email and full_name metadata only", async () => {
    const id = await db.createUser({
      email: "new@batik.test",
      fullName: "  Nadia New  ",
      metadata: { scaleup_role: "super_admin", role: "super_admin" },
      appMetadata: { scaleup_role: "super_admin", role: "super_admin" },
    });
    expect(await db.one("select email, full_name, scaleup_role, is_active from public.profiles where id = $1", [id])).toEqual({
      email: "new@batik.test",
      full_name: "Nadia New",
      scaleup_role: null,
      is_active: true,
    });
    const nameless = await db.createUser({ fullName: null });
    expect(await db.value("select full_name from public.profiles where id = $1", [nameless])).toBeNull();
  });

  it("keep the email in sync with auth.users", async () => {
    await db.query("update auth.users set email = 'renamed@batik.test' where id = $1", [p.batikOwner]);
    expect(await db.value("select email from public.profiles where id = $1", [p.batikOwner])).toBe("renamed@batik.test");
    await db.query("update auth.users set raw_user_meta_data = '{}' where id = $1", [p.batikOwner]);
    expect(await db.value("select email from public.profiles where id = $1", [p.batikOwner])).toBe("renamed@batik.test");
  });

  it("are deleted with their auth user", async () => {
    const id = await db.createUser();
    await db.query("delete from auth.users where id = $1", [id]);
    expect(await db.count("select 1 from public.profiles where id = $1", [id])).toBe(0);
  });

  it("cannot be written directly by anyone, so users cannot change their own role", async () => {
    for (const user of [p.batikOwner, p.superAdmin, p.viewer]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.query("update public.profiles set scaleup_role = 'super_admin' where id = auth.uid()")),
        /permission denied for table profiles/,
      );
      await expectDenied(
        db.asUser(user, (sql) => sql.query("update public.profiles set is_active = true where id = auth.uid()")),
        /permission denied for table profiles/,
      );
      await expectDenied(db.asUser(user, (sql) => sql.query("delete from public.profiles where id = auth.uid()")));
    }
    await expectDenied(
      db.asUser(p.batikOwner, (sql) => sql.query("insert into public.profiles (id, email) values (gen_random_uuid(), 'x@y.z')")),
    );
    expect(await db.value("select scaleup_role from public.profiles where id = $1", [p.batikOwner])).toBeNull();
  });

  it("update_my_profile changes only the caller's name and job title", async () => {
    await db.asUser(p.batikOwner, (sql) => sql.rpc("update_my_profile", { p_full_name: "  Bea B. Batik ", p_job_title: " CEO " }));
    expect(await db.one("select full_name, job_title, scaleup_role from public.profiles where id = $1", [p.batikOwner])).toEqual({
      full_name: "Bea B. Batik",
      job_title: "CEO",
      scaleup_role: null,
    });
    await db.asUser(p.batikOwner, (sql) => sql.rpc("update_my_profile", { p_full_name: "Bea Batik" }));
    expect(await db.value("select job_title from public.profiles where id = $1", [p.batikOwner])).toBeNull();
    await expectRule(db.asUser(p.batikOwner, (sql) => sql.rpc("update_my_profile", { p_full_name: "  " })), "Please enter your full name.");
    await expectRule(
      db.asUser(p.batikOwner, (sql) => sql.rpc("update_my_profile", { p_full_name: "x".repeat(201) })),
      "Names and job titles must be 200 characters or fewer.",
    );
    await expectDenied(db.asUser(p.batikOwner, (sql) => sql.rpc("update_my_profile", { p_full_name: "X" }), { aal: "aal1" }));
  });

  it("accept_terms records the current terms version for the caller only", async () => {
    // (setupPortfolio's users have accepted the terms already; these two have not.)
    const newcomer = await db.createUser({ email: "newcomer@batik.test", acceptTerms: false });
    const other = await db.createUser({ email: "other@batik.test", acceptTerms: false });
    await db.addMember(A, newcomer, "contributor");
    await expectRule(
      db.asUser(newcomer, (sql) => sql.rpc("accept_terms", { p_version: "2020-01" })),
      "The terms of use have been updated. Please reload the page and review the latest version.",
    );
    await db.asUser(newcomer, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" }));
    const row = await db.one<{ terms_version: string; accepted: boolean }>(
      "select terms_version, terms_accepted_at is not null as accepted from public.profiles where id = $1",
      [newcomer],
    );
    expect(row).toEqual({ terms_version: "2026-09", accepted: true });
    expect(await db.value("select terms_accepted_at from public.profiles where id = $1", [other])).toBeNull();
    await expectDenied(db.asUser(other, (sql) => sql.rpc("accept_terms", { p_version: "2026-09" }), { aal: "aal1" }));
    expect(await db.value("select terms_accepted_at from public.profiles where id = $1", [other])).toBeNull();
  });
});

describe("admin_update_profile()", () => {
  const update = (caller: string, args: Record<string, unknown>) => db.asUser(caller, (sql) => sql.rpc("admin_update_profile", args));

  it("lets a Super Admin set names, roles and access", async () => {
    await update(p.superAdmin, {
      p_user_id: p.batikContributor,
      p_full_name: "Ben B.",
      p_job_title: "Analyst",
      p_scaleup_role: "partner",
      p_is_active: true,
    });
    expect(await db.one("select full_name, job_title, scaleup_role, is_active from public.profiles where id = $1", [p.batikContributor])).toEqual(
      { full_name: "Ben B.", job_title: "Analyst", scaleup_role: "partner", is_active: true },
    );
    // Null role = company user; blank name keeps the name; null is_active keeps it.
    await update(p.superAdmin, { p_user_id: p.batikContributor, p_full_name: " ", p_job_title: null, p_scaleup_role: null, p_is_active: null });
    expect(await db.one("select full_name, job_title, scaleup_role, is_active from public.profiles where id = $1", [p.batikContributor])).toEqual(
      { full_name: "Ben B.", job_title: null, scaleup_role: null, is_active: true },
    );
    await update(p.superAdmin, { p_user_id: p.viewer, p_full_name: "Vic", p_job_title: null, p_scaleup_role: "viewer", p_is_active: false });
    expect(await db.value("select is_active from public.profiles where id = $1", [p.viewer])).toBe(false);
    expect(await db.asUser(p.viewer, (sql) => sql.count("select 1 from public.companies"))).toBe(0);
  });

  it("is for Super Admins only", async () => {
    for (const user of [p.fundAdmin, p.partner, p.batikOwner]) {
      await expectDenied(
        update(user, { p_user_id: user, p_full_name: "Me", p_job_title: null, p_scaleup_role: "super_admin", p_is_active: true }),
        "Only Super Admins can change user details, roles and access.",
      );
    }
    // A Super Admin session without MFA is not trusted either.
    await expectDenied(
      db.asUser(
        p.superAdmin,
        (sql) =>
          sql.rpc("admin_update_profile", {
            p_user_id: p.viewer,
            p_full_name: "X",
            p_job_title: null,
            p_scaleup_role: "super_admin",
            p_is_active: true,
          }),
        { aal: "aal1" },
      ),
    );
  });

  it("stops Super Admins from demoting or deactivating themselves", async () => {
    for (const args of [
      { p_scaleup_role: "fund_admin", p_is_active: true },
      { p_scaleup_role: null, p_is_active: true },
      { p_scaleup_role: "super_admin", p_is_active: false },
    ]) {
      await expectRule(
        update(p.superAdmin, { p_user_id: p.superAdmin, p_full_name: "Sue", p_job_title: null, ...args }),
        "You cannot remove your own Super Admin role or deactivate your own account.",
      );
    }
    await update(p.superAdmin, { p_user_id: p.superAdmin, p_full_name: "Sue S.", p_job_title: "COO", p_scaleup_role: "super_admin", p_is_active: null });
    expect(await db.one("select full_name, scaleup_role, is_active from public.profiles where id = $1", [p.superAdmin])).toEqual({
      full_name: "Sue S.",
      scaleup_role: "super_admin",
      is_active: true,
    });
    // Another Super Admin can demote them.
    const second = await db.createUser({ scaleupRole: "super_admin" });
    await update(second, { p_user_id: p.superAdmin, p_full_name: "Sue", p_job_title: null, p_scaleup_role: "viewer", p_is_active: true });
    expect(await db.value("select scaleup_role from public.profiles where id = $1", [p.superAdmin])).toBe("viewer");
  });

  it("reports unknown users", async () => {
    await expectRule(
      update(p.superAdmin, {
        p_user_id: "00000000-0000-4000-8000-000000000123",
        p_full_name: "X",
        p_job_title: null,
        p_scaleup_role: null,
        p_is_active: true,
      }),
      "That user was not found.",
    );
  });
});

describe("company memberships", () => {
  const insertMember = (caller: string, company: string, user: string, role: "owner" | "contributor") =>
    db.asUser(caller, (sql) =>
      sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, $3) returning invited_by", [company, user, role]),
    );

  it("owners add, deactivate and remove contributors of their own company", async () => {
    const newcomer = await db.createUser({ email: "cfo@batik.test" });
    expect(await insertMember(p.batikOwner, A, newcomer, "contributor")).toEqual([{ invited_by: p.batikOwner }]);
    expect(await db.asUser(newcomer, (sql) => sql.count("select 1 from public.submissions"))).toBe(3);
    const deactivated = await db.asUser(p.batikOwner, (sql) =>
      sql.query("update public.company_members set is_active = false where user_id = $1 returning is_active", [newcomer]),
    );
    expect(deactivated).toEqual([{ is_active: false }]);
    expect(await db.asUser(newcomer, (sql) => sql.count("select 1 from public.submissions"))).toBe(0);
    const removed = await db.asUser(p.batikOwner, (sql) =>
      sql.query("delete from public.company_members where user_id = $1 returning user_id", [newcomer]),
    );
    expect(removed).toEqual([{ user_id: newcomer }]);
    // A contributor in another portfolio company can be added too (multi-company users).
    await insertMember(p.batikOwner, A, p.kiddoContributor, "contributor");
    expect(await db.asUser(p.kiddoContributor, (sql) => sql.count("select 1 from public.companies"))).toBe(2);
  });

  it("owners cannot create owners, touch other companies, add ScaleUp staff or edit owner rows", async () => {
    const newcomer = await db.createUser();
    await expectDenied(insertMember(p.batikOwner, A, newcomer, "owner"), RLS);
    await expectDenied(insertMember(p.batikOwner, B, newcomer, "contributor"), RLS);
    await expectDenied(insertMember(p.batikOwner, A, p.viewer, "contributor"), RLS);
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("update public.company_members set role = 'owner' where user_id = $1", [p.batikContributor]),
      ),
      RLS,
    );
    await expectDenied(
      db.asUser(p.batikOwner, (sql) =>
        sql.query("update public.company_members set company_id = $1 where user_id = $2", [B, p.batikContributor]),
      ),
      RLS,
    );
    // Owner rows (including their own) are out of reach: nothing is changed.
    const second = await db.createUser();
    await db.addMember(A, second, "owner");
    for (const target of [p.batikOwner, second]) {
      expect(
        await db.asUser(p.batikOwner, (sql) =>
          sql.query("update public.company_members set is_active = false where user_id = $1 and company_id = $2 returning 1", [target, A]),
        ),
      ).toEqual([]);
      expect(
        await db.asUser(p.batikOwner, (sql) => sql.query("delete from public.company_members where user_id = $1 and company_id = $2 returning 1", [target, A])),
      ).toEqual([]);
    }
    expect(
      await db.asUser(p.batikOwner, (sql) => sql.query("delete from public.company_members where company_id = $1 returning 1", [B])),
    ).toEqual([]);
    expect(await db.count("select 1 from public.company_members where company_id = $1", [A])).toBe(3);
  });

  it("contributors and ScaleUp roles other than Super Admin cannot manage memberships", async () => {
    const newcomer = await db.createUser();
    for (const user of [p.batikContributor, p.fundAdmin, p.partner, p.viewer]) {
      await expectDenied(insertMember(user, A, newcomer, "contributor"), RLS);
      expect(await db.asUser(user, (sql) => sql.query("delete from public.company_members returning 1"))).toEqual([]);
    }
  });

  it("Super Admins manage any membership, and invited_by is always the inserting user", async () => {
    const newcomer = await db.createUser();
    const rows = await db.asUser(p.superAdmin, (sql) =>
      sql.query("insert into public.company_members (company_id, user_id, role, invited_by) values ($1, $2, 'owner', $3) returning invited_by", [
        B,
        newcomer,
        p.kiddoOwner,
      ]),
    );
    expect(rows).toEqual([{ invited_by: p.superAdmin }]);
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.company_members set role = 'contributor' where user_id = $1", [newcomer]));
    await db.asUser(p.superAdmin, (sql) => sql.query("delete from public.company_members where user_id = $1", [newcomer]));
    expect(await db.count("select 1 from public.company_members where user_id = $1", [newcomer])).toBe(0);
  });

  it("owners of exited companies can no longer manage contributors (Super Admins still can)", async () => {
    await db.rpc("set_company_status", { p_company_id: A, p_status: "exited", p_reason: "Sold" });
    const newcomer = await db.createUser();
    await expectDenied(insertMember(p.batikOwner, A, newcomer, "contributor"), RLS);
    expect(
      await db.asUser(p.batikOwner, (sql) =>
        sql.query("update public.company_members set is_active = false where user_id = $1 and company_id = $2 returning 1", [p.batikContributor, A]),
      ),
    ).toEqual([]);
    expect(
      await db.asUser(p.batikOwner, (sql) =>
        sql.query("delete from public.company_members where user_id = $1 and company_id = $2 returning 1", [p.batikContributor, A]),
      ),
    ).toEqual([]);
    expect(await db.asUser(newcomer, (sql) => sql.count("select 1 from public.submissions"))).toBe(0);
    await insertMember(p.superAdmin, A, newcomer, "contributor");
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.company_members set is_active = false where user_id = $1", [newcomer]));
  });

  it("owners cannot back-date memberships", async () => {
    const newcomer = await db.createUser();
    await db.asUser(p.batikOwner, (sql) =>
      sql.query(
        `insert into public.company_members (company_id, user_id, role, created_at, updated_at)
         values ($1, $2, 'contributor', '2020-01-01', '2020-01-01')`,
        [A, newcomer],
      ),
    );
    const recent = () =>
      db.one(
        `select created_at > now() - interval '1 hour' as created, updated_at > now() - interval '1 hour' as updated
         from public.company_members where company_id = $1 and user_id = $2`,
        [A, newcomer],
      );
    expect(await recent()).toEqual({ created: true, updated: true });
    await db.asUser(p.batikOwner, (sql) =>
      sql.query("update public.company_members set created_at = '2020-01-01' where company_id = $1 and user_id = $2", [A, newcomer]),
    );
    expect(await recent()).toEqual({ created: true, updated: true });
  });

  it("co-members see each other's profiles only while they share a company", async () => {
    const seen = () => db.asUser(p.batikContributor, (sql) => sql.count("select 1 from public.profiles where id = $1", [p.batikOwner]));
    expect(await seen()).toBe(1);
    await db.query("delete from public.company_members where user_id = $1 and company_id = $2", [p.batikOwner, A]);
    expect(await seen()).toBe(0);
  });
});
