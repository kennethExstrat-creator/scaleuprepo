/**
 * The partner-in-charge is ScaleUp-internal (BRD §6.3, B24): it lives in company_internal (never on the
 * company-visible companies row), only Super Admins assign it, and company users cannot learn the
 * assignment through any table, view, embed or RPC. ScaleUp staff profiles (names, emails, roles) are not
 * visible to company users at all; since the decisions of 1 Oct 2026 (BRD B28) the company side names
 * ScaleUp people "<full name> (ScaleUp)" through public.staff_display_names() only — never an email or a
 * role (tests/db/decisions-2026-10-01.test.ts). Every company always has exactly one company_internal row.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, setupPortfolio, status, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique;
const K = SEED.companies.kiddocare;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" }); // p.partner is in charge of Batik Boutique and Kiddocare
});

afterEach(async () => {
  await db?.close();
});

const ONLY_SUPER_ADMINS = "Only Super Admins can assign the partner-in-charge.";

const assign = (user: string, company: string, partner: string | null) =>
  db.asUser(user, (sql) =>
    sql.query("update public.company_internal set partner_in_charge_id = $2 where company_id = $1 returning company_id", [company, partner]),
  );
const partnerOf = (company: string) =>
  db.value<string | null>("select partner_in_charge_id from public.company_internal where company_id = $1", [company]);

describe("partner-in-charge", () => {
  it("is stored in company_internal (referencing profiles, cleared when the profile goes), not on companies", async () => {
    const columns = await db.query<{ table_name: string }>(
      "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'partner_in_charge_id'",
    );
    expect(columns.map((c) => c.table_name)).toEqual(["company_internal"]);
    expect(
      await db.one(
        `select confrelid::regclass::text as target, confdeltype::text as on_delete from pg_constraint
          where conname = 'company_internal_partner_in_charge_id_fkey'`,
      ),
    ).toEqual({ target: "profiles", on_delete: "n" });
    expect(await partnerOf(A)).toBe(p.partner);
    expect(await partnerOf(SEED.companies.recqa)).toBeNull();
    const leaving = await db.createUser({ scaleupRole: "partner" });
    await db.query("update public.company_internal set partner_in_charge_id = $1 where company_id = $2", [leaving, SEED.companies.recqa]);
    await db.query("delete from auth.users where id = $1", [leaving]);
    expect(await partnerOf(SEED.companies.recqa)).toBeNull();
  });

  it("every company always has one company_internal row: created with the company, never inserted or deleted through the API", async () => {
    expect(await db.count("select 1 from public.companies")).toBe(18);
    expect(await db.count("select 1 from public.company_internal")).toBe(18);
    expect(await db.count("select 1 from public.companies c where not exists (select 1 from public.company_internal i where i.company_id = c.id)")).toBe(0);
    const company = await db.asUser(p.superAdmin, (sql) =>
      sql.value<string>("insert into public.companies (name) values ('Newco') returning id"),
    );
    expect(await db.one("select partner_in_charge_id, internal_rating from public.company_internal where company_id = $1", [company])).toEqual({
      partner_in_charge_id: null,
      internal_rating: null,
    });
    for (const privilege of ["INSERT", "DELETE", "TRUNCATE"]) {
      expect(await db.value("select has_table_privilege('authenticated', 'public.company_internal', $1)", [privilege]), privilege).toBe(false);
    }
    for (const user of [p.superAdmin, p.fundAdmin, p.partner]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.query("delete from public.company_internal where company_id = $1", [A])),
        /permission denied for table company_internal/,
      );
      await expectDenied(
        db.asUser(user, (sql) => sql.query("insert into public.company_internal (company_id) values ($1)", [company])),
        /permission denied for table company_internal/,
      );
    }
    // The row goes with its company.
    await db.asUser(p.superAdmin, (sql) => sql.rpc("delete_company", { p_company_id: company, p_reason: "Created by mistake" }));
    expect(await db.count("select 1 from public.company_internal where company_id = $1", [company])).toBe(0);
  });

  it("only Super Admins assign it; Fund Admins and the partner-in-charge still edit rating, exit status and notes", async () => {
    // Super Admin
    expect(await assign(p.superAdmin, SEED.companies.recqa, p.otherPartner)).toEqual([{ company_id: SEED.companies.recqa }]);
    expect(await partnerOf(SEED.companies.recqa)).toBe(p.otherPartner);
    // Fund Admin: other fields yes, the partner no (not even clearing it).
    await expectDenied(assign(p.fundAdmin, A, p.otherPartner), ONLY_SUPER_ADMINS);
    await expectDenied(assign(p.fundAdmin, A, null), ONLY_SUPER_ADMINS);
    expect(
      await db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.company_internal set internal_rating = 'watch', exit_strategy_status = 'Trade sale' where company_id = $1 returning company_id", [A]),
      ),
    ).toEqual([{ company_id: A }]);
    // Saving the whole row with the partner unchanged is fine (forms send every column).
    expect(
      await db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.company_internal set partner_in_charge_id = $2, notes = 'Board seat' where company_id = $1 returning company_id", [A, p.partner]),
      ),
    ).toEqual([{ company_id: A }]);
    // The partner-in-charge edits the internal fields of their own companies, but cannot hand them over.
    expect(
      await db.asUser(p.partner, (sql) =>
        sql.query("update public.company_internal set internal_rating = 'at_risk', exit_strategy_notes = 'IPO 2029' where company_id = $1 returning company_id", [K]),
      ),
    ).toEqual([{ company_id: K }]);
    await expectDenied(assign(p.partner, K, p.otherPartner), ONLY_SUPER_ADMINS);
    await expectDenied(assign(p.partner, K, null), ONLY_SUPER_ADMINS);
    // Other partners, viewers and company users change nothing.
    for (const user of [p.otherPartner, p.viewer, p.batikOwner]) {
      expect(await db.asUser(user, (sql) => sql.query("update public.company_internal set notes = 'x' where company_id = $1 returning company_id", [A]))).toEqual([]);
      expect(await assign(user, A, user)).toEqual([]);
    }
    expect(await partnerOf(A)).toBe(p.partner);
    expect(await partnerOf(K)).toBe(p.partner);
    // Rows never move to another company.
    await expectRule(
      db.asUser(p.fundAdmin, (sql) => sql.query("update public.company_internal set company_id = $2 where company_id = $1", [A, SEED.companies.huddle])),
      "Company settings cannot be moved to another company.",
    );
    expect(await db.one("select internal_rating, notes, updated_by from public.company_internal where company_id = $1", [A])).toEqual({
      internal_rating: "watch",
      notes: "Board seat",
      updated_by: p.fundAdmin,
    });
    // Assignments are audited (ScaleUp-only audit log).
    const audit = await db.one<{ actor_id: string; old_data: unknown; new_data: unknown }>(
      "select actor_id, old_data, new_data from public.audit_log where entity = 'company_internal' and entity_id = $1 and new_data ? 'partner_in_charge_id' order by id desc limit 1",
      [SEED.companies.recqa],
    );
    expect(audit).toEqual({ actor_id: p.superAdmin, old_data: { partner_in_charge_id: null }, new_data: { partner_in_charge_id: p.otherPartner } });
  });

  it("partner rights follow the assignment in company_internal", async () => {
    const jul = p.subs.batik["2026-07-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await expectDenied(
      db.asUser(p.otherPartner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul })),
      "Only the partner-in-charge or a Super Admin can approve this update.",
    );
    // A Super Admin hands Batik Boutique over to the other partner.
    await assign(p.superAdmin, A, p.otherPartner);
    await expectDenied(
      db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul })),
      "Only the partner-in-charge or a Super Admin can approve this update.",
    );
    await db.asUser(p.otherPartner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    expect(await status(db, jul)).toBe("approved");
    await db.asUser(p.otherPartner, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Restated cash" }));
    expect(await status(db, jul)).toBe("changes_requested");
    // company_internal edits follow too.
    expect(await db.asUser(p.partner, (sql) => sql.query("update public.company_internal set notes = 'x' where company_id = $1 returning 1", [A]))).toEqual([]);
    expect(await db.asUser(p.otherPartner, (sql) => sql.query("update public.company_internal set notes = 'x' where company_id = $1 returning 1", [A]))).toHaveLength(1);
    // is_partner_of() reads company_internal.
    expect(await db.asUser(p.otherPartner, (sql) => sql.value("select private.is_partner_of($1)", [A]))).toBe(true);
    expect(await db.asUser(p.partner, (sql) => sql.value("select private.is_partner_of($1)", [A]))).toBe(false);
    expect(await db.asUser(p.partner, (sql) => sql.value("select private.is_partner_of($1)", [K]))).toBe(true);
    // Only an active, MFA-verified partner counts.
    expect(await db.asUser(p.otherPartner, (sql) => sql.value("select private.is_partner_of($1)", [A]), { aal: "aal1" })).toBe(false);
  });

  it("company users cannot learn the assignment through any table, view, embed or RPC", async () => {
    await assign(p.superAdmin, SEED.companies.recqa, p.otherPartner); // an audited assignment
    for (const user of [p.batikOwner, p.batikContributor, p.kiddoOwner, p.recqaOwner]) {
      await db.asUser(user, async (sql) => {
        // The internal table itself
        expect(await sql.count("select 1 from public.company_internal")).toBe(0);
        // An embed from their own company (PostgREST: companies?select=*,company_internal(*))
        const embedded = await sql.query<{ partner: string | null; rating: string | null }>(
          `select i.partner_in_charge_id as partner, i.internal_rating as rating
             from public.companies c left join public.company_internal i on i.company_id = c.id`,
        );
        expect(embedded.length).toBeGreaterThan(0);
        expect(embedded.every((row) => row.partner === null && row.rating === null)).toBe(true);
        // The audit trail of the assignment
        expect(await sql.count("select 1 from public.audit_log")).toBe(0);
        // The policy helper only ever describes the caller
        expect(await sql.value("select private.is_partner_of($1)", [A])).toBe(false);
      });
    }
    // No other table or view has the column, and no RPC reads or returns it.
    const exposed = await db.query<{ name: string }>(
      `select c.table_name as name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'partner_in_charge_id' and c.table_name <> 'company_internal'`,
    );
    expect(exposed).toEqual([]);
    const rpcs = await db.query<{ name: string }>(
      `select p.proname as name from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and (strpos(p.prosrc, 'partner_in_charge_id') > 0 or strpos(p.prosrc, 'company_internal') > 0
               or strpos(pg_get_function_result(p.oid), 'company_internal') > 0)`,
    );
    expect(rpcs).toEqual([]);
    // A view that joined company_internal would still be filtered by its RLS (security_invoker), but
    // none does.
    const views = await db.query<{ name: string }>(
      `select distinct v.relname as name from pg_depend d
         join pg_rewrite r on r.oid = d.objid
         join pg_class v on v.oid = r.ev_class and v.relkind = 'v'
        where d.refobjid = 'public.company_internal'::regclass`,
    );
    expect(views).toEqual([]);
  });

  it("company users cannot read the profile, email or role of whoever at ScaleUp approved, reopened, sent back or commented", async () => {
    // Only the partner-in-charge or a Super Admin approves, so an approver's role would reveal the
    // assignment; emails and roles stay hidden. (BRD B28: the company side shows their names with a
    // "(ScaleUp)" label, from staff_display_names() only — tests/db/decisions-2026-10-01.test.ts.) Walk a
    // month through every step that records a ScaleUp actor.
    const jul = p.subs.batik["2026-07-01"];
    const aug = p.subs.batik["2026-08-01"];
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul, p_message: "Thanks" }));
    await db.asUser(p.partner, (sql) => sql.rpc("reopen_submission", { p_submission_id: jul, p_reason: "Restated cash" }));
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.otherPartner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Check GP" }));
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await db.asUser(p.fundAdmin, (sql) => sql.rpc("extend_due_date", { p_submission_id: aug, p_new_due_date: "2026-12-31" }));
    await db.asUser(p.fundAdmin, (sql) =>
      sql.rpc("save_submission_values", { p_submission_id: aug, p_values: [{ key: "revenue_total", value_number: 1 }] }),
    );
    await db.asUser(p.partner, (sql) =>
      sql.query("insert into public.comments (submission_id, visibility, body) values ($1, 'shared', 'Please explain July')", [jul]),
    );
    const staff = [p.superAdmin, p.fundAdmin, p.partner, p.otherPartner, p.viewer];
    // The workflow recorded ScaleUp ids in company-visible rows …
    expect(await db.value("select approved_by from public.submissions where id = $1", [jul])).toBe(p.partner);

    for (const user of [p.batikOwner, p.batikContributor]) {
      await db.asUser(user, async (sql) => {
        // … but no ScaleUp profile is visible: no email or role to resolve them with.
        expect(await sql.count("select 1 from public.profiles where scaleup_role is not null")).toBe(0);
        expect(await sql.count("select 1 from public.profiles where id = any($1::uuid[])", [staff])).toBe(0);
        const resolved = await sql.query<{ source: string; name: string | null }>(
          `select 'event:' || e.event as source, pr.full_name as name
             from public.submission_events e left join public.profiles pr on pr.id = e.actor_id
            where e.submission_id in (select id from public.submissions where company_id = $1)
           union all
           select 'approved_by', pr.full_name from public.submissions s left join public.profiles pr on pr.id = s.approved_by
            where s.company_id = $1 and s.approved_by is not null
           union all
           select 'last_saved_by', pr.full_name from public.submissions s left join public.profiles pr on pr.id = s.last_saved_by
            where s.id = $2
           union all
           select 'comment', pr.full_name from public.comments c left join public.profiles pr on pr.id = c.author_id
           order by 1, 2`,
          [A, aug],
        );
        // Company-side actors keep their profiles; no ScaleUp actor resolves to a profile.
        expect(resolved).toEqual([
          { source: "approved_by", name: null },
          { source: "comment", name: null },
          { source: "event:approved", name: null },
          { source: "event:approved", name: null },
          { source: "event:changes_requested", name: null },
          { source: "event:deadline_extended", name: null },
          { source: "event:reopened", name: null },
          { source: "event:resubmitted", name: "Bea Batik" },
          { source: "event:resubmitted", name: "Bea Batik" },
          { source: "event:submitted", name: "Bea Batik" },
          { source: "last_saved_by", name: null },
        ]);
        // Their co-members stay visible.
        expect(await sql.count("select 1 from public.profiles where id = any($1::uuid[])", [[p.batikOwner, p.batikContributor]])).toBe(2);
      });
    }

    // A ScaleUp account that is also a company member (added by a Super Admin) stays hidden too.
    await db.addMember(A, p.otherPartner, "contributor");
    expect(await db.asUser(p.batikContributor, (sql) => sql.count("select 1 from public.profiles where id = $1", [p.otherPartner]))).toBe(0);
    // ScaleUp staff still see everyone, with roles (the review page names the approver).
    expect(
      await db.asUser(p.viewer, (sql) =>
        sql.query("select pr.scaleup_role::text as role from public.submissions s join public.profiles pr on pr.id = s.approved_by where s.id = $1", [jul]),
      ),
    ).toEqual([{ role: "partner" }]);
  });
});
