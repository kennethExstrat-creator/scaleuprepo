import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { fillAndSubmit, fillValid, save, setupPortfolio, status, submit, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
let jul: string;
let aug: string;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
  jul = p.subs.batik["2026-07-01"];
  aug = p.subs.batik["2026-08-01"];
});

afterEach(async () => {
  await db?.close();
});

const call = (user: string, fn: string, args: Record<string, unknown>) => db.asUser(user, (sql) => sql.rpc(fn, args));

async function events(submissionId: string) {
  return db.query<{ event: string; actor_id: string; message: string | null }>(
    "select event, actor_id, message from public.submission_events where submission_id = $1 order by id",
    [submissionId],
  );
}

describe("submit_submission()", () => {
  it("submits a complete month for the owner, with declaration, revision and event", async () => {
    await fillValid(db, p.batikContributor, jul, "batik");
    await call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true });
    const row = await db.one(
      "select status::text as status, submitted_by, declaration_text, revision, submitted_at is not null as has_time from public.submissions where id = $1",
      [jul],
    );
    expect(row).toEqual({
      status: "submitted",
      submitted_by: p.batikOwner,
      declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
      revision: 1,
      has_time: true,
    });
    expect(await events(jul)).toEqual([{ event: "submitted", actor_id: p.batikOwner, message: null }]);
    const audit = await db.one("select action, summary, actor_role from public.audit_log where entity = 'submissions' and action = 'submit'");
    expect(audit).toEqual({ action: "submit", summary: "Submitted Jul 2026", actor_role: "company_owner" });
  });

  it("is only for the company owner", async () => {
    await fillValid(db, p.batikOwner, jul, "batik");
    for (const user of [p.batikContributor, p.fundAdmin, p.superAdmin, p.partner, p.viewer]) {
      await expectDenied(
        call(user, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }),
        "Only the company owner can submit monthly updates.",
      );
    }
    await expectDenied(call(p.kiddoOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }));
    expect(await status(db, jul)).toBe("draft");
  });

  it("needs the declaration and a valid month", async () => {
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: false }),
      "Please confirm the declaration before submitting.",
    );
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }),
      "Please fix 22 issues before submitting, starting with: Total revenue is required.",
    );
    await fillValid(db, p.batikOwner, jul, "batik", { headcount_pt: 1.5 });
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }),
      "Part-time headcount must be a whole number.",
    );
    expect(await status(db, jul)).toBe("draft");
  });

  it("blocks a month while earlier months are unsubmitted", async () => {
    await fillValid(db, p.batikOwner, aug, "batik");
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: aug, p_declaration_accepted: true }),
      "Submit earlier months first: Jul 2026.",
    );
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await submit(db, p.batikOwner, aug);
    expect(await status(db, aug)).toBe("submitted");
  });

  it("cannot submit twice, submit an approved month, or submit for an exited company", async () => {
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }),
      "Jul 2026 has already been submitted.",
    );
    await call(p.partner, "approve_submission", { p_submission_id: jul });
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: jul, p_declaration_accepted: true }),
      "Jul 2026 is approved and locked.",
    );
    await fillValid(db, p.batikOwner, aug, "batik");
    await db.rpc("set_company_status", { p_company_id: SEED.companies.batikBoutique, p_status: "exited", p_reason: null });
    await expectRule(
      call(p.batikOwner, "submit_submission", { p_submission_id: aug, p_declaration_accepted: true }),
      "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
    );
  });
});

