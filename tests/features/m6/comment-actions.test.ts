import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ assertUser: vi.fn(), assertCanViewCompany: vi.fn() }));

import { refresh, revalidatePath } from "next/cache";

import { addComment, getCommentCounts, listComments, setCommentResolved } from "@/lib/actions/comments";
import { assertCanViewCompany, assertUser } from "@/lib/auth/session";
import type { CompanyViewContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { IDS } from "./fixtures";
import { companyCtx, eqValue, fakeSupabase, scaleUpCtx, type Answer, type RecordedQuery } from "./fake-supabase";

const SCOPE = { id: IDS.sep, company_id: IDS.company, month: "2026-09-01" };
const OTHER_SUBMISSION = "90000000-0000-4000-8000-000000000555";
const ROOT = "c1000000-0000-4000-8000-000000000001";
const INTERNAL_ROOT = "c1000000-0000-4000-8000-000000000002";
const REPLY = "c1000000-0000-4000-8000-000000000011";
const NOT_FOUND = "This monthly update was not found or you do not have access to it.";

type CommentRef = { id: string; submission_id: string; parent_id: string | null; target: string; visibility: "shared" | "internal" };
const COMMENTS: Record<string, CommentRef> = {
  [ROOT]: { id: ROOT, submission_id: IDS.sep, parent_id: null, target: "field:gross_profit", visibility: "shared" },
  [INTERNAL_ROOT]: { id: INTERNAL_ROOT, submission_id: IDS.sep, parent_id: null, target: "general", visibility: "internal" },
  [REPLY]: { id: REPLY, submission_id: IDS.sep, parent_id: ROOT, target: "field:gross_profit", visibility: "shared" },
};

/** staff_display_names (BRD B28): "<full name> (ScaleUp)" for ScaleUp staff ids, nothing for anyone else. */
const STAFF_DISPLAY_NAMES: Record<string, string> = { [IDS.partner]: "Renuka Sena (ScaleUp)" };

function staffDisplayNames(name: string, args: unknown): Answer {
  if (name !== "staff_display_names") return { data: null, error: null };
  const ids = (args as { p_ids: string[] }).p_ids;
  return { data: ids.flatMap((id) => (STAFF_DISPLAY_NAMES[id] ? [{ id, display_name: STAFF_DISPLAY_NAMES[id] }] : [])), error: null };
}

/** Answers like PostgREST under RLS: company users never see internal comments. */
function database(viewer: CompanyViewContext, overrides: { insert?: Answer; commentRows?: unknown[]; submission?: unknown } = {}) {
  return fakeSupabase((query: RecordedQuery): Answer => {
    if (query.table === "submissions") {
      const id = eqValue(query, "id");
      if ("submission" in overrides) return { data: overrides.submission, error: null };
      return { data: id === IDS.sep ? SCOPE : id === OTHER_SUBMISSION ? { ...SCOPE, id: OTHER_SUBMISSION } : null, error: null };
    }
    if (query.table === "comments" && query.op === "insert") {
      return overrides.insert ?? { data: { id: "c1000000-0000-4000-8000-000000000777" }, error: null };
    }
    if (query.table === "comments" && eqValue(query, "id")) {
      const found = COMMENTS[String(eqValue(query, "id"))] ?? null;
      const visible = found && (viewer.scaleupRole || found.visibility === "shared") ? found : null;
      return { data: visible, error: null };
    }
    if (query.table === "comments") return { data: overrides.commentRows ?? [], error: null };
    if (query.table === "company_members") {
      return { data: [{ user_id: IDS.owner, role: "owner" }, { user_id: IDS.contributor, role: "contributor" }], error: null };
    }
    throw new Error(`unexpected query on ${query.table}`);
  }, staffDisplayNames);
}

function signIn(viewer: CompanyViewContext, overrides?: Parameters<typeof database>[1]) {
  const db = database(viewer, overrides);
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  vi.mocked(assertUser).mockResolvedValue(viewer);
  vi.mocked(assertCanViewCompany).mockResolvedValue(viewer);
  return db;
}

const partner = scaleUpCtx("partner", IDS.partner);
const viewer = scaleUpCtx("viewer", "a1000000-0000-4000-8000-000000000009");
const owner = companyCtx(IDS.owner, IDS.company, "owner");
const exitedOwner = companyCtx(IDS.owner, IDS.company, "owner", "exited");

beforeEach(() => {
  vi.clearAllMocks();
});

const OWNER_PROFILE = { id: IDS.owner, full_name: "Aisha Rahman", email: "aisha@batik.test", scaleup_role: null };
const PARTNER_PROFILE = { id: IDS.partner, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner" };

/** A shared question from the partner with the owner's reply; `asCompany` hides the partner's profile (RLS). */
function threadRows(asCompany: boolean) {
  return [
    {
      id: ROOT,
      submission_id: IDS.sep,
      parent_id: null,
      target: "field:gross_profit",
      visibility: "shared",
      body: "Why did gross profit drop?",
      created_at: "2026-10-01T01:00:00+00:00",
      resolved_at: null,
      resolved_by: null,
      author_id: IDS.partner,
      author: asCompany ? null : PARTNER_PROFILE,
      resolver: null,
    },
    {
      id: REPLY,
      submission_id: IDS.sep,
      parent_id: ROOT,
      target: "field:gross_profit",
      visibility: "shared",
      body: "Seasonal discounting.",
      created_at: "2026-10-01T02:00:00+00:00",
      resolved_at: null,
      resolved_by: null,
      author_id: IDS.owner,
      author: OWNER_PROFILE,
      resolver: null,
    },
  ];
}

describe("listComments", () => {
  it("names ScaleUp authors '<name> (ScaleUp)' for company users, without email or role (BRD B28)", async () => {
    const db = signIn(owner, { commentRows: threadRows(true) });
    const result = await listComments(IDS.sep);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    const [thread] = result.data;
    expect(thread.root.author).toEqual({ name: "Renuka Sena (ScaleUp)", roleLabel: null, side: "scaleup", isViewer: false });
    expect(thread.replies[0].author).toEqual({ name: "Aisha Rahman", roleLabel: "Company Owner", side: "company", isViewer: true });
    expect(thread).toMatchObject({ canReply: true, canResolve: true });
    expect(assertCanViewCompany).toHaveBeenCalledWith(IDS.company);
    // One staff_display_names request, for the hidden author only.
    expect(db.rpcs).toEqual([{ name: "staff_display_names", args: { p_ids: [IDS.partner] } }]);
    expect(JSON.stringify(result.data)).not.toContain("renuka@scaleup.test");
  });

  it("shows ScaleUp viewers names and roles from the profiles, without asking for display names", async () => {
    const db = signIn(partner, { commentRows: threadRows(false) });
    const result = await listComments(IDS.sep);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].root.author).toEqual({ name: "Renuka Sena", roleLabel: "Partner", side: "scaleup", isViewer: true });
    expect(result.data[0].replies[0].author).toMatchObject({ name: "Aisha Rahman", roleLabel: "Company Owner", isViewer: false });
    expect(db.rpcs).toEqual([]);
  });

  it("reports a failed name lookup as the database's friendly message", async () => {
    const failing = fakeSupabase(
      (query) =>
        query.table === "submissions"
          ? { data: SCOPE, error: null }
          : query.table === "comments"
            ? { data: threadRows(true), error: null }
            : { data: [], error: null },
      () => ({ data: null, error: { code: "42501", message: "Please sign in first." } }),
    );
    vi.mocked(createClient).mockResolvedValue(failing.client as never);
    vi.mocked(assertUser).mockResolvedValue(owner);
    vi.mocked(assertCanViewCompany).mockResolvedValue(owner);
    expect(await listComments(IDS.sep)).toEqual({ ok: false, error: "Please sign in first." });
    expect(failing.rpcs.map((call) => call.name)).toEqual(["staff_display_names"]);
  });

  it("refuses malformed and invisible months without checking the company", async () => {
    const db = signIn(owner);
    expect(await listComments("not-a-uuid")).toEqual({ ok: false, error: NOT_FOUND });
    expect(db.queries).toHaveLength(0);
    expect(await listComments("90000000-0000-4000-8000-000000000404")).toEqual({ ok: false, error: NOT_FOUND });
    expect(assertCanViewCompany).not.toHaveBeenCalled();
  });

  it("reports a signed-out session as the guard's message", async () => {
    signIn(owner);
    const { ActionError } = await import("@/lib/actions/result");
    vi.mocked(assertUser).mockRejectedValue(new ActionError("Your session has expired. Please sign in again."));
    expect(await listComments(IDS.sep)).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
  });
});

