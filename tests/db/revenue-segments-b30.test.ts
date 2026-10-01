/**
 * BRD B30 (product owner, 1 Oct 2026; supabase/migrations/20261001000200_revenue_segments_b30.sql):
 * two revenue breakdowns per company.
 *
 * - Company revenue segments (revenue_segments.kind = 'company'): the owner (or a Super Admin / Fund
 *   Admin on the owner's behalf) sets the complete ordered list with public.set_company_revenue_segments().
 *   They add up to total revenue and carry over every month. A renamed segment is renamed in place while
 *   no submitted or approved month has figures for it; otherwise it is retired and continues as a new
 *   series, and the months still open for changes move to it. Removed segments are retired and cleared
 *   from open months. Submitted and approved months never change.
 * - ScaleUp revenue lines (kind = 'scaleup'): Super Admins / Fund Admins write them directly, as before;
 *   required every month, no sum rule.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { companySegmentListError, diffCompanySegments, type RevenueSegmentRow } from "@/lib/types/domain";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type Sql, type TestDb } from "./harness";
import { fillValid, save, setupPortfolio, submit, type Portfolio } from "./scenario";
import { readMigrations, readShim, runSqlFile, setUtcTimeZone } from "./schema";

let db: TestDb;
let p: Portfolio;
const A = SEED.companies.batikBoutique; // p.batikOwner (owner), p.batikContributor
const K = SEED.companies.kiddocare; // p.kiddoOwner
const R = SEED.companies.recqa; // p.recqaOwner, no KPIs (easy to submit)

const MIGRATION = "20261001000200_revenue_segments_b30.sql";
const CHANGED = "The revenue segments have changed since this page was opened. Reload the page and try again.";
const OWNER_ONLY = "Only the company owner can change its revenue segments.";
const KIND_CHANGE = "A revenue segment cannot switch between a company segment and a ScaleUp revenue line. Add a new one instead.";

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Segment = RevenueSegmentRow;

const setAs = (sql: Sql, company: string, list: unknown) =>
  sql.query<Segment>("select * from public.set_company_revenue_segments($1, $2)", [company, list]);

/** set_company_revenue_segments as `user` (the list as given: objects, nulls, anything). */
function setSegments(user: string, company: string, list: unknown): Promise<Segment[]> {
  return db.asUser(user, (sql) => setAs(sql, company, list));
}

/** Every segment of a company (both kinds), active first, in order. */
function segmentsOf(company: string): Promise<Segment[]> {
  return db.query<Segment>(
    "select * from public.revenue_segments where company_id = $1 order by is_active desc, kind, sort_order, name",
    [company],
  );
}

/** A month's stored segment amounts by segment id. */
async function amounts(submissionId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ segment_id: string; amount: number }>(
    "select segment_id, amount from public.submission_segment_values where submission_id = $1",
    [submissionId],
  );
  return Object.fromEntries(rows.map((row) => [row.segment_id, row.amount]));
}

/**
 * Fills a RECQA month validly: the system numbers with total revenue `total` (default: the sum of
 * `figures`, i.e. when they are all company segments), and the segment figures.
 */
async function fill(
  submissionId: string,
  figures: Record<string, number>,
  total = Object.values(figures).reduce((sum, amount) => sum + amount, 0),
): Promise<void> {
  const user = p.recqaOwner;
  await fillValid(db, user, submissionId, "recqa", { revenue_total: total });
  await db.asUser(user, (sql) =>
    save(sql, submissionId, { segments: Object.entries(figures).map(([segment_id, amount]) => ({ segment_id, amount })) }),
  );
}

