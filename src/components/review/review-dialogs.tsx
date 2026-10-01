"use client";

import { CalendarIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import {
  approveSubmissionAction,
  extendDueDateAction,
  reopenSubmissionAction,
  requestChangesAction,
} from "@/app/admin/review/[submissionId]/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MessageField, ReviewDialog } from "./review-dialog";
import { extensionChoices, extensionDateError, extensionSummary } from "./review-state";

const MESSAGE_MAX = 5000;
const EXTENSION_REASON_MAX = 2000;

/** An open shared thread, listed as a reminder when sending a month back. */
export type SharedThreadReminder = { id: string; targetLabel: string; excerpt: string; replies: number };

type DialogBaseProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  companyName: string;
  /** "September 2026". */
  monthLabel: string;
};

function Note({ icon, tone = "muted", children }: { icon?: ReactNode; tone?: "muted" | "warning" | "success"; children: ReactNode }) {
  return (
    <li
      className={cn(
        "flex gap-2 text-sm",
        tone === "muted" && "text-muted-foreground",
        tone === "warning" && "text-warning",
        tone === "success" && "text-success",
      )}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4" aria-hidden="true">
        {icon ?? <InfoIcon />}
      </span>
      <span className="min-w-0 text-pretty">{children}</span>
    </li>
  );
}

function closesText(labels: string[]): string {
  if (labels.length === 1) return `The confirmed ${labels[0]} close`;
  return `The confirmed ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} closes`;
}

// ---------------------------------------------------------------------------------------------
// Request changes
// ---------------------------------------------------------------------------------------------