describe("review workflow", () => {
  beforeEach(async () => {
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
  });

  it("request_changes → resubmit → approve (full cycle)", async () => {
    await call(p.otherPartner, "request_changes", { p_submission_id: jul, p_message: "  Please split revenue by outlet.  " });
    expect(await status(db, jul)).toBe("changes_requested");
    await db.asUser(p.batikOwner, (sql) => save(sql, jul, { values: [{ key: "key_milestones", value_text: "Split" }] }));
    await submit(db, p.batikOwner, jul);
    const row = await db.one("select status::text as status, revision from public.submissions where id = $1", [jul]);
    expect(row).toEqual({ status: "submitted", revision: 2 });
    await call(p.partner, "approve_submission", { p_submission_id: jul, p_message: "Looks good" });
    const approved = await db.one("select status::text as status, approved_by, approved_at is not null as has_time from public.submissions where id = $1", [
      jul,
    ]);
    expect(approved).toEqual({ status: "approved", approved_by: p.partner, has_time: true });
    expect(await events(jul)).toEqual([
      { event: "submitted", actor_id: p.batikOwner, message: null },
      { event: "changes_requested", actor_id: p.otherPartner, message: "Please split revenue by outlet." },
      { event: "resubmitted", actor_id: p.batikOwner, message: null },
      { event: "approved", actor_id: p.partner, message: "Looks good" },
    ]);
    // Company users can read their own timeline.
    expect(await db.asUser(p.batikContributor, (sql) => sql.count("select 1 from public.submission_events"))).toBe(4);
  });

  it("request_changes: ScaleUp reviewers only, needs a message, submitted months only", async () => {
    for (const user of [p.viewer, p.batikOwner, p.batikContributor]) {
      await expectDenied(
        call(user, "request_changes", { p_submission_id: jul, p_message: "x" }),
        "Only ScaleUp reviewers can request changes.",
      );
    }
    await expectRule(call(p.fundAdmin, "request_changes", { p_submission_id: jul, p_message: "   " }), "Please explain what needs to change.");
    await call(p.fundAdmin, "request_changes", { p_submission_id: jul, p_message: "Fix it" });
    await expectRule(
      call(p.superAdmin, "request_changes", { p_submission_id: jul, p_message: "Again" }),
      "Only submitted updates can be sent back for changes.",
    );
    await expectRule(
      call(p.superAdmin, "request_changes", { p_submission_id: aug, p_message: "Draft" }),
      "Only submitted updates can be sent back for changes.",
    );
  });

  it("approve: only the partner-in-charge or a Super Admin, submitted months only", async () => {
    for (const user of [p.otherPartner, p.fundAdmin, p.viewer, p.batikOwner]) {
      await expectDenied(
        call(user, "approve_submission", { p_submission_id: jul }),
        "Only the partner-in-charge or a Super Admin can approve this update.",
      );
    }
    await expectRule(call(p.superAdmin, "approve_submission", { p_submission_id: aug }), "Only submitted updates can be approved.");
    await call(p.superAdmin, "approve_submission", { p_submission_id: jul });
    expect(await status(db, jul)).toBe("approved");
    await expectRule(call(p.partner, "approve_submission", { p_submission_id: jul }), "Only submitted updates can be approved.");
  });

  it("a partner who is no longer active cannot approve", async () => {
    await db.query("update public.profiles set is_active = false where id = $1", [p.partner]);
    await expectDenied(call(p.partner, "approve_submission", { p_submission_id: jul }));
  });

  it("reopen: Super Admin, Fund Admin or partner-in-charge, approved months only, reason required", async () => {
    await call(p.partner, "approve_submission", { p_submission_id: jul });
    for (const user of [p.otherPartner, p.viewer, p.batikOwner]) {
      await expectDenied(
        call(user, "reopen_submission", { p_submission_id: jul, p_reason: "x" }),
        "Only a Super Admin, a Fund Admin or the partner-in-charge can reopen an approved month.",
      );
    }
    await expectRule(call(p.fundAdmin, "reopen_submission", { p_submission_id: jul, p_reason: "" }), "Please give a reason for reopening this month.");
    await call(p.fundAdmin, "reopen_submission", { p_submission_id: jul, p_reason: "Audit adjustment" });
    const row = await db.one("select status::text as status, approved_at, approved_by from public.submissions where id = $1", [jul]);
    expect(row).toEqual({ status: "changes_requested", approved_at: null, approved_by: null });
    expect((await events(jul)).at(-1)).toEqual({ event: "reopened", actor_id: p.fundAdmin, message: "Audit adjustment" });
    await expectRule(call(p.fundAdmin, "reopen_submission", { p_submission_id: jul, p_reason: "Again" }), "Only approved months can be reopened.");
    // Needs re-approval after the company resubmits.
    await submit(db, p.batikOwner, jul);
    expect(await db.value("select revision from public.submissions where id = $1", [jul])).toBe(2);
    await call(p.partner, "approve_submission", { p_submission_id: jul });
    await call(p.partner, "reopen_submission", { p_submission_id: jul, p_reason: "Partner reopen" });
    expect(await status(db, jul)).toBe("changes_requested");
  });

  it("request_amendment: owner of an approved month adds a shared thread and an event", async () => {
    await expectRule(
      call(p.batikOwner, "request_amendment", { p_submission_id: jul, p_reason: "x" }),
      "Amendments can only be requested for approved months.",
    );
    await call(p.partner, "approve_submission", { p_submission_id: jul });
    for (const user of [p.batikContributor, p.fundAdmin, p.partner]) {
      await expectDenied(
        call(user, "request_amendment", { p_submission_id: jul, p_reason: "x" }),
        "Only the company owner can request an amendment.",
      );
    }
    await expectRule(call(p.batikOwner, "request_amendment", { p_submission_id: jul, p_reason: " " }), "Please describe the amendment you need.");
    await call(p.batikOwner, "request_amendment", { p_submission_id: jul, p_reason: "Cash was misstated" });
    const comment = await db.one(
      "select parent_id, target, visibility::text as visibility, author_id, body, resolved_at from public.comments where submission_id = $1",
      [jul],
    );
    expect(comment).toEqual({
      parent_id: null,
      target: "general",
      visibility: "shared",
      author_id: p.batikOwner,
      body: "Amendment requested: Cash was misstated",
      resolved_at: null,
    });
    expect((await events(jul)).at(-1)).toEqual({ event: "amendment_requested", actor_id: p.batikOwner, message: "Cash was misstated" });
    expect(await status(db, jul)).toBe("approved"); // ScaleUp decides whether to reopen
  });
});