const ids = (rows: Segment[]) => rows.map((row) => row.id);
const names = (rows: Segment[]) => rows.map((row) => row.name);

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------
describe("revenue_segments.kind and retired_at", () => {
  it("defaults to a ScaleUp line, never changes kind, and keeps retired_at in step with is_active", async () => {
    const line = await db.asUser(p.fundAdmin, (sql) =>
      sql.one<Segment>("insert into public.revenue_segments (company_id, name) values ($1, 'AOnePay') returning *", [R]),
    );
    expect(line).toMatchObject({ kind: "scaleup", is_active: true, retired_at: null });

    // Deactivating sets retired_at (whatever the client sends); reactivating clears it.
    await db.asUser(p.fundAdmin, (sql) =>
      sql.query("update public.revenue_segments set is_active = false, retired_at = '2001-01-01' where id = $1", [line.id]),
    );
    const retired = await db.one<{ recent: boolean; retired_at: string }>(
      "select retired_at > now() - interval '1 hour' as recent, retired_at from public.revenue_segments where id = $1",
      [line.id],
    );
    expect(retired.recent).toBe(true);
    // Still retired: the time stays.
    await db.asUser(p.fundAdmin, (sql) =>
      sql.query("update public.revenue_segments set name = 'AOne Pay', retired_at = null where id = $1", [line.id]),
    );
    expect(await db.value("select retired_at from public.revenue_segments where id = $1", [line.id])).toBe(retired.retired_at);
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.revenue_segments set is_active = true where id = $1", [line.id]));
    expect(await db.value("select retired_at from public.revenue_segments where id = $1", [line.id])).toBeNull();

    // Nobody turns a ScaleUp line into a company segment: not an admin, not a system caller (trigger, which
    // runs before RLS would refuse the admin's row).
    for (const run of [
      (q: string, v: unknown[]) => db.asUser(p.superAdmin, (sql) => sql.query(q, v)),
      (q: string, v: unknown[]) => db.query(q, v),
    ]) {
      await expectRule(run("update public.revenue_segments set kind = 'company' where id = $1", [line.id]), KIND_CHANGE);
    }
    await expectPgError(db.query("insert into public.revenue_segments (company_id, kind, name) values ($1, 'other', 'X')", [R]), {
      code: "23514",
    });
    // Trusted system callers (data migrations) may date a retirement; an active segment is never retired.
    const imported = await db.one<{ retired_at: string; active_retired_at: string | null }>(
      `with old as (
         insert into public.revenue_segments (company_id, name, is_active, retired_at)
         values ($1, 'Imported', false, '2025-12-31 16:00:00+00') returning retired_at
       ), current as (
         insert into public.revenue_segments (company_id, name, is_active, retired_at)
         values ($1, 'Current', true, now()) returning retired_at
       )
       select (select retired_at from old) as retired_at, (select retired_at from current) as active_retired_at`,
      [R],
    );
    expect(imported).toEqual({ retired_at: "2025-12-31 16:00:00+00", active_retired_at: null });
  });

  it("keeps active names unique per company and kind, ignoring case, and lets a retired name be used again", async () => {
    const insert = (name: string, kind = "scaleup") =>
      db.query<{ id: string }>("insert into public.revenue_segments (company_id, kind, name) values ($1, $2, $3) returning id", [
        R,
        kind,
        name,
      ]);
    const [retail] = await insert("Retail");
    await expectPgError(insert("retail"), { code: "23505" });
    await insert("Retail", "company"); // the other kind may use the name
    await db.query("update public.revenue_segments set is_active = false where id = $1", [retail.id]);
    await insert("RETAIL"); // the retired one no longer holds it
    expect(
      await db.count("select 1 from pg_constraint where conname = 'revenue_segments_company_id_name_key'"),
    ).toBe(0);
    expect(await db.count("select 1 from pg_indexes where indexname = 'revenue_segments_active_name_key'")).toBe(1);
    // Kiddocare can have its own "Retail".
    await db.query("insert into public.revenue_segments (company_id, name) values ($1, 'Retail')", [K]);
  });
});

