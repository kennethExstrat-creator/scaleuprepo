"use client";

import { CalendarIcon, InfoIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/actions/result";
import { formatDate, formatNumber } from "@/lib/format";
import { addDays, daysBetween, monthLabelLong, type DateKey } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { extendDeadlineAction } from "../actions";
import {
  EXTENSION_QUICK_DAYS,
  earliestExtensionDate,
  extensionBase,
  initialExtendSelection,
  latestExtensionDate,
  newDueDateIssue,
  plural,
  type DeadlineCompanyChoice,
  type ExtendTarget,
} from "../_lib/cycles-model";
import { EXTENSION_REASON_MAX } from "../_lib/schemas";

type Errors = {
  form?: string | null;
  company?: string | null;
  month?: string | null;
  date?: string | null;
  reason?: string | null;
};

/** 'YYYY-MM-DD' → a local Date on that calendar day (the calendar works in local days). */
function toLocalDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** A local Date → 'YYYY-MM-DD' of that calendar day. */
function toDateKey(date: Date): DateKey {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Shown when the dialog was opened on a month it does not offer (any more). */
function TargetMissingNote({ label, hasChoices }: { label: string | undefined; hasChoices: boolean }) {
  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>
        {label ? `${label} can no longer be extended here` : "That month can no longer be extended here"}
      </AlertTitle>
      <AlertDescription>
        It may have been approved in the meantime, or the company no longer reports for that month.
        {hasChoices ? " Choose a company and month below if another deadline needs to move." : ""}
      </AlertDescription>
    </Alert>
  );
}

/**
 * "Extend a deadline" (extend_due_date; Super Admin and Fund Admin): choose a reporting company, one of its
 * months that is not approved yet, a later due date and an optional reason. Mount it with a new `key` each
 * time it opens so it starts from `initial`: exactly that month, or nothing (with a note) when the dialog
 * does not offer it, never another company's month.
 */
export function ExtendDeadlineDialog({
  open,
  onOpenChange,
  choices,
  today,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choices: DeadlineCompanyChoice[];
  /** Today in Malaysia time, from the server. */
  today: DateKey;
  initial: ExtendTarget | null;
}) {
  const id = useId();
  const initialSelection = initialExtendSelection(choices, initial);

  const [companyId, setCompanyId] = useState(initialSelection.companyId);
  const [submissionId, setSubmissionId] = useState(initialSelection.submissionId);
  const [newDueDate, setNewDueDate] = useState<DateKey | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const company = choices.find((choice) => choice.companyId === companyId) ?? null;
  const month = company?.months.find((choice) => choice.submissionId === submissionId) ?? null;

  const base = month ? extensionBase(month.dueDate, today) : null;
  const latest = month ? latestExtensionDate(month.dueDate, today) : null;
  const earliestDate = month ? toLocalDate(earliestExtensionDate(month.dueDate, today)) : undefined;
  const latestDate = latest ? toLocalDate(latest) : undefined;
  const selectedDate = newDueDate ? toLocalDate(newDueDate) : undefined;

  const ids = {
    company: `${id}-company`,
    companyError: `${id}-company-error`,
    monthError: `${id}-month-error`,
    date: `${id}-date`,
    dateHelp: `${id}-date-help`,
    dateError: `${id}-date-error`,
    reason: `${id}-reason`,
    reasonHelp: `${id}-reason-help`,
    reasonError: `${id}-reason-error`,
    form: `${id}-form-error`,
  };

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function chooseCompany(next: string) {
    const choice = choices.find((item) => item.companyId === next) ?? null;
    setCompanyId(next);
    setSubmissionId(choice && choice.months.length === 1 ? choice.months[0].submissionId : "");
    setNewDueDate(null);
    setErrors({});
  }

  function chooseMonth(next: string) {
    setSubmissionId(next);
    setNewDueDate(null);
    setErrors((current) => ({ ...current, month: null, date: null, form: null }));
  }

  function chooseDate(date: DateKey) {
    setNewDueDate(date);
    setErrors((current) => ({ ...current, date: null, form: null }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!company) {
      setErrors({ company: "Choose a company." });
      return;
    }
    if (!month) {
      setErrors({ month: "Choose the month to extend." });
      return;
    }
    const issue = newDueDateIssue(newDueDate, month.dueDate, today, formatDate);
    if (issue || !newDueDate) {
      setErrors({ date: issue ?? "Choose the new due date." });
      return;
    }
    const trimmed = reason.trim();
    if (trimmed.length > EXTENSION_REASON_MAX) {
      setErrors({ reason: "Please keep the reason under 2,000 characters." });
      return;
    }
    setErrors({});
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof extendDeadlineAction>>;
      try {
        result = await extendDeadlineAction({
          submissionId: month.submissionId,
          newDueDate,
          reason: trimmed || undefined,
        });
      } catch {
        setErrors({ form: MESSAGES.network });
        return;
      }
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        const shown = fields.newDueDate || fields.reason;
        setErrors({
          date: fields.newDueDate ?? null,
          reason: fields.reason ?? null,
          form: shown ? null : (fields.submissionId ?? result.error),
        });
        return;
      }
      toast.success(`Deadline extended to ${formatDate(result.data.dueDate)}`, {
        description: `${result.data.companyName}, ${monthLabelLong(result.data.month)}.`,
      });
      onOpenChange(false);
    });
  }

  const reasonTooLong = reason.trim().length > EXTENSION_REASON_MAX;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Extend a deadline</DialogTitle>
          <DialogDescription>
            Give a company more time for a month that is not approved yet. The new date and the reason appear on the
            month&apos;s timeline, which the company also sees.
          </DialogDescription>
        </DialogHeader>

        {initialSelection.targetMissing ? (
          <TargetMissingNote label={initial?.label} hasChoices={choices.length > 0} />
        ) : null}

        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reporting company has a month that can be extended: every open month is approved, or no active company
            reports yet.
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-describedby={errors.form ? ids.form : undefined}>
            <FormError id={ids.form} message={errors.form} />

            <Field data-invalid={errors.company ? true : undefined}>
              <FieldLabel htmlFor={ids.company}>Company</FieldLabel>
              <Select value={companyId} onValueChange={chooseCompany} disabled={pending}>
                <SelectTrigger
                  id={ids.company}
                  className="w-full"
                  aria-invalid={errors.company ? true : undefined}
                  aria-describedby={errors.company ? ids.companyError : undefined}
                >
                  <SelectValue placeholder="Choose a company" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {choices.map((choice) => (
                    <SelectItem key={choice.companyId} value={choice.companyId}>
                      {choice.companyName}
                      <span className="text-muted-foreground">{plural(choice.months.length, "open month")}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.company ? <FieldError id={ids.companyError}>{errors.company}</FieldError> : null}
            </Field>

            {company ? (
              <FieldSet>
                <FieldLegend variant="label">Month</FieldLegend>
                <RadioGroup
                  value={submissionId}
                  onValueChange={chooseMonth}
                  disabled={pending}
                  className="gap-2"
                  aria-describedby={errors.month ? ids.monthError : undefined}
                >
                  {company.months.map((choice) => {
                    const itemId = `${id}-month-${choice.submissionId}`;
                    const moved = choice.originalDueDate && choice.originalDueDate !== choice.dueDate;
                    return (
                      <FieldLabel key={choice.submissionId} htmlFor={itemId}>
                        <Field orientation="horizontal">
                          <FieldContent>
                            <FieldTitle>
                              {monthLabelLong(choice.month)}
                              <StatusBadge status={choice.status} overdue={choice.isOverdue} />
                            </FieldTitle>
                            <FieldDescription>
                              Due {formatDate(choice.dueDate)}
                              {moved ? ` (originally ${formatDate(choice.originalDueDate)})` : ""}
                              {choice.isOverdue ? ` · ${plural(choice.daysOverdue, "day")} overdue` : ""}
                            </FieldDescription>
                          </FieldContent>
                          <RadioGroupItem value={choice.submissionId} id={itemId} />
                        </Field>
                      </FieldLabel>
                    );
                  })}
                </RadioGroup>
                {errors.month ? <FieldError id={ids.monthError}>{errors.month}</FieldError> : null}
              </FieldSet>
            ) : null}

            {month && base && latest ? (
              <Field data-invalid={errors.date ? true : undefined} className="gap-1.5">
                <FieldLabel htmlFor={ids.date}>New due date</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id={ids.date}
                        type="button"
                        variant="outline"
                        className={cn("min-w-44 justify-start font-normal", !newDueDate && "text-muted-foreground")}
                        aria-invalid={errors.date ? true : undefined}
                        aria-describedby={[ids.dateHelp, errors.date ? ids.dateError : null].filter(Boolean).join(" ")}
                        disabled={pending}
                      >
                        <CalendarIcon data-icon="inline-start" aria-hidden="true" />
                        {newDueDate ? formatDate(newDueDate) : "Choose a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        defaultMonth={selectedDate ?? toLocalDate(base)}
                        disabled={[
                          ...(earliestDate ? [{ before: earliestDate }] : []),
                          ...(latestDate ? [{ after: latestDate }] : []),
                        ]}
                        weekStartsOn={1}
                        onSelect={(date) => {
                          if (!date) return;
                          chooseDate(toDateKey(date));
                          setCalendarOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  {EXTENSION_QUICK_DAYS.map((days) => {
                    const date = addDays(base, days);
                    const fromToday = base === today && base !== month.dueDate;
                    return (
                      <Button
                        key={days}
                        type="button"
                        variant={newDueDate === date ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => chooseDate(date)}
                        disabled={pending}
                        aria-pressed={newDueDate === date}
                        title={formatDate(date)}
                      >
                        {fromToday ? `In ${days} days` : `+${days} days`}
                      </Button>
                    );
                  })}
                </div>
                <FieldDescription id={ids.dateHelp} className="text-xs">
                  {newDueDate && !errors.date
                    ? `${plural(daysBetween(month.dueDate, newDueDate), "day")} after the current due date (${formatDate(month.dueDate)}).`
                    : base !== month.dueDate
                      ? `Currently due ${formatDate(month.dueDate)}, which has passed: the quick choices count from today.`
                      : `Currently due ${formatDate(month.dueDate)}. Choose a later date, up to ${formatDate(latest)}.`}
                </FieldDescription>
                {errors.date ? <FieldError id={ids.dateError}>{errors.date}</FieldError> : null}
              </Field>
            ) : null}

            {month ? (
              <Field data-invalid={errors.reason || reasonTooLong ? true : undefined}>
                <FieldLabel htmlFor={ids.reason}>
                  Reason <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Textarea
                  id={ids.reason}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (errors.reason) setErrors((current) => ({ ...current, reason: null }));
                  }}
                  rows={3}
                  maxLength={EXTENSION_REASON_MAX + 200}
                  placeholder="e.g. The auditors are finalising the management accounts."
                  disabled={pending}
                  aria-invalid={errors.reason || reasonTooLong ? true : undefined}
                  aria-describedby={[ids.reasonHelp, errors.reason ? ids.reasonError : null].filter(Boolean).join(" ")}
                />
                <FieldDescription id={ids.reasonHelp} className="flex justify-between gap-3 text-xs">
                  <span>Shown on the month&apos;s timeline, also to the company.</span>
                  <span className={cn("tabular-nums", reasonTooLong && "text-destructive")}>
                    {formatNumber(reason.trim().length)} / {formatNumber(EXTENSION_REASON_MAX)}
                  </span>
                </FieldDescription>
                {errors.reason ? <FieldError id={ids.reasonError}>{errors.reason}</FieldError> : null}
              </Field>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending || !month || !newDueDate || reasonTooLong} aria-busy={pending || undefined}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Extend deadline
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