describe("extend_due_date()", () => {
  const dueOf = (id: string) =>
    db.one("select due_date, original_due_date, extension_reason from public.submissions where id = $1", [id]);

  it("records the original due date once, the new date and the reason", async () => {
    // Opened on 20 Oct, after its normal due date (15 Sep): 14 days of grace.
    expect(await dueOf(aug)).toEqual({ due_date: "2026-11-03", original_due_date: null, extension_reason: null });
    await call(p.fundAdmin, "extend_due_date", { p_submission_id: aug, p_new_due_date: "2026-11-30", p_reason: " Auditor delay " });
    expect(await dueOf(aug)).toEqual({ due_date: "2026-11-30", original_due_date: "2026-11-03", extension_reason: "Auditor delay" });
    await call(p.superAdmin, "extend_due_date", { p_submission_id: aug, p_new_due_date: "2026-12-15", p_reason: null });
    expect(await dueOf(aug)).toEqual({ due_date: "2026-12-15", original_due_date: "2026-11-03", extension_reason: null });
    expect(await events(aug)).toEqual([
      { event: "deadline_extended", actor_id: p.fundAdmin, message: "Due date extended to 30 Nov 2026. Reason: Auditor delay" },
      { event: "deadline_extended", actor_id: p.superAdmin, message: "Due date extended to 15 Dec 2026." },
    ]);
  });

  it("is for Super Admins and Fund Admins, later dates only, and never for approved months", async () => {
    for (const user of [p.partner, p.viewer, p.batikOwner]) {
      await expectDenied(
        call(user, "extend_due_date", { p_submission_id: aug, p_new_due_date: "2026-12-01", p_reason: "x" }),
        "Only Super Admins and Fund Admins can extend deadlines.",
      );
    }
    await expectRule(
      call(p.fundAdmin, "extend_due_date", { p_submission_id: aug, p_new_due_date: "2026-11-03", p_reason: "x" }),
      "The new due date must be after the current due date (3 Nov 2026).",
    );
    await expectRule(
      call(p.fundAdmin, "extend_due_date", { p_submission_id: aug, p_new_due_date: null, p_reason: "x" }),
      "Choose the new due date.",
    );
    await fillAndSubmit(db, p.batikOwner, "batik", [jul]);
    await call(p.fundAdmin, "extend_due_date", { p_submission_id: jul, p_new_due_date: "2026-12-01", p_reason: "Submitted months can move" });
    await call(p.partner, "approve_submission", { p_submission_id: jul });
    await expectRule(
      call(p.fundAdmin, "extend_due_date", { p_submission_id: jul, p_new_due_date: "2026-12-31", p_reason: "x" }),
      "Approved months cannot have their deadline extended.",
    );
  });
});
