"use client";

import { ChevronDownIcon, CopyIcon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_DISPLAY,
  currencySymbol,
  formatMoney,
  formatNumber,
  formatNumberTrimmed,
  formatPct,
  toFiniteNumber,
} from "@/lib/format";
import { fieldTarget } from "@/lib/targets";
import {
  parseFieldOptions,
  parseFieldValidation,
  type SubmissionValueRow,
  type TemplateFieldRow,
} from "@/lib/types/domain";
import type { FieldType, SectionKind } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { isEmptyFieldDraft, jsonDraft, numberDraft, textDraft, withFieldValue, type FieldDraft } from "./draft";
import { CommentSlot, useFormContext } from "./form-context";
import { NumberInput, PicklistInput, RatingInput, TagsInput, YesNoInput } from "./inputs";
import { allowsNegative, targetDomId } from "./presentation";

// ---------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------

export type ControlWiring = { id: string; labelId: string; describedBy: string | undefined; invalid: boolean };

export type FieldShellProps = {
  target: string;
  label: ReactNode;
  /** 'label' → <label for>; 'group' → a plain label referenced with aria-labelledby (buttons groups). */
  labelKind?: "label" | "group";
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  /** Shows "Required" after the label (for fields that are usually optional). */
  required?: boolean;
  help?: ReactNode;
  /** Small muted line under the control, e.g. last month's figure. */
  hint?: ReactNode;
  /** Extra content under the control (e.g. "Last month"). */
  footer?: ReactNode;
  className?: string;
  children: (wiring: ControlWiring) => ReactNode;
};

