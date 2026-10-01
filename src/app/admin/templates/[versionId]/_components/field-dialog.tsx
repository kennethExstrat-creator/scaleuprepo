"use client";

import { LockIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { addFieldAction, updateFieldAction } from "../../actions";
import { fieldFormToDraft, initialFieldFormState, ratingValues, type FieldFormState } from "../../_lib/field-form";
import {
  DEFAULT_MAX_TEXT_LENGTH,
  MAX_HELP_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_RATING_LABEL_LENGTH,
  RATING_HIGHEST,
  RATING_LOWEST,
  SYSTEM_FIELD_RULES,
  allowedFieldTypes,
  isChoiceType,
  isNumberInputType,
  isSystemFieldKey,
  isTextInputType,
  parseChoiceLines,
  suggestFieldKey,
  validateFieldDraft,
  type FieldErrorKey,
  type FieldErrors,
  type LockedField,
} from "../../_lib/rules";
import { EditorDialog } from "./editor-dialog";
import { useRetained } from "./use-retained";
import { FormError } from "@/components/app/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FIELD_TYPE_LABELS } from "@/lib/constants";
import { formatNumberTrimmed } from "@/lib/format";
import type { TemplateFieldRow, TemplateSectionFull } from "@/lib/types/domain";

export type FieldDialogMode = { section: TemplateSectionFull; field: TemplateFieldRow | null };

/** Input ids by error key, in the order the form shows them (the first problem gets the focus). */
const INPUT_IDS: [FieldErrorKey, string][] = [
  ["label", "field-label"],
  ["key", "field-key"],
  ["field_type", "field-type"],
  ["help_text", "field-help"],
  ["choices", "field-choices"],
  ["rating.min", "field-rating-min"],
  ["rating.max", "field-rating-max"],
  ["rating.labels", "field-rating-labels"],
  ["validation.min", "field-min"],
  ["validation.max", "field-max"],
  ["validation.max_length", "field-max-length"],
];

function focusFirstError(errors: Record<string, string | undefined> | undefined) {
  if (!errors) return;
  const first = INPUT_IDS.find(([key]) => errors[key]);
  if (!first) return;
  requestAnimationFrame(() => document.getElementById(first[1])?.focus());
}

/** Add a field to a section, or edit one (system fields: label, help text and limits only). */
export function FieldDialog({
  mode,
  onOpenChange,
  versionKeys,
  lockedFields,
}: {
  /** null = closed. */
  mode: FieldDialogMode | null;
  onOpenChange: (open: boolean) => void;
  /** Keys of every field in the version. */
  versionKeys: string[];
  lockedFields: Record<string, LockedField>;
}) {
  const [pending, setPending] = useState(false);
  const shown = useRetained(mode);

  const title = shown?.field ? `Edit “${shown.field.label}”` : `Add a field to “${shown?.section.title ?? ""}”`;
  const description = shown?.field
    ? "Changes apply to months opened after you publish this draft."
    : "The field is added at the end of the section. Move it afterwards if needed.";

  return (
    <EditorDialog
      open={mode !== null}
      onOpenChange={onOpenChange}
      pending={pending}
      title={title}
      description={description}
      className="sm:max-w-xl"
    >
      {shown ? (
        <FieldForm
          key={shown.field?.id ?? `new-${shown.section.id}`}
          mode={shown}
          versionKeys={versionKeys}
          lockedFields={lockedFields}
          pending={pending}
          setPending={setPending}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </EditorDialog>
  );
}

function FieldForm({
  mode,
  versionKeys,
  lockedFields,
  pending,
  setPending,
  onDone,
}: {
  mode: FieldDialogMode;
  versionKeys: string[];
  lockedFields: Record<string, LockedField>;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const { section, field } = mode;
  const system = field?.is_system ?? false;
  const lockedAs = field && !system && Object.hasOwn(lockedFields, field.key) ? lockedFields[field.key] : null;
  const otherKeys = useMemo(() => versionKeys.filter((key) => key !== field?.key), [versionKeys, field?.key]);
  const typeOptions = useMemo(() => {
    if (field && (system || lockedAs)) return [field.field_type];
    const allowed = [...allowedFieldTypes(section.kind)];
    if (field && !allowed.includes(field.field_type)) allowed.push(field.field_type);
    return allowed;
  }, [field, system, lockedAs, section.kind]);

  const [state, setState] = useState<FieldFormState>(() => initialFieldFormState(section.kind, field));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function update(patch: Partial<FieldFormState>) {
    setState((previous) => {
      const next = { ...previous, ...patch };
      if (!next.keyTouched && !field) {
        next.key =
          next.label.trim() === ""
            ? ""
            : suggestFieldKey(next.label, { versionKeys: otherKeys, lockedFields, fieldType: next.fieldType });
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const { draft, errors: parseErrors } = fieldFormToDraft(state);
    const found: FieldErrors = {
      ...validateFieldDraft(draft, {
        sectionKind: section.kind,
        otherKeys,
        lockedFields,
        existing: field ? { key: field.key, field_type: field.field_type, is_system: field.is_system } : null,
      }),
      ...parseErrors,
    };
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError("Please check the highlighted fields.");
      focusFirstError(found);
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = field
        ? await updateFieldAction({ fieldId: field.id, ...draft })
        : await addFieldAction({ sectionId: section.id, ...draft });
      if (!result.ok) {
        const fieldErrors = result.fieldErrors ?? {};
        // Problems with inputs this form does not show (e.g. an id) are spelled out instead.
        const unshown = Object.entries(fieldErrors)
          .filter(([key]) => !INPUT_IDS.some(([name]) => name === key))
          .map(([, message]) => message);
        setErrors(fieldErrors);
        setFormError(unshown.length > 0 ? unshown.join(" ") : result.error);
        focusFirstError(fieldErrors);
        return;
      }
      toast.success(field ? "Field saved" : `Field “${draft.label}” added`);
      onDone();
    } finally {
      setPending(false);
    }
  }

  const invalid = (key: FieldErrorKey) => (errors[key] ? true : undefined);
  const describedBy = (key: FieldErrorKey, ...hints: (string | false | null | undefined)[]) => {
    const inputId = INPUT_IDS.find(([name]) => name === key)?.[1];
    return [errors[key] && inputId ? `${inputId}-error` : null, ...hints].filter(Boolean).join(" ") || undefined;
  };
  const errorText = (key: FieldErrorKey) => {
    const inputId = INPUT_IDS.find(([name]) => name === key)?.[1];
    return errors[key] ? <FieldError id={`${inputId}-error`}>{errors[key]}</FieldError> : null;
  };

  const type = state.fieldType;
  const fixedNonNegative = system && field !== null && isSystemFieldKey(field.key) && SYSTEM_FIELD_RULES[field.key].nonNegative;
  const choiceCount = isChoiceType(type) ? parseChoiceLines(state.choicesText).length : 0;
  const scaleValues = type === "rating" ? ratingValues(state.ratingMin, state.ratingMax) : [];

  let keyHint: string;
  if (system) keyHint = "Built-in key, used in calculations.";
  else if (lockedAs) keyHint = `Fixed: version ${lockedAs.version_no} stored answers under this key.`;
  else if (!field && !state.keyTouched) keyHint = "Generated from the label. Lower-case letters, numbers and underscores.";
  else keyHint = "Lower-case letters, numbers and underscores, starting with a letter.";

  let typeHint: string | null = null;
  if (system) typeHint = "Built-in type.";
  else if (lockedAs) typeHint = `Fixed: earlier months stored answers as ${FIELD_TYPE_LABELS[lockedAs.field_type].toLowerCase()}.`;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        {system ? (
          <Alert role="note" className="border-info/25 bg-info/5">
            <LockIcon className="text-info" aria-hidden="true" />
            <AlertDescription className="text-foreground">
              System field used in calculations. You can change its label, help text and limits; its key, type and
              section stay fixed and it is always required.
            </AlertDescription>
          </Alert>
        ) : null}

        <Field data-invalid={invalid("label")}>
          <FieldLabel htmlFor="field-label">Label</FieldLabel>
          <Input
            id="field-label"
            value={state.label}
            onChange={(event) => update({ label: event.target.value })}
            maxLength={MAX_LABEL_LENGTH}
            required
            autoFocus
            disabled={pending}
            aria-invalid={invalid("label")}
            aria-describedby={describedBy("label")}
          />
          {errorText("label")}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid("key")}>
            <FieldLabel htmlFor="field-key">Key</FieldLabel>
            <Input
              id="field-key"
              value={state.key}
              onChange={(event) => update({ key: event.target.value.toLowerCase(), keyTouched: true })}
              className="font-mono"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              maxLength={63}
              disabled={pending || system || lockedAs !== null}
              aria-invalid={invalid("key")}
              aria-describedby={describedBy("key", "field-key-hint")}
            />
            <FieldDescription id="field-key-hint">{keyHint}</FieldDescription>
            {errorText("key")}
          </Field>

          <Field data-invalid={invalid("field_type")}>
            <FieldLabel htmlFor="field-type">Type</FieldLabel>
            <Select
              value={type}
              onValueChange={(value) => {
                const next = typeOptions.find((option) => option === value);
                if (next) update({ fieldType: next });
              }}
              disabled={pending || typeOptions.length < 2}
            >
              <SelectTrigger
                id="field-type"
                className="w-full"
                aria-invalid={invalid("field_type")}
                aria-describedby={describedBy("field_type", typeHint ? "field-type-hint" : null)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FIELD_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeHint ? <FieldDescription id="field-type-hint">{typeHint}</FieldDescription> : null}
            {errorText("field_type")}
          </Field>
        </div>

        <Field orientation="horizontal">
          <Switch
            id="field-required"
            checked={state.isRequired}
            onCheckedChange={(checked) => update({ isRequired: checked })}
            disabled={pending || system}
            aria-describedby="field-required-hint"
          />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="field-required">Required</FieldLabel>
            <FieldDescription id="field-required-hint">
              {system
                ? "Always required: companies cannot submit a month without it."
                : "Companies must answer before they can submit the month."}
            </FieldDescription>
          </div>
        </Field>

        <Field data-invalid={invalid("help_text")}>
          <FieldLabel htmlFor="field-help">
            Help text <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Textarea
            id="field-help"
            value={state.helpText}
            onChange={(event) => update({ helpText: event.target.value })}
            maxLength={MAX_HELP_LENGTH}
            rows={2}
            disabled={pending}
            placeholder="Shown under the label, e.g. “Enter 0 if cash-flow positive”."
            aria-invalid={invalid("help_text")}
            aria-describedby={describedBy("help_text")}
          />
          {errorText("help_text")}
        </Field>

        {isChoiceType(type) ? (
          <Field data-invalid={invalid("choices")}>
            <FieldLabel htmlFor="field-choices">{type === "tags" ? "Tags" : "Options"}</FieldLabel>
            <Textarea
              id="field-choices"
              value={state.choicesText}
              onChange={(event) => update({ choicesText: event.target.value })}
              rows={6}
              disabled={pending}
              placeholder={type === "tags" ? "Fundraising\nHiring\nSales introductions" : "Not raising\nPreparing to raise\nActively raising"}
              aria-invalid={invalid("choices")}
              aria-describedby={describedBy("choices", "field-choices-hint")}
            />
            <FieldDescription id="field-choices-hint">
              One per line, in the order companies see them
              {type === "tags" ? "; companies can pick several" : "; companies pick one"}.{" "}
              {choiceCount > 0 ? `${choiceCount} ${type === "tags" ? "tag" : "option"}${choiceCount === 1 ? "" : "s"}.` : null}
            </FieldDescription>
            {errorText("choices")}
          </Field>
        ) : null}

        {type === "rating" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Rating scale</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={invalid("rating.min")}>
                <FieldLabel htmlFor="field-rating-min" className="font-normal">
                  Lowest
                </FieldLabel>
                <Input
                  id="field-rating-min"
                  value={state.ratingMin}
                  onChange={(event) => update({ ratingMin: event.target.value })}
                  inputMode="numeric"
                  className="tabular-nums"
                  disabled={pending}
                  aria-invalid={invalid("rating.min")}
                  aria-describedby={describedBy("rating.min")}
                />
                {errorText("rating.min")}
              </Field>
              <Field data-invalid={invalid("rating.max")}>
                <FieldLabel htmlFor="field-rating-max" className="font-normal">
                  Highest
                </FieldLabel>
                <Input
                  id="field-rating-max"
                  value={state.ratingMax}
                  onChange={(event) => update({ ratingMax: event.target.value })}
                  inputMode="numeric"
                  className="tabular-nums"
                  disabled={pending}
                  aria-invalid={invalid("rating.max")}
                  aria-describedby={describedBy("rating.max")}
                />
                {errorText("rating.max")}
              </Field>
            </div>
            {scaleValues.length > 0 ? (
              <div
                id="field-rating-labels"
                tabIndex={-1}
                role="group"
                aria-labelledby="field-rating-labels-title"
                className="flex flex-col gap-2 outline-none"
              >
                <p id="field-rating-labels-title" className="text-sm">
                  Labels <span className="text-muted-foreground">(optional, e.g. for the lowest and highest values)</span>
                </p>
                {scaleValues.map((value, index) => (
                  <div key={value} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2">
                    <Label htmlFor={`field-rating-label-${value}`} className="justify-center tabular-nums">
                      <span className="sr-only">Label for </span>
                      {value}
                    </Label>
                    <Input
                      id={`field-rating-label-${value}`}
                      value={state.ratingLabels[String(value)] ?? ""}
                      onChange={(event) =>
                        update({ ratingLabels: { ...state.ratingLabels, [String(value)]: event.target.value } })
                      }
                      maxLength={MAX_RATING_LABEL_LENGTH}
                      disabled={pending}
                      placeholder={index === 0 ? "e.g. Very low" : index === scaleValues.length - 1 ? "e.g. Very high" : undefined}
                    />
                  </div>
                ))}
                {errorText("rating.labels")}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enter whole numbers from {RATING_LOWEST} to {RATING_HIGHEST}, the highest above the lowest, to add labels.
              </p>
            )}
          </fieldset>
        ) : null}

        {isNumberInputType(type) ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Limits</legend>
            {fixedNonNegative ? (
              <p className="text-sm text-muted-foreground">Never negative: a built-in rule for this figure.</p>
            ) : (
              <Field orientation="horizontal">
                <Switch
                  id="field-allow-negative"
                  checked={state.allowNegative}
                  onCheckedChange={(checked) => update({ allowNegative: checked })}
                  disabled={pending}
                />
                <FieldLabel htmlFor="field-allow-negative" className="font-normal">
                  Allow negative values
                </FieldLabel>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={invalid("validation.min")}>
                <FieldLabel htmlFor="field-min" className="font-normal">
                  Minimum <span className="text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id="field-min"
                  value={state.min}
                  onChange={(event) => update({ min: event.target.value })}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  disabled={pending}
                  aria-invalid={invalid("validation.min")}
                  aria-describedby={describedBy("validation.min", "field-limits-hint")}
                />
                {errorText("validation.min")}
              </Field>
              <Field data-invalid={invalid("validation.max")}>
                <FieldLabel htmlFor="field-max" className="font-normal">
                  Maximum <span className="text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id="field-max"
                  value={state.max}
                  onChange={(event) => update({ max: event.target.value })}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  disabled={pending}
                  aria-invalid={invalid("validation.max")}
                  aria-describedby={describedBy("validation.max", "field-limits-hint")}
                />
                {errorText("validation.max")}
              </Field>
            </div>
            <FieldDescription id="field-limits-hint">
              Figures outside the limits are still saved, but must be corrected before the month can be submitted.
            </FieldDescription>
          </fieldset>
        ) : null}

        {isTextInputType(type) ? (
          <Field data-invalid={invalid("validation.max_length")}>
            <FieldLabel htmlFor="field-max-length">
              Maximum length <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="field-max-length"
              value={state.maxLength}
              onChange={(event) => update({ maxLength: event.target.value })}
              inputMode="numeric"
              className="max-w-40 tabular-nums"
              disabled={pending}
              aria-invalid={invalid("validation.max_length")}
              aria-describedby={describedBy("validation.max_length", "field-max-length-hint")}
            />
            <FieldDescription id="field-max-length-hint">
              In characters. Leave empty for the standard limit of {formatNumberTrimmed(DEFAULT_MAX_TEXT_LENGTH, 0)}.
            </FieldDescription>
            {errorText("validation.max_length")}
          </Field>
        ) : null}

        {type === "boolean" ? <p className="text-sm text-muted-foreground">Companies answer Yes or No.</p> : null}
      </FieldGroup>

      <FormError message={formError} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {field ? "Save changes" : "Add field"}
        </Button>
      </DialogFooter>
    </form>
  );
}
