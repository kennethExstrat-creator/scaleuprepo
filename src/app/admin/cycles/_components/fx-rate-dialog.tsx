"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";
import { formatNumberInput, formatNumberTrimmed, formatPct, parseNumberInput } from "@/lib/format";
import { monthLabel, monthLabelLong, type MonthKey } from "@/lib/periods";

import { createFxRateAction, updateFxRateAction } from "../actions";
import {
  FX_UNUSUAL_CHANGE_PCT,
  previousRate,
  rateChangePct,
  type FxCurrency,
} from "../_lib/cycles-model";
import { FX_RATE_DECIMALS, fxRateSchema } from "../_lib/schemas";
import { MonthSelect } from "./month-select";

/** What the dialog edits: a new rate (optionally for a given currency / month) or an existing one. */
export type FxDialogTarget =
  | { mode: "create"; currency: string | null; month: MonthKey | null }
  | { mode: "edit"; currency: string; month: MonthKey; rate: number };

type Errors = { form?: string | null; currency?: string | null; month?: string | null; rate?: string | null };

/** A rate as typed back into the box: up to 8 decimals, no trailing zeros. */
export function rateInputText(rate: number | null | undefined): string {
  return formatNumberInput(rate ?? null, FX_RATE_DECIMALS);
}

/**
 * Add or change one month's FX rate (BRD §12, B18): MYR per one unit of the currency, e.g. 1 USD = 4.215 MYR.
 * Exports and dashboards multiply the company's figures by it. Mount with a new `key` per opening.
 */
