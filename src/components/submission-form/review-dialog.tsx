"use client";

import { ArrowRightIcon, CircleAlertIcon, ListOrderedIcon, RotateCwIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FormError } from "@/components/app/form-error";
import { Money } from "@/components/app/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/actions/result";
import { getSubmissionValidationAction, submitSubmission, type SubmissionCheck } from "@/lib/actions/submission";
import { formatNumber, formatPct, formatRunway } from "@/lib/format";
import { deriveMetrics, financialsFromValues } from "@/lib/metrics";
import { monthLabel, monthLabelLong } from "@/lib/periods";
import { toValidationInput, type SubmissionBundle } from "@/lib/types/domain";
import { isEmptyValue, kpiCellsForMonth, type ValidationIssue } from "@/lib/validation";

import { isEmptyFieldDraft } from "./draft";
import type { DraftStore } from "./draft-store";

/** Where the review dialog is: each step of saving, checking and declaring. */
export type ReviewStep =
  | { kind: "unreadable" }
  | { kind: "saving" }
  | { kind: "checking" }
  | { kind: "save-failed"; message: string }
  | { kind: "check-failed"; message: string }
  | { kind: "issues"; errors: ValidationIssue[]; priorMonths: string[] }
  | { kind: "declare"; check: SubmissionCheck };

export type ReviewSubmitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundle: SubmissionBundle;
  store: DraftStore;
  /** Inputs whose text cannot be saved ([target, message]); they must be fixed first. */
  unreadable: [string, string][];
  /** Labels for targets (field, segment and KPI cell names), for the issue list. */
  labelFor: (target: string) => string;
  /** Base of month links, e.g. '/portal/<id>/updates'. */
  monthHrefBase: string;
  /** Scrolls to and focuses the input of a target (called after the dialog has closed). */
  onJump: (target: string) => void;
  /** After a successful submission. */
  onSubmitted: () => void;
};

/**
 * "Review and submit": saves pending changes, runs the server check (get_submission_validation, earlier
 * months included), then shows the figures being submitted with the owner declaration.
 */
