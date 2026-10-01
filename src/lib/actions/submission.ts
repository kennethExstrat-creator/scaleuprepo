"use server";

// Server Actions of the monthly update form (module M5; docs/ARCHITECTURE.md §2.4, §5.3, §6 "Monthly form").
// Every action re-checks the session and the caller's role for the submission's company before calling the
// RPC (the database enforces the same rules again): company members of the company, or a Fund Admin on
// behalf, save values; only the company owner submits and requests amendments.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { DraftValues, SaveKpiEntry, SaveSegmentEntry, SaveValueEntry } from "@/components/submission-form/draft";
import { toDraftValues } from "@/components/submission-form/draft";
import { listEarlierDrafts } from "@/components/submission-form/queries";
import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { assertCanViewCompany, assertCompanyAccess, assertScaleUp, assertUser } from "@/lib/auth/session";
import { getSubmission, getSubmissionValidation, getSubmissionValues, type SubmissionRow } from "@/lib/data";
import { dateToMonthKey } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { SubmissionStatus } from "@/lib/types/enums";
import type { ValidationIssue } from "@/lib/validation";

const NOT_FOUND = "This monthly update was not found or you do not have access to it.";

// ---------------------------------------------------------------------------------------------
// Input schemas (save_submission_values input rules, §2.4)
// ---------------------------------------------------------------------------------------------

const idSchema = z.guid({ error: NOT_FOUND });
const numberSchema = z
  .number({ error: "Numbers must be sent as numbers." })
  .gt(-1e15, { error: "That number is too large." })
  .lt(1e15, { error: "That number is too large." });

const valueEntrySchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, { error: "Unknown field." }),
  value_number: numberSchema.nullable().optional(),
  value_text: z.string().max(20_000, { error: "That text is too long." }).nullable().optional(),
  value_json: z
    .union([z.boolean(), z.array(z.string().max(500)).max(50, { error: "Choose at most 50 tags." })])
    .nullable()
    .optional(),
});

const segmentEntrySchema = z.strictObject({
  segment_id: z.guid(),
  amount: numberSchema.nullable(),
});

const kpiEntrySchema = z.strictObject({
  kpi_id: z.guid(),
  dimension_member_id: z.guid().nullable(),
  value_number: numberSchema.nullable().optional(),
  value_text: z
    .string()
    .max(2_000, { error: "That text is too long (2,000 characters maximum)." })
    .nullable()
    .optional(),
  value_bool: z.boolean().nullable().optional(),
});

const saveSchema = z.strictObject({
  submissionId: idSchema,
  values: z.array(valueEntrySchema).max(1_000).optional(),
  segments: z.array(segmentEntrySchema).max(1_000).optional(),
  kpis: z.array(kpiEntrySchema).max(5_000).optional(),
});

const submitSchema = z.strictObject({ submissionId: idSchema, declarationAccepted: z.boolean() });

const amendmentSchema = z.strictObject({
  submissionId: idSchema,
  reason: z
    .string()
    .trim()
    .min(1, { error: "Please describe the amendment you need." })
    .max(4_900, { error: "Please keep the description under 4,900 characters." }),
});

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type SaveSubmissionValuesInput = {
  submissionId: string;
  /** Changed template fields (an entry whose values are all empty deletes the stored value). */
  values?: SaveValueEntry[];
  /** Changed revenue segment amounts (`amount: null` deletes). */
  segments?: SaveSegmentEntry[];
  /** Changed KPI cells. */
  kpis?: SaveKpiEntry[];
};

/** What the form needs before showing the declaration (get_submission_validation plus the stored values). */
export type SubmissionCheck = {
  /** True when the month can be submitted (every rule of §2.6 passes, earlier months included). */
  ok: boolean;
  /** Server issues in the database's order (targets §2.5); `prior_months` has target 'general'. */
  errors: ValidationIssue[];
  /** Earlier months still to submit ('YYYY-MM', oldest first) when `prior_months` fails. */
  priorMonths: string[];
  /** The values stored right now (what would be submitted). */
  values: DraftValues;
  lastSavedAt: string | null;
  status: SubmissionStatus;
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * Parses input whose problems the person can fix (the amendment reason): a refusal states its first
 * problem, e.g. "Please keep the description under 4,900 characters.", rather than "Please check the
 * highlighted fields." (a confirmation dialog highlights nothing); `fieldErrors` as `toActionError` builds them.
 */
function parseWithMessage<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }
  throw new ActionError(result.error.issues[0]?.message ?? MESSAGES.invalid, fieldErrors);
}

/** The submission as the caller sees it (RLS); not visible → the RPCs' own not-found message. */
async function loadSubmission(submissionId: string): Promise<{
  sb: Awaited<ReturnType<typeof createClient>>;
  submission: SubmissionRow;
}> {
  const sb = await createClient();
  const submission = await getSubmission(sb, submissionId);
  if (!submission) throw new ActionError(NOT_FOUND);
  return { sb, submission };
}

