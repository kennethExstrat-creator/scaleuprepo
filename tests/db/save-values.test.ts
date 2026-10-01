import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type TestDb } from "./harness";
import { fillValid, save, setupPortfolio, submit, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
let jul: string;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
  jul = p.subs.batik["2026-07-01"];
});

afterEach(async () => {
  await db?.close();
});

async function storedValues(submissionId: string) {
  return db.query<{ field_key: string; value_number: number | null; value_text: string | null; value_json: unknown }>(
    "select field_key, value_number, value_text, value_json from public.submission_values where submission_id = $1 order by field_key",
    [submissionId],
  );
}

describe("save_submission_values()", () => {
  it("upserts typed values and KPI cells and returns last_saved_at", async () => {
    const savedAt = await db.asUser(p.batikOwner, (sql) =>
      save(sql, jul, {
        values: [
          { key: "revenue_total", value_number: 1000.5 },
          { key: "key_milestones", value_text: "Opened the Merdeka 118 outlet" },
          { key: "fundraising_status", value_text: "Actively raising" },
          { key: "team_morale", value_number: 4 },
          { key: "help_tags", value_json: ["Hiring", "Finance"] },
        ],
        kpis: [
          { kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: SEED.outlets.montKiara, value_number: 500 },
          { kpi_id: SEED.kpis.profitable, dimension_member_id: SEED.outlets.montKiara, value_bool: true },
        ],
      }),
    );
    expect(await storedValues(jul)).toEqual([
      { field_key: "fundraising_status", value_number: null, value_text: "Actively raising", value_json: null },
      { field_key: "help_tags", value_number: null, value_text: null, value_json: ["Hiring", "Finance"] },
      { field_key: "key_milestones", value_number: null, value_text: "Opened the Merdeka 118 outlet", value_json: null },
      { field_key: "revenue_total", value_number: 1000.5, value_text: null, value_json: null },
      { field_key: "team_morale", value_number: 4, value_text: null, value_json: null },
    ]);
    const submission = await db.one<{ last_saved_at: string; last_saved_by: string }>(
      "select last_saved_at, last_saved_by from public.submissions where id = $1",
      [jul],
    );
    expect(submission.last_saved_by).toBe(p.batikOwner);
    expect(savedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(savedAt).toBe(submission.last_saved_at);
    expect(
      await db.query(
        `select kpi_id, dimension_member_id, value_number, value_bool from public.submission_kpi_values
         where submission_id = $1 order by kpi_id`,
        [jul],
      ),
    ).toEqual([
      { kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: SEED.outlets.montKiara, value_number: 500, value_bool: null },
      { kpi_id: SEED.kpis.profitable, dimension_member_id: SEED.outlets.montKiara, value_number: null, value_bool: true },
    ]);

    // Upsert: the same keys again replace the stored values.
    await db.asUser(p.batikOwner, (sql) =>
      save(sql, jul, {
        values: [{ key: "revenue_total", value_number: 2000 }],
        kpis: [{ kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: SEED.outlets.montKiara, value_number: 750 }],
      }),
    );
    expect(await db.value("select value_number from public.submission_values where submission_id = $1 and field_key = 'revenue_total'", [jul])).toBe(2000);
    expect(await db.count("select 1 from public.submission_kpi_values where submission_id = $1", [jul])).toBe(2);
    expect(
      await db.value(
        "select value_number from public.submission_kpi_values where submission_id = $1 and kpi_id = $2",
        [jul, SEED.kpis.revenuePerOutlet],
      ),
    ).toBe(750);
    // KPIs without a dimension use a null member (unique nulls not distinct).
    const kiddoJul = p.subs.kiddo["2026-07-01"];
    for (const value of [10, 12]) {
      await db.asUser(p.kiddoOwner, (sql) =>
        save(sql, kiddoJul, { kpis: [{ kpi_id: SEED.kpis.appDownloads, dimension_member_id: null, value_number: value }] }),
      );
    }
    expect(await db.query("select value_number from public.submission_kpi_values where submission_id = $1", [kiddoJul])).toEqual([
      { value_number: 12 },
    ]);
  });

  it("deletes the stored row when an entry is empty", async () => {
    const segment = await db.value<string>(
      "insert into public.revenue_segments (company_id, name) values ($1, 'Retail') returning id",
      [SEED.companies.batikBoutique],
    );
    await db.asUser(p.batikOwner, (sql) =>
      save(sql, jul, {
        values: [
          { key: "revenue_total", value_number: 10 },
          { key: "key_milestones", value_text: "Something" },
          { key: "help_tags", value_json: ["Hiring"] },
        ],
        segments: [{ segment_id: segment, amount: 10 }],
        kpis: [{ kpi_id: SEED.kpis.profitable, dimension_member_id: SEED.outlets.theRow, value_bool: false }],
      }),
    );
    expect(await db.count("select 1 from public.submission_values where submission_id = $1", [jul])).toBe(3);
    await db.asUser(p.batikOwner, (sql) =>
      save(sql, jul, {
        values: [
          { key: "revenue_total", value_number: null },
          { key: "key_milestones", value_text: "   " },
          { key: "help_tags", value_json: [] },
        ],
        segments: [{ segment_id: segment, amount: null }],
        kpis: [{ kpi_id: SEED.kpis.profitable, dimension_member_id: SEED.outlets.theRow, value_bool: null }],
      }),
    );
    expect(await db.count("select 1 from public.submission_values where submission_id = $1", [jul])).toBe(0);
    expect(await db.count("select 1 from public.submission_segment_values where submission_id = $1", [jul])).toBe(0);
    expect(await db.count("select 1 from public.submission_kpi_values where submission_id = $1", [jul])).toBe(0);
    // Keys with no value at all also count as empty.
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, { values: [{ key: "revenue_total" }] }));
  });

  it("accepts empty lists for every argument", async () => {
    const savedAt = await db.asUser(p.batikContributor, (sql) => save(sql, jul, {}));
    expect(savedAt).toBeTruthy();
  });

  it("rejects unknown keys, wrong value types and invalid choices", async () => {
    const attempt = (values: unknown[]) =>
      db.asUser(p.batikOwner, (sql) =>
        sql.rpc("save_submission_values", { p_submission_id: jul, p_values: values, p_segments: [], p_kpis: [] }),
      );
    await expectRule(attempt([{ key: "made_up", value_number: 1 }]), `Unknown field "made_up" for this month's form.`);
    await expectRule(attempt([{ key: "revenue_total", value_text: "1000" }]), '"Total revenue" expects a number.');
    await expectRule(attempt([{ key: "revenue_total", value_number: "1000" }]), '"Total revenue" expects a number.');
    await expectRule(attempt([{ key: "key_milestones", value_number: 1 }]), '"Key milestones" expects text.');
    await expectRule(
      attempt([{ key: "fundraising_status", value_text: "Buying a yacht" }]),
      'Choose one of the listed options for "Fundraising status".',
    );
    await expectRule(attempt([{ key: "team_morale", value_number: 6 }]), '"Team morale" must be a whole number from 1 to 5.');
    await expectRule(attempt([{ key: "team_morale", value_number: 2.5 }]), '"Team morale" must be a whole number from 1 to 5.');
    await expectRule(
      attempt([{ key: "help_tags", value_json: ["Hiring", "Yachts"] }]),
      '"Yachts" is not one of the tags for "Help needed (tags)".',
    );
    await expectRule(attempt([{ key: "help_tags", value_json: "Hiring" }]), '"Help needed (tags)" expects a list of tags.');
    await expectRule(attempt([{ value_number: 1 }]), "Each value needs a field key.");
    await expectRule(attempt([{ key: "revenue_total", value_number: 1e16 }]), 'The value for "Total revenue" is too large.');
    await expectRule(
      attempt([{ key: "key_milestones", value_text: "x".repeat(20001) }]),
      '"Key milestones" is too long (20000 characters maximum).',
    );
    await expectRule(
      db.asUser(p.batikOwner, (sql) =>
        sql.rpc("save_submission_values", { p_submission_id: jul, p_values: { key: "revenue_total" }, p_segments: [], p_kpis: [] }),
      ),
      "Values, segments and KPIs must each be sent as a list.",
    );
    // Nothing was written by the failed calls.
    expect(await db.count("select 1 from public.submission_values where submission_id = $1", [jul])).toBe(0);
  });

  it("rejects segments, KPIs and dimension members that do not belong to the company or KPI", async () => {
    const kiddoSegment = await db.value<string>(
      "insert into public.revenue_segments (company_id, name) values ($1, 'Subscriptions') returning id",
      [SEED.companies.kiddocare],
    );
    const kiddoDimension = await db.value<string>(
      "insert into public.kpi_dimensions (company_id, name) values ($1, 'City') returning id",
      [SEED.companies.kiddocare],
    );
    const kiddoMember = await db.value<string>(
      "insert into public.kpi_dimension_members (dimension_id, name) values ($1, 'Penang') returning id",
      [kiddoDimension],
    );
    const attempt = (payload: Parameters<typeof save>[2]) => db.asUser(p.batikOwner, (sql) => save(sql, jul, payload));

    await expectRule(
      attempt({ segments: [{ segment_id: kiddoSegment, amount: 10 }] }),
      "That revenue segment does not belong to Batik Boutique.",
    );
    await expectRule(
      attempt({ segments: [{ segment_id: "not-a-uuid", amount: 10 }] }),
      "That revenue segment does not belong to Batik Boutique.",
    );
    await expectRule(
      attempt({ kpis: [{ kpi_id: SEED.kpis.appDownloads, dimension_member_id: null, value_number: 1 }] }),
      "That KPI does not belong to Batik Boutique.",
    );
    await expectRule(
      attempt({ kpis: [{ kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: kiddoMember, value_number: 1 }] }),
      'Choose a valid outlet for "Revenue per outlet".',
    );
    await expectRule(
      attempt({ kpis: [{ kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: null, value_number: 1 }] }),
      'Choose a valid outlet for "Revenue per outlet".',
    );
    await expectRule(
      db.asUser(p.kiddoOwner, (sql) =>
        save(sql, p.subs.kiddo["2026-07-01"], {
          kpis: [{ kpi_id: SEED.kpis.appDownloads, dimension_member_id: kiddoMember, value_number: 1 }],
        }),
      ),
      '"App downloads" is not reported per dimension member.',
    );
    await expectRule(
      attempt({ kpis: [{ kpi_id: SEED.kpis.profitable, dimension_member_id: SEED.outlets.theRow, value_number: 1 }] }),
      '"Profitable" must be yes or no.',
    );
    await expectRule(
      db.asUser(p.kiddoOwner, (sql) =>
        save(sql, p.subs.kiddo["2026-07-01"], {
          kpis: [{ kpi_id: SEED.kpis.bookings, dimension_member_id: null, value_number: 3.5 }],
        }),
      ),
      '"Bookings" must be a whole number.',
    );
  });

  it("only accepts half-yearly KPI values in June and December", async () => {
    await db.query("update public.company_kpis set frequency = 'half_yearly' where id = $1", [SEED.kpis.bookings]);
    await expectRule(
      db.asUser(p.kiddoOwner, (sql) =>
        save(sql, p.subs.kiddo["2026-07-01"], {
          kpis: [{ kpi_id: SEED.kpis.bookings, dimension_member_id: null, value_number: 3 }],
        }),
      ),
      '"Bookings" is reported in June and December only.',
    );
    // Clearing is always allowed.
    await db.asUser(p.kiddoOwner, (sql) =>
      save(sql, p.subs.kiddo["2026-07-01"], { kpis: [{ kpi_id: SEED.kpis.bookings, dimension_member_id: null, value_number: null }] }),
    );
    await db.setToday("2027-01-10");
    await db.rpc("open_due_periods");
    const dec = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-12-01'", [
      SEED.companies.kiddocare,
    ]);
    await db.asUser(p.kiddoOwner, (sql) =>
      save(sql, dec, { kpis: [{ kpi_id: SEED.kpis.bookings, dimension_member_id: null, value_number: 3 }] }),
    );
  });

  it("only allows edits while the month is a draft or has changes requested", async () => {
    await fillValid(db, p.batikOwner, jul, "batik");
    await submit(db, p.batikOwner, jul);
    await expectRule(
      db.asUser(p.batikOwner, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] })),
      "Jul 2026 has been submitted and is awaiting review, so it can no longer be edited.",
    );
    await expectRule(
      db.asUser(p.fundAdmin, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] })),
      "Jul 2026 has been submitted and is awaiting review, so it can no longer be edited.",
    );
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Check revenue" }));
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 100000 }] }));
    await submit(db, p.batikOwner, jul);
    await db.asUser(p.partner, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await expectRule(
      db.asUser(p.batikContributor, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] })),
      "Jul 2026 is approved and locked. Request an amendment if something needs to change.",
    );
  });

  it("lets a Fund Admin save on behalf of the company, audited with on_behalf = true", async () => {
    await db.asUser(p.fundAdmin, (sql) => save(sql, jul, { values: [{ key: "gross_profit", value_number: -50 }] }));
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, { values: [{ key: "net_profit", value_number: -75 }] }));
    const audit = await db.query(
      `select entity_id, actor_id, actor_role, on_behalf, company_id from public.audit_log
       where entity = 'submission_values' and action = 'insert' order by id`,
    );
    expect(audit).toEqual([
      {
        entity_id: `${jul}:gross_profit`,
        actor_id: p.fundAdmin,
        actor_role: "fund_admin",
        on_behalf: true,
        company_id: SEED.companies.batikBoutique,
      },
      {
        entity_id: `${jul}:net_profit`,
        actor_id: p.batikOwner,
        actor_role: "company_owner",
        on_behalf: false,
        company_id: SEED.companies.batikBoutique,
      },
    ]);
    expect(await db.value("select last_saved_by from public.submissions where id = $1", [jul])).toBe(p.batikOwner);
  });

  it("lets contributors save", async () => {
    await db.asUser(p.batikContributor, (sql) => save(sql, jul, { values: [{ key: "cash_in_bank", value_number: 5 }] }));
    const audit = await db.one("select actor_role, on_behalf from public.audit_log where entity = 'submission_values'");
    expect(audit).toEqual({ actor_role: "company_contributor", on_behalf: false });
  });

  it("denies partners, viewers and super admins", async () => {
    for (const user of [p.partner, p.otherPartner, p.viewer, p.superAdmin]) {
      await expectDenied(
        db.asUser(user, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] })),
        "You do not have permission to edit this monthly update.",
      );
    }
  });

  it("denies members of other companies, inactive members, deactivated users, aal1 sessions and anon", async () => {
    const attempt = (user: string, aal: "aal1" | "aal2" = "aal2") =>
      db.asUser(user, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] }), { aal });
    await expectDenied(attempt(p.kiddoOwner), "This monthly update was not found or you do not have access to it.");
    await expectDenied(attempt(p.batikOwner, "aal1"));
    await db.query("update public.company_members set is_active = false where user_id = $1", [p.batikContributor]);
    await expectDenied(attempt(p.batikContributor));
    await db.query("update public.profiles set is_active = false where id = $1", [p.batikOwner]);
    await expectDenied(attempt(p.batikOwner));
    await expectDenied(db.asAnon((sql) => save(sql, jul, {})), /permission denied for function save_submission_values/);
    // A random, unknown submission id reveals nothing.
    await expectDenied(
      db.asUser(p.fundAdmin, (sql) => save(sql, "00000000-0000-4000-8000-000000000999", {})),
      "This monthly update was not found or you do not have access to it.",
    );
  });

  it("denies edits for exited or written-off companies", async () => {
    await db.rpc("set_company_status", { p_company_id: SEED.companies.batikBoutique, p_status: "exited", p_reason: "Trade sale" });
    for (const user of [p.batikOwner, p.fundAdmin]) {
      await expectRule(
        db.asUser(user, (sql) => save(sql, jul, { values: [{ key: "revenue_total", value_number: 1 }] })),
        "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
      );
    }
    // Still visible to its members.
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.submissions"))).toBe(3);
  });

  it("does not log no-op saves", async () => {
    const payload = { values: [{ key: "revenue_total", value_number: 42 }] };
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, payload));
    const before = await db.count("select 1 from public.audit_log where entity like 'submission%'");
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, payload));
    expect(await db.count("select 1 from public.audit_log where entity like 'submission%'")).toBe(before);
  });

  it("cannot be bypassed by writing the value tables directly", async () => {
    for (const statement of [
      `insert into public.submission_values (submission_id, field_key, value_number) values ('${jul}', 'revenue_total', 1)`,
      `update public.submission_values set value_number = 1`,
      `delete from public.submission_values`,
      `insert into public.submission_kpi_values (submission_id, kpi_id, value_number) values ('${jul}', '${SEED.kpis.revenuePerOutlet}', 1)`,
      `update public.submissions set status = 'approved' where id = '${jul}'`,
    ]) {
      await expectPgError(
        db.asUser(p.batikOwner, (sql) => sql.exec(statement)),
        { code: "42501" },
      );
    }
  });
});