export function ReviewSubmitDialog(props: ReviewSubmitDialogProps) {
  const { open, onOpenChange, bundle, onJump } = props;
  const [busy, setBusy] = useState(false);
  const jumpTarget = useRef<string | null>(null);
  const month = monthLabelLong(bundle.submission.month);

  const jump = (target: string) => {
    jumpTarget.current = target;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => busy && event.preventDefault()}
        onCloseAutoFocus={(event) => {
          const target = jumpTarget.current;
          if (!target) return;
          jumpTarget.current = null;
          event.preventDefault();
          onJump(target);
        }}
      >
        <DialogHeader>
          <DialogTitle>Review and submit {month}</DialogTitle>
          <DialogDescription>
            ScaleUp reviews the month once it is submitted. It is then locked until ScaleUp approves it or asks for
            changes.
          </DialogDescription>
        </DialogHeader>
        <ReviewBody {...props} onBusyChange={setBusy} onJumpRequest={jump} />
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  bundle,
  store,
  unreadable,
  labelFor,
  monthHrefBase,
  onOpenChange,
  onSubmitted,
  onBusyChange,
  onJumpRequest,
}: ReviewSubmitDialogProps & { onBusyChange: (busy: boolean) => void; onJumpRequest: (target: string) => void }) {
  const [step, setStep] = useState<ReviewStep>(() =>
    unreadable.length > 0 ? { kind: "unreadable" } : { kind: "saving" },
  );
  const submissionId = bundle.submission.id;

  // The check starts when the dialog opens (this body mounts with it); a closed dialog ignores the result.
  useEffect(() => {
    if (unreadable.length > 0) return;
    let active = true;
    void runReviewCheck(store, submissionId, (next) => {
      if (active) setStep(next);
    });
    return () => {
      active = false;
    };
  }, [store, submissionId, unreadable.length]);

  const retry = () => {
    setStep({ kind: "saving" });
    void runReviewCheck(store, submissionId, setStep);
  };

  switch (step.kind) {
    case "saving":
    case "checking":
      return (
        <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground" role="status">
          <Spinner aria-hidden="true" />
          {step.kind === "saving" ? "Saving your latest changes…" : "Checking the figures…"}
        </div>
      );
    case "unreadable":
      return (
        <>
          <IssueList
            title="Some values can't be read"
            description="Correct these values first. They haven't been saved."
            issues={unreadable.map(([target, message]) => ({
              target,
              code: "unreadable",
              message: `${labelFor(target)}: ${message}`,
            }))}
            labelFor={labelFor}
            onJump={onJumpRequest}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </>
      );
    case "save-failed":
    case "check-failed":
      return (
        <>
          <FormError
            message={
              step.kind === "save-failed" ? `Your latest changes couldn't be saved. ${step.message}` : step.message
            }
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={retry}>
              <RotateCwIcon data-icon="inline-start" />
              Try again
            </Button>
          </DialogFooter>
        </>
      );
    case "issues":
      return (
        <>
          {step.priorMonths.length > 0 ? (
            <Alert className="border-warning/30 bg-warning/5 [&>svg]:text-warning">
              <ListOrderedIcon />
              <AlertTitle>Submit earlier months first</AlertTitle>
              <AlertDescription className="flex flex-col gap-2 text-foreground/80">
                <p>Months are submitted in order. These months haven&apos;t been submitted yet:</p>
                <ul className="flex flex-wrap gap-2">
                  {step.priorMonths.map((m) => (
                    <li key={m}>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`${monthHrefBase}/${m}`}>
                          {monthLabel(m)}
                          <ArrowRightIcon data-icon="inline-end" />
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {step.errors.some((issue) => issue.code !== "prior_months") ? (
            <IssueList
              title="Fix these before submitting"
              issues={step.errors.filter((issue) => issue.code !== "prior_months")}
              labelFor={labelFor}
              onJump={onJumpRequest}
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button variant="outline" onClick={retry}>
              <RotateCwIcon data-icon="inline-start" />
              Check again
            </Button>
          </DialogFooter>
        </>
      );
    case "declare":
      return (
        <DeclareStep
          bundle={bundle}
          check={step.check}
          onCancel={() => onOpenChange(false)}
          onBusyChange={onBusyChange}
          onSubmitted={onSubmitted}
        />
      );
  }
}

/** Shown when a request of the dialog got no answer (offline, server unavailable, a new release). */
export const CHECK_UNREACHABLE = "Couldn't reach the server to check the figures. Check your connection and try again.";
export const SUBMIT_UNREACHABLE =
  "Couldn't reach the server. Check your connection and try again (reload the page to see whether the month was submitted).";

/**
 * Saves pending changes, then asks the server whether the month can be submitted; reports each step. The
 * stored values it returns replace untouched entries, so the declaration shows exactly what is stored. A
 * request that fails on the network ends in "check-failed" (with "Try again"), never in an endless spinner.
 */
export async function runReviewCheck(
  store: Pick<DraftStore, "flush" | "getSnapshot" | "syncFromServer">,
  submissionId: string,
  report: (step: ReviewStep) => void,
): Promise<void> {
  try {
    const saved = await store.flush();
    if (!saved) {
      report({ kind: "save-failed", message: store.getSnapshot().error ?? "Please try again." });
      return;
    }
    report({ kind: "checking" });
    const result = await getSubmissionValidationAction(submissionId);
    if (!result.ok) {
      report({ kind: "check-failed", message: result.error });
      return;
    }
    store.syncFromServer(result.data.values, result.data.lastSavedAt);
    if (result.data.status !== "draft" && result.data.status !== "changes_requested") {
      report({
        kind: "check-failed",
        message: "This month has already been submitted. Reload the page to see its status.",
      });
      return;
    }
    report(
      result.data.ok
        ? { kind: "declare", check: result.data }
        : { kind: "issues", errors: result.data.errors, priorMonths: result.data.priorMonths },
    );
  } catch {
    report({ kind: "check-failed", message: CHECK_UNREACHABLE });
  }
}

/**
 * Submits the month with the owner declaration (submitSubmission). A request that gets no answer (the
 * Server Action call rejects) becomes a failure with a message instead of an exception, so the dialog
 * never stays locked on its spinner.
 */
export async function submitMonth(submissionId: string): Promise<ActionResult<{ month: string }>> {
  try {
    return await submitSubmission(submissionId, true);
  } catch {
    return { ok: false, error: SUBMIT_UNREACHABLE };
  }
}

function IssueList({
  title,
  description,
  issues,
  labelFor,
  onJump,
}: {
  title: string;
  description?: string;
  issues: ValidationIssue[];
  labelFor: (target: string) => string;
  onJump: (target: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <ul className="divide-y rounded-lg border">
        {issues.map((issue, index) => (
          <li
            key={`${issue.target}-${issue.code}-${index}`}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <span className="min-w-0 text-sm">{issue.message}</span>
            {issue.target !== "general" ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="shrink-0"
                onClick={() => onJump(issue.target)}
                aria-label={`Go to ${labelFor(issue.target)}`}
              >
                Go to field
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeclareStep({
  bundle,
  check,
  onCancel,
  onBusyChange,
  onSubmitted,
}: {
  bundle: SubmissionBundle;
  check: SubmissionCheck;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  onSubmitted: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = bundle.company.reporting_currency.trim();
  const month = monthLabelLong(bundle.submission.month);
  const figures = financialsFromValues(bundle.submission.month, check.values.values);
  const metrics = deriveMetrics(figures);

  const cells = kpiCellsForMonth(toValidationInput(bundle));
  const filledCells = cells.filter(
    (cell) => !isEmptyValue(check.values.kpis[cell.cellKey] ?? null, cell.valueType),
  ).length;
  const narrative = bundle.template.sections.filter((section) => section.kind === "narrative");
  const filledNarrative = narrative.filter((section) =>
    section.fields.some((field) => !isEmptyFieldDraft(check.values.values[field.key])),
  ).length;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Total revenue", value: <Money value={figures.revenue_total} currency={currency} /> },
    {
      label: "Gross profit",
      value: (
        <>
          <Money value={figures.gross_profit} currency={currency} />
          <span className="ml-1.5 text-xs text-muted-foreground">{formatPct(metrics.gp_pct)}</span>
        </>
      ),
    },
    {
      label: "Net profit",
      value: (
        <>
          <Money value={figures.net_profit} currency={currency} />
          <span className="ml-1.5 text-xs text-muted-foreground">{formatPct(metrics.np_pct)}</span>
        </>
      ),
    },
    { label: "Cash in bank", value: <Money value={figures.cash_in_bank} currency={currency} /> },
    {
      label: "Burn rate",
      value: (
        <>
          <Money value={figures.burn_rate} currency={currency} />
          <span className="ml-1.5 text-xs text-muted-foreground">
            {formatRunway(metrics.runway_months, { cashflowPositive: metrics.cashflow_positive })}
          </span>
        </>
      ),
    },
    {
      label: "Headcount",
      value: `${formatNumber(figures.headcount_ft)} full-time, ${formatNumber(figures.headcount_pt)} part-time`,
    },
  ];
  if (cells.length > 0) rows.push({ label: "Company KPIs", value: `${filledCells} of ${cells.length} filled in` });
  if (narrative.length > 0) {
    rows.push({ label: "Narrative", value: `${filledNarrative} of ${narrative.length} categories (optional)` });
  }

  async function submit() {
    setPending(true);
    onBusyChange(true);
    setError(null);
    // Never rejects, so the dialog can always be closed again.
    const result = await submitMonth(bundle.submission.id);
    setPending(false);
    onBusyChange(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSubmitted();
  }

  return (
    <>
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <Checkbox
          id="submission-declaration"
          checked={accepted}
          onCheckedChange={(value) => setAccepted(value === true)}
          disabled={pending}
          aria-describedby={error ? "submission-declaration-error" : undefined}
          className="mt-0.5"
        />
        <Label htmlFor="submission-declaration" className="leading-snug font-normal">
          {bundle.clientSettings.declaration_text}
        </Label>
      </div>
      <FormError id="submission-declaration-error" message={error} />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!accepted || pending} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          Submit {month}
        </Button>
      </DialogFooter>
    </>
  );
}
