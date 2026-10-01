/**
 * BRD B30 hardening (supabase/migrations/20261001000300_revenue_total_from_segments.sql).
 *
 * - Total revenue follows the company's own revenue segments (kind 'company') in every month still open for
 *   changes: when their figures change (save_submission_values, or set_company_revenue_segments moving or
 *   clearing them), revenue_total becomes the sum of the amounts present for the ACTIVE company segments,
 *   and is removed when none is present. A save that sends revenue_total keeps what it sends, and a total
 *   the month had before it had any segment figures is kept by the save that enters the first ones (the
 *   validation compares them). Companies without segments of their own keep whatever was entered;
 *   submitted and approved months never change; ScaleUp revenue lines never count.
 * - set_company_revenue_segments(p_company_id, p_segments, p_expected_ids uuid[] default null): with
 *   p_expected_ids, a list based on segments someone else has changed since is refused.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillValid, save, setupPortfolio, submit, systemValues, type Portfolio } from "./scenario";
import { readMigrations, readShim, runSqlFile, setUtcTimeZone } from "./schema";

let db: TestDb;
let p: Portfolio;
const R = SEED.companies.recqa; // p.recqaOwner; no KPIs, so a month is easy to complete and submit
const K = SEED.companies.kiddocare; // p.kiddoOwner, p.kiddoContributor

const MIGRATION = "20261001000300_revenue_total_from_segments.sql";
const STALE = "Your revenue segments were changed by someone else. Reload the page to see the latest version.";
const CHANGED = "The revenue segments have changed since this page was opened. Reload the page and try again.";
const OWNER_ONLY = "Only the company owner can change its revenue segments.";
const RECALCULATED = "Total revenue recalculated from the revenue segments";
const UNKNOWN_ID = "f0000000-0000-4000-8000-0000000000ff";

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Segment = { id: string; name: string; kind: string; sort_order: number; is_active: boolean };
type Validation = { ok: boolean; errors: { target: string; code: string; message: string }[] };

/**
 * set_company_revenue_segments as `user`: the two-argument call, or with p_expected_ids when `expected` is
 * given (null included). Named arguments, as the Data API calls it.
 */
function setSegments(user: string, company: string, list: unknown, expected?: (string | null)[] | null): Promise<Segment[]> {
  return db.asUser(user, (sql) =>
    expected === undefined
      ? sql.query<Segment>("select * from public.set_company_revenue_segments(p_company_id => $1, p_segments => $2)", [company, list])
      : sql.query<Segment>(
          "select * from public.set_company_revenue_segments(p_company_id => $1, p_segments => $2, p_expected_ids => $3::uuid[])",
          [company, list, expected],
        ),
  );
}

const names = (rows: Segment[]) => rows.map((row) => row.name);

/** The company's active company segments, in order. */
function companySegments(company: string): Promise<Segment[]> {
  return db.query<Segment>(
    "select * from public.revenue_segments where company_id = $1 and kind = 'company' and is_active order by sort_order, name",
    [company],
  );
}

/** A ScaleUp revenue line, added by a Fund Admin (direct write). */
function scaleupLine(company: string, name: string): Promise<string> {
  return db.asUser(p.fundAdmin, (sql) =>
    sql.value<string>("insert into public.revenue_segments (company_id, name) values ($1, $2) returning id", [company, name]),
  );
}

/** The month's stored total revenue (null when there is none). */
async function totalOf(submissionId: string): Promise<number | null> {
  const total = await db.value<number | null | undefined>(
    "select value_number from public.submission_values where submission_id = $1 and field_key = 'revenue_total'",
    [submissionId],
  );
  return total ?? null;
}

/** The month's stored segment amounts by segment id. */
async function amountsOf(submissionId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ segment_id: string; amount: number }>(
    "select segment_id, amount from public.submission_segment_values where submission_id = $1",
    [submissionId],
  );
  return Object.fromEntries(rows.map((row) => [row.segment_id, row.amount]));
}