// ---------------------------------------------------------------------------------------------
// Who may set the company's segments
// ---------------------------------------------------------------------------------------------
describe("set_company_revenue_segments: permissions", () => {
  it("lets the owner of an active company and ScaleUp admins (on behalf) set them; nobody else", async () => {
    const list = [{ name: "Online" }, { name: "Retail" }];
    expect(names(await setSegments(p.batikOwner, A, list))).toEqual(["Online", "Retail"]);
    expect(names(await setSegments(p.fundAdmin, A, [...list, { name: "Corporate" }]))).toEqual(["Online", "Retail", "Corporate"]);
    expect(names(await setSegments(p.superAdmin, A, list))).toEqual(["Online", "Retail"]);

    for (const user of [p.batikContributor, p.kiddoOwner, p.recqaOwner, p.partner, p.otherPartner, p.viewer]) {
      await expectDenied(setSegments(user, A, list), OWNER_ONLY);
    }
    // MFA not completed (aal1): not an owner as far as the database is concerned.
    await expectDenied(db.asUser(p.batikOwner, (sql) => setAs(sql, A, list), { aal: "aal1" }), OWNER_ONLY);
    // The API's anonymous role cannot even call it; the service role (a trusted system caller) can.
    await expectDenied(db.asAnon((sql) => setAs(sql, A, list)));
    expect(names(await db.asService((sql) => setAs(sql, A, [{ name: "Online" }])))).toEqual(["Online"]);
    // A company that does not exist: ScaleUp admins are told so; others learn nothing.
    const unknown = "c0000000-0000-4000-8000-0000000000ff";
    await expectRule(setSegments(p.fundAdmin, unknown, list), "That company was not found.");
    await expectDenied(setSegments(p.batikOwner, unknown, list), OWNER_ONLY);
  });

  it("refuses exited and written-off companies (read-only, BRD B21), for their owners and for ScaleUp", async () => {
    await db.query("update public.companies set status = 'exited' where id = $1", [K]);
    for (const user of [p.kiddoOwner, p.fundAdmin, p.superAdmin]) {
      await expectRule(
        setSegments(user, K, [{ name: "Subscriptions" }]),
        "Kiddocare is no longer an active portfolio company, so its records are read-only.",
      );
    }
    await expectDenied(setSegments(p.kiddoContributor, K, [{ name: "Subscriptions" }]), OWNER_ONLY);
    expect(await db.count("select 1 from public.revenue_segments where company_id = $1", [K])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------
describe("set_company_revenue_segments: the list", () => {
  it("validates the list with the messages companySegmentListError gives (UX mirror)", async () => {
    const long = "x".repeat(81);
    const cases: unknown[][] = [
      Array.from({ length: 51 }, (_, i) => ({ name: `Segment ${i + 1}` })),
      [{ name: "   " }],
      [{ name: "" }],
      [{ name: long }],
      [{ name: "Online\nshop" }],
      [{ name: "Online\tshop" }],
      [{ name: "Online" }, { name: " online " }],
      [{ name: "Online" }, { name: "Retail" }, { name: "ONLINE" }],
    ];
    for (const list of cases) {
      const expected = companySegmentListError(list as { name: string }[]);
      expect(expected, JSON.stringify(list).slice(0, 60)).not.toBeNull();
      await expectRule(setSegments(p.recqaOwner, R, list), expected ?? "");
    }
    // 50 segments, 80-character names and names trimmed of spaces, tabs and line breaks are fine.
    const fifty = Array.from({ length: 50 }, (_, i) => ({ name: i === 0 ? "y".repeat(80) : ` Segment ${i + 1}\t` }));
    expect(companySegmentListError(fifty)).toBeNull();
    const saved = await setSegments(p.recqaOwner, R, fifty);
    expect(saved).toHaveLength(50);
    expect(saved[1].name).toBe("Segment 2");
    expect(saved.map((row) => row.sort_order)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("refuses a malformed list, items without a name, and ids that are not the company's current segments", async () => {
    await expectRule(setSegments(p.recqaOwner, R, null), "Send the revenue segments as a list.");
    await expectRule(setSegments(p.recqaOwner, R, { name: "Online" }), "Send the revenue segments as a list.");
    await expectRule(setSegments(p.recqaOwner, R, ["Online"]), "Each revenue segment needs a name.");
    await expectRule(setSegments(p.recqaOwner, R, [{ id: null }]), "Each revenue segment needs a name.");
    await expectRule(setSegments(p.recqaOwner, R, [{ name: 42 }]), "Each revenue segment needs a name.");

    const [online] = await setSegments(p.recqaOwner, R, [{ name: "Online" }]);
    await expectRule(
      setSegments(p.recqaOwner, R, [{ id: online.id, name: "Online" }, { id: online.id.toUpperCase(), name: "Web" }]),
      "Each revenue segment can only be listed once.",
    );
    expect(companySegmentListError([{ id: online.id, name: "Online" }, { id: online.id.toUpperCase(), name: "Web" }])).toBe(
      "Each revenue segment can only be listed once.",
    );
    // Not a uuid, unknown, another company's, a ScaleUp line, a retired segment.
    const [kiddoSegment] = await setSegments(p.kiddoOwner, K, [{ name: "Subscriptions" }]);
    const line = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name) values ($1, 'Drones') returning id", [R]),
    );
    const [retail] = await setSegments(p.recqaOwner, R, [{ name: "Retail" }]); // Online retired
    for (const id of ["nope", 7, "c0000000-0000-4000-8000-0000000000ff", kiddoSegment.id, line, online.id]) {
      await expectRule(setSegments(p.recqaOwner, R, [{ id: retail.id, name: "Retail" }, { id, name: "Other" }]), CHANGED);
    }
    expect(names(await segmentsOf(R)).sort()).toEqual(["Drones", "Online", "Retail"]);
  });

  it("returns the active company segments in order and leaves ScaleUp lines alone", async () => {
    const line = await db.asUser(p.fundAdmin, (sql) =>
      sql.one<Segment>("insert into public.revenue_segments (company_id, name, sort_order) values ($1, 'Drones', 1) returning *", [R]),
    );
    const saved = await setSegments(p.recqaOwner, R, [{ name: "Services" }, { name: "Hardware" }]);
    expect(saved.map((row) => [row.name, row.kind, row.sort_order, row.is_active, row.retired_at])).toEqual([
      ["Services", "company", 1, true, null],
      ["Hardware", "company", 2, true, null],
    ]);
    // An empty list removes them all (the company then enters total revenue directly).
    expect(await setSegments(p.recqaOwner, R, [])).toEqual([]);
    expect(await db.one("select name, kind, is_active from public.revenue_segments where id = $1", [line.id])).toEqual({
      name: "Drones",
      kind: "scaleup",
      is_active: true,
    });
    expect(
      await db.query("select name, is_active, retired_at is not null as retired from public.revenue_segments where company_id = $1 and kind = 'company' order by name", [R]),
    ).toEqual([
      { name: "Hardware", is_active: false, retired: true },
      { name: "Services", is_active: false, retired: true },
    ]);
  });

  it("keeps ids for unchanged names, reorders, and treats an unlisted segment named again as itself", async () => {
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    const jul = p.subs.recqa["2026-07-01"];
    await fill(jul, { [online.id]: 60, [retail.id]: 40 });

    // Same names in another order: same ids, new positions.
    const reordered = await setSegments(p.recqaOwner, R, [
      { id: retail.id, name: "Retail" },
      { id: online.id, name: "Online" },
    ]);
    expect(reordered.map((row) => [row.id, row.sort_order])).toEqual([
      [retail.id, 1],
      [online.id, 2],
    ]);
    // Taken out and put back in the form (no id), even in another case: the same segment, figures kept.
    const again = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "retail" }]);
    expect(ids(again)).toEqual([online.id, retail.id]);
    expect(names(again)).toEqual(["Online", "retail"]); // no submitted figures yet: renamed in place
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 });
    // But a segment listed by id is not taken over by a new one with its old name.
    const both = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }, { name: "Online" }, { id: retail.id, name: "Retail" }]);
    expect(both[0].id).toBe(online.id);
    expect(both[1].id).not.toBe(online.id);
    expect(names(both)).toEqual(["Web", "Online", "Retail"]);
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 }); // now under "Web"
  });

  it("swaps names of segments without submitted figures in place", async () => {
    const [a, b, c] = await setSegments(p.recqaOwner, R, [{ name: "A" }, { name: "B" }, { name: "C" }]);
    const swapped = await setSegments(p.recqaOwner, R, [
      { id: a.id, name: "B" },
      { id: b.id, name: "C" },
      { id: c.id, name: "A" },
    ]);
    expect(swapped.map((row) => [row.id, row.name])).toEqual([
      [a.id, "B"],
      [b.id, "C"],
      [c.id, "A"],
    ]);
    expect(await db.count("select 1 from public.revenue_segments where company_id = $1 and not is_active", [R])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// History: submitted and approved months never change; open months follow the new set
// ---------------------------------------------------------------------------------------------
describe("set_company_revenue_segments: months", () => {
  it("renames in place while no submitted month has figures; afterwards a rename starts a new series", async () => {
    const [jul, aug, sep] = ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.recqa[m]);
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await fill(jul, { [online.id]: 60, [retail.id]: 40 });

    // Jul is a draft: renamed in place, same id, figures stay.
    const renamed = await setSegments(p.recqaOwner, R, [
      { id: online.id, name: "E-commerce" },
      { id: retail.id, name: "Retail" },
    ]);
    expect(renamed.map((row) => [row.id, row.name])).toEqual([
      [online.id, "E-commerce"],
      [retail.id, "Retail"],
    ]);
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 });

    await submit(db, p.recqaOwner, jul);
    await fill(aug, { [online.id]: 70, [retail.id]: 30 });

    // Jul (submitted) has figures for "E-commerce": the rename retires it and starts a new series.
    const [web, retailAgain] = await setSegments(p.recqaOwner, R, [
      { id: online.id, name: "Web" },
      { id: retail.id, name: "Retail" },
    ]);
    expect(web.id).not.toBe(online.id);
    expect([web.name, web.kind, web.sort_order, web.is_active]).toEqual(["Web", "company", 1, true]);
    expect(retailAgain.id).toBe(retail.id);
    const old = await db.one<Segment>("select * from public.revenue_segments where id = $1", [online.id]);
    expect([old.name, old.is_active, old.retired_at !== null, old.sort_order]).toEqual(["E-commerce", false, true, 1]);
    // Submitted Jul keeps its segment names and figures; open Aug moved to the new segment; Sep had none.
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 });
    expect(await amounts(aug)).toEqual({ [web.id]: 70, [retail.id]: 30 });
    expect(await amounts(sep)).toEqual({});
    expect(await db.value("select status::text from public.submissions where id = $1", [jul])).toBe("submitted");

    // Aug still validates against the new set (total = Web + Retail).
    const augValidation = await db.asUser(p.recqaOwner, (sql) => sql.rpc<{ ok: boolean }>("get_submission_validation", { p_submission_id: aug }));
    expect(augValidation.ok).toBe(true);
    // The company's segment history: the retired one with its retirement time.
    expect(
      (await segmentsOf(R)).map((row) => [row.name, row.is_active]),
    ).toEqual([
      ["Web", true],
      ["Retail", true],
      ["E-commerce", false],
    ]);
  });

  it("clears removed segments from open months only; submitted and approved months keep them", async () => {
    const [jul, aug, sep] = ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.recqa[m]);
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await fill(jul, { [online.id]: 60, [retail.id]: 40 });
    await submit(db, p.recqaOwner, jul);
    await db.asUser(p.superAdmin, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await fill(aug, { [online.id]: 70, [retail.id]: 30 });
    await submit(db, p.recqaOwner, aug);
    await fill(sep, { [online.id]: 80, [retail.id]: 20 });

    const kept = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Online" }]);
    expect(ids(kept)).toEqual([online.id]);
    expect(await db.value("select is_active from public.revenue_segments where id = $1", [retail.id])).toBe(false);
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 }); // approved
    expect(await amounts(aug)).toEqual({ [online.id]: 70, [retail.id]: 30 }); // submitted
    expect(await amounts(sep)).toEqual({ [online.id]: 80 }); // draft: Retail cleared
  });

  it("treats a month sent back for changes as open: its figures move to a renamed segment", async () => {
    const [jul, aug] = ["2026-07-01", "2026-08-01"].map((m) => p.subs.recqa[m]);
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await fill(jul, { [online.id]: 60, [retail.id]: 40 });
    await submit(db, p.recqaOwner, jul);
    await db.asUser(p.superAdmin, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await fill(aug, { [online.id]: 70, [retail.id]: 30 });
    await submit(db, p.recqaOwner, aug);
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: aug, p_message: "Check GP" }));

    const [web] = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }]);
    expect(web.id).not.toBe(online.id); // Jul (approved) has Online figures
    expect(await amounts(jul)).toEqual({ [online.id]: 60, [retail.id]: 40 }); // approved: untouched
    expect(await amounts(aug)).toEqual({ [web.id]: 70 }); // changes requested: moved, Retail cleared
    expect(await db.value("select status::text from public.submissions where id = $1", [aug])).toBe("changes_requested");
  });

  it("is audited per change, as the owner or on the owner's behalf", async () => {
    const [online] = await setSegments(p.recqaOwner, R, [{ name: "Online" }]);
    await fill(p.subs.recqa["2026-07-01"], { [online.id]: 100 });
    await submit(db, p.recqaOwner, p.subs.recqa["2026-07-01"]);
    await fill(p.subs.recqa["2026-08-01"], { [online.id]: 50 });
    await setSegments(p.fundAdmin, R, [{ id: online.id, name: "Web" }, { name: "Retail" }]);

    const rows = await db.query<{ entity: string; action: string; actor_role: string; on_behalf: boolean; summary: string }>(
      `select entity, action, actor_role, on_behalf, summary from public.audit_log
        where company_id = $1 and entity in ('revenue_segments', 'submission_segment_values') and summary is not null
        order by id`,
      [R],
    );
    expect(rows).toEqual([
      { entity: "revenue_segments", action: "insert", actor_role: "company_owner", on_behalf: false, summary: 'Revenue segment "Online" added' },
      ...["update", "insert", "update"].map((action, i) => ({
        entity: i === 2 ? "submission_segment_values" : "revenue_segments",
        action,
        actor_role: "fund_admin",
        on_behalf: true,
        summary: 'Revenue segment "Online" renamed to "Web" as a new series (submitted months keep "Online")',
      })),
      { entity: "revenue_segments", action: "insert", actor_role: "fund_admin", on_behalf: true, summary: 'Revenue segment "Retail" added' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Saving values
// ---------------------------------------------------------------------------------------------
describe("save_submission_values and retired segments", () => {
  it("refuses figures for retired segments (either kind), still lets them be cleared", async () => {
    const jul = p.subs.recqa["2026-07-01"];
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await setSegments(p.recqaOwner, R, [{ id: retail.id, name: "Retail" }]); // Online removed
    await expectRule(
      db.asUser(p.recqaOwner, (sql) => save(sql, jul, { segments: [{ segment_id: online.id, amount: 5 }] })),
      '"Online" is no longer in use, so revenue can no longer be entered for it. Reload the page to see the current revenue segments.',
    );
    await db.asUser(p.recqaOwner, (sql) => save(sql, jul, { segments: [{ segment_id: online.id, amount: null }] }));

    const line = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name, is_active) values ($1, 'Old line', false) returning id", [R]),
    );
    await expectRule(
      db.asUser(p.fundAdmin, (sql) => save(sql, jul, { segments: [{ segment_id: line, amount: 1 }] })),
      '"Old line" is no longer in use, so revenue can no longer be entered for it. Reload the page to see the current revenue segments.',
    );
    // A failed save writes nothing.
    expect(await amounts(jul)).toEqual({});
  });

  it("clears a reopened month's figures for retired company segments when it is saved (ScaleUp lines are kept)", async () => {
    const jul = p.subs.recqa["2026-07-01"];
    const [online] = await setSegments(p.recqaOwner, R, [{ name: "Online" }]);
    const line = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name) values ($1, 'Drones') returning id", [R]),
    );
    await fill(jul, { [online.id]: 100, [line]: 20 }, 100); // the ScaleUp line does not count towards the total
    await submit(db, p.recqaOwner, jul);
    const [web] = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }]); // new series (Jul submitted)
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.revenue_segments set is_active = false where id = $1", [line]));
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Use the new segments" }));
    expect(await amounts(jul)).toEqual({ [online.id]: 100, [line]: 20 }); // sending back changes nothing

    await db.asUser(p.recqaOwner, (sql) => save(sql, jul, { segments: [{ segment_id: web.id, amount: 100 }] }));
    expect(await amounts(jul)).toEqual({ [web.id]: 100, [line]: 20 });
    const ok = await db.asUser(p.recqaOwner, (sql) => sql.rpc<{ ok: boolean; errors: unknown[] }>("get_submission_validation", { p_submission_id: jul }));
    expect(ok).toEqual({ ok: true, errors: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// Direct writes
// ---------------------------------------------------------------------------------------------
describe("direct writes", () => {
  it("still let Super Admins and Fund Admins manage ScaleUp lines, and never company segments", async () => {
    const [own] = await setSegments(p.recqaOwner, R, [{ name: "Services" }]);
    for (const admin of [p.fundAdmin, p.superAdmin]) {
      await db.asUser(admin, async (sql) => {
        const line = await sql.value<string>("insert into public.revenue_segments (company_id, name) values ($1, $2) returning id", [
          R,
          `Line ${admin.slice(0, 4)}`,
        ]);
        expect(await sql.query("update public.revenue_segments set sort_order = 9 where id = $1 returning id", [line])).toHaveLength(1);
        expect(await sql.query("delete from public.revenue_segments where id = $1 returning id", [line])).toHaveLength(1);
        // Company segments: invisible to direct writes.
        expect(await sql.query("update public.revenue_segments set name = 'Hijacked' where id = $1 returning id", [own.id])).toEqual([]);
        expect(await sql.query("delete from public.revenue_segments where id = $1 returning id", [own.id])).toEqual([]);
      });
      await expectDenied(
        db.asUser(admin, (sql) => sql.query("insert into public.revenue_segments (company_id, kind, name) values ($1, 'company', 'Direct')", [R])),
      );
      await expectRule(
        db.asUser(admin, (sql) =>
          sql.query<{ id: string }>("insert into public.revenue_segments (company_id, name) values ($1, 'X') returning id", [R]).then(([row]) =>
            sql.query("update public.revenue_segments set kind = 'company' where id = $1", [row.id]),
          ),
        ),
        KIND_CHANGE,
      );
    }
    // Owners never write either kind directly.
    await expectDenied(
      db.asUser(p.recqaOwner, (sql) => sql.query("insert into public.revenue_segments (company_id, kind, name) values ($1, 'company', 'Mine')", [R])),
    );
    expect(await db.asUser(p.recqaOwner, (sql) => sql.query("update public.revenue_segments set name = 'X' returning id"))).toEqual([]);
    expect(await db.one("select name, is_active from public.revenue_segments where id = $1", [own.id])).toEqual({
      name: "Services",
      is_active: true,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// UX mirrors
// ---------------------------------------------------------------------------------------------
describe("diffCompanySegments agrees with what the database does", () => {
  it("reports added, removed, renamed and reordered segments like set_company_revenue_segments applies them", async () => {
    const current = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }, { name: "Corporate" }]);
    const [online, retail, corporate] = current;
    const next = [
      { id: retail.id, name: "Retail" },
      { name: "online" }, // the unlisted Online, renamed
      { name: "Wholesale" },
    ];
    const diff = diffCompanySegments(current, next);
    expect(diff).toMatchObject({
      added: ["Wholesale"],
      removed: [expect.objectContaining({ id: corporate.id })],
      renamed: [{ segment: expect.objectContaining({ id: online.id }), name: "online" }],
      reordered: true,
      affectsComparability: true,
      changed: true,
    });
    const saved = await setSegments(p.recqaOwner, R, next);
    expect(saved.map((row) => [row.id === retail.id, row.id === online.id, row.name])).toEqual([
      [true, false, "Retail"],
      [false, true, "online"],
      [false, false, "Wholesale"],
    ]);
    expect(await db.value("select is_active from public.revenue_segments where id = $1", [corporate.id])).toBe(false);

    const unchanged = diffCompanySegments(saved, saved.map((row) => ({ id: row.id, name: ` ${row.name} ` })));
    expect(unchanged).toEqual({ added: [], removed: [], renamed: [], reordered: false, affectsComparability: false, changed: false });
    const moved = diffCompanySegments(saved, [...saved].reverse().map((row) => ({ id: row.id, name: row.name })));
    expect([moved.reordered, moved.affectsComparability, moved.changed]).toEqual([true, false, true]);
  });
});

// ---------------------------------------------------------------------------------------------
// The migration itself
// ---------------------------------------------------------------------------------------------
describe(`${MIGRATION}`, () => {
  it("turns existing segments into ScaleUp lines, dates retired ones, and can run again", async () => {
    const files = readMigrations();
    const index = files.findIndex((m) => m.name === MIGRATION);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1].name).toBe("20261001000100_decisions_b28_b29.sql");

    // A database as deployed before this file (shim + the earlier migrations), with segments of the old kind.
    const pg = await PGlite.create();
    try {
      await pg.exec("alter database postgres set timezone to 'UTC';");
      await setUtcTimeZone(pg);
      await runSqlFile(pg, readShim());
      for (const file of files.slice(0, index)) await runSqlFile(pg, file);
      const one = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params as never[])).rows[0];
      await pg.exec("insert into public.companies (id, name, reporting_start_month) values ('c0000000-0000-4000-8000-0000000000aa', 'Oldco', '2026-07-01')");
      await pg.exec(`
        insert into public.revenue_segments (id, company_id, name, sort_order, is_active, created_at) values
          ('f0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-4000-8000-0000000000aa', 'Online', 1, true, '2026-07-01'),
          ('f0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-4000-8000-0000000000aa', 'Retail', 2, true, '2026-07-01'),
          ('f0000000-0000-4000-8000-0000000000a3', 'c0000000-0000-4000-8000-0000000000aa', 'Legacy', 3, false, '2026-06-01');
        update public.revenue_segments set is_active = false where id = 'f0000000-0000-4000-8000-0000000000a2';
      `);
      const deactivated = await one<{ at: string }>(
        "select max(occurred_at)::text as at from public.audit_log where entity = 'revenue_segments' and entity_id = 'f0000000-0000-4000-8000-0000000000a2' and action = 'update'",
      );

      const file = files[index];
      await runSqlFile(pg, file);
      await runSqlFile(pg, file); // e.g. a repeated `db push`
      const rows = (
        await pg.query<{ name: string; kind: string; is_active: boolean; retired_at: string | null }>(
          "select name, kind, is_active, retired_at::text as retired_at from public.revenue_segments order by sort_order",
        )
      ).rows;
      expect(rows).toEqual([
        { name: "Online", kind: "scaleup", is_active: true, retired_at: null },
        { name: "Retail", kind: "scaleup", is_active: false, retired_at: deactivated.at },
        { name: "Legacy", kind: "scaleup", is_active: false, retired_at: "2026-06-01 00:00:00+00" },
      ]);
      expect(
        await one(
          `select (select count(*)::int from pg_trigger where tgname = 'revenue_segments_guard') as triggers,
                  (select count(*)::int from pg_indexes where indexname = 'revenue_segments_active_name_key') as name_index,
                  (select count(*)::int from pg_policies where tablename = 'revenue_segments') as policies,
                  has_function_privilege('authenticated', 'public.set_company_revenue_segments(uuid, jsonb)', 'EXECUTE') as rpc_auth,
                  has_function_privilege('anon', 'public.set_company_revenue_segments(uuid, jsonb)', 'EXECUTE') as rpc_anon,
                  has_function_privilege('authenticated', 'private.revenue_segments_guard()', 'EXECUTE') as guard_auth`,
        ),
      ).toEqual({ triggers: 1, name_index: 1, policies: 4, rpc_auth: true, rpc_anon: false, guard_auth: false });
    } finally {
      await pg.close();
    }
  });
});
