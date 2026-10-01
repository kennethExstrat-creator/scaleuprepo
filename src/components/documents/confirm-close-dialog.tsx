"use client";

import { BadgeCheckIcon, InfoIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { confirmPeriodClose } from "@/lib/actions/documents";
import { currencySymbol, formatNumberInput, parseNumberInput } from "@/lib/format";
import type { PeriodTotals } from "@/lib/metrics";
import { cn } from "@/lib/utils";

import {
  deriveRestatement,
  EDITABLE_FIGURE_KEYS,
  effectiveTotals,
  figureIssue,
  formatFigure,
  hasRestatement,
  PERIOD_FIGURES,
  REASON_MAX_LENGTH,
  type EditableFigureKey,
  type EnteredFigures,
  type RestatedTotals,
} from "./totals";

export type ConfirmCloseDialogProps = {
  companyId: string;
  companyName: string;
  closeId: string;
  label: string;
  rangeLabel: string;
  currency: string;
  /** Totals of the submitted and approved months (what will be stored as computed_totals). */
  liveTotals: PeriodTotals;
  countedMonths: number;
  /** Restated figures and reason kept from before the close was reopened (pre-filled). */
  previousRestatement: RestatedTotals | null;
  previousReason: string | null;
  latestAccounts: { fileName: string; version: number } | null;
  /** Every month submitted and management accounts uploaded. */
  ready: boolean;
  /** Id of the text explaining why the close cannot be confirmed yet (the card's checklist). */
  blockedDescriptionId?: string;
  /** A Fund Admin confirming for the company. */
  onBehalf: boolean;
};

type FigureTexts = Record<EditableFigureKey, string>;
type FigureErrorKey = EditableFigureKey | "reason";
type FigureErrors = Partial<Record<FigureErrorKey, string>>;

/** The figures as editable text (e.g. '1,234.5'); blank when unknown. */
function figureTexts(totals: PeriodTotals): FigureTexts {
  const text = (value: number | null) => formatNumberInput(value, 4);
  return {
    revenue_total: text(totals.revenue_total),
    gross_profit: text(totals.gross_profit),
    net_profit: text(totals.net_profit),
    cash_in_bank: text(totals.cash_in_bank),
    avg_burn_rate: text(totals.avg_burn_rate),
    headcount_ft: text(totals.headcount_ft),
    headcount_pt: text(totals.headcount_pt),
  };
}

/** A field-error key of the confirm action ('reason' or 'restated.<figure>') → the dialog's key. */
function toFigureErrorKey(path: string): FigureErrorKey | null {
  const key = path.replace(/^restated\./, "");
  if (key === "reason") return key;
  return EDITABLE_FIGURE_KEYS.find((figureKey) => figureKey === key) ?? null;
}

/** Reads the restated figures typed in: blanks are not restated; invalid entries become errors. */
function readFigures(texts: FigureTexts): { entered: EnteredFigures; errors: FigureErrors } {
  const entered: EnteredFigures = {};
  const errors: FigureErrors = {};
  for (const key of EDITABLE_FIGURE_KEYS) {
    const text = texts[key].trim();
    if (text === "") continue;
    const value = parseNumberInput(text);
    if (value === null) {
      errors[key] = "Enter a number, for example 1,234.50.";
      continue;
    }
    const issue = figureIssue(key, value);
    if (issue) errors[key] = issue;
    else entered[key] = value;
  }
  return { entered, errors };
}

/**
 * "Confirm" button and dialog for an open close: shows the calculated totals, lets the company restate
 * figures to match its management accounts (a reason is then required; margins follow the restated
 * revenue and profit) and calls confirm_period_close through confirmPeriodClose.
 */
export function ConfirmCloseDialog({
  companyId,
  companyName,
  closeId,
  label,
  rangeLabel,
  currency,
  liveTotals,
  countedMonths,
  previousRestatement,
  previousReason,
  latestAccounts,
  ready,
  blockedDescriptionId,
  onBehalf,
}: ConfirmCloseDialogProps) {
  const initialRestating = hasRestatement(previousRestatement);
  const initialTexts = () => figureTexts(effectiveTotals(liveTotals, previousRestatement));
  const [open, setOpen] = React.useState(false);
  const [restating, setRestating] = React.useState(initialRestating);
  const [texts, setTexts] = React.useState<FigureTexts>(initialTexts);
  const [reason, setReason] = React.useState(previousReason ?? "");
  const [errors, setErrors] = React.useState<FigureErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const baseId = React.useId();
  const toggleId = `${baseId}-restate`;
  const reasonId = `${baseId}-reason`;
  const formErrorId = `${baseId}-error`;

  const { entered } = readFigures(texts);
  const restatement = restating ? deriveRestatement(liveTotals, entered) : null;
  const preview = effectiveTotals(liveTotals, restatement);

  function reset() {
    setRestating(initialRestating);
    setTexts(initialTexts());
    setReason(previousReason ?? "");
    setErrors({});
    setFormError(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (next) reset();
    setOpen(next);
  }

  function setFigure(key: EditableFigureKey, text: string) {
    setTexts((current) => ({ ...current, [key]: text }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    let restated: EnteredFigures | null = null;
    let restatedTotals: RestatedTotals | null = null;
    if (restating) {
      const read = readFigures(texts);
      restatedTotals = deriveRestatement(liveTotals, read.entered);
      const nextErrors: FigureErrors = { ...read.errors };
      if (restatedTotals && reason.trim() === "") nextErrors.reason = "Give the reason for restating the totals.";
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        setFormError("Please check the highlighted fields.");
        return;
      }
      restated = restatedTotals ? read.entered : null;
    }

    setPending(true);
    setErrors({});
    try {
      const result = await confirmPeriodClose({
        companyId,
        closeId,
        restated,
        reason: restatedTotals ? reason.trim() : undefined,
      });
      if (!result.ok) {
        const fieldErrors: FigureErrors = {};
        for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
          const key = toFigureErrorKey(path);
          if (key) fieldErrors[key] = message;
        }
        setErrors(fieldErrors);
        setFormError(result.error);
        return;
      }
      toast.success(`${label} confirmed`, {
        description: restatedTotals
          ? "The restated figures and the reason were recorded."
          : "The period totals are confirmed and stored.",
      });
      setOpen(false);
    } catch {
      setFormError("Couldn't reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const symbol = currencySymbol(currency);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!ready} aria-describedby={!ready ? blockedDescriptionId : undefined}>
          <BadgeCheckIcon data-icon="inline-start" aria-hidden="true" />
          Confirm {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onInteractOutside={(event) => pending && event.preventDefault()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Confirm {label}</DialogTitle>
            <DialogDescription>
              {rangeLabel} · {countedMonths} {countedMonths === 1 ? "month" : "months"}. Check the totals against the
              management accounts
              {latestAccounts ? ` (${latestAccounts.fileName}, version ${latestAccounts.version})` : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-3">Figure</TableHead>
                  <TableHead className={cn("text-right", !restating && "pr-3")}>Calculated</TableHead>
                  {restating ? <TableHead className="w-40 pr-3 text-right">Restated</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {PERIOD_FIGURES.map((figure) => {
                  const changed = restatement !== null && Object.prototype.hasOwnProperty.call(restatement, figure.key);
                  const calculated = formatFigure(figure.kind, liveTotals[figure.key], currency);
                  const inputId = `${baseId}-${figure.key}`;
                  const errorId = `${inputId}-error`;
                  const error = figure.derived ? undefined : errors[figure.key];
                  return (
                    <TableRow key={figure.key} className={cn(changed && "bg-info/5 hover:bg-info/10")}>
                      <TableCell className={cn("pl-3 whitespace-normal", figure.derived && "pl-6 text-muted-foreground")}>
                        {restating && !figure.derived ? (
                          <label htmlFor={inputId}>{figure.label}</label>
                        ) : (
                          figure.label
                        )}
                        {changed ? <span className="sr-only"> (restated)</span> : null}
                      </TableCell>
                      <TableCell
                        className={cn("text-right tabular-nums", !restating && "pr-3", changed && "text-muted-foreground line-through")}
                      >
                        {calculated}
                      </TableCell>
                      {restating ? (
                        <TableCell className="pr-3 text-right align-top">
                          {figure.derived ? (
                            <span className={cn("tabular-nums", changed ? "font-semibold" : "text-muted-foreground")}>
                              {formatFigure(figure.kind, preview[figure.key], currency)}
                            </span>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                id={inputId}
                                inputMode="decimal"
                                autoComplete="off"
                                value={texts[figure.key]}
                                onChange={(event) => setFigure(figure.key, event.target.value)}
                                disabled={pending}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={error ? errorId : undefined}
                                className={cn("h-7 w-full min-w-28 text-right tabular-nums", changed && "font-semibold")}
                              />
                              {error ? (
                                <span id={errorId} className="text-xs text-destructive">
                                  {error}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Field orientation="horizontal">
            <Switch
              id={toggleId}
              checked={restating}
              onCheckedChange={(checked) => {
                setRestating(checked);
                setErrors({});
                setFormError(null);
              }}
              disabled={pending}
            />
            <FieldContent>
              <FieldLabel htmlFor={toggleId}>Restate figures to match the management accounts</FieldLabel>
              <FieldDescription>
                {initialRestating
                  ? "Filled in with the figures restated when this period was last confirmed. Turn this off to confirm the calculated totals."
                  : "Only when the management accounts show different figures."}{" "}
                Amounts are in {symbol}; the margins follow the restated revenue and profit.
              </FieldDescription>
            </FieldContent>
          </Field>

          {restating ? (
            <Field data-invalid={errors.reason ? true : undefined}>
              <FieldLabel htmlFor={reasonId}>Reason for restating</FieldLabel>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (errors.reason) setErrors((current) => ({ ...current, reason: undefined }));
                }}
                rows={3}
                maxLength={REASON_MAX_LENGTH}
                disabled={pending}
                placeholder="For example: year-end accruals booked after the monthly updates were submitted."
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={errors.reason ? `${reasonId}-error` : `${reasonId}-hint`}
              />
              {errors.reason ? (
                <FieldError id={`${reasonId}-error`}>{errors.reason}</FieldError>
              ) : (
                <FieldDescription id={`${reasonId}-hint`}>
                  {restatement
                    ? "Required, because at least one figure differs from the calculated totals."
                    : "No figure differs from the calculated totals yet, so nothing will be restated."}
                </FieldDescription>
              )}
            </Field>
          ) : null}

          <Alert className="border-info/25 bg-info/5">
            <InfoIcon className="text-info" aria-hidden="true" />
            <AlertDescription className="text-foreground">
              {onBehalf ? (
                <p>
                  You&apos;re confirming {label} on behalf of {companyName}. This is recorded in the audit log.
                </p>
              ) : (
                <p>By confirming, you confirm these totals for {label} are correct to the best of your knowledge.</p>
              )}
              <p>The totals are then stored and locked. ScaleUp can reopen the period if something needs to change.</p>
            </AlertDescription>
          </Alert>

          <FormError id={formErrorId} message={formError} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : <BadgeCheckIcon data-icon="inline-start" aria-hidden="true" />}
              {pending ? "Confirming…" : `Confirm ${label}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
