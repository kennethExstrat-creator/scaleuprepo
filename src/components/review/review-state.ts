// Which review actions to show for a month (BRD A7, §7 workflow, B8, B9, B21). Pure and client-safe: the
// permission flags come from src/lib/auth/permissions.ts on the server; the database enforces everything
// again (request_changes, approve_submission, reopen_submission, extend_due_date).
import { formatDate } from "@/lib/format";

import type { PendingAmendment } from "./amendment";
import { addDays, daysBetween } from "@/lib/periods";
import type { SubmissionStatus } from "@/lib/types/enums";

export type ReviewAction = "approve" | "request_changes" | "reopen" | "extend" | "edit_on_behalf";

/** The caller's rights for this company (computed with the permission helpers). */
export type ReviewPermissions = {
  /** canRequestChanges(ctx, company.status). */
  canRequestChanges: boolean;
  /** canApprove(ctx, internal). */
  canApprove: boolean;
  /** canReopen(ctx, internal, company.status). */
  canReopen: boolean;
  /** canExtendDueDate(ctx, company.status). */
  canExtendDueDate: boolean;
  /** canEnterData(ctx, companyId, company.status): Fund Admin on-behalf entry. */
  canEditOnBehalf: boolean;
};

export type ReviewActionState = {
  action: ReviewAction;
  /** False: shown disabled, with `reason` explaining who can do it. */
  enabled: boolean;
  reason: string | null;
};

/** The company's partner-in-charge (`CompanyInternalWithPartner.partner`; null when nobody is assigned). */
export type PartnerInCharge = { full_name: string | null; email: string; is_active: boolean; scaleup_role: string | null };

/**
 * Who apart from Super Admins can approve the company's months (BRD B9): the partner-in-charge, and only
 * while they are an active Partner (`private.is_partner_of` needs the Partner role, and deactivated people
 * have no role). `inactive` and `not_partner`: someone is assigned who cannot approve; `none`: nobody is.
 */
export type ApproverState =
  | { kind: "partner"; name: string }
  | { kind: "inactive"; name: string }
  | { kind: "not_partner"; name: string }
  | { kind: "none" };

/** The approver state of a company from its partner-in-charge (see ApproverState). */
export function approverState(partner: PartnerInCharge | null): ApproverState {
  if (!partner) return { kind: "none" };
  const name = partner.full_name?.trim() || partner.email;
  if (!partner.is_active) return { kind: "inactive", name };
  if (partner.scaleup_role !== "partner") return { kind: "not_partner", name };
  return { kind: "partner", name };
}

/** Who may approve (BRD B9): the partner-in-charge while they are an active Partner, or a Super Admin. */
export function approverNote(approver: ApproverState): string {
  switch (approver.kind) {
    case "partner":
      return `Only ${approver.name} (partner-in-charge) or a Super Admin can approve this update.`;
    case "inactive":
      return `${approver.name}, the partner-in-charge, is no longer active, so only a Super Admin can approve this update.`;
    case "not_partner":
      return `${approver.name}, the partner-in-charge, is not a Partner, so only a Super Admin can approve this update.`;
    default:
      return "No partner-in-charge is assigned, so only a Super Admin can approve this update.";
  }
}

/**
 * The actions for a month in `status`, in display order:
 * - submitted: Approve (shown to everyone; disabled with `approverNote` unless the caller may approve),
 *   Request changes (active companies), Extend deadline;
 * - approved: Reopen (active companies);
 * - draft / changes requested: Extend deadline, Edit on behalf (Fund Admin, active companies).
 * Actions the caller cannot use are left out, apart from the disabled Approve.
 */
export function reviewActions(
  status: SubmissionStatus,
  permissions: ReviewPermissions,
  approver: ApproverState,
): ReviewActionState[] {
  const actions: ReviewActionState[] = [];
  if (status === "submitted") {
    actions.push({
      action: "approve",
      enabled: permissions.canApprove,
      reason: permissions.canApprove ? null : approverNote(approver),
    });
    if (permissions.canRequestChanges) actions.push({ action: "request_changes", enabled: true, reason: null });
  }
  if (status === "approved" && permissions.canReopen) actions.push({ action: "reopen", enabled: true, reason: null });
  if (status !== "approved" && permissions.canExtendDueDate) actions.push({ action: "extend", enabled: true, reason: null });
  if ((status === "draft" || status === "changes_requested") && permissions.canEditOnBehalf) {
    actions.push({ action: "edit_on_behalf", enabled: true, reason: null });
  }
  return actions;
}

/** The longest part of an amendment reason quoted in the review panel's summary (the thread has all of it). */
const AMENDMENT_REASON_QUOTE = 240;

function quoteReason(reason: string): string {
  const text = reason.replace(/\s+/g, " ").trim();
  return text.length > AMENDMENT_REASON_QUOTE ? `${text.slice(0, AMENDMENT_REASON_QUOTE - 1).trimEnd()}…` : text;
}

/**
 * A short headline and explanation of where the month stands, for the review panel. An approved month
 * whose owner asked to amend it (`amendment`, BRD B8; pendingAmendment) says so, next to "Reopen".
 */
