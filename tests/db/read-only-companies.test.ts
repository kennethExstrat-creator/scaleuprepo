/**
 * Exited and written-off companies are read-only (BRD B15, B21): ScaleUp can still approve months that
 * were already submitted (to finalise the history), but can no longer send a month back
 * (request_changes), reopen an approved month, extend a deadline or reopen a confirmed period close.
 * Those RPCs raise P0001 "<Company> is no longer an active portfolio company, so its records are
 * read-only." — after the permission check, so callers without the role still get 42501.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, setupPortfolio, status, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Case = { company: string; name: string; status: "exited" | "written_off"; owner: () => string; subs: () => Record<string, string>; key: "batik" | "kiddo" };

const CASES: Case[] = [
  { company: SEED.companies.batikBoutique, name: "Batik Boutique", status: "exited", owner: () => p.batikOwner, subs: () => p.subs.batik, key: "batik" },
  { company: SEED.companies.kiddocare, name: "Kiddocare", status: "written_off", owner: () => p.kiddoOwner, subs: () => p.subs.kiddo, key: "kiddo" },
];

const call = (user: string, fn: string, args: Record<string, unknown>) => db.asUser(user, (sql) => sql.rpc(fn, args));

/** Jul approved, Aug and Sep submitted, then the company leaves the active portfolio. */
async function prepare(c: Case): Promise<{ jul: string; aug: string; sep: string }> {
  const { "2026-07-01": jul, "2026-08-01": aug, "2026-09-01": sep } = c.subs();
  await fillAndSubmit(db, c.owner(), c.key, [jul, aug, sep]);
  await call(p.partner, "approve_submission", { p_submission_id: jul });
  await call(p.superAdmin, "set_company_status", { p_company_id: c.company, p_status: c.status, p_reason: "Portfolio change" });
  return { jul, aug, sep };
}

const snapshot = (id: string) =>
  db.one("select status::text as status, due_date, original_due_date, extension_reason, approved_at is not null as approved from public.submissions where id = $1", [id]);

describe("months of exited and written-off companies cannot be sent back (BRD B21)", () => {
  for (const c of CASES) {
    it(`${c.status}: request_changes, reopen_submission and extend_due_date are refused`, async () => {
      const { jul, aug, sep } = await prepare(c);
      const READ_ONLY = `${c.name} is no longer an active portfolio company, so its records are read-only.`;
      const before = await Promise.all([jul, aug, sep].map(snapshot));
      const eventsBefore = await db.count("select 1 from public.submission_events");

      for (const reviewer of [p.superAdmin, p.fundAdmin, p.partner, p.otherPartner]) {
        await expectRule(call(reviewer, "request_changes", { p_submission_id: aug, p_message: "Please fix cash" }), READ_ONLY);
      }
      for (const reviewer of [p.superAdmin, p.fundAdmin, p.partner]) {
        await expectRule(call(reviewer, "reopen_submission", { p_submission_id: jul, p_reason: "Restatement" }), READ_ONLY);
      }
      for (const admin of [p.superAdmin, p.fundAdmin]) {
        await expectRule(
          call(admin, "extend_due_date", { p_submission_id: sep, p_new_due_date: "2026-12-31", p_reason: "Auditor delay" }),
          READ_ONLY,
        );
      }
      // Trusted system callers (data fixes) follow the same rule.
      await expectRule(db.rpc("reopen_submission", { p_submission_id: jul, p_reason: "System" }), READ_ONLY);
      await expectRule(db.rpc("extend_due_date", { p_submission_id: sep, p_new_due_date: "2026-12-31" }), READ_ONLY);

      // Callers without the role still get the permission error first (nothing about the company leaks).
      await expectDenied(call(p.viewer, "request_changes", { p_submission_id: aug, p_message: "x" }), "Only ScaleUp reviewers can request changes.");
      await expectDenied(
        call(p.otherPartner, "reopen_submission", { p_submission_id: jul, p_reason: "x" }),
        "Only a Super Admin, a Fund Admin or the partner-in-charge can reopen an approved month.",
      );
      await expectDenied(
        call(p.partner, "extend_due_date", { p_submission_id: sep, p_new_due_date: "2026-12-31" }),
        "Only Super Admins and Fund Admins can extend deadlines.",
      );
      await expectDenied(call(c.owner(), "request_changes", { p_submission_id: aug, p_message: "x" }), "Only ScaleUp reviewers can request changes.");

      expect(await Promise.all([jul, aug, sep].map(snapshot))).toEqual(before);
      expect(await db.count("select 1 from public.submission_events")).toBe(eventsBefore);
    });

    it(`${c.status}: ScaleUp can still approve months that were already submitted`, async () => {
      const { aug, sep } = await prepare(c);
      await call(p.partner, "approve_submission", { p_submission_id: aug, p_message: "Final figures" });
      await call(p.superAdmin, "approve_submission", { p_submission_id: sep });
      expect([await status(db, aug), await status(db, sep)]).toEqual(["approved", "approved"]);
      await expectDenied(
        call(p.fundAdmin, "approve_submission", { p_submission_id: sep }),
        "Only the partner-in-charge or a Super Admin can approve this update.",
      );
    });
  }

  it("the rules apply again once the company is active again", async () => {
    const { jul, aug } = await prepare(CASES[0]);
    await call(p.superAdmin, "set_company_status", { p_company_id: CASES[0].company, p_status: "active", p_reason: "Exit reversed" });
    await call(p.fundAdmin, "request_changes", { p_submission_id: aug, p_message: "Please fix cash" });
    await call(p.fundAdmin, "reopen_submission", { p_submission_id: jul, p_reason: "Restatement" });
    expect([await status(db, jul), await status(db, aug)]).toEqual(["changes_requested", "changes_requested"]);
  });
});

