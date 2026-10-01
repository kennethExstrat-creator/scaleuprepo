"use server";

// Server Actions of /admin/cycles (module M4, BRD A5, B4, B18, B19, B21): open the current month early
// (open_period), extend a month's deadline (extend_due_date) and keep the monthly FX rates (fx_rates).
// Each re-checks the role first; the database enforces the same rules (RPC checks; RLS lets only Super
// Admins and Fund Admins write fx_rates).

import { revalidatePath } from "next/cache";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canExtendDueDate, canManageCycles, canManageTemplates } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { getCompany, getSubmission } from "@/lib/data";
import { formatDate } from "@/lib/format";
import {
  compareMonths,
  currentMonthMYT,
  dateToMonthKey,
  monthKeyToDate,
  monthLabel,
  monthLabelLong,
  todayMYT,
} from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

import { newDueDateIssue } from "./_lib/cycles-model";
import { extendDeadlineSchema, fxRateKeySchema, fxRateSchema, openMonthSchema } from "./_lib/schemas";

const CYCLE_ROLES = ["super_admin", "fund_admin"] as const;

const SUBMISSION_NOT_FOUND = "This monthly update was not found or you do not have access to it.";
const RATE_NOT_FOUND = "This rate no longer exists. Reload the page to see the current rates.";

function revalidateCycles(): void {
  revalidatePath("/admin/cycles");
  revalidatePath("/admin/tracker");
}

/**
 * Opens a month before it ends (open_period, BRD A5): the current Malaysia-time month, as offered by the
 * page. Its companies can start entering numbers straight away; the due date stays day `due_day` of the
 * following month. Opening a month that is already open changes nothing. Super Admin and Fund Admin.
 */
export async function openMonthEarlyAction(input: unknown): Promise<ActionResult<{ month: string }>> {
  try {
    const ctx = await assertScaleUp(CYCLE_ROLES);
    if (!canManageCycles(ctx)) throw new ActionError(MESSAGES.permission);
    const { month } = openMonthSchema.parse(input);
    const current = currentMonthMYT();
    if (compareMonths(month, current) > 0) {
      throw new ActionError(`Only months up to the current month (${monthLabel(current)}) can be opened.`);
    }

    const sb = await createClient();
    const { error } = await sb.rpc("open_period", { p_month: monthKeyToDate(month) });
    if (error) throw error;

    revalidateCycles();
    revalidatePath("/admin/documents");
    return ok({ month });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Moves a month's due date to a later date, with an optional reason (extend_due_date; the reason shows on
 * the month's timeline, also to the company). Not for approved months, and only for active companies
 * (BRD B21). Super Admin and Fund Admin.
 */
export async function extendDeadlineAction(
  input: unknown,
): Promise<ActionResult<{ dueDate: string; companyName: string; month: string }>> {
  try {
    const ctx = await assertScaleUp(CYCLE_ROLES);
    const { submissionId, newDueDate, reason } = extendDeadlineSchema.parse(input);
    const sb = await createClient();
    const submission = await getSubmission(sb, submissionId);
    if (!submission) throw new ActionError(SUBMISSION_NOT_FOUND);
    const company = await getCompany(sb, submission.company_id);
    if (!company) throw new ActionError(SUBMISSION_NOT_FOUND);
    if (!canExtendDueDate(ctx, company.status)) {
      throw new ActionError(
        company.status !== "active"
          ? `${company.name} is no longer an active portfolio company, so its records are read-only.`
          : MESSAGES.permission,
      );
    }
    if (submission.status === "approved") {
      throw new ActionError("Approved months cannot have their deadline extended.");
    }
    const issue = newDueDateIssue(newDueDate, submission.due_date, todayMYT(), formatDate);
    if (issue) throw new ActionError(issue, { newDueDate: issue });

    const { error } = await sb.rpc("extend_due_date", {
      p_submission_id: submissionId,
      p_new_due_date: newDueDate,
      p_reason: reason,
    });
    if (error) throw error;

    revalidateCycles();
    revalidatePath(`/admin/review/${submissionId}`);
    revalidatePath(`/portal/${company.id}`, "layout");
    return ok({ dueDate: newDueDate, companyName: company.name, month: dateToMonthKey(submission.month) });
  } catch (e) {
    return toActionError(e);
  }
}

function revalidateRates(): void {
  revalidatePath("/admin/cycles");
  revalidatePath("/admin/exports");
}

/** Adds the FX rate of a currency for a month (BRD §12, B18): MYR per one unit of the currency. */
export async function createFxRateAction(input: unknown): Promise<ActionResult<{ currency: string; month: string }>> {
  try {
    const ctx = await assertScaleUp(CYCLE_ROLES);
    if (!canManageTemplates(ctx)) throw new ActionError(MESSAGES.permission);
    const { currency, month, rate } = fxRateSchema.parse(input);
    const sb = await createClient();
    const { error } = await sb
      .from("fx_rates")
      .insert({ currency, month: monthKeyToDate(month), rate_to_myr: rate });
    if (error) {
      if (error.code === "23505") {
        const message = `There is already a ${currency} rate for ${monthLabelLong(month)}. Edit that rate instead.`;
        throw new ActionError(message, { month: message });
      }
      throw error;
    }
    revalidateRates();
    return ok({ currency, month });
  } catch (e) {
    return toActionError(e);
  }
}

/** Changes the rate of an existing currency and month. */
export async function updateFxRateAction(input: unknown): Promise<ActionResult<{ currency: string; month: string }>> {
  try {
    const ctx = await assertScaleUp(CYCLE_ROLES);
    if (!canManageTemplates(ctx)) throw new ActionError(MESSAGES.permission);
    const { currency, month, rate } = fxRateSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("fx_rates")
      .update({ rate_to_myr: rate })
      .eq("currency", currency)
      .eq("month", monthKeyToDate(month))
      .select("currency");
    if (error) throw error;
    if (data.length === 0) throw new ActionError(RATE_NOT_FOUND);
    revalidateRates();
    return ok({ currency, month });
  } catch (e) {
    return toActionError(e);
  }
}

/** Deletes the rate of a currency and month (exports then leave that month's RM amounts blank). */
export async function deleteFxRateAction(input: unknown): Promise<ActionResult<{ currency: string; month: string }>> {
  try {
    const ctx = await assertScaleUp(CYCLE_ROLES);
    if (!canManageTemplates(ctx)) throw new ActionError(MESSAGES.permission);
    const { currency, month } = fxRateKeySchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("fx_rates")
      .delete()
      .eq("currency", currency)
      .eq("month", monthKeyToDate(month))
      .select("currency");
    if (error) throw error;
    if (data.length === 0) throw new ActionError(RATE_NOT_FOUND);
    revalidateRates();
    return ok({ currency, month });
  } catch (e) {
    return toActionError(e);
  }
}