export function RequestChangesDialog({
  open,
  onOpenChange,
  submissionId,
  companyName,
  monthLabel,
  sendBackDueDate,
  confirmedCloses,
  openSharedThreads,
}: DialogBaseProps & { sendBackDueDate: string; confirmedCloses: string[]; openSharedThreads: SharedThreadReminder[] }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = message.trim();

  function close(next: boolean) {
    if (!next) {
      setFieldError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    if (!trimmed) {
      setFieldError("Explain what needs to change.");
      return;
    }
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await requestChangesAction({ submissionId, message: trimmed });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.message ?? null);
        setError(result.fieldErrors?.message ? null : result.error);
        return;
      }
      toast.success(`${monthLabel} sent back to ${companyName}`, {
        description: `It is now due ${formatDate(result.data.dueDate)}.`,
      });
      setMessage("");
      onOpenChange(false);
    });
  }

  return (
    <ReviewDialog
      open={open}
      onOpenChange={close}
      title={`Request changes to ${monthLabel}?`}
      description={`${companyName} will be able to edit ${monthLabel} again and must resubmit it. Your message appears on the month's timeline.`}
      submitLabel="Send back for changes"
      canSubmit={trimmed.length > 0 && message.length <= MESSAGE_MAX}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <MessageField
        id={`${id}-message`}
        label="What needs to change?"
        value={message}
        onChange={(value) => {
          setMessage(value);
          if (fieldError) setFieldError(null);
        }}
        maxLength={MESSAGE_MAX}
        required
        error={fieldError}
        placeholder="e.g. Total revenue does not match the management accounts for the month. Please check the Online segment."
        disabled={pending}
        autoFocus
        onSubmitShortcut={submit}
      />
      <ul className="flex flex-col gap-1.5">
        <Note>
          {companyName} will have until <strong className="font-medium text-foreground">{formatDate(sendBackDueDate)}</strong> to resubmit.
        </Note>
        {confirmedCloses.length > 0 ? (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {closesText(confirmedCloses)} will be reopened. The company confirms it again after resubmitting.
          </Note>
        ) : null}
      </ul>
      {openSharedThreads.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <MessageSquareIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Open threads the company can see ({openSharedThreads.length})
          </p>
          <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto text-sm">
            {openSharedThreads.map((thread) => (
              <li key={thread.id} className="min-w-0">
                <span className="font-medium">{thread.targetLabel}:</span>{" "}
                <span className="text-muted-foreground">{thread.excerpt}</span>
                {thread.replies > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ({thread.replies} {thread.replies === 1 ? "reply" : "replies"})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            They stay open for the company to answer. Mention anything that must be fixed before resubmitting in your message.
          </p>
        </div>
      ) : null}
    </ReviewDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------------------------

export function ApproveDialog({
  open,
  onOpenChange,
  submissionId,
  companyName,
  monthLabel,
  flagSummary,
  openThreadCount,
  validationIssueCount,
}: DialogBaseProps & {
  flagSummary: { critical: number; warning: number };
  openThreadCount: number;
  /** null when validation could not be loaded. */
  validationIssueCount: number | null;
}) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (!next) {
      setFieldError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const trimmed = message.trim();
      const result = await approveSubmissionAction({ submissionId, message: trimmed || undefined });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.message ?? null);
        setError(result.fieldErrors?.message ? null : result.error);
        return;
      }
      toast.success(`${monthLabel} approved`, { description: `${companyName}'s update is now locked.` });
      setMessage("");
      onOpenChange(false);
    });
  }

  const flagCount = flagSummary.critical + flagSummary.warning;

  return (
    <ReviewDialog
      open={open}
      onOpenChange={close}
      title={`Approve ${monthLabel}?`}
      description={`Approving locks ${companyName}'s ${monthLabel} update. It can only change again if it is reopened.`}
      submitLabel="Approve and lock"
      canSubmit={message.length <= MESSAGE_MAX}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <ul className="flex flex-col gap-1.5">
        {validationIssueCount === null ? (
          <Note tone="warning" icon={<CircleAlertIcon />}>
            The validation checks could not be loaded.
          </Note>
        ) : validationIssueCount === 0 ? (
          <Note tone="success" icon={<CircleCheckIcon />}>
            All validation checks pass.
          </Note>
        ) : (
          <Note tone="warning" icon={<CircleAlertIcon />}>
            {validationIssueCount} validation {validationIssueCount === 1 ? "issue is" : "issues are"} still open.
          </Note>
        )}
        {flagCount === 0 ? (
          <Note tone="success" icon={<CircleCheckIcon />}>
            No auto-flags raised.
          </Note>
        ) : (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {flagSummary.critical > 0 ? `${flagSummary.critical} critical` : null}
            {flagSummary.critical > 0 && flagSummary.warning > 0 ? " and " : null}
            {flagSummary.warning > 0 ? `${flagSummary.warning} ${flagSummary.warning === 1 ? "warning" : "warnings"}` : null}{" "}
            {flagCount === 1 ? "flag" : "flags"} raised on this month.
          </Note>
        )}
        {openThreadCount > 0 ? (
          <Note tone="warning" icon={<MessageSquareIcon />}>
            {openThreadCount} comment {openThreadCount === 1 ? "thread is" : "threads are"} still open. Approving does not close them.
          </Note>
        ) : (
          <Note tone="success" icon={<CircleCheckIcon />}>
            No open comment threads.
          </Note>
        )}
      </ul>
      <MessageField
        id={`${id}-message`}
        label="Message"
        description="Shown on the month's timeline, also to the company."
        value={message}
        onChange={(value) => {
          setMessage(value);
          if (fieldError) setFieldError(null);
        }}
        maxLength={MESSAGE_MAX}
        error={fieldError}
        placeholder="e.g. Thanks, all clear."
        rows={3}
        disabled={pending}
        onSubmitShortcut={submit}
      />
    </ReviewDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------------------------

export function ReopenDialog({
  open,
  onOpenChange,
  submissionId,
  companyName,
  monthLabel,
  sendBackDueDate,
  confirmedCloses,
}: DialogBaseProps & { sendBackDueDate: string; confirmedCloses: string[] }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = reason.trim();

  function close(next: boolean) {
    if (!next) {
      setFieldError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function submit() {
    if (!trimmed) {
      setFieldError("Give a reason for reopening this month.");
      return;
    }
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const result = await reopenSubmissionAction({ submissionId, reason: trimmed });
      if (!result.ok) {
        setFieldError(result.fieldErrors?.reason ?? null);
        setError(result.fieldErrors?.reason ? null : result.error);
        return;
      }
      toast.success(`${monthLabel} reopened`, {
        description: `${companyName} can correct and resubmit it by ${formatDate(result.data.dueDate)}.`,
      });
      setReason("");
      onOpenChange(false);
    });
  }

  return (
    <ReviewDialog
      open={open}
      onOpenChange={close}
      title={`Reopen ${monthLabel}?`}
      description={`This unlocks ${companyName}'s approved ${monthLabel} update so the company can correct and resubmit it. It then needs approval again.`}
      submitLabel="Reopen month"
      submitVariant="destructive"
      canSubmit={trimmed.length > 0 && reason.length <= MESSAGE_MAX}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <MessageField
        id={`${id}-reason`}
        label="Reason"
        description="Recorded on the timeline and in the audit log; the company sees it."
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (fieldError) setFieldError(null);
        }}
        maxLength={MESSAGE_MAX}
        required
        error={fieldError}
        placeholder="e.g. The management accounts restated cash in bank for this month."
        disabled={pending}
        autoFocus
        onSubmitShortcut={submit}
      />
      <ul className="flex flex-col gap-1.5">
        <Note>
          {companyName} will have until <strong className="font-medium text-foreground">{formatDate(sendBackDueDate)}</strong> to resubmit.
        </Note>
        {confirmedCloses.length > 0 ? (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {closesText(confirmedCloses)} will be reopened. The company confirms it again after resubmitting.
          </Note>
        ) : null}
      </ul>
    </ReviewDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Extend deadline
// ---------------------------------------------------------------------------------------------

/** 'YYYY-MM-DD' → a local Date on that calendar day (the calendar works in local days). */
function toLocalDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A local Date → 'YYYY-MM-DD' of that calendar day. */
function toDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Moves the month's due date (extend_due_date). The new date must be after the current due date and not in
 * the past: once the current due date has passed, the calendar starts at today and the quick choices count
 * from today, so an overdue month cannot be "extended" to a date that leaves it overdue.
 */
export function ExtendDeadlineDialog({
  open,
  onOpenChange,
  submissionId,
  companyName,
  monthLabel,
  dueDate,
  originalDueDate,
  today,
  daysOverdue,
}: DialogBaseProps & {
  dueDate: string;
  originalDueDate: string | null;
  /** Today in Malaysia time ('YYYY-MM-DD'), from the server. */
  today: string;
  /** Days the month is overdue (v_submission_overview; 0 when it is not overdue). */
  daysOverdue: number;
}) {
  const id = useId();
  const [newDueDate, setNewDueDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choices = useMemo(() => extensionChoices(dueDate, today), [dueDate, today]);
  const earliestDate = useMemo(() => toLocalDate(choices.earliest), [choices.earliest]);
  const latestDate = useMemo(() => toLocalDate(choices.latest), [choices.latest]);
  const selectedDate = useMemo(() => (newDueDate ? toLocalDate(newDueDate) : undefined), [newDueDate]);

  function close(next: boolean) {
    if (!next) {
      setDateError(null);
      setReasonError(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function choose(date: string) {
    setNewDueDate(date);
    setDateError(null);
  }

  function submit() {
    if (!newDueDate) {
      setDateError("Choose the new due date.");
      return;
    }
    const issue = extensionDateError(newDueDate, dueDate, today);
    if (issue) {
      setDateError(issue);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await extendDueDateAction({ submissionId, newDueDate, reason: reason.trim() || undefined });
      if (!result.ok) {
        setDateError(result.fieldErrors?.newDueDate ?? null);
        setReasonError(result.fieldErrors?.reason ?? null);
        setError(result.fieldErrors?.newDueDate || result.fieldErrors?.reason ? null : result.error);
        return;
      }
      toast.success(`Deadline extended to ${formatDate(result.data.dueDate)}`, {
        description: `${companyName}, ${monthLabel}.`,
      });
      setReason("");
      setNewDueDate(null);
      onOpenChange(false);
    });
  }

  const dateButtonId = `${id}-date`;
  const dateErrorId = `${id}-date-error`;

  return (
    <ReviewDialog
      open={open}
      onOpenChange={close}
      title={`Extend the deadline for ${monthLabel}?`}
      description={
        <>
          Currently due <strong className="font-medium text-foreground">{formatDate(dueDate)}</strong>
          {originalDueDate && originalDueDate !== dueDate ? ` (originally ${formatDate(originalDueDate)})` : ""}. The new date
          must be {choices.pastDue ? "today or later" : "later"}.
        </>
      }
      submitLabel="Extend deadline"
      canSubmit={newDueDate !== null && reason.length <= EXTENSION_REASON_MAX}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      {choices.pastDue ? (
        <ul className="flex flex-col gap-1.5">
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {daysOverdue > 0
              ? `${monthLabel} is ${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} overdue`
              : "The current due date has passed"}
            , so the quick choices count from today ({formatDate(today)}).
          </Note>
        </ul>
      ) : null}
      <Field data-invalid={dateError ? true : undefined} className="gap-1.5">
        <FieldLabel htmlFor={dateButtonId}>New due date</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                id={dateButtonId}
                type="button"
                variant="outline"
                className={cn("min-w-44 justify-start font-normal", !newDueDate && "text-muted-foreground")}
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? dateErrorId : undefined}
                disabled={pending}
              >
                <CalendarIcon data-icon="inline-start" />
                {newDueDate ? formatDate(newDueDate) : "Choose a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate ?? earliestDate}
                disabled={[{ before: earliestDate }, { after: latestDate }]}
                weekStartsOn={1}
                onSelect={(date) => {
                  if (!date) return;
                  choose(toDateKey(date));
                  setCalendarOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          {choices.quick.map((choice) => (
            <Button
              key={choice.days}
              type="button"
              variant={newDueDate === choice.date ? "secondary" : "ghost"}
              size="sm"
              onClick={() => choose(choice.date)}
              disabled={pending}
              aria-pressed={newDueDate === choice.date}
              aria-label={`${choice.label}: ${formatDate(choice.date)}`}
              title={formatDate(choice.date)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        {dateError ? <FieldError id={dateErrorId}>{dateError}</FieldError> : null}
        {newDueDate && !dateError ? (
          <FieldDescription className="text-xs">{extensionSummary(newDueDate, dueDate, today)}</FieldDescription>
        ) : null}
      </Field>
      <MessageField
        id={`${id}-reason`}
        label="Reason"
        description="Shown on the month's timeline, also to the company."
        value={reason}
        onChange={(value) => {
          setReason(value);
          if (reasonError) setReasonError(null);
        }}
        maxLength={EXTENSION_REASON_MAX}
        error={reasonError}
        placeholder="e.g. Auditors are finalising the management accounts."
        rows={3}
        disabled={pending}
        onSubmitShortcut={submit}
      />
    </ReviewDialog>
  );
}