export function FxRateDialog({
  open,
  onOpenChange,
  target,
  currencies,
  groups,
  range,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: FxDialogTarget;
  /** Currencies a new rate can be added for (the non-MYR currencies companies report in). */
  currencies: string[];
  groups: FxCurrency[];
  range: { from: MonthKey; to: MonthKey };
}) {
  const id = useId();
  const editing = target.mode === "edit";
  const [currency, setCurrency] = useState(
    target.currency ?? (currencies.length === 1 ? currencies[0] : ""),
  );
  const [month, setMonth] = useState<string>(target.month ?? "");
  const [rateText, setRateText] = useState(editing ? rateInputText(target.rate) : "");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();

  const group = groups.find((item) => item.currency === currency) ?? null;
  const existing = !editing && group && month ? group.rows.find((row) => row.month === month && row.rate !== null) : null;
  const previous = group && month ? previousRate(group.rows, month) : null;
  const parsedRate = parseNumberInput(rateText);
  const change = previous && parsedRate !== null && parsedRate > 0 ? rateChangePct(previous.rate, parsedRate) : null;
  const unusual = change !== null && Math.abs(change) > FX_UNUSUAL_CHANGE_PCT;

  const ids = {
    currency: `${id}-currency`,
    currencyError: `${id}-currency-error`,
    month: `${id}-month`,
    monthError: `${id}-month-error`,
    rate: `${id}-rate`,
    rateHelp: `${id}-rate-help`,
    rateError: `${id}-rate-error`,
    form: `${id}-form-error`,
  };

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rate = parseNumberInput(rateText);
    const checked = fxRateSchema.safeParse({ currency, month, rate: rate ?? Number.NaN });
    if (!checked.success) {
      const next: Errors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (field === "currency" || field === "month" || field === "rate") {
          if (!next[field]) next[field] = issue.message;
        } else if (!next.form) {
          next.form = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    if (existing) {
      const message = `There is already a ${checked.data.currency} rate for ${monthLabelLong(checked.data.month)}. Edit that rate instead.`;
      setErrors({ month: message });
      return;
    }
    setErrors({});
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createFxRateAction>>;
      try {
        result = editing ? await updateFxRateAction(checked.data) : await createFxRateAction(checked.data);
      } catch {
        setErrors({ form: MESSAGES.network });
        return;
      }
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        const shown = fields.currency || fields.month || fields.rate;
        setErrors({
          currency: fields.currency ?? null,
          month: fields.month ?? null,
          rate: fields.rate ?? null,
          form: shown ? null : result.error,
        });
        return;
      }
      toast.success(
        `${editing ? "Rate updated" : "Rate added"}: ${checked.data.currency}, ${monthLabel(checked.data.month)}`,
        { description: `1 ${checked.data.currency} = ${formatNumberTrimmed(checked.data.rate, FX_RATE_DECIMALS)} MYR.` },
      );
      onOpenChange(false);
    });
  }

  const title = editing
    ? `Edit the ${target.currency} rate for ${monthLabelLong(target.month)}`
    : "Add an FX rate";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            How many ringgit one unit of the currency was worth for the month. Exports convert the company&apos;s
            figures to RM with it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError id={ids.form} message={errors.form} />

          {editing ? null : (
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field data-invalid={errors.currency ? true : undefined}>
                <FieldLabel htmlFor={ids.currency}>Currency</FieldLabel>
                <Select
                  value={currency}
                  onValueChange={(value) => {
                    setCurrency(value);
                    setErrors((current) => ({ ...current, currency: null, month: null }));
                  }}
                  disabled={pending || currencies.length === 0}
                >
                  <SelectTrigger
                    id={ids.currency}
                    className="w-full"
                    aria-invalid={errors.currency ? true : undefined}
                    aria-describedby={errors.currency ? ids.currencyError : undefined}
                  >
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {currencies.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.currency ? <FieldError id={ids.currencyError}>{errors.currency}</FieldError> : null}
              </Field>
              <Field data-invalid={errors.month ? true : undefined}>
                <FieldLabel htmlFor={ids.month}>Month</FieldLabel>
                <MonthSelect
                  id={ids.month}
                  value={month}
                  onValueChange={(value) => {
                    setMonth(value);
                    setErrors((current) => ({ ...current, month: null }));
                  }}
                  from={range.from}
                  to={range.to}
                  disabled={pending}
                  invalid={Boolean(errors.month)}
                  describedBy={errors.month ? ids.monthError : undefined}
                />
                {errors.month ? <FieldError id={ids.monthError}>{errors.month}</FieldError> : null}
                {existing && !errors.month ? (
                  <FieldDescription className="text-xs text-warning">
                    {currency} already has a rate for {monthLabelLong(month)} ({formatNumberTrimmed(existing.rate, FX_RATE_DECIMALS)}).
                    Close this and edit it instead.
                  </FieldDescription>
                ) : null}
              </Field>
            </div>
          )}

          <Field data-invalid={errors.rate ? true : undefined}>
            <FieldLabel htmlFor={ids.rate}>Rate</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>1 {currency || "unit"} =</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id={ids.rate}
                value={rateText}
                onChange={(event) => {
                  setRateText(event.target.value);
                  if (errors.rate) setErrors((current) => ({ ...current, rate: null }));
                }}
                inputMode="decimal"
                autoComplete="off"
                placeholder="4.215"
                className="text-right tabular-nums"
                disabled={pending}
                autoFocus={editing}
                aria-invalid={errors.rate ? true : undefined}
                aria-describedby={[ids.rateHelp, errors.rate ? ids.rateError : null].filter(Boolean).join(" ")}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>MYR</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id={ids.rateHelp} className="text-xs">
              {previous ? (
                <>
                  {monthLabel(previous.month)}: {formatNumberTrimmed(previous.rate, FX_RATE_DECIMALS)}.{" "}
                  {rateText.trim() === "" ? (
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-3"
                      onClick={() => setRateText(rateInputText(previous.rate))}
                      disabled={pending}
                    >
                      Use this rate
                    </button>
                  ) : change !== null ? (
                    <span>Change: {formatPct(change, 1, { signed: true })}.</span>
                  ) : null}
                </>
              ) : (
                "Up to 8 decimal places, e.g. 4.215 for US dollars."
              )}
            </FieldDescription>
            {unusual && !errors.rate ? (
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                That is a change of more than {FX_UNUSUAL_CHANGE_PCT}% from {monthLabel(previous?.month ?? month)}. Check
                it is ringgit per one {currency}, not the other way round.
              </p>
            ) : null}
            {errors.rate ? <FieldError id={ids.rateError}>{errors.rate}</FieldError> : null}
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || Boolean(existing)} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {editing ? "Save rate" : "Add rate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
