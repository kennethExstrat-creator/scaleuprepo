import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type Sql, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;
let jul: string;
let sharedRoot: string;
let internalRoot: string;

type NewComment = {
  submission_id: string;
  body: string;
  parent_id?: string | null;
  target?: string;
  visibility?: "shared" | "internal";
  author_id?: string;
};

function addComment(sql: Sql, userId: string, c: NewComment): Promise<string> {
  return sql.value<string>(
    `insert into public.comments (submission_id, parent_id, target, visibility, author_id, body)
     values ($1, $2, coalesce($3, 'general'), coalesce($4, 'shared')::public.comment_visibility, $5, $6)
     returning id`,
    [c.submission_id, c.parent_id ?? null, c.target ?? null, c.visibility ?? null, c.author_id ?? userId, c.body],
  );
}

const comment = (user: string, c: NewComment) => db.asUser(user, (sql) => addComment(sql, user, c));
const resolve = (user: string, id: string, resolved = true) =>
  db.asUser(user, (sql) => sql.rpc("resolve_comment", { p_comment_id: id, p_resolved: resolved }));

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
  jul = p.subs.batik["2026-07-01"];
  sharedRoot = await comment(p.partner, {
    submission_id: jul,
    target: "field:gross_profit",
    visibility: "shared",
    body: "Why did gross profit drop?",
  });
  internalRoot = await comment(p.otherPartner, {
    submission_id: jul,
    target: `kpi:${SEED.kpis.revenuePerOutlet}:${SEED.outlets.theRow}`,
    visibility: "internal",
    body: "Internal: The Row looks weak.",
  });
});

afterEach(async () => {
  await db?.close();
});