/** Saves segment figures only (no total revenue) as `user`. */
async function saveFigures(user: string, submissionId: string, figures: Record<string, number | null>): Promise<void> {
  await db.asUser(user, (sql) =>
    save(sql, submissionId, { segments: Object.entries(figures).map(([segment_id, amount]) => ({ segment_id, amount })) }),
  );
}

/** Every system number except total revenue (valid values). */
async function fillOtherNumbers(user: string, submissionId: string): Promise<void> {
  await db.asUser(user, (sql) => save(sql, submissionId, { values: systemValues().filter((v) => v.key !== "revenue_total") }));
}

function validation(submissionId: string, user = p.recqaOwner): Promise<Validation> {
  return db.asUser(user, (sql) => sql.rpc<Validation>("get_submission_validation", { p_submission_id: submissionId }));
}

/** The audit rows of a month's total revenue, oldest first. */
function totalAudit(submissionId: string) {
  return db.query<{ action: string; actor_role: string; on_behalf: boolean; summary: string | null; old_data: unknown; new_data: unknown }>(
    `select action, actor_role, on_behalf, summary, old_data, new_data from public.audit_log
      where entity = 'submission_values' and entity_id = $1 order by id`,
    [`${submissionId}:revenue_total`],
  );
}

// ---------------------------------------------------------------------------------------------
// Saving a month
// ---------------------------------------------------------------------------------------------
describe("save_submission_values: total revenue follows the company's own segments", () => {
  it("recalculates it as figures are entered, changed and cleared (partial, then full), and removes it when none is left", async () => {
    const jul = p.subs.recqa["2026-07-01"];
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await fillOtherNumbers(p.recqaOwner, jul);
    expect(await totalOf(jul)).toBeNull();

    await saveFigures(p.recqaOwner, jul, { [online.id]: 60 });
    expect(await totalOf(jul)).toBe(60); // partial: Retail not entered yet
    expect((await validation(jul)).errors).toEqual([
      { target: `segment:${retail.id}`, code: "required", message: "Revenue for Retail is required." },
    ]);

    await saveFigures(p.recqaOwner, jul, { [retail.id]: 40.25 });
    expect(await totalOf(jul)).toBe(100.25); // full
    expect(await validation(jul)).toEqual({ ok: true, errors: [] });

    await saveFigures(p.recqaOwner, jul, { [online.id]: -10.5, [retail.id]: 40.25 }); // negative amounts add up too
    expect(await totalOf(jul)).toBe(29.75);
    await saveFigures(p.recqaOwner, jul, { [online.id]: null });
    expect(await totalOf(jul)).toBe(40.25);
    await saveFigures(p.recqaOwner, jul, { [retail.id]: null });
    expect(await totalOf(jul)).toBeNull(); // no figure left: total revenue removed
    expect(await db.count("select 1 from public.submission_values where submission_id = $1 and field_key = 'revenue_total'", [jul])).toBe(0);

    // ScaleUp revenue lines never count, and changing only them leaves total revenue alone.
    const line = await scaleupLine(R, "Drones");
    await saveFigures(p.recqaOwner, jul, { [online.id]: 5, [line]: 500 });
    expect(await totalOf(jul)).toBe(5);
    await saveFigures(p.recqaOwner, jul, { [line]: 900 });
    expect(await totalOf(jul)).toBe(5);

    // Saving the same amounts again writes nothing.
    const audited = (await totalAudit(jul)).length;
    await saveFigures(p.recqaOwner, jul, { [online.id]: 5 });
    expect((await totalAudit(jul)).length).toBe(audited);
  });

  it("keeps the total revenue a save sends itself, and the one a month had before any segment figure", async () => {
    const [jul, aug] = ["2026-07-01", "2026-08-01"].map((m) => p.subs.recqa[m]);
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);

    // Sent with the figures: kept exactly as sent; the validation compares it with the sum.
    await fillOtherNumbers(p.recqaOwner, jul);
    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, jul, {
        values: [{ key: "revenue_total", value_number: 999 }],
        segments: [
          { segment_id: online.id, amount: 60 },
          { segment_id: retail.id, amount: 40 },
        ],
      }),
    );
    expect(await totalOf(jul)).toBe(999);
    expect((await validation(jul)).errors).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (999.00) must equal the sum of your revenue segments (100.00).",
      },
    ]);
    // Sent empty next to a figure: cleared, not recalculated.
    await db.asUser(p.recqaOwner, (sql) =>
      save(sql, jul, { values: [{ key: "revenue_total", value_number: null }], segments: [{ segment_id: online.id, amount: 70 }] }),
    );
    expect(await totalOf(jul)).toBeNull();
    // The next change of a figure alone recalculates it.
    await saveFigures(p.recqaOwner, jul, { [retail.id]: 30 });
    expect(await totalOf(jul)).toBe(100);
    expect(await validation(jul)).toEqual({ ok: true, errors: [] });

    // Entered while the month had no segment figures (say, before the owner defined the segments): the save
    // that enters the first figures keeps it; from then on it follows the figures.
    await fillValid(db, p.recqaOwner, aug, "recqa", { revenue_total: 500 });
    await saveFigures(p.recqaOwner, aug, { [online.id]: 300 });
    expect(await totalOf(aug)).toBe(500);
    await saveFigures(p.recqaOwner, aug, { [retail.id]: 150 });
    expect(await totalOf(aug)).toBe(450);
    expect((await validation(aug)).errors.map((issue) => issue.code)).toEqual(["prior_months"]); // Jul is still a draft
  });

  it("follows the segments in use when a month sent back still holds figures of retired segments", async () => {
    const jul = p.subs.recqa["2026-07-01"];
    const [online] = await setSegments(p.recqaOwner, R, [{ name: "Online" }]);
    await fillOtherNumbers(p.recqaOwner, jul);
    await saveFigures(p.recqaOwner, jul, { [online.id]: 100 });
    await submit(db, p.recqaOwner, jul);
    // Jul has submitted figures for Online: the rename starts a new series; Jul keeps Online.
    const [web] = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }]);
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: jul, p_message: "Use the new segments" }));
    expect([await totalOf(jul), await amountsOf(jul)]).toEqual([100, { [online.id]: 100 }]); // sending back changes nothing

    // Entering the figure of the segment in use clears the retired one's and recalculates.
    await saveFigures(p.recqaOwner, jul, { [web.id]: 120 });
    expect([await totalOf(jul), await amountsOf(jul)]).toEqual([120, { [web.id]: 120 }]);
    expect(await validation(jul)).toEqual({ ok: true, errors: [] });
  });

  it("audits the recalculated total as the person who saved (on behalf for ScaleUp)", async () => {
    const jul = p.subs.recqa["2026-07-01"];
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await saveFigures(p.recqaOwner, jul, { [online.id]: 50 });
    await saveFigures(p.fundAdmin, jul, { [retail.id]: 25 });
    expect(await totalAudit(jul)).toEqual([
      {
        action: "insert",
        actor_role: "company_owner",
        on_behalf: false,
        summary: RECALCULATED,
        old_data: null,
        new_data: expect.objectContaining({ field_key: "revenue_total", value_number: 50, updated_by: p.recqaOwner }),
      },
      {
        action: "update",
        actor_role: "fund_admin",
        on_behalf: true,
        summary: RECALCULATED,
        old_data: { value_number: 50 },
        new_data: { value_number: 75 },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Changing the segments
// ---------------------------------------------------------------------------------------------
describe("set_company_revenue_segments: open months' total revenue follows the segments", () => {
  it("recalculates months whose figures move or are cleared; submitted and approved months never change", async () => {
    const [jul, aug, sep] = ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => p.subs.recqa[m]);
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    const fill = async (month: string, figures: Record<string, number>) => {
      await fillOtherNumbers(p.recqaOwner, month);
      await saveFigures(p.recqaOwner, month, figures);
    };
    await fill(jul, { [online.id]: 60, [retail.id]: 40 });
    await submit(db, p.recqaOwner, jul);
    await db.asUser(p.superAdmin, (sql) => sql.rpc("approve_submission", { p_submission_id: jul }));
    await fill(aug, { [online.id]: 70, [retail.id]: 30 });
    await submit(db, p.recqaOwner, aug);
    await fill(sep, { [online.id]: 80, [retail.id]: 15 });
    expect([await totalOf(jul), await totalOf(aug), await totalOf(sep)]).toEqual([100, 100, 95]);
    const history = async () => [await totalOf(jul), await amountsOf(jul), await totalOf(aug), await amountsOf(aug)];
    const locked = await history();

    // Renamed with submitted figures: a new series; Sep's figure moves to it and the total stays the sum.
    const [web] = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }, { id: retail.id, name: "Retail" }]);
    expect(web.id).not.toBe(online.id);
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([95, { [web.id]: 80, [retail.id]: 15 }]);

    // Removed (on the owner's behalf): Sep's Retail figure is cleared and the total follows.
    await setSegments(p.fundAdmin, R, [{ id: web.id, name: "Web" }]);
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([80, { [web.id]: 80 }]);
    expect((await totalAudit(sep)).at(-1)).toEqual({
      action: "update",
      actor_role: "fund_admin",
      on_behalf: true,
      summary: RECALCULATED,
      old_data: { value_number: 95 },
      new_data: { value_number: 80 },
    });

    // A total that disagrees with the figures is recalculated when the figures move or are cleared…
    await db.asUser(p.recqaOwner, (sql) => save(sql, sep, { values: [{ key: "revenue_total", value_number: 999 }] }));
    const [, corporate] = await setSegments(p.recqaOwner, R, [{ id: web.id, name: "Web" }, { name: "Corporate" }]);
    expect(await totalOf(sep)).toBe(999); // …not when nothing moves (added; renamed in place; reordered)
    await setSegments(p.recqaOwner, R, [{ id: corporate.id, name: "B2B" }, { id: web.id, name: "Web shop" }]);
    expect(names(await companySegments(R))).toEqual(["B2B", "Web shop"]);
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([999, { [web.id]: 80 }]);
    await saveFigures(p.recqaOwner, sep, { [corporate.id]: 20 });
    expect(await totalOf(sep)).toBe(100); // the month has figures: a figure change recalculates
    await setSegments(p.recqaOwner, R, [{ id: web.id, name: "Web shop" }]); // B2B removed
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([80, { [web.id]: 80 }]);

    // Every company segment removed: the figures go, the total revenue the month had stays (entered
    // directly from now on).
    expect(await setSegments(p.recqaOwner, R, [])).toEqual([]);
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([80, {}]);
    expect(await validation(sep)).toEqual({ ok: true, errors: [] });

    // Approved Jul and submitted Aug never changed.
    expect(await history()).toEqual(locked);
    // Aug sent back still holds its retired figures; saving it clears them and keeps the total, since
    // the company has no segments of its own any more.
    await db.asUser(p.partner, (sql) => sql.rpc("request_changes", { p_submission_id: aug, p_message: "Check GP" }));
    await db.asUser(p.recqaOwner, (sql) => save(sql, aug, { values: [{ key: "gross_profit", value_number: 41000 }] }));
    expect([await totalOf(aug), await amountsOf(aug)]).toEqual([100, {}]);
    expect([await totalOf(jul), await amountsOf(jul)]).toEqual([locked[0], locked[1]]);
  });

  it("removes the total of an open month whose only figures are cleared", async () => {
    const sep = p.subs.recqa["2026-09-01"];
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    await saveFigures(p.recqaOwner, sep, { [online.id]: 80 });
    expect(await totalOf(sep)).toBe(80);
    await setSegments(p.superAdmin, R, [{ id: retail.id, name: "Retail" }]);
    expect([await totalOf(sep), await amountsOf(sep)]).toEqual([null, {}]);
    expect((await totalAudit(sep)).at(-1)).toMatchObject({ action: "delete", actor_role: "super_admin", on_behalf: true, summary: RECALCULATED });
  });

  it("leaves total revenue alone for companies without segments of their own", async () => {
    // RECQA with ScaleUp revenue lines only.
    const jul = p.subs.recqa["2026-07-01"];
    const line = await scaleupLine(R, "Inspection drones");
    await fillValid(db, p.recqaOwner, jul, "recqa", { revenue_total: 1000 });
    await saveFigures(p.recqaOwner, jul, { [line]: 5000 });
    expect(await totalOf(jul)).toBe(1000);
    await saveFigures(p.recqaOwner, jul, { [line]: null });
    expect(await totalOf(jul)).toBe(1000);
    // Kiddocare: no revenue segments at all.
    const kiddoJul = p.subs.kiddo["2026-07-01"];
    await fillValid(db, p.kiddoContributor, kiddoJul, "kiddo", { revenue_total: 1234.5 });
    expect(await totalOf(kiddoJul)).toBe(1234.5);
    expect(await validation(kiddoJul, p.kiddoOwner)).toEqual({ ok: true, errors: [] });
    // Defining (or clearing) segments moves no figures, so the totals stay.
    await setSegments(p.kiddoOwner, K, [{ name: "Subscriptions" }]);
    await setSegments(p.kiddoOwner, K, []);
    expect(await totalOf(kiddoJul)).toBe(1234.5);
  });
});

// ---------------------------------------------------------------------------------------------
// Optimistic concurrency: p_expected_ids
// ---------------------------------------------------------------------------------------------
describe("set_company_revenue_segments: p_expected_ids", () => {
  it("accepts the company's current segments as a set and refuses anything else, changing nothing", async () => {
    // A company without segments yet: the empty set.
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }], []);
    // Order and repeats do not matter.
    const saved = await setSegments(
      p.recqaOwner,
      R,
      [{ id: online.id, name: "Online" }, { id: retail.id, name: "Retail" }, { name: "Corporate" }],
      [retail.id, online.id, retail.id],
    );
    expect(names(saved)).toEqual(["Online", "Retail", "Corporate"]);
    const current = saved.map((row) => row.id);

    const stale: (string | null)[][] = [
      [online.id, retail.id], // one missing (added since)
      [...current, UNKNOWN_ID], // one too many
      [...current.slice(1), UNKNOWN_ID],
      [...current, null], // nulls never match
      [], // none
    ];
    for (const expected of stale) {
      await expectRule(setSegments(p.recqaOwner, R, [{ name: "Something else" }], expected), STALE);
    }
    // A retired segment is not current either.
    const [kept] = await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Online" }], current); // Retail and Corporate retired
    await expectRule(setSegments(p.recqaOwner, R, [{ id: kept.id, name: "Online" }], [online.id, retail.id]), STALE);
    expect(names(await companySegments(R))).toEqual(["Online"]);
  });

  it("refuses a list based on segments someone else changed in between; without it the call behaves as before", async () => {
    const [online, retail] = await setSegments(p.recqaOwner, R, [{ name: "Online" }, { name: "Retail" }]);
    const ownersPage = [online.id, retail.id];
    // A Fund Admin, on the owner's behalf, removes Retail and adds Corporate.
    await setSegments(p.fundAdmin, R, [{ id: online.id, name: "Online" }, { name: "Corporate" }], ownersPage);
    // The owner's page still shows Online and Retail: refused, nothing changes.
    await expectRule(setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }, { name: "Retail" }], ownersPage), STALE);
    expect(names(await companySegments(R))).toEqual(["Online", "Corporate"]);
    // Reloaded, it goes through.
    const reloaded = (await companySegments(R)).map((row) => row.id);
    expect(names(await setSegments(p.recqaOwner, R, [{ id: online.id, name: "Web" }], reloaded))).toEqual(["Web"]);
    // Without p_expected_ids — the two-argument call, or null — the list is applied as before.
    expect(names(await setSegments(p.recqaOwner, R, [{ name: "Retail" }]))).toEqual(["Retail"]);
    expect(names(await setSegments(p.recqaOwner, R, [{ name: "Retail" }, { name: "Online" }], null))).toEqual(["Retail", "Online"]);
    // Positional, as before.
    expect(
      await db.asUser(p.recqaOwner, (sql) =>
        sql.query<{ name: string }>("select name from public.set_company_revenue_segments($1, $2)", [R, [{ name: "Retail" }]]),
      ),
    ).toEqual([{ name: "Retail" }]);
  });

  it("is checked after the existing checks: permission, read-only company, the list; and before stale ids in the list", async () => {
    const [online] = await setSegments(p.kiddoOwner, K, [{ name: "Subscriptions" }]);
    const wrong = [UNKNOWN_ID];
    await expectDenied(setSegments(p.kiddoContributor, K, [{ name: "X" }], wrong), OWNER_ONLY);
    await expectDenied(setSegments(p.recqaOwner, K, [{ name: "X" }], wrong), OWNER_ONLY);
    await expectRule(setSegments(p.kiddoOwner, K, [{ name: "A" }, { name: "a" }], wrong), /^There are two revenue segments called "a"\./);
    await expectRule(setSegments(p.kiddoOwner, K, { name: "A" }, wrong), "Send the revenue segments as a list.");
    // A listed id that is not current: the stale set is reported first; with the right set, the old message.
    await expectRule(setSegments(p.kiddoOwner, K, [{ id: UNKNOWN_ID, name: "X" }], wrong), STALE);
    await expectRule(setSegments(p.kiddoOwner, K, [{ id: UNKNOWN_ID, name: "X" }], [online.id]), CHANGED);
    // Exited companies stay read-only, whatever the ids.
    await db.query("update public.companies set status = 'exited' where id = $1", [K]);
    await expectRule(
      setSegments(p.kiddoOwner, K, [{ name: "X" }], wrong),
      "Kiddocare is no longer an active portfolio company, so its records are read-only.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Permissions and privileges
// ---------------------------------------------------------------------------------------------
describe("permissions", () => {
  it("are unchanged: the owner and ScaleUp admins (on behalf) only, with or without p_expected_ids", async () => {
    const [online] = await setSegments(p.batikOwner, SEED.companies.batikBoutique, [{ name: "Online" }], []);
    const A = SEED.companies.batikBoutique;
    expect(names(await setSegments(p.fundAdmin, A, [{ id: online.id, name: "Online" }, { name: "Retail" }], [online.id]))).toEqual([
      "Online",
      "Retail",
    ]);
    const ids = (await companySegments(A)).map((row) => row.id);
    expect(names(await setSegments(p.superAdmin, A, [{ id: online.id, name: "Online" }], ids))).toEqual(["Online"]);
    for (const user of [p.batikContributor, p.kiddoOwner, p.partner, p.otherPartner, p.viewer]) {
      await expectDenied(setSegments(user, A, [{ name: "Online" }], [online.id]), OWNER_ONLY);
    }
    await expectDenied(
      db.asUser(p.batikOwner, (sql) => sql.query("select * from public.set_company_revenue_segments($1, $2, $3::uuid[])", [A, [], [online.id]]), {
        aal: "aal1",
      }),
      OWNER_ONLY,
    );
    await expectDenied(db.asAnon((sql) => sql.query("select * from public.set_company_revenue_segments($1, $2, $3::uuid[])", [A, [], [online.id]])));
    expect(
      await db.asService((sql) => sql.query<Segment>("select * from public.set_company_revenue_segments($1, $2, $3::uuid[])", [A, [{ name: "Online" }], [online.id]])),
    ).toEqual([expect.objectContaining({ id: online.id, name: "Online" })]);
  });

  it("keep one set_company_revenue_segments (uuid, jsonb, uuid[]) for authenticated and the service role only; the helper is internal", async () => {
    const signatures = await db.query<{ signature: string; definer: boolean; config: string[] }>(
      `select p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig as config
         from pg_proc p where p.proname = 'set_company_revenue_segments'`,
    );
    expect(signatures).toEqual([{ signature: "set_company_revenue_segments(uuid,jsonb,uuid[])", definer: true, config: ['search_path=""'] }]);
    expect(
      await db.one(
        `select has_function_privilege('authenticated', f.rpc, 'EXECUTE') as rpc_auth,
                has_function_privilege('service_role', f.rpc, 'EXECUTE') as rpc_service,
                has_function_privilege('anon', f.rpc, 'EXECUTE') as rpc_anon,
                exists (select 1 from aclexplode((select proacl from pg_proc where oid = f.rpc)) a where a.grantee = 0) as rpc_public,
                has_function_privilege('authenticated', f.save, 'EXECUTE') as save_auth,
                has_function_privilege('anon', f.save, 'EXECUTE') as save_anon,
                has_function_privilege('authenticated', f.helper, 'EXECUTE') as helper_auth,
                has_function_privilege('anon', f.helper, 'EXECUTE') as helper_anon,
                exists (select 1 from aclexplode((select proacl from pg_proc where oid = f.helper)) a where a.grantee = 0) as helper_public
           from (select 'public.set_company_revenue_segments(uuid, jsonb, uuid[])'::regprocedure as rpc,
                        'public.save_submission_values(uuid, jsonb, jsonb, jsonb)'::regprocedure as save,
                        'private.set_revenue_total_from_segments(uuid)'::regprocedure as helper) as f`,
      ),
    ).toEqual({
      rpc_auth: true,
      rpc_service: true,
      rpc_anon: false,
      rpc_public: false,
      save_auth: true,
      save_anon: false,
      helper_auth: false,
      helper_anon: false,
      helper_public: false,
    });
    // The helper cannot be reached through the API.
    await expectDenied(db.asUser(p.recqaOwner, (sql) => sql.query("select private.set_revenue_total_from_segments($1)", [p.subs.recqa["2026-07-01"]])));
  });
});

// ---------------------------------------------------------------------------------------------
// The migration itself
// ---------------------------------------------------------------------------------------------
describe(`${MIGRATION}`, () => {
  it("applies on top of the deployed migrations, keeps the RPCs' privileges exactly, and can run again", async () => {
    const files = readMigrations();
    const index = files.findIndex((m) => m.name === MIGRATION);
    expect(index).toBeGreaterThan(0);
    expect(files[index - 1].name).toBe("20261001000200_revenue_segments_b30.sql");

    const pg = await PGlite.create();
    try {
      await pg.exec("alter database postgres set timezone to 'UTC';");
      await setUtcTimeZone(pg);
      await runSqlFile(pg, readShim());
      for (const file of files.slice(0, index)) await runSqlFile(pg, file);
      const acl = async (signature: string) =>
        (
          await pg.query<{ grantee: string; privilege: string; grantable: boolean }>(
            `select coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type as privilege, a.is_grantable as grantable
               from pg_proc p cross join lateral aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
              where p.oid = to_regprocedure($1) order by 1, 2`,
            [signature],
          )
        ).rows;
      const rpcBefore = await acl("public.set_company_revenue_segments(uuid, jsonb)");
      const saveBefore = await acl("public.save_submission_values(uuid, jsonb, jsonb, jsonb)");
      expect(rpcBefore.map((row) => row.grantee)).toEqual(expect.arrayContaining(["authenticated", "service_role"]));

      const file = files[index];
      await runSqlFile(pg, file);
      await runSqlFile(pg, file); // e.g. a repeated `db push`
      expect(await acl("public.set_company_revenue_segments(uuid, jsonb, uuid[])")).toEqual(rpcBefore);
      expect(await acl("public.save_submission_values(uuid, jsonb, jsonb, jsonb)")).toEqual(saveBefore);
      expect(
        (
          await pg.query<{ old: boolean; helper: boolean }>(
            `select to_regprocedure('public.set_company_revenue_segments(uuid, jsonb)') is null as old,
                    to_regprocedure('private.set_revenue_total_from_segments(uuid)') is not null as helper`,
          )
        ).rows[0],
      ).toEqual({ old: true, helper: true });
    } finally {
      await pg.close();
    }
  });
});