describe("getCommentCounts", () => {
  it("counts root threads per target", async () => {
    const db = fakeSupabase((query) =>
      query.table === "submissions"
        ? { data: SCOPE, error: null }
        : {
            data: [
              { target: "general", resolved_at: null },
              { target: "general", resolved_at: "2026-10-02T00:00:00Z" },
              { target: "field:gross_profit", resolved_at: null },
            ],
            error: null,
          },
    );
    vi.mocked(createClient).mockResolvedValue(db.client as never);
    vi.mocked(assertUser).mockResolvedValue(partner);
    vi.mocked(assertCanViewCompany).mockResolvedValue(partner);
    expect(await getCommentCounts(IDS.sep)).toEqual({
      ok: true,
      data: { general: { total: 2, unresolved: 1 }, "field:gross_profit": { total: 1, unresolved: 1 } },
    });
    expect(db.queries[1].filters).toContainEqual({ column: "parent_id", op: "is", value: null });
  });
});

describe("addComment: new threads", () => {
  it("lets ScaleUp reviewers start shared or internal threads on a normalised target", async () => {
    const db = signIn(partner);
    const result = await addComment({
      submissionId: IDS.sep,
      body: "  Please check the Online segment.  ",
      target: `SEGMENT:${IDS.segOnline.toUpperCase()}`,
      visibility: "internal",
    });
    expect(result).toEqual({ ok: true, data: { id: "c1000000-0000-4000-8000-000000000777" } });
    const insert = db.queries.find((q) => q.op === "insert");
    expect(insert?.payload).toEqual({
      submission_id: IDS.sep,
      author_id: IDS.partner,
      body: "Please check the Online segment.",
      parent_id: null,
      target: `segment:${IDS.segOnline}`,
      visibility: "internal",
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/review/${IDS.sep}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/portal/${IDS.company}/updates/2026-09`);
    expect(refresh).toHaveBeenCalled();
  });

  it("defaults to a shared thread on 'general'", async () => {
    const db = signIn(partner);
    await addComment({ submissionId: IDS.sep, body: "Looks fine overall." });
    expect(db.queries.find((q) => q.op === "insert")?.payload).toMatchObject({ target: "general", visibility: "shared" });
  });

  it("refuses company users and viewers (BRD B7), without writing", async () => {
    let db = signIn(owner);
    expect(await addComment({ submissionId: IDS.sep, body: "New thread", target: "general" })).toEqual({
      ok: false,
      error: "Only ScaleUp can start a new comment thread. Reply to an existing thread instead.",
    });
    expect(db.queries.some((q) => q.op === "insert")).toBe(false);
    db = signIn(viewer);
    expect(await addComment({ submissionId: IDS.sep, body: "New thread" })).toEqual({
      ok: false,
      error: "Your role can read comments but not start new threads.",
    });
    expect(db.queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("refuses unknown targets and empty or oversized bodies", async () => {
    signIn(partner);
    expect(await addComment({ submissionId: IDS.sep, body: "Hi", target: "field:Gross Profit" })).toEqual({
      ok: false,
      error: "That comment target is not recognised.",
    });
    expect(await addComment({ submissionId: IDS.sep, body: "   " })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: { body: "Write a comment first." },
    });
    const long = await addComment({ submissionId: IDS.sep, body: "x".repeat(5001) });
    expect(long).toMatchObject({ ok: false, fieldErrors: { body: "Please keep comments under 5,000 characters." } });
  });

  it("maps a refusal by Row Level Security to the generic permission message", async () => {
    signIn(partner, { insert: { data: null, error: { code: "42501", message: "new row violates row-level security policy for table \"comments\"" } } });
    expect(await addComment({ submissionId: IDS.sep, body: "Hello" })).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("addComment: replies", () => {
  it("lets company members reply to shared threads, inheriting target and visibility", async () => {
    const db = signIn(owner);
    const result = await addComment({ submissionId: IDS.sep, parentId: ROOT, body: "Seasonal discounting.", target: "general", visibility: "internal" });
    expect(result.ok).toBe(true);
    expect(db.queries.find((q) => q.op === "insert")?.payload).toEqual({
      submission_id: IDS.sep,
      author_id: IDS.owner,
      body: "Seasonal discounting.",
      parent_id: ROOT,
      target: "field:gross_profit",
      visibility: "shared",
    });
  });

  it("treats internal threads as not found for company users", async () => {
    const db = signIn(owner);
    expect(await addComment({ submissionId: IDS.sep, parentId: INTERNAL_ROOT, body: "Hello" })).toEqual({
      ok: false,
      error: "This comment thread was not found. It may have been removed.",
    });
    expect(db.queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("keeps threads one level deep and on the same month", async () => {
    signIn(partner);
    expect(await addComment({ submissionId: IDS.sep, parentId: REPLY, body: "Nested" })).toEqual({
      ok: false,
      error: "Replies can only be added to the first comment of a thread.",
    });
    expect(await addComment({ submissionId: OTHER_SUBMISSION, parentId: ROOT, body: "Moved" })).toEqual({
      ok: false,
      error: "You can only reply to a comment on the same monthly update.",
    });
  });

  it("refuses members of exited companies and ScaleUp viewers", async () => {
    signIn(exitedOwner);
    expect(await addComment({ submissionId: IDS.sep, parentId: ROOT, body: "After the exit" })).toEqual({
      ok: false,
      error: "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
    });
    signIn(viewer);
    expect(await addComment({ submissionId: IDS.sep, parentId: ROOT, body: "Viewer reply" })).toEqual({
      ok: false,
      error: "Your role can read comments but not reply to them.",
    });
  });
});

describe("setCommentResolved", () => {
  it("resolves and reopens whole threads through resolve_comment", async () => {
    const db = signIn(owner);
    expect(await setCommentResolved(ROOT, true)).toEqual({ ok: true, data: undefined });
    expect(await setCommentResolved(ROOT, false)).toEqual({ ok: true, data: undefined });
    expect(db.rpcs).toEqual([
      { name: "resolve_comment", args: { p_comment_id: ROOT, p_resolved: true } },
      { name: "resolve_comment", args: { p_comment_id: ROOT, p_resolved: false } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/portal/${IDS.company}`);
  });

  it("refuses replies, hidden threads, viewers and read-only companies", async () => {
    let db = signIn(partner);
    expect(await setCommentResolved(REPLY, true)).toEqual({
      ok: false,
      error: "Only whole threads can be resolved. Resolve the first comment of the thread instead.",
    });
    db = signIn(owner);
    expect(await setCommentResolved(INTERNAL_ROOT, true)).toEqual({
      ok: false,
      error: "This comment thread was not found. It may have been removed.",
    });
    db = signIn(viewer);
    expect(await setCommentResolved(ROOT, true)).toEqual({ ok: false, error: "Your role can read comments but not resolve them." });
    db = signIn(exitedOwner);
    expect(await setCommentResolved(ROOT, true)).toEqual({
      ok: false,
      error: "Batik Boutique is no longer an active portfolio company, so its records are read-only.",
    });
    expect(db.rpcs).toHaveLength(0);
    expect(await setCommentResolved("nope", true)).toEqual({
      ok: false,
      error: "This comment thread was not found. It may have been removed.",
    });
  });
});