describe("comments", () => {
  it("ScaleUp sees every thread; company members see only shared threads of their own company", async () => {
    expect(await db.asUser(p.viewer, (sql) => sql.count("select 1 from public.comments"))).toBe(2);
    const own = await db.asUser(p.batikContributor, (sql) => sql.query<{ id: string }>("select id from public.comments"));
    expect(own).toEqual([{ id: sharedRoot }]);
    expect(await db.asUser(p.kiddoOwner, (sql) => sql.count("select 1 from public.comments"))).toBe(0);
    // Open-thread counts in the overview only include threads the caller can see.
    const overview = (user: string) =>
      db.asUser(user, (sql) => sql.value<number>("select open_threads from public.v_submission_overview where id = $1", [jul]));
    expect(await overview(p.partner)).toBe(2);
    expect(await overview(p.batikOwner)).toBe(1);
  });

  it("company members can reply to shared roots; replies inherit the root's target and visibility", async () => {
    const reply = await comment(p.batikContributor, {
      submission_id: jul,
      parent_id: sharedRoot,
      target: "general",
      visibility: "shared",
      body: "Seasonal discounting.",
    });
    const row = await db.one("select target, visibility::text as visibility, author_id from public.comments where id = $1", [reply]);
    expect(row).toEqual({ target: "field:gross_profit", visibility: "shared", author_id: p.batikContributor });
    // A ScaleUp reply to the internal thread stays internal even if it claims to be shared.
    const scaleUpReply = await comment(p.partner, {
      submission_id: jul,
      parent_id: internalRoot,
      visibility: "shared",
      body: "Agreed",
    });
    expect(await db.value("select visibility::text from public.comments where id = $1", [scaleUpReply])).toBe("internal");
    expect(await db.asUser(p.batikOwner, (sql) => sql.count("select 1 from public.comments"))).toBe(2);
  });

  it("company members cannot reply to internal threads, start threads or comment on other companies", async () => {
    await expectDenied(
      comment(p.batikOwner, { submission_id: jul, parent_id: internalRoot, visibility: "shared", body: "Sneaky" }),
      /row-level security/,
    );
    await expectDenied(comment(p.batikOwner, { submission_id: jul, body: "New thread" }), /row-level security/);
    await expectDenied(
      comment(p.kiddoOwner, { submission_id: jul, parent_id: sharedRoot, body: "Not my company" }),
      /row-level security/,
    );
    // Pointing a reply on their own month at another company's thread is rejected by the trigger
    // (same message whether or not the parent exists, so nothing leaks).
    const kiddoJul = p.subs.kiddo["2026-07-01"];
    await expectRule(
      comment(p.kiddoOwner, { submission_id: kiddoJul, parent_id: sharedRoot, body: "Cross-submission" }),
      "You can only reply to a comment on the same monthly update.",
    );
    await expectRule(
      comment(p.kiddoOwner, { submission_id: kiddoJul, parent_id: "00000000-0000-4000-8000-000000000000", body: "Unknown" }),
      "You can only reply to a comment on the same monthly update.",
    );
  });

  it("only ScaleUp non-viewers start threads, and nobody can post as someone else", async () => {
    await expectDenied(comment(p.viewer, { submission_id: jul, body: "Viewer thread" }), /row-level security/);
    await expectDenied(comment(p.viewer, { submission_id: jul, parent_id: sharedRoot, body: "Viewer reply" }), /row-level security/);
    await expectDenied(
      comment(p.fundAdmin, { submission_id: jul, body: "Spoofed", author_id: p.partner }),
      /row-level security/,
    );
    await expectDenied(
      comment(p.batikOwner, { submission_id: jul, parent_id: sharedRoot, body: "Spoofed", author_id: p.batikContributor }),
      /row-level security/,
    );
    // Partners can comment on any company, including ones they are not in charge of.
    await comment(p.otherPartner, { submission_id: p.subs.recqa["2026-07-01"], visibility: "internal", body: "RECQA note" });
    await comment(p.superAdmin, { submission_id: jul, body: "Super admin thread" });
    await comment(p.fundAdmin, { submission_id: jul, body: "Fund admin thread", target: `SEGMENT:${SEED.companies.batikBoutique.toUpperCase()}` });
    expect(await db.value("select target from public.comments where body = 'Fund admin thread'")).toBe(`segment:${SEED.companies.batikBoutique}`);
  });

  it("keeps threads one level deep, on the same submission, with a valid target", async () => {
    const reply = await comment(p.batikOwner, { submission_id: jul, parent_id: sharedRoot, body: "Reply" });
    await expectRule(
      comment(p.partner, { submission_id: jul, parent_id: reply, body: "Nested" }),
      "Replies can only be added to the first comment of a thread.",
    );
    await expectRule(
      comment(p.partner, { submission_id: p.subs.batik["2026-08-01"], parent_id: sharedRoot, body: "Moved" }),
      "You can only reply to a comment on the same monthly update.",
    );
    await expectRule(comment(p.partner, { submission_id: jul, target: "field:", body: "Bad target" }), "That comment target is not recognised.");
    await expectRule(comment(p.partner, { submission_id: jul, target: "kpi:not-a-uuid", body: "Bad target" }), "That comment target is not recognised.");
    await expectPgError(comment(p.partner, { submission_id: jul, body: "" }), { code: "23514" });
    await expectPgError(comment(p.partner, { submission_id: jul, body: "x".repeat(5001) }), { code: "23514" });
  });

  it("comments cannot be edited or deleted directly", async () => {
    await expectDenied(db.asUser(p.partner, (sql) => sql.exec(`update public.comments set body = 'Edited' where id = '${sharedRoot}'`)));
    await expectDenied(db.asUser(p.partner, (sql) => sql.exec(`delete from public.comments where id = '${sharedRoot}'`)));
    await expectRule(db.query("update public.comments set body = 'Edited' where id = $1", [sharedRoot]), "Comments cannot be edited.");
  });

  it("resolve_comment: company members resolve shared threads; ScaleUp non-viewers resolve any thread", async () => {
    await resolve(p.batikContributor, sharedRoot);
    let row = await db.one("select resolved_by, resolved_at is not null as resolved from public.comments where id = $1", [sharedRoot]);
    expect(row).toEqual({ resolved_by: p.batikContributor, resolved: true });
    // Resolving again keeps the first resolver; unresolving clears it.
    await resolve(p.partner, sharedRoot);
    expect(await db.value("select resolved_by from public.comments where id = $1", [sharedRoot])).toBe(p.batikContributor);
    await resolve(p.batikOwner, sharedRoot, false);
    row = await db.one("select resolved_by, resolved_at is not null as resolved from public.comments where id = $1", [sharedRoot]);
    expect(row).toEqual({ resolved_by: null, resolved: false });

    await expectDenied(resolve(p.batikOwner, internalRoot), "This comment was not found or you do not have access to it.");
    await expectDenied(resolve(p.kiddoOwner, sharedRoot), "This comment was not found or you do not have access to it.");
    await expectDenied(resolve(p.viewer, internalRoot), "You do not have permission to resolve this thread.");
    await resolve(p.otherPartner, internalRoot);
    await resolve(p.fundAdmin, internalRoot, false);

    const reply = await comment(p.batikOwner, { submission_id: jul, parent_id: sharedRoot, body: "Reply" });
    await expectRule(resolve(p.partner, reply), "Only whole threads can be resolved. Resolve the first comment of the thread instead.");
    await expectDenied(db.asAnon((sql) => sql.rpc("resolve_comment", { p_comment_id: sharedRoot, p_resolved: true })));
  });

  it("exited companies are read-only for their members, but not for ScaleUp reviewers", async () => {
    await db.rpc("set_company_status", { p_company_id: SEED.companies.batikBoutique, p_status: "exited", p_reason: "Sold" });
    const READ_ONLY = "Batik Boutique is no longer an active portfolio company, so its records are read-only.";
    await expectRule(comment(p.batikOwner, { submission_id: jul, parent_id: sharedRoot, body: "After the exit" }), READ_ONLY);
    await expectRule(resolve(p.batikContributor, sharedRoot), READ_ONLY);
    // Users of other companies learn nothing about it (a plain RLS refusal).
    await expectDenied(comment(p.kiddoOwner, { submission_id: jul, parent_id: sharedRoot, body: "Hello" }), /row-level security/);
    await expectDenied(resolve(p.kiddoOwner, sharedRoot), "This comment was not found or you do not have access to it.");
    // ScaleUp reviewers can still discuss and resolve the company's history.
    await comment(p.partner, { submission_id: jul, parent_id: sharedRoot, body: "Noted for the exit memo" });
    await comment(p.fundAdmin, { submission_id: jul, visibility: "internal", body: "Final numbers check" });
    await resolve(p.partner, sharedRoot);
    expect(await db.value("select resolved_by from public.comments where id = $1", [sharedRoot])).toBe(p.partner);
  });

  it("new comments cannot be created already resolved or back-dated", async () => {
    const id = await db.asUser(p.partner, (sql) =>
      sql.value<string>(
        `insert into public.comments (submission_id, author_id, body, resolved_at, resolved_by, created_at)
         values ($1, $2, 'Pre-resolved', now(), $2, '2020-01-01') returning id`,
        [jul, p.partner],
      ),
    );
    const row = await db.one<{ resolved_at: string | null; resolved_by: string | null; created_at: string }>(
      "select resolved_at, resolved_by, created_at from public.comments where id = $1",
      [id],
    );
    expect(row.resolved_at).toBeNull();
    expect(row.resolved_by).toBeNull();
    expect(row.created_at.startsWith("2020")).toBe(false);
  });
});