/** Label, comment button, control, help text, hint and error message of one input, wired for ARIA. */
export function FieldShell({
  target,
  label,
  labelKind = "label",
  optional,
  required,
  help,
  hint,
  footer,
  className,
  children,
}: FieldShellProps) {
  const { errorFor } = useFormContext();
  const id = targetDomId(target);
  const labelId = `${id}-label`;
  const helpId = help ? `${id}-help` : null;
  const hintId = hint ? `${id}-hint` : null;
  const error = errorFor(target);
  const errorId = error ? `${id}-error` : null;
  const describedBy = [helpId, hintId, errorId].filter(Boolean).join(" ") || undefined;

  const labelContent = (
    <>
      <span>{label}</span>
      {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      {required ? <span className="text-xs font-normal text-muted-foreground">Required</span> : null}
    </>
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-invalid={error ? "true" : undefined}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        {labelKind === "label" ? (
          <Label id={labelId} htmlFor={id} className="flex-wrap gap-1.5 leading-snug">
            {labelContent}
          </Label>
        ) : (
          <span id={labelId} className="flex flex-wrap items-center gap-1.5 text-sm leading-snug font-medium">
            {labelContent}
          </span>
        )}
        <CommentSlot target={target} />
      </div>
      {children({ id, labelId, describedBy, invalid: Boolean(error) })}
      {help ? (
        <p id={helpId ?? undefined} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId ?? undefined} className="text-xs text-muted-foreground tabular-nums">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId ?? undefined} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {footer}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Read-only values
// ---------------------------------------------------------------------------------------------

type StoredValue = Pick<SubmissionValueRow, "value_number" | "value_text" | "value_json"> | FieldDraft;

function tagsOf(value: StoredValue | null | undefined): string[] {
  const json = value?.value_json;
  return Array.isArray(json) ? json.filter((item): item is string => typeof item === "string") : [];
}

/** A stored value as text, formatted for its field type ('—' when empty). */
export function formatFieldValue(
  field: Pick<TemplateFieldRow, "field_type" | "options">,
  value: StoredValue | null | undefined,
  currency: string,
): string {
  if (
    !value ||
    isEmptyFieldDraft({
      value_number: toFiniteNumber(value.value_number),
      value_text: value.value_text,
      value_json: value.value_json,
    })
  ) {
    return EMPTY_DISPLAY;
  }
  const number = toFiniteNumber(value.value_number);
  switch (field.field_type) {
    case "currency":
      return formatMoney(number, currency, { decimals: number !== null && !Number.isInteger(number) ? 2 : 0 });
    case "integer":
      return formatNumber(number);
    case "number":
      return formatNumberTrimmed(number, 4);
    case "percent":
      return number === null ? EMPTY_DISPLAY : `${formatNumberTrimmed(number, 2)}%`;
    case "rating": {
      const labels = parseFieldOptions(field).rating?.labels ?? {};
      return number === null
        ? EMPTY_DISPLAY
        : labels[String(number)]
          ? `${number} (${labels[String(number)]})`
          : String(number);
    }
    case "boolean":
      return value.value_json === true ? "Yes" : value.value_json === false ? "No" : EMPTY_DISPLAY;
    case "tags":
      return tagsOf(value).join(", ") || EMPTY_DISPLAY;
    default:
      return value.value_text?.trim() ? value.value_text : EMPTY_DISPLAY;
  }
}

function ReadonlyFieldValue({ field, value }: { field: TemplateFieldRow; value: FieldDraft | undefined }) {
  const { currency } = useFormContext();
  const empty = isEmptyFieldDraft(value);
  if (empty)
    return (
      <p className="text-sm text-muted-foreground">
        {field.field_type === "long_text" ? "Not filled in" : EMPTY_DISPLAY}
      </p>
    );
  const number = toFiniteNumber(value?.value_number);
  if (field.field_type === "currency") {
    return (
      <p className="text-sm font-medium">
        <Money value={number} currency={currency} decimals={number !== null && !Number.isInteger(number) ? 2 : 0} />
      </p>
    );
  }
  if (field.field_type === "tags") {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {tagsOf(value).map((tag) => (
          <li key={tag} className="rounded-full border px-2 py-0.5 text-xs">
            {tag}
          </li>
        ))}
      </ul>
    );
  }
  const text = formatFieldValue(field, value, currency);
  const long = field.field_type === "long_text" || field.field_type === "text";
  return <p className={cn("text-sm", long ? "break-words whitespace-pre-wrap" : "font-medium tabular-nums")}>{text}</p>;
}

// ---------------------------------------------------------------------------------------------
// Last month
// ---------------------------------------------------------------------------------------------

/** "Last month" (collapsible) with last month's entry and, when editable, "Copy last month". */
export function LastMonth({ field }: { field: TemplateFieldRow }) {
  const { previous, editable, copyLastMonth, currency } = useFormContext();
  const stored = previous?.values.values[field.key];
  if (!previous || !stored) return null;
  const draft: FieldDraft = {
    value_number: toFiniteNumber(stored.value_number),
    value_text: stored.value_text,
    value_json: stored.value_json,
  };
  if (isEmptyFieldDraft(draft)) return null;
  return (
    <Collapsible className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="group/last text-muted-foreground">
            <HistoryIcon data-icon="inline-start" />
            Last month ({previous.label})
            <ChevronDownIcon className="transition-transform group-data-[state=open]/last:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => copyLastMonth(field)}
          >
            <CopyIcon data-icon="inline-start" />
            Copy last month
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground/90">
          {formatFieldValue(field, draft, currency)}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------------------------
// Template fields
// ---------------------------------------------------------------------------------------------

const NUMBER_TYPES = new Set<FieldType>(["currency", "number", "integer", "percent"]);

/** Sections whose fields show last month's figure under the input. */
const FIGURE_SECTIONS = new Set<SectionKind>(["financials", "headcount", "custom_numbers"]);

function previousFigure(
  field: TemplateFieldRow,
  previous: { label: string; values: { values: Record<string, SubmissionValueRow> } } | null,
  currency: string,
): string | null {
  const stored = previous?.values.values[field.key];
  const number = toFiniteNumber(stored?.value_number);
  if (!previous || number === null) return null;
  const text =
    field.field_type === "currency"
      ? formatMoney(number, currency, { decimals: Number.isInteger(number) ? 0 : 2 })
      : field.field_type === "percent"
        ? formatPct(number, 1)
        : formatNumberTrimmed(number, 4);
  return `${previous.label}: ${text}`;
}

export type TemplateFieldControlProps = {
  field: TemplateFieldRow;
  sectionKind: SectionKind;
  /** Show "Last month" with its copy button (narrative and pulse). */
  showLastMonth?: boolean;
  /** The field is always required (the seven system numbers), whatever `is_required` says. */
  systemRequired?: boolean;
  className?: string;
};

/** One template field: its input by field type (or its value when read-only), with label, help and errors. */
export function TemplateFieldControl({
  field,
  sectionKind,
  showLastMonth,
  systemRequired,
  className,
}: TemplateFieldControlProps) {
  const { draft, store, editable, currency, touch, previous } = useFormContext();
  const target = fieldTarget(field.key);
  const value = draft.values[field.key];
  const required = systemRequired || field.is_required;
  const narrative = sectionKind === "narrative" || sectionKind === "pulse";
  const numberField = NUMBER_TYPES.has(field.field_type);
  const groupControl = field.field_type === "rating" || field.field_type === "tags" || field.field_type === "boolean";

  const hint = FIGURE_SECTIONS.has(sectionKind) && numberField ? previousFigure(field, previous, currency) : null;
  const footer = showLastMonth ? <LastMonth field={field} /> : null;

  const set = (next: FieldDraft | null) => store.update((current) => withFieldValue(current, field.key, next));

  return (
    <FieldShell
      target={target}
      label={field.label}
      labelKind={!editable || groupControl ? "group" : "label"}
      optional={!required && !narrative}
      required={required && narrative}
      help={field.help_text ?? (field.key === "burn_rate" ? "Enter 0 if cash-flow positive" : null)}
      hint={hint}
      footer={footer}
      className={className}
    >
      {(wiring) =>
        editable ? (
          <FieldInput field={field} value={value} wiring={wiring} onChange={set} onBlur={() => touch(target)} />
        ) : (
          <ReadonlyFieldValue field={field} value={value} />
        )
      }
    </FieldShell>
  );
}

function FieldInput({
  field,
  value,
  wiring,
  onChange,
  onBlur,
}: {
  field: TemplateFieldRow;
  value: FieldDraft | undefined;
  wiring: ControlWiring;
  onChange: (value: FieldDraft | null) => void;
  onBlur: () => void;
}) {
  const { store, currency } = useFormContext();
  const target = fieldTarget(field.key);
  const aria = { id: wiring.id, describedBy: wiring.describedBy, invalid: wiring.invalid };
  const validation = parseFieldValidation(field.validation);
  const maxLength = validation?.max_length ?? 20_000;

  switch (field.field_type) {
    case "currency":
    case "number":
    case "integer":
    case "percent":
      return (
        <NumberInput
          {...aria}
          value={toFiniteNumber(value?.value_number)}
          onValueChange={(next) => onChange(next === null ? null : numberDraft(next))}
          onInvalidChange={(message) => store.setInvalid(target, message)}
          onBlur={onBlur}
          percent={field.field_type === "percent"}
          prefix={field.field_type === "currency" ? currencySymbol(currency) : undefined}
          suffix={field.field_type === "percent" ? "%" : undefined}
          allowNegative={allowsNegative(field)}
          className="max-w-xs"
        />
      );
    case "rating": {
      const rating = parseFieldOptions(field).rating ?? { min: 1, max: 5, labels: {} };
      return (
        <RatingInput
          {...aria}
          ariaLabelledBy={wiring.labelId}
          value={toFiniteNumber(value?.value_number)}
          onValueChange={(next) => onChange(next === null ? null : numberDraft(next))}
          min={rating.min}
          max={rating.max}
          labels={rating.labels}
          onBlur={onBlur}
        />
      );
    }
    case "boolean":
      return (
        <YesNoInput
          {...aria}
          ariaLabelledBy={wiring.labelId}
          value={typeof value?.value_json === "boolean" ? value.value_json : null}
          onValueChange={(next) => onChange(next === null ? null : jsonDraft(next))}
          onBlur={onBlur}
        />
      );
    case "tags": {
      const options = parseFieldOptions(field).choices;
      const tags = Array.isArray(value?.value_json)
        ? value.value_json.filter((item): item is string => typeof item === "string")
        : [];
      return (
        <TagsInput
          {...aria}
          ariaLabelledBy={wiring.labelId}
          value={tags}
          options={options}
          onValueChange={(next) => onChange(next.length === 0 ? null : jsonDraft(next))}
          onBlur={onBlur}
        />
      );
    }
    case "picklist":
      return (
        <PicklistInput
          {...aria}
          value={value?.value_text?.trim() ? value.value_text : null}
          options={parseFieldOptions(field).choices}
          onValueChange={(next) => onChange(next === null ? null : textDraft(next))}
          onBlur={onBlur}
        />
      );
    case "long_text":
      return (
        <Textarea
          id={wiring.id}
          value={value?.value_text ?? ""}
          onChange={(event) => onChange(textDraft(event.target.value))}
          onBlur={onBlur}
          maxLength={maxLength}
          rows={3}
          className="min-h-24 bg-background"
          aria-invalid={wiring.invalid || undefined}
          aria-describedby={wiring.describedBy}
        />
      );
    default:
      return (
        <Input
          id={wiring.id}
          value={value?.value_text ?? ""}
          onChange={(event) => onChange(textDraft(event.target.value))}
          onBlur={onBlur}
          maxLength={maxLength}
          className="bg-background"
          aria-invalid={wiring.invalid || undefined}
          aria-describedby={wiring.describedBy}
        />
      );
  }
}
