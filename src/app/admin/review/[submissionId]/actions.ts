"use server";

// Review actions (module M6, BRD A7, §7 workflow, B8, B9, B19–B21): request changes, approve, reopen an
// approved month and extend the deadline. Each re-checks the role and the permission helpers
// (src/lib/auth/permissions.ts); the RPCs enforce the same rules in the database with friendly messages.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { extensionDateError } from "@/components/review/review-state";
import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canApprove, canExtendDueDate, canReopen, canRequestChanges } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { getCompany, getCompanyInternal, getSubmission } from "@/lib/data";
import { dateToMonthKey, todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { CompanyInternalWithPartner, CompanyRow, SubmissionRow } from "@/lib/types/domain";

type Client = Awaited<ReturnType<typeof createClient>>;

const NOT_FOUND = "This monthly update was not found or you do not have access to it.";
const MESSAGE_MAX = 5000;
const EXTENSION_REASON_MAX = 2000;

const submissionIdSchema = z.guid({ error: NOT_FOUND });

const requestChangesSchema = z.object({
  submissionId: submissionIdSchema,
  message: z
    .string({ error: "Explain what needs to change." })
    .trim()
    .min(1, "Explain what needs to change.")
    .max(MESSAGE_MAX, "Please keep the message under 5,000 characters."),
});

const approveSchema = z.object({
  submissionId: submissionIdSchema,
  message: z.string().trim().max(MESSAGE_MAX, "Please keep the message under 5,000 characters.").optional(),
});

const reopenSchema = z.object({
  submissionId: submissionIdSchema,
  reason: z
    .string({ error: "Give a reason for reopening this month." })
    .trim()
    .min(1, "Give a reason for reopening this month.")
    .max(MESSAGE_MAX, "Please keep the reason under 5,000 characters."),
});

const extendSchema = z.object({
  submissionId: submissionIdSchema,
  newDueDate: z.iso.date({ error: "Choose the new due date." }),
  reason: z.string().trim().max(EXTENSION_REASON_MAX, "Please keep the reason under 2,000 characters.").optional(),
});

type ReviewTarget = { submission: SubmissionRow; company: CompanyRow; internal: CompanyInternalWithPartner | null };

/** The submission with its company and internal record (partner-in-charge), as the caller may see them. */
async function loadReviewTarget(sb: Client, submissionId: string): Promise<ReviewTarget> {
  const submission = await getSubmission(sb, submissionId);
  if (!submission) throw new ActionError(NOT_FOUND);
  const [company, internal] = await Promise.all([
    getCompany(sb, submission.company_id),
    getCompanyInternal(sb, submission.company_id),
  ]);
  if (!company) throw new ActionError(NOT_FOUND);
  return { submission, company, internal };
}

function readOnlyMessage(company: CompanyRow): string {
  return `${company.name} is no longer an active portfolio company, so its records are read-only.`;
}

/** The month's due date after the change (the RPCs move it when a month is sent back, BRD B19). */
async function currentDueDate(sb: Client, submissionId: string, fallback: string): Promise<string> {
  const fresh = await getSubmission(sb, submissionId);
  return fresh?.due_date ?? fallback;
}

/** Pages that show the month's status, due date, timeline or period closes. */
function revalidateReview(submission: Pick<SubmissionRow, "id" | "company_id" | "month">): void {
  const month = dateToMonthKey(submission.month);
  const company = submission.company_id;
  for (const path of [
    `/admin/review/${submission.id}`,
    "/admin/tracker",
    `/admin/companies/${company}`,
    `/admin/companies/${company}/updates/${month}`,
    "/admin/documents",
    `/portal/${company}`,
    `/portal/${company}/updates`,
    `/portal/${company}/updates/${month}`,
    `/portal/${company}/history`,
    `/portal/${company}/documents`,
  ]) {
    revalidatePath(path);
  }
}

/**
 * Sends a submitted month back to the company with a required message (request_changes). The month becomes
 * editable again and is due no earlier than the grace period from today (BRD B19); a confirmed quarter or
 * half close covering it is reopened (B20). Super Admin, Fund Admin, Partner — active companies only (B21).
 */
export async function requestChangesAction(input: {
  submissionId: string;
  message: string;
}): Promise<ActionResult<{ dueDate: string }>> {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin", "partner"]);
    const { submissionId, message } = requestChangesSchema.parse(input);
    const sb = await createClient();
    const { submission, company } = await loadReviewTarget(sb, submissionId);
    if (!canRequestChanges(ctx, company.status)) {
      throw new ActionError(company.status !== "active" ? readOnlyMessage(company) : MESSAGES.permission);
    }

    const { error } = await sb.rpc("request_changes", { p_submission_id: submissionId, p_message: message });
    if (error) throw error;

    const dueDate = await currentDueDate(sb, submissionId, submission.due_date);
    revalidateReview(submission);
    return ok({ dueDate });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Approves a submitted month (approve_submission), which locks it; an optional message goes on the timeline.
 * Only the company's partner-in-charge or a Super Admin (BRD B9) — also for exited / written-off companies,
 * to finalise their history (B21).
 */
export async function approveSubmissionAction(input: {
  submissionId: string;
  message?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await assertScaleUp(["super_admin", "partner"]);
    const { submissionId, message } = approveSchema.parse(input);
    const sb = await createClient();
    const { submission, internal } = await loadReviewTarget(sb, submissionId);
    if (!canApprove(ctx, internal)) {
      throw new ActionError("Only the partner-in-charge or a Super Admin can approve this update.");
    }

    const { error } = await sb.rpc("approve_submission", {
      p_submission_id: submissionId,
      p_message: message ? message : undefined,
    });
    if (error) throw error;

    revalidateReview(submission);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Reopens an approved (locked) month with a required reason (reopen_submission): it goes back to the company
 * as "changes requested" and needs approval again (BRD B8). Super Admin, Fund Admin or the partner-in-charge —
 * active companies only.
 */
export async function reopenSubmissionAction(input: {
  submissionId: string;
  reason: string;
}): Promise<ActionResult<{ dueDate: string }>> {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin", "partner"]);
    const { submissionId, reason } = reopenSchema.parse(input);
    const sb = await createClient();
    const { submission, company, internal } = await loadReviewTarget(sb, submissionId);
    if (!canReopen(ctx, internal, company.status)) {
      throw new ActionError(
        company.status !== "active"
          ? readOnlyMessage(company)
          : "Only a Super Admin, a Fund Admin or the partner-in-charge can reopen an approved month.",
      );
    }

    const { error } = await sb.rpc("reopen_submission", { p_submission_id: submissionId, p_reason: reason });
    if (error) throw error;

    const dueDate = await currentDueDate(sb, submissionId, submission.due_date);
    revalidateReview(submission);
    return ok({ dueDate });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Moves a month's due date to a later date, with an optional reason (extend_due_date). Not for approved
 * months. The new date must also not be in the past (Malaysia time): an overdue month moved to a date that
 * has already passed would stay overdue. Super Admin and Fund Admin — active companies only.
 */
export async function extendDueDateAction(input: {
  submissionId: string;
  newDueDate: string;
  reason?: string;
}): Promise<ActionResult<{ dueDate: string }>> {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin"]);
    const { submissionId, newDueDate, reason } = extendSchema.parse(input);
    const sb = await createClient();
    const { submission, company } = await loadReviewTarget(sb, submissionId);
    if (!canExtendDueDate(ctx, company.status)) {
      throw new ActionError(company.status !== "active" ? readOnlyMessage(company) : MESSAGES.permission);
    }
    const dateIssue = extensionDateError(newDueDate, submission.due_date, todayMYT());
    if (dateIssue) throw new ActionError(dateIssue, { newDueDate: dateIssue });

    const { error } = await sb.rpc("extend_due_date", {
      p_submission_id: submissionId,
      p_new_due_date: newDueDate,
      p_reason: reason ? reason : undefined,
    });
    if (error) throw error;

    revalidateReview(submission);
    return ok({ dueDate: newDueDate });
  } catch (e) {
    return toActionError(e);
  }
}
