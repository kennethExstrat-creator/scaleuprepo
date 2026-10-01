"use server";

// Comment server actions (module M6, BRD A7 / C7, docs/ARCHITECTURE.md §5.7). Both audiences use them:
// ScaleUp staff (every thread; non-viewers start threads, shared or internal) and company members (shared
// threads of their own company: read, reply and resolve while the company is active; never start threads,
// BRD B7). Company users see ScaleUp people as "<full name> (ScaleUp)" (staff_display_names), never their
// email or role (BRD B24, B28). Row Level Security and resolve_comment() enforce all of this again in the
// database.

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";

import {
  findCommentScope,
  loadCommentCounts,
  loadCommentThreads,
  type CommentScope,
} from "@/components/comments/load-threads";
import { COMMENT_MAX_LENGTH, normaliseCommentTarget } from "@/components/comments/model";
import type { AddCommentInput, CommentCounts, CommentThread } from "@/components/comments/types";
import { ActionError, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import {
  canComment,
  canReplyToComments,
  canResolveComments,
  membershipFor,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import { assertCanViewCompany, assertUser } from "@/lib/auth/session";
import { dateToMonthKey } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import { COMMENT_VISIBILITIES, type CommentVisibility } from "@/lib/types/enums";

type Client = Awaited<ReturnType<typeof createClient>>;
type CommentRef = { id: string; submission_id: string; parent_id: string | null; target: string; visibility: CommentVisibility };

const SUBMISSION_NOT_FOUND = "This monthly update was not found or you do not have access to it.";
const THREAD_NOT_FOUND = "This comment thread was not found. It may have been removed.";

const idSchema = z.guid();

const addCommentSchema = z.object({
  submissionId: z.guid({ error: SUBMISSION_NOT_FOUND }),
  body: z
    .string({ error: "Write a comment first." })
    .trim()
    .min(1, "Write a comment first.")
    .max(COMMENT_MAX_LENGTH, "Please keep comments under 5,000 characters."),
  target: z.string().max(200).optional(),
  visibility: z.enum(COMMENT_VISIBILITIES).optional(),
  parentId: z.guid({ error: THREAD_NOT_FOUND }).nullish(),
});

const resolvedSchema = z.boolean({ error: "Choose whether to resolve or reopen the thread." });

/** The submission (id, company, month) the caller may see; a friendly error otherwise. */
async function requireScope(sb: Client, submissionId: unknown): Promise<CommentScope> {
  const parsed = idSchema.safeParse(submissionId);
  if (!parsed.success) throw new ActionError(SUBMISSION_NOT_FOUND);
  const scope = await findCommentScope(sb, parsed.data);
  if (!scope) throw new ActionError(SUBMISSION_NOT_FOUND);
  return scope;
}

async function findComment(sb: Client, commentId: string): Promise<CommentRef | null> {
  const { data, error } = await sb
    .from("comments")
    .select("id, submission_id, parent_id, target, visibility")
    .eq("id", commentId)
    .maybeSingle();
  if (error) throw error;
  const comment: CommentRef | null = data;
  return comment;
}

function readOnlyMessage(ctx: PermissionSubject, companyId: string): string | null {
  const membership = membershipFor(ctx, companyId);
  if (!membership || membership.companyStatus === "active") return null;
  return `${membership.companyName} is no longer an active portfolio company, so its records are read-only.`;
}

function replyDeniedMessage(ctx: PermissionSubject, companyId: string): string {
  if (ctx.scaleupRole) return "Your role can read comments but not reply to them.";
  return readOnlyMessage(ctx, companyId) ?? "You don't have permission to reply to this thread.";
}

function resolveDeniedMessage(ctx: PermissionSubject, companyId: string): string {
  if (ctx.scaleupRole) return "Your role can read comments but not resolve them.";
  return readOnlyMessage(ctx, companyId) ?? "You don't have permission to resolve this thread.";
}

/**
 * Refreshes the pages that show this month's comments or thread counts. Revalidating in a Server Action
 * also re-renders the current page in the same response, so the caller sees the change at once.
 */
function revalidateCommentPaths(scope: CommentScope): void {
  const month = dateToMonthKey(scope.month);
  const company = scope.company_id;
  for (const path of [
    `/admin/review/${scope.id}`,
    "/admin/tracker",
    `/admin/companies/${company}`,
    `/admin/companies/${company}/updates/${month}`,
    `/portal/${company}`,
    `/portal/${company}/updates`,
    `/portal/${company}/updates/${month}`,
    `/portal/${company}/history`,
  ]) {
    revalidatePath(path);
  }
  try {
    refresh(); // whatever page called the action (only possible inside a Server Action)
  } catch {
    // Called outside a Server Action (e.g. from a route handler): the revalidation above is enough.
  }
}

/**
 * Comment threads of a monthly update, as the caller may see them: roots oldest first, each with its
 * replies (oldest first), the author shown for this viewer (ScaleUp viewers: name and role; company
 * viewers: ScaleUp staff as "<full name> (ScaleUp)", their own team by name and company role), visibility,
 * target, resolved state and what the caller may do (`canReply`, `canResolve`).
 * ScaleUp staff get every thread; company members the shared threads of their own company.
 */
export async function listComments(submissionId: string): Promise<ActionResult<CommentThread[]>> {
  try {
    await assertUser();
    const sb = await createClient();
    const scope = await requireScope(sb, submissionId);
    const ctx = await assertCanViewCompany(scope.company_id);
    const threads = await loadCommentThreads(sb, {
      submissionId: scope.id,
      companyId: scope.company_id,
      viewer: {
        userId: ctx.userId,
        audience: ctx.scaleupRole ? "scaleup" : "company",
        canReply: canReplyToComments(ctx, scope.company_id),
        canResolve: canResolveComments(ctx, scope.company_id),
      },
    });
    return ok(threads);
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Threads and unresolved threads per target (§2.5) that the caller may see, e.g. for the monthly form's
 * `commentCounts`.
 */
export async function getCommentCounts(submissionId: string): Promise<ActionResult<CommentCounts>> {
  try {
    await assertUser();
    const sb = await createClient();
    const scope = await requireScope(sb, submissionId);
    await assertCanViewCompany(scope.company_id);
    return ok(await loadCommentCounts(sb, scope.id));
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Adds a comment. With `parentId` it replies to that thread (ScaleUp non-viewers: any thread; company members:
 * shared threads of their own active company) and inherits the thread's target and visibility. Without it,
 * it starts a new thread on `target` (default 'general') with `visibility` 'shared' (the company sees it) or
 * 'internal' (ScaleUp only) — ScaleUp non-viewers only (BRD B7). Returns the new comment's id.
 */
export async function addComment(input: AddCommentInput): Promise<ActionResult<{ id: string }>> {
  try {
    await assertUser();
    const parsed = addCommentSchema.parse(input);
    const sb = await createClient();
    const scope = await requireScope(sb, parsed.submissionId);
    const ctx = await assertCanViewCompany(scope.company_id);

    let placement: { parent_id: string | null; target: string; visibility: CommentVisibility };
    if (parsed.parentId) {
      if (!canReplyToComments(ctx, scope.company_id)) throw new ActionError(replyDeniedMessage(ctx, scope.company_id));
      const parent = await findComment(sb, parsed.parentId);
      // Company users cannot see internal threads, so those are "not found" for them too (nothing leaks).
      if (!parent || (!ctx.scaleupRole && parent.visibility !== "shared")) throw new ActionError(THREAD_NOT_FOUND);
      if (parent.submission_id !== scope.id) {
        throw new ActionError("You can only reply to a comment on the same monthly update.");
      }
      if (parent.parent_id !== null) {
        throw new ActionError("Replies can only be added to the first comment of a thread.");
      }
      placement = { parent_id: parent.id, target: parent.target, visibility: parent.visibility };
    } else {
      if (!canComment(ctx)) {
        throw new ActionError(
          ctx.scaleupRole
            ? "Your role can read comments but not start new threads."
            : "Only ScaleUp can start a new comment thread. Reply to an existing thread instead.",
        );
      }
      const target = normaliseCommentTarget(parsed.target);
      if (!target) throw new ActionError("That comment target is not recognised.");
      placement = { parent_id: null, target, visibility: parsed.visibility ?? "shared" };
    }

    const { data, error } = await sb
      .from("comments")
      .insert({ submission_id: scope.id, author_id: ctx.userId, body: parsed.body, ...placement })
      .select("id")
      .single();
    if (error) throw error;
    const created: { id: string } = data;

    revalidateCommentPaths(scope);
    return ok({ id: created.id });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Resolves (`resolved` true) or reopens a whole thread — pass the thread's root comment id — through
 * resolve_comment(). ScaleUp non-viewers: any thread; company members: shared threads of their own active
 * company. Resolving an already resolved thread keeps the first resolver.
 */
export async function setCommentResolved(commentId: string, resolved: boolean): Promise<ActionResult> {
  try {
    await assertUser();
    const id = idSchema.safeParse(commentId);
    if (!id.success) throw new ActionError(THREAD_NOT_FOUND);
    const resolve = resolvedSchema.parse(resolved);
    const sb = await createClient();
    const comment = await findComment(sb, id.data);
    if (!comment) throw new ActionError(THREAD_NOT_FOUND);
    if (comment.parent_id !== null) {
      throw new ActionError("Only whole threads can be resolved. Resolve the first comment of the thread instead.");
    }
    const scope = await requireScope(sb, comment.submission_id);
    const ctx = await assertCanViewCompany(scope.company_id);
    if (!ctx.scaleupRole && comment.visibility !== "shared") throw new ActionError(THREAD_NOT_FOUND);
    if (!canResolveComments(ctx, scope.company_id)) throw new ActionError(resolveDeniedMessage(ctx, scope.company_id));

    const { error } = await sb.rpc("resolve_comment", { p_comment_id: comment.id, p_resolved: resolve });
    if (error) throw error;

    revalidateCommentPaths(scope);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