describe("confirmed period closes of exited and written-off companies stay confirmed", () => {
  /** Jul–Sep submitted, management accounts uploaded, Q3 confirmed by the owner; then the status changes. */
  async function confirmedQ3(c: Case): Promise<string> {
    await fillAndSubmit(db, c.owner(), c.key, ["2026-07-01", "2026-08-01", "2026-09-01"].map((m) => c.subs()[m]));
    const close = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [c.company]);
    const path = `${c.company}/${close}/${randomUUID()}-accounts.pdf`;
    await db.query("insert into storage.objects (bucket_id, name) values ('company-documents', $1)", [path]);
    await db.asUser(c.owner(), (sql) =>
      sql.query(
        "insert into public.documents (company_id, period_close_id, file_name, storage_path) values ($1, $2, 'accounts.pdf', $3)",
        [c.company, close, path],
      ),
    );
    await call(c.owner(), "confirm_period_close", { p_close_id: close });
    return close;
  }

  const closeState = (close: string) =>
    db.one<{ status: string; confirmed: boolean; totals: boolean }>(
      `select status::text as status, confirmed_at is not null and confirmed_by is not null as confirmed,
              computed_totals is not null as totals
         from public.period_closes where id = $1`,
      [close],
    );

  for (const c of CASES) {
    it(`${c.status}: reopen_period_close is refused (otherwise nobody could ever confirm the close again)`, async () => {
      const close = await confirmedQ3(c);
      await call(p.superAdmin, "set_company_status", { p_company_id: c.company, p_status: c.status, p_reason: "Portfolio change" });
      const READ_ONLY = `${c.name} is no longer an active portfolio company, so its records are read-only.`;
      const auditBefore = await db.count("select 1 from public.audit_log where entity = 'period_closes'");

      for (const admin of [p.superAdmin, p.fundAdmin]) {
        await expectRule(call(admin, "reopen_period_close", { p_close_id: close, p_reason: "Check" }), READ_ONLY);
      }
      // Trusted system callers (data fixes) follow the same rule.
      await expectRule(db.rpc("reopen_period_close", { p_close_id: close, p_reason: "System" }), READ_ONLY);
      // Callers without the role still get the permission error first.
      for (const user of [p.partner, p.viewer, c.owner()]) {
        await expectDenied(
          call(user, "reopen_period_close", { p_close_id: close, p_reason: "x" }),
          "Only Super Admins and Fund Admins can reopen a period close.",
        );
      }
      expect(await closeState(close)).toEqual({ status: "confirmed", confirmed: true, totals: true });
      expect(await db.count("select 1 from public.audit_log where entity = 'period_closes'")).toBe(auditBefore);
    });
  }

  it("the close can be reopened (and confirmed again) once the company is active again", async () => {
    const c = CASES[0];
    const close = await confirmedQ3(c);
    await call(p.superAdmin, "set_company_status", { p_company_id: c.company, p_status: c.status, p_reason: "Trade sale" });
    await call(p.superAdmin, "set_company_status", { p_company_id: c.company, p_status: "active", p_reason: "Exit reversed" });
    await call(p.fundAdmin, "reopen_period_close", { p_close_id: close, p_reason: "Wrong accounts" });
    expect(await closeState(close)).toEqual({ status: "open", confirmed: false, totals: false });
    await call(c.owner(), "confirm_period_close", { p_close_id: close });
    expect((await closeState(close)).status).toBe("confirmed");
  });
});