export function reviewStatusSummary(
  status: SubmissionStatus,
  info: { companyName: string; monthLabel: string; companyActive: boolean; amendment?: PendingAmendment | null },
): { title: string; description: string } {
  if (status === "approved" && info.amendment) {
    const asked = `${info.companyName}'s owner asked on ${formatDate(info.amendment.requestedAt)} to amend ${info.monthLabel}: “${quoteReason(info.amendment.reason)}”.`;
    return {
      title: "Amendment requested",
      description: info.companyActive
        ? `${asked} Reopen the month so they can correct and resubmit it (it then needs approval again), or reply in the comments and resolve the thread if no change is needed.`
        : `${asked} The company is no longer active, so the month cannot be reopened: reply in the comments and resolve the thread.`,
    };
  }
  switch (status) {
    case "draft":
      return {
        title: "Not submitted yet",
        description: `${info.companyName} has not submitted ${info.monthLabel} yet.`,
      };
    case "submitted":
      return {
        title: "Awaiting review",
        description: info.companyActive
          ? "Approve the month to lock it, or send it back with a message explaining what needs to change."
          : "The company is no longer active: the month can still be approved to finalise its history, but not sent back.",
      };
    case "changes_requested":
      return {
        title: "Changes requested",
        description: `Waiting for ${info.companyName} to correct and resubmit ${info.monthLabel}.`,
      };
    default:
      return {
        title: "Approved and locked",
        description: info.companyActive
          ? "The month is locked. Reopen it with a reason if something needs to change; it then needs approval again."
          : "The month is locked. The company is no longer active, so its months cannot be reopened.",
      };
  }
}

/**
 * The due date after sending a month back or reopening it (BRD B19, `private.send_back_due_date`): the
 * current due date, or `today + graceDays` if that is later. Dates are 'YYYY-MM-DD'.
 */
export function sendBackDueDate(currentDueDate: string, today: string, graceDays: number): string {
  const candidate = addDays(today, Math.max(0, Math.trunc(graceDays)));
  return candidate > currentDueDate ? candidate : currentDueDate;
}

/** The extend-deadline dialog's quick choices, in days. */
export const EXTENSION_QUICK_DAYS = [7, 14, 30] as const;

/** A new due date may be at most this many days after the later of the current due date and today (typo guard). */
export const EXTENSION_MAX_DAYS = 365;

export type ExtensionChoices = {
  /** The earliest new due date: the day after the current due date, or today once that date has passed. */
  earliest: string;
  /** The latest new due date: a year after the current due date, or after today once that date has passed. */
  latest: string;
  /** The current due date is before today (for a draft or changes-requested month: it is overdue). */
  pastDue: boolean;
  /** "+7 days" from the current due date, or "In 7 days" from today once the current due date has passed. */
  quick: Array<{ days: number; date: string; label: string }>;
};

/**
 * The dates the extend-deadline dialog offers. A new due date must be after the current one (extend_due_date)
 * and not before today: an overdue month moved to a date that has already passed would still be overdue.
 * Dates are 'YYYY-MM-DD'; `today` is todayMYT().
 */
export function extensionChoices(dueDate: string, today: string): ExtensionChoices {
  const pastDue = dueDate < today;
  const base = pastDue ? today : dueDate;
  const dayAfter = addDays(dueDate, 1);
  return {
    earliest: dayAfter > today ? dayAfter : today,
    latest: addDays(base, EXTENSION_MAX_DAYS),
    pastDue,
    quick: EXTENSION_QUICK_DAYS.map((days) => ({
      days,
      date: addDays(base, days),
      label: pastDue ? `In ${days} days` : `+${days} days`,
    })),
  };
}

/**
 * Why `newDueDate` cannot be the month's new due date, or null when it can (see extensionChoices). The dialog
 * and extendDueDateAction both check it, with the same messages.
 */
export function extensionDateError(newDueDate: string, dueDate: string, today: string): string | null {
  if (newDueDate <= dueDate) return `The new due date must be after the current due date (${formatDate(dueDate)}).`;
  if (newDueDate < today) return `The new due date cannot be in the past. Choose today (${formatDate(today)}) or a later date.`;
  // The same one-year guard as /admin/cycles (src/app/admin/cycles/_lib/cycles-model.ts newDueDateIssue).
  const latest = extensionChoices(dueDate, today).latest;
  if (newDueDate > latest) return `Choose a date up to ${formatDate(latest)}.`;
  return null;
}

/**
 * How far a valid new due date moves the deadline: "14 days later than the current due date", or — once the
 * current due date has passed — from today: "Due today", "Due tomorrow", "Due in 7 days".
 */
export function extensionSummary(newDueDate: string, dueDate: string, today: string): string {
  if (dueDate < today) {
    const days = daysBetween(today, newDueDate);
    if (days <= 0) return "Due today.";
    return days === 1 ? "Due tomorrow." : `Due in ${days} days.`;
  }
  const days = daysBetween(dueDate, newDueDate);
  return `${days} ${days === 1 ? "day" : "days"} later than the current due date.`;
}