/** The monthly form, its lists and the ScaleUp pages that show the month. */
function revalidateSubmission(submission: Pick<SubmissionRow, "id" | "company_id" | "month">, extra = false): void {
  const month = dateToMonthKey(submission.month);
  const companyId = submission.company_id;
  revalidatePath(`/portal/${companyId}/updates/${month}`);
  revalidatePath(`/portal/${companyId}/updates`);
  revalidatePath(`/portal/${companyId}`);
  revalidatePath(`/admin/companies/${companyId}/updates/${month}`);
  revalidatePath(`/admin/review/${submission.id}`);
  revalidatePath("/admin/tracker");
  if (extra) {
    revalidatePath(`/portal/${companyId}/history`);
    revalidatePath(`/admin/companies/${companyId}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

/**
 * Autosave: stores the changed entries with `save_submission_values` (one transaction; an entry whose
 * values are all empty deletes the stored value). Company members of the company, or a Fund Admin on
 * behalf (audited as on behalf), while the month is not submitted or approved. Returns `last_saved_at`.
 */
export async function saveSubmissionValues(
  input: SaveSubmissionValuesInput,
): Promise<ActionResult<{ savedAt: string | null }>> {
  try {
    const ctx = await assertUser();
    const { submissionId, values = [], segments = [], kpis = [] } = saveSchema.parse(input);
    const { sb, submission } = await loadSubmission(submissionId);
    if (ctx.scaleupRole) await assertScaleUp(["fund_admin"]);
    else await assertCompanyAccess(submission.company_id);

    // Nothing changed: nothing to store (the RPC would still stamp last_saved_at).
    if (values.length === 0 && segments.length === 0 && kpis.length === 0) {
      return ok({ savedAt: submission.last_saved_at });
    }

    const { data: savedAt, error } = await sb.rpc("save_submission_values", {
      p_submission_id: submission.id,
      p_values: values,
      p_segments: segments,
      p_kpis: kpis,
    });
    if (error) throw error;

    revalidateSubmission(submission);
    return ok({ savedAt });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * The server-side check before submitting (`get_submission_validation`, rules 1–6 including earlier
 * months) with the stored values, so the declaration step shows exactly what will be submitted. Anyone who
 * may view the company. Read-only: nothing is revalidated.
 */
export async function getSubmissionValidationAction(submissionId: string): Promise<ActionResult<SubmissionCheck>> {
  try {
    await assertUser();
    const id = idSchema.parse(submissionId);
    const { sb, submission } = await loadSubmission(id);
    await assertCanViewCompany(submission.company_id);

    const [validation, stored] = await Promise.all([getSubmissionValidation(sb, id), getSubmissionValues(sb, id)]);

    let priorMonths: string[] = [];
    if (validation.errors.some((issue) => issue.code === "prior_months")) {
      const { data: company, error } = await sb
        .from("companies")
        .select("reporting_start_month")
        .eq("id", submission.company_id)
        .maybeSingle();
      if (error) throw error;
      const start: string | null = company?.reporting_start_month ?? null;
      priorMonths = await listEarlierDrafts(sb, submission.company_id, submission.month, start);
    }

    return ok({
      ok: validation.ok,
      errors: validation.errors,
      priorMonths,
      values: toDraftValues(stored),
      lastSavedAt: submission.last_saved_at,
      status: submission.status,
    });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Submits (or resubmits) the month with the owner declaration (`submit_submission`): company owner of an
 * active company; the month must pass validation, earlier months included (BRD B5, C6).
 */
export async function submitSubmission(
  submissionId: string,
  declarationAccepted: boolean,
): Promise<ActionResult<{ month: string }>> {
  try {
    await assertUser();
    const input = submitSchema.parse({ submissionId, declarationAccepted });
    const { sb, submission } = await loadSubmission(input.submissionId);
    await assertCompanyAccess(submission.company_id, ["owner"]);
    if (!input.declarationAccepted) throw new ActionError("Please confirm the declaration before submitting.");

    const { error } = await sb.rpc("submit_submission", {
      p_submission_id: submission.id,
      p_declaration_accepted: true,
    });
    if (error) throw error;

    revalidateSubmission(submission, true);
    return ok({ month: dateToMonthKey(submission.month) });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Asks ScaleUp to reopen an approved month (`request_amendment`: a shared "Amendment requested: …" thread
 * and a timeline event). Company owner of an active company.
 */
export async function requestAmendment(submissionId: string, reason: string): Promise<ActionResult<void>> {
  try {
    await assertUser();
    const input = parseWithMessage(amendmentSchema, { submissionId, reason });
    const { sb, submission } = await loadSubmission(input.submissionId);
    await assertCompanyAccess(submission.company_id, ["owner"]);

    const { error } = await sb.rpc("request_amendment", {
      p_submission_id: submission.id,
      p_reason: input.reason,
    });
    if (error) throw error;

    revalidateSubmission(submission, true);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
