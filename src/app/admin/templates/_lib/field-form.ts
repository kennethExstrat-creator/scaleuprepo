// State of the field dialog (text as typed) and its conversion to a FieldDraft (client-safe, pure).

import {
  NEW_FIELD_RULES,
  allowedFieldTypes,
  parseChoiceLines,
  rulesFromField,
  type FieldDraft,
  type FieldErrors,
} from "./rules";
import { formatNumberInput, parseNumberInput } from "@/lib/format";
import { parseFieldOptions, type TemplateFieldRow } from "@/lib/types/domain";
import type { FieldType, SectionKind } from "@/lib/types/enums";

export type FieldFormState = {
  label: string;
  key: string;
  /** False while the key still follows the label (new fields until the key is edited). */
  keyTouched: boolean;
  fieldType: FieldType;
  isRequired: boolean;
  helpText: string;
  /** Picklist / tag options, one per line. */
  choicesText: string;
  ratingMin: string;
  ratingMax: string;
  ratingLabels: Record<string, string>;
  allowNegative: boolean;
  min: string;
  max: string;
  maxLength: string;
};

/** The dialog's starting state: the stored field, or a new field of the section's first allowed type. */
export function initialFieldFormState(sectionKind: SectionKind, field: TemplateFieldRow | null): FieldFormState {
  if (field) {
    const options = parseFieldOptions(field);
    const rules = rulesFromField(field);
    return {
      label: field.label,
      key: field.key,
      keyTouched: true,
      fieldType: field.field_type,
      isRequired: field.is_required || field.is_system,
      helpText: field.help_text ?? "",
      choicesText: options.choices.join("\n"),
      ratingMin: String(options.rating?.min ?? 1),
      ratingMax: String(options.rating?.max ?? 5),
      ratingLabels: { ...(options.rating?.labels ?? {}) },
      allowNegative: rules.allow_negative,
      min: formatNumberInput(rules.min),
      max: formatNumberInput(rules.max),
      maxLength: rules.max_length === null ? "" : String(rules.max_length),
    };
  }
  return {
    label: "",
    key: "",
    keyTouched: false,
    fieldType: allowedFieldTypes(sectionKind)[0] ?? "long_text",
    isRequired: false,
    helpText: "",
    choicesText: "",
    ratingMin: "1",
    ratingMax: "5",
    ratingLabels: {},
    allowNegative: NEW_FIELD_RULES.allow_negative,
    min: "",
    max: "",
    maxLength: "",
  };
}

const NUMBER_HINT = "Enter a number, for example 0 or 1,000.";
const WHOLE_HINT = "Enter a whole number.";

function optionalNumber(text: string): { value: number | null; invalid: boolean } {
  if (text.trim() === "") return { value: null, invalid: false };
  const value = parseNumberInput(text);
  return value === null ? { value: null, invalid: true } : { value, invalid: false };
}

function wholeNumber(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** The whole values of a rating scale typed as text (empty when the bounds are not usable). */
export function ratingValues(minText: string, maxText: string, limit = 11): number[] {
  const min = wholeNumber(minText);
  const max = wholeNumber(maxText);
  if (min === null || max === null || max <= min || max - min + 1 > limit) return [];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/**
 * Turns the dialog's text into a FieldDraft. `errors` lists text that is not a number where one is
 * needed (the builder rules are checked separately with validateFieldDraft). Settings that do not
 * apply to the chosen type are sent empty.
 */
export function fieldFormToDraft(state: FieldFormState): { draft: FieldDraft; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const type = state.fieldType;

  const min = optionalNumber(state.min);
  const max = optionalNumber(state.max);
  const isNumber = type === "currency" || type === "number" || type === "integer" || type === "percent";
  if (isNumber && min.invalid) errors["validation.min"] = NUMBER_HINT;
  if (isNumber && max.invalid) errors["validation.max"] = NUMBER_HINT;

  let maxLength: number | null = null;
  const isText = type === "text" || type === "long_text";
  if (isText && state.maxLength.trim() !== "") {
    maxLength = wholeNumber(state.maxLength);
    if (maxLength === null) errors["validation.max_length"] = WHOLE_HINT;
  }

  let rating: FieldDraft["rating"] = null;
  if (type === "rating") {
    const ratingMin = wholeNumber(state.ratingMin);
    const ratingMax = wholeNumber(state.ratingMax);
    if (ratingMin === null) errors["rating.min"] = WHOLE_HINT;
    if (ratingMax === null) errors["rating.max"] = WHOLE_HINT;
    const labels: Record<string, string> = {};
    if (ratingMin !== null && ratingMax !== null) {
      for (let value = ratingMin; value <= ratingMax && value - ratingMin <= 20; value++) {
        const label = state.ratingLabels[String(value)]?.trim();
        if (label) labels[String(value)] = label;
      }
    }
    rating = { min: ratingMin ?? Number.NaN, max: ratingMax ?? Number.NaN, labels };
  }

  const draft: FieldDraft = {
    label: state.label.trim(),
    key: state.key.trim(),
    field_type: type,
    is_required: state.isRequired,
    help_text: state.helpText.trim(),
    choices: type === "picklist" || type === "tags" ? parseChoiceLines(state.choicesText) : [],
    rating,
    validation: {
      allow_negative: isNumber ? state.allowNegative : false,
      min: isNumber ? min.value : null,
      max: isNumber ? max.value : null,
      max_length: isText ? maxLength : null,
    },
  };
  return { draft, errors };
}
