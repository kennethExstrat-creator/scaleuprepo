// Pure rules of the template builder (BRD A3; docs/ARCHITECTURE.md §2.2, §2.4, §3). Client-safe: the
// editor uses them for instant feedback and the Server Actions (../actions.ts) re-apply them before
// writing. The database stays the source of truth for the structural rules (private.guard_template_edit,
// publish_template_version); these mirror them and add the builder's own rules:
//   * admins add narrative, additional-number and founder-pulse sections, each with its own field types;
//   * keys are lower-case slugs, unique in the version and never a built-in key; a key used by an earlier
//     (published or archived) version keeps its type, because answers are stored per key across months;
//   * picklists and tags need options, ratings a whole-number scale, and number limits must agree;
//   * system fields keep their key, type, "required" flag and section: their label, help text, order and
//     number limits can change (BRD B26: limits set in the template apply to the core figures too).

import { FIELD_TYPE_LABELS, SYSTEM_FIELD_KEYS, type SystemFieldKey } from "@/lib/constants";
import { formatNumberTrimmed } from "@/lib/format";
import { MONTH_NAMES_SHORT, addMonths, monthLabel, parseMonthKey, parseMonthParts } from "@/lib/periods";
import type { Json } from "@/lib/supabase/database.types";
import { parseFieldOptions, parseFieldValidation } from "@/lib/types/domain";
import type { FieldType, SectionKind } from "@/lib/types/enums";

// ---------------------------------------------------------------------------------------------
// Section kinds and field types
// ---------------------------------------------------------------------------------------------

/** Section kinds an admin can add (the three system sections come with every template). */
export const ADDABLE_SECTION_KINDS = ["narrative", "custom_numbers", "pulse"] as const;
export type AddableSectionKind = (typeof ADDABLE_SECTION_KINDS)[number];

/** Financials, Headcount and Company KPIs: one each per version, never deleted (index + guard trigger). */
export const REQUIRED_SECTION_KINDS = ["financials", "headcount", "kpis"] as const;

/** What each addable kind is for (section dialog). */
export const SECTION_KIND_HELP: Record<AddableSectionKind, string> = {
  narrative:
    "Optional written updates, one C4 category per section. The C4 export uses the section title as its row name.",
  custom_numbers: "Extra monthly figures, such as customer numbers or unit economics.",
  pulse: "A short founder check-in: ratings, goals and requests for help.",
};

/**
 * Section kinds the C4 export turns into rows: the narrative sections (the C4 categories), then the
 * founder pulse (src/lib/exports/c4-workbook.ts). Rows are matched by section title, not key
 * (docs/ARCHITECTURE.md §3), and each month fills them from the version it was opened with, so a renamed
 * section reports earlier months and later months in separate rows.
 */
export const C4_ROW_SECTION_KINDS: readonly SectionKind[] = ["narrative", "pulse"];

export function isC4RowKind(kind: SectionKind): boolean {
  return C4_ROW_SECTION_KINDS.includes(kind);
}

/**
 * A section title as the C4 export matches it: capitals and spacing do not count. Mirrors titleId in
 * src/lib/exports/c4-workbook.ts, which this client-safe module cannot import (it loads ExcelJS).
 */
export function c4RowName(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The note under a section's title in the edit dialog: a narrative or founder-pulse title names a C4 row.
 * `publishedTitle` is the section's title in the published version, which months already opened report
 * under (null when the section is new in the draft). Null for other kinds.
 */
export function c4TitleHint(kind: SectionKind, publishedTitle: string | null): string | null {
  if (!isC4RowKind(kind)) return null;
  const hint = "The C4 export uses this title as its row name.";
  if (publishedTitle === null || publishedTitle.trim() === "") return hint;
  return `${hint} Months already opened stay in the “${publishedTitle.trim()}” row, so a new title starts a separate row for months opened after you publish.`;
}

/**
 * Field types admins may add to each section kind. System sections take no new fields: Financials and
 * Headcount hold the built-in figures and Company KPIs lists each company's own KPIs.
 */
export const FIELD_TYPES_BY_SECTION_KIND: Record<SectionKind, readonly FieldType[]> = {
  financials: [],
  headcount: [],
  kpis: [],
  custom_numbers: ["currency", "number", "integer", "percent"],
  narrative: ["long_text", "text", "picklist", "tags", "boolean", "rating"],
  pulse: ["rating", "long_text", "tags", "picklist"],
};

/** Plain names of the section kinds, for sentences (SECTION_KIND_LABELS in constants are badge labels). */
export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
  financials: "Financials",
  headcount: "Headcount",
  kpis: "Company KPIs",
  custom_numbers: "Additional numbers",
  narrative: "Narrative",
  pulse: "Founder pulse",
};

export function allowedFieldTypes(kind: SectionKind): readonly FieldType[] {
  return FIELD_TYPES_BY_SECTION_KIND[kind] ?? [];
}

export function sectionAcceptsFields(kind: SectionKind): boolean {
  return allowedFieldTypes(kind).length > 0;
}

export function isSystemSectionKind(kind: SectionKind): boolean {
  return (REQUIRED_SECTION_KINDS as readonly string[]).includes(kind);
}

export function isAddableSectionKind(kind: string): kind is AddableSectionKind {
  return (ADDABLE_SECTION_KINDS as readonly string[]).includes(kind);
}

/** Types entered as a figure in a text box (the number rules and min/max apply). */
export const NUMBER_INPUT_TYPES: readonly FieldType[] = ["currency", "number", "integer", "percent"];
/** Types entered as free text (a maximum length applies). */
export const TEXT_INPUT_TYPES: readonly FieldType[] = ["text", "long_text"];
/** Types with a list of options. */
export const CHOICE_TYPES: readonly FieldType[] = ["picklist", "tags"];

export function isNumberInputType(type: FieldType): boolean {
  return NUMBER_INPUT_TYPES.includes(type);
}

export function isTextInputType(type: FieldType): boolean {
  return TEXT_INPUT_TYPES.includes(type);
}

export function isChoiceType(type: FieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

// ---------------------------------------------------------------------------------------------
// System fields (mirror of private.system_fields())
// ---------------------------------------------------------------------------------------------

export type SystemFieldRule = { type: FieldType; sectionKind: SectionKind; nonNegative: boolean };

/** The seven built-in figures: their type, the section kind they live in and whether they may be negative. */
export const SYSTEM_FIELD_RULES: Record<SystemFieldKey, SystemFieldRule> = {
  revenue_total: { type: "currency", sectionKind: "financials", nonNegative: true },
  gross_profit: { type: "currency", sectionKind: "financials", nonNegative: false },
  net_profit: { type: "currency", sectionKind: "financials", nonNegative: false },
  cash_in_bank: { type: "currency", sectionKind: "financials", nonNegative: true },
  burn_rate: { type: "currency", sectionKind: "financials", nonNegative: true },
  headcount_ft: { type: "integer", sectionKind: "headcount", nonNegative: true },
  headcount_pt: { type: "integer", sectionKind: "headcount", nonNegative: true },
};

export function isSystemFieldKey(key: string): key is SystemFieldKey {
  return (SYSTEM_FIELD_KEYS as readonly string[]).includes(key);
}

/** Tooltip of the lock icon on system fields and sections. */
export const SYSTEM_FIELD_TOOLTIP = "System field - used in calculations";
export const SYSTEM_SECTION_TOOLTIP = "System section - always part of the form";

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

/** `template_sections.key` / `template_fields.key` check constraint. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
export const KEY_MAX_LENGTH = 63;

/**
 * A key from a label: lower-case ASCII letters, digits and single underscores, starting with a letter
 * ("Customer acquisition cost (CAC)" → "customer_acquisition_cost_cac"). Accents are dropped and "&"
 * reads "and". Labels without a leading letter get `fallback` in front ("2027 plan" → "field_2027_plan").
 */
export function slugifyKey(text: string, fallback = "field"): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = /^[a-z]/.test(slug) ? slug : slug ? `${fallback}_${slug}` : fallback;
  return base.slice(0, KEY_MAX_LENGTH).replace(/_+$/g, "") || fallback;
}

/** `base`, or `base_2`, `base_3`, … — the first one not in `taken` (always within 63 characters). */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KEY_MAX_LENGTH - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Why a key is malformed, or null. */
export function keyFormatError(key: string): string | null {
  if (key === "") return "Enter a key.";
  if (key.length > KEY_MAX_LENGTH) return `Keys can be at most ${KEY_MAX_LENGTH} characters.`;
  if (!/^[a-z]/.test(key)) return "Start the key with a lower-case letter.";
  if (!KEY_PATTERN.test(key)) return "Use only lower-case letters, numbers and underscores.";
  return null;
}

/** A field of an earlier (published or archived) version of the same template. */
export type LockedField = { field_type: FieldType; label: string; version_no: number };

/**
 * The key suggested for a new field: the label's slug, made unique against the version's keys, the
 * built-in keys and the keys earlier versions used for another type.
 */
export function suggestFieldKey(
  label: string,
  context: { versionKeys: Iterable<string>; lockedFields: Readonly<Record<string, LockedField>>; fieldType: FieldType },
): string {
  const taken = new Set<string>([...context.versionKeys, ...SYSTEM_FIELD_KEYS]);
  for (const [key, locked] of Object.entries(context.lockedFields)) {
    if (locked.field_type !== context.fieldType) taken.add(key);
  }
  return uniqueKey(slugifyKey(label, "field"), taken);
}

/** The key of a new section: the title's slug, unique in the version. */
export function suggestSectionKey(title: string, versionKeys: Iterable<string>): string {
  return uniqueKey(slugifyKey(title, "section"), versionKeys);
}

// ---------------------------------------------------------------------------------------------
// Options (picklist / tags / rating)
// ---------------------------------------------------------------------------------------------

export const MAX_CHOICES = 100;
export const MAX_CHOICE_LENGTH = 200;
export const RATING_LOWEST = 0;
export const RATING_HIGHEST = 10;
export const MAX_RATING_LABEL_LENGTH = 60;

/** Options typed one per line: trimmed, blank lines dropped. */
export function parseChoiceLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Why a picklist or tag list is not usable, or null. */
export function choicesError(choices: readonly string[], type: FieldType): string | null {
  const noun = type === "tags" ? "tag" : "option";
  if (choices.length === 0) return `Add at least one ${noun}, one per line.`;
  if (choices.length > MAX_CHOICES) return `Use at most ${MAX_CHOICES} ${noun}s.`;
  const tooLong = choices.find((choice) => choice.length > MAX_CHOICE_LENGTH);
  if (tooLong) return `Keep each ${noun} to ${MAX_CHOICE_LENGTH} characters or fewer.`;
  const seen = new Set<string>();
  for (const choice of choices) {
    const normalised = choice.toLocaleLowerCase("en-GB");
    if (seen.has(normalised)) return `“${choice}” is listed more than once.`;
    seen.add(normalised);
  }
  return null;
}

export type RatingScale = { min: number; max: number; labels: Record<string, string> };

export type RatingErrors = Partial<Record<"rating.min" | "rating.max" | "rating.labels", string>>;

/** Problems with a rating scale: whole numbers from 0 to 10, highest above lowest, short labels. */
export function ratingErrors(scale: RatingScale): RatingErrors {
  const errors: RatingErrors = {};
  const { min, max } = scale;
  if (!Number.isInteger(min) || min < RATING_LOWEST || min > RATING_HIGHEST) {
    errors["rating.min"] = `Enter a whole number from ${RATING_LOWEST} to ${RATING_HIGHEST}.`;
  }
  if (!Number.isInteger(max) || max < RATING_LOWEST || max > RATING_HIGHEST) {
    errors["rating.max"] = `Enter a whole number from ${RATING_LOWEST} to ${RATING_HIGHEST}.`;
  } else if (errors["rating.min"] === undefined && max <= min) {
    errors["rating.max"] = "The highest value must be above the lowest.";
  }
  if (Object.values(scale.labels).some((label) => label.trim().length > MAX_RATING_LABEL_LENGTH)) {
    errors["rating.labels"] = `Keep each label to ${MAX_RATING_LABEL_LENGTH} characters or fewer.`;
  }
  return errors;
}

/** The labels that belong on a scale: trimmed, non-empty, for whole values from min to max. */
export function ratingLabelsWithin(scale: RatingScale): Record<string, string> {
  const labels: Record<string, string> = {};
  for (let value = scale.min; value <= scale.max; value++) {
    const label = scale.labels[String(value)]?.trim();
    if (label) labels[String(value)] = label;
  }
  return labels;
}

/**
 * `template_fields.options` for a field (§2.2): picklist/tags `{"options": [...]}`, rating
 * `{"min", "max", "labels"?}`; null for other types.
 */
export function buildFieldOptions(
  type: FieldType,
  input: { choices: readonly string[]; rating: RatingScale | null },
): Json | null {
  if (isChoiceType(type)) return { options: [...input.choices] };
  if (type === "rating") {
    const scale = input.rating ?? { min: 1, max: 5, labels: {} };
    const labels = ratingLabelsWithin(scale);
    return Object.keys(labels).length > 0
      ? { min: scale.min, max: scale.max, labels }
      : { min: scale.min, max: scale.max };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Validation settings (template_fields.validation)
// ---------------------------------------------------------------------------------------------

/** Largest magnitude the database stores for a value (save_submission_values: |value| < 1e15). */
export const MAX_NUMBER_MAGNITUDE = 1e15;
/** The database's default maximum text length (save_submission_values). */
export const DEFAULT_MAX_TEXT_LENGTH = 20000;

/** The limits an admin edits; null = not set. */
export type FieldRulesDraft = {
  allow_negative: boolean;
  min: number | null;
  max: number | null;
  max_length: number | null;
};

export type RuleErrors = Partial<Record<"validation.min" | "validation.max" | "validation.max_length", string>>;

/** Whether a number field refuses negative values (validation §2.6: system rule, allow_negative or min 0). */
export function refusesNegatives(key: string, rules: Pick<FieldRulesDraft, "allow_negative" | "min">): boolean {
  if (isSystemFieldKey(key) && SYSTEM_FIELD_RULES[key].nonNegative) return true;
  return rules.allow_negative === false || rules.min === 0;
}

/** Problems with number limits (`nonNegative`: the field refuses negative values). */
export function numberRuleErrors(
  rules: Pick<FieldRulesDraft, "min" | "max">,
  options: { nonNegative: boolean },
): RuleErrors {
  const errors: RuleErrors = {};
  const tooLarge = (n: number) => !Number.isFinite(n) || Math.abs(n) >= MAX_NUMBER_MAGNITUDE;
  if (rules.min !== null) {
    if (tooLarge(rules.min)) errors["validation.min"] = "Enter a smaller number.";
    else if (options.nonNegative && rules.min < 0) {
      errors["validation.min"] = "The minimum can't be below 0, because negative values aren't allowed.";
    }
  }
  if (rules.max !== null) {
    if (tooLarge(rules.max)) errors["validation.max"] = "Enter a smaller number.";
    else if (options.nonNegative && rules.max < 0) {
      errors["validation.max"] = "The maximum can't be below 0, because negative values aren't allowed.";
    } else if (rules.min !== null && errors["validation.min"] === undefined && rules.max < rules.min) {
      errors["validation.max"] = "The maximum must be at least the minimum.";
    }
  }
  return errors;
}

/** Problems with a maximum text length (whole number from 1 to 20,000). */
export function maxLengthError(maxLength: number | null): string | null {
  if (maxLength === null) return null;
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > DEFAULT_MAX_TEXT_LENGTH) {
    return `Enter a whole number from 1 to ${formatNumberTrimmed(DEFAULT_MAX_TEXT_LENGTH, 0)}.`;
  }
  return null;
}

/**
 * `template_fields.validation` for a field (§2.2): number fields `{"allow_negative"?, "min"?, "max"?}`,
 * text fields `{"max_length"}`; null when nothing is set. `allow_negative` is stored for every custom
 * number field and for the system figures that may be negative (gross and net profit); the other system
 * figures are never negative whatever the setting, so it is left out for them.
 */
export function buildFieldValidation(key: string, type: FieldType, rules: FieldRulesDraft): Json | null {
  if (isNumberInputType(type)) {
    const out: { [name: string]: Json } = {};
    const fixedNonNegative = isSystemFieldKey(key) && SYSTEM_FIELD_RULES[key].nonNegative;
    if (!fixedNonNegative) out.allow_negative = rules.allow_negative;
    if (rules.min !== null) out.min = rules.min;
    if (rules.max !== null) out.max = rules.max;
    return Object.keys(out).length > 0 ? out : null;
  }
  if (isTextInputType(type) && rules.max_length !== null) return { max_length: rules.max_length };
  return null;
}

/**
 * The editable limits of a stored field, as the database reads them: negatives are allowed unless the
 * field is a non-negative system figure or `allow_negative` is false (a minimum of 0 is kept as the
 * minimum). New fields start from NEW_FIELD_RULES instead.
 */
export function rulesFromField(field: { key: string; field_type: FieldType; validation: Json | null }): FieldRulesDraft {
  const parsed = parseFieldValidation(field.validation);
  const fixedNonNegative = isSystemFieldKey(field.key) && SYSTEM_FIELD_RULES[field.key].nonNegative;
  return {
    allow_negative: !fixedNonNegative && parsed?.allow_negative !== false,
    min: parsed?.min ?? null,
    max: parsed?.max ?? null,
    max_length: parsed?.max_length ?? null,
  };
}

/** Limits of a new field: negative figures refused until the admin allows them, nothing else set. */
export const NEW_FIELD_RULES: FieldRulesDraft = { allow_negative: false, min: null, max: null, max_length: null };

// ---------------------------------------------------------------------------------------------
// Field drafts (the field dialog → addField / updateField actions)
// ---------------------------------------------------------------------------------------------

/** A field as the dialog sends it (strings trimmed; numbers parsed; settings of other types ignored). */
export type FieldDraft = {
  label: string;
  key: string;
  field_type: FieldType;
  is_required: boolean;
  help_text: string;
  choices: string[];
  rating: RatingScale | null;
  validation: FieldRulesDraft;
};

export type FieldErrorKey =
  | "label"
  | "key"
  | "field_type"
  | "help_text"
  | "choices"
  | "rating.min"
  | "rating.max"
  | "rating.labels"
  | "validation.min"
  | "validation.max"
  | "validation.max_length";

export type FieldErrors = Partial<Record<FieldErrorKey, string>>;

export const MAX_LABEL_LENGTH = 200;
export const MAX_HELP_LENGTH = 1000;
export const MAX_SECTION_TITLE_LENGTH = 120;
export const MAX_SECTION_DESCRIPTION_LENGTH = 1000;
export const MAX_NOTES_LENGTH = 2000;

export type FieldDraftContext = {
  /** Kind of the section the field is (or will be) in. */
  sectionKind: SectionKind;
  /** Keys of the version's other fields (not the one being edited). */
  otherKeys: Iterable<string>;
  /** Fields of earlier published or archived versions of the template, by key. */
  lockedFields: Readonly<Record<string, LockedField>>;
  /** The stored field when editing; null when adding. */
  existing: { key: string; field_type: FieldType; is_system: boolean } | null;
};

function labelErrors(draft: Pick<FieldDraft, "label" | "help_text">): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.label.trim() === "") errors.label = "Enter a label.";
  else if (draft.label.length > MAX_LABEL_LENGTH) errors.label = `Keep the label to ${MAX_LABEL_LENGTH} characters or fewer.`;
  if (draft.help_text.length > MAX_HELP_LENGTH) {
    errors.help_text = `Keep the help text to ${formatNumberTrimmed(MAX_HELP_LENGTH, 0)} characters or fewer.`;
  }
  return errors;
}

/**
 * Checks a field draft against the builder's rules. Returns the problems by input (empty = valid).
 * System fields only take a label, help text and number limits (their key, type, "required" flag and
 * section never change), so only those are checked for them.
 */
export function validateFieldDraft(draft: FieldDraft, context: FieldDraftContext): FieldErrors {
  const errors: FieldErrors = labelErrors(draft);
  const existing = context.existing;

  if (existing?.is_system) {
    if (isSystemFieldKey(existing.key)) {
      Object.assign(
        errors,
        numberRuleErrors(draft.validation, { nonNegative: refusesNegatives(existing.key, draft.validation) }),
      );
    }
    return errors;
  }

  // Key
  const locked = context.lockedFields;
  const keyLocked = existing !== null && Object.hasOwn(locked, existing.key);
  const formatError = keyFormatError(draft.key);
  if (keyLocked && draft.key !== existing.key) {
    errors.key = "This key can't change: earlier versions stored answers under it.";
  } else if (formatError) {
    errors.key = formatError;
  } else if (isSystemFieldKey(draft.key)) {
    errors.key = `“${draft.key}” is reserved for a built-in field. Choose another key.`;
  } else if (new Set(context.otherKeys).has(draft.key)) {
    errors.key = "Another field in this version already uses this key.";
  }

  // Type
  const allowed = allowedFieldTypes(context.sectionKind);
  const lockedType = Object.hasOwn(locked, draft.key) ? locked[draft.key] : undefined;
  if (!allowed.includes(draft.field_type)) {
    errors.field_type =
      allowed.length === 0
        ? "Fields can't be added to this section."
        : `${FIELD_TYPE_LABELS[draft.field_type]} fields can't be used in ${SECTION_KIND_NAMES[context.sectionKind].toLowerCase()} sections.`;
  } else if (lockedType && lockedType.field_type !== draft.field_type && errors.key === undefined) {
    if (keyLocked) {
      errors.field_type = `Earlier months stored answers to this field as ${FIELD_TYPE_LABELS[lockedType.field_type].toLowerCase()}, so its type can't change. Add a new field instead.`;
    } else {
      errors.key = `Version ${lockedType.version_no} used this key for “${lockedType.label}” (${FIELD_TYPE_LABELS[lockedType.field_type].toLowerCase()}). Choose another key or use that type.`;
    }
  }

  // Type-specific settings
  if (isChoiceType(draft.field_type)) {
    const error = choicesError(draft.choices, draft.field_type);
    if (error) errors.choices = error;
  } else if (draft.field_type === "rating") {
    Object.assign(errors, ratingErrors(draft.rating ?? { min: 1, max: 5, labels: {} }));
  } else if (isNumberInputType(draft.field_type)) {
    Object.assign(errors, numberRuleErrors(draft.validation, { nonNegative: refusesNegatives(draft.key, draft.validation) }));
  } else if (isTextInputType(draft.field_type)) {
    const error = maxLengthError(draft.validation.max_length);
    if (error) errors["validation.max_length"] = error;
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

export type Orderable = { id: string; key: string; sort_order: number };

/** Template order: `sort_order`, then key, then id (as the data layer and the form sort). */
export function sortByTemplateOrder<T extends Orderable>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** `ids` with `id` moved one place up or down; null when it cannot move (first/last or unknown). */
export function moveId(ids: readonly string[], id: string, direction: "up" | "down"): string[] | null {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** `ids` with `id` placed right after `afterId` (null = first). An unknown `afterId` places it last. */
export function placeAfter(ids: readonly string[], id: string, afterId: string | null): string[] {
  const rest = ids.filter((item) => item !== id);
  if (afterId === null) return [id, ...rest];
  const index = rest.indexOf(afterId);
  if (index === -1) return [...rest, id];
  return [...rest.slice(0, index + 1), id, ...rest.slice(index + 1)];
}

/**
 * Where a new section goes by default (the id of the section to place it after; null = at the end):
 * narrative sections after the last narrative section (so before the founder pulse), additional
 * numbers after the last number section (Financials, Headcount, Company KPIs or additional numbers),
 * founder pulse sections at the end. `sections` are in template order.
 */
export function defaultPlacement(
  kind: AddableSectionKind,
  sections: readonly { id: string; kind: SectionKind }[],
): string | null {
  const lastOf = (kinds: readonly SectionKind[]): string | null => {
    for (let index = sections.length - 1; index >= 0; index--) {
      if (kinds.includes(sections[index].kind)) return sections[index].id;
    }
    return null;
  };
  const numbers: SectionKind[] = ["financials", "headcount", "kpis", "custom_numbers"];
  if (kind === "narrative") return lastOf(["narrative"]) ?? lastOf(numbers);
  if (kind === "custom_numbers") return lastOf(numbers);
  return null;
}

/**
 * The `sort_order` updates that put `rows` in the order of `orderedIds`: positions 1…n, listing only
 * the rows whose value changes (a swap of neighbours numbered 1…n is two updates). Ids missing from
 * `orderedIds` keep their place after the listed ones.
 */
export function planSortOrders(
  rows: readonly { id: string; sort_order: number }[],
  orderedIds: readonly string[],
): { id: string; sort_order: number }[] {
  const current = new Map(rows.map((row) => [row.id, row.sort_order]));
  const order = [...orderedIds.filter((id) => current.has(id)), ...rows.map((row) => row.id).filter((id) => !orderedIds.includes(id))];
  const updates: { id: string; sort_order: number }[] = [];
  order.forEach((id, index) => {
    if (current.get(id) !== index + 1) updates.push({ id, sort_order: index + 1 });
  });
  return updates;
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

export type ComparableField = {
  key: string;
  label: string;
  help_text: string | null;
  field_type: FieldType;
  is_required: boolean;
  is_system: boolean;
  options: Json | null;
  validation: Json | null;
  sort_order: number;
};

export type ComparableSection = {
  key: string;
  title: string;
  description: string | null;
  kind: SectionKind;
  sort_order: number;
  fields: readonly ComparableField[];
};

export type ComparableVersion = { sections: readonly ComparableSection[] };

export type ReadinessIssue = { level: "error" | "warning"; message: string };

function byOrderThenKey<T extends { key: string; sort_order: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * What stands between a draft and publishing it. Errors block publishing: the database's own rules
 * (the Financials, Headcount and Company KPIs sections and the seven built-in figures with their types,
 * publish_template_version) and settings the monthly form could not use (a picklist or tag field
 * without options, a rating scale whose highest value is not above its lowest, a minimum above the
 * maximum). Warnings do not block: sections without fields, field types that do not belong to their
 * section and, given the published version the draft replaces (`base`), renamed narrative and
 * founder-pulse sections, whose earlier months stay in another C4 row (renamedC4Sections).
 */
export function checkPublishReadiness(version: ComparableVersion, base: ComparableVersion | null = null): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const sections = byOrderThenKey(version.sections);

  for (const kind of REQUIRED_SECTION_KINDS) {
    if (!sections.some((section) => section.kind === kind)) {
      issues.push({ level: "error", message: `The ${SECTION_KIND_NAMES[kind]} section is missing. Every version needs it.` });
    }
  }

  const fields = sections.flatMap((section) => section.fields.map((field) => ({ field, section })));
  for (const key of SYSTEM_FIELD_KEYS) {
    const rule = SYSTEM_FIELD_RULES[key];
    const found = fields.find(({ field }) => field.key === key);
    if (!found || !found.field.is_system || found.field.field_type !== rule.type) {
      issues.push({
        level: "error",
        message: `The built-in field “${key}” (${FIELD_TYPE_LABELS[rule.type].toLowerCase()}) is missing.`,
      });
    }
  }

  for (const section of sections) {
    const sectionFields = byOrderThenKey(section.fields);
    if (sectionFields.length === 0 && sectionAcceptsFields(section.kind)) {
      issues.push({ level: "warning", message: `“${section.title}” has no fields yet.` });
    }
    for (const field of sectionFields) {
      if (isChoiceType(field.field_type) && parseFieldOptions(field).choices.length === 0) {
        issues.push({
          level: "error",
          message: `“${field.label}” needs at least one ${field.field_type === "tags" ? "tag" : "option"}.`,
        });
      }
      if (field.field_type === "rating") {
        const rating = parseFieldOptions(field).rating;
        if (rating && !(Number.isInteger(rating.min) && Number.isInteger(rating.max) && rating.max > rating.min)) {
          issues.push({ level: "error", message: `“${field.label}” needs a rating scale whose highest value is above its lowest.` });
        }
      }
      const rules = parseFieldValidation(field.validation);
      if (rules?.min !== undefined && rules.max !== undefined && rules.max < rules.min) {
        issues.push({ level: "error", message: `“${field.label}” has a minimum above its maximum.` });
      }
      if (!field.is_system && !allowedFieldTypes(section.kind).includes(field.field_type)) {
        issues.push({
          level: "warning",
          message: `“${field.label}” is a ${FIELD_TYPE_LABELS[field.field_type].toLowerCase()} field in the ${SECTION_KIND_NAMES[section.kind].toLowerCase()} section “${section.title}”.`,
        });
      }
    }
  }

  if (base) {
    for (const rename of renamedC4Sections(base, version)) {
      issues.push({
        level: "warning",
        message: `Renamed “${rename.from}” to “${rename.to}”: the C4 export will show earlier months and months opened with this version in separate rows.`,
      });
    }
  }
  return issues;
}

/** The message a refused publish shows for the blocking issues (null when there are none). */
export function blockingMessage(issues: readonly ReadinessIssue[]): string | null {
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length === 0) return null;
  if (errors.length === 1) return errors[0].message;
  return `Please fix ${errors.length} issues before publishing, starting with: ${errors[0].message}`;
}

// ---------------------------------------------------------------------------------------------
// Changes between two versions
// ---------------------------------------------------------------------------------------------

export type TemplateChange = { type: "added" | "removed" | "changed" | "reordered"; text: string };

/** JSON with sorted object keys (so key order never counts as a change); `{}` and `[]` read as null. */
function stableJson(value: Json | null | undefined, top = true): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    if (top && value.length === 0) return "null";
    return `[${value.map((item) => stableJson(item, false)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    if (top && keys.length === 0) return "null";
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key], false)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function fieldCountNote(count: number): string {
  return count === 0 ? "" : ` (${count} field${count === 1 ? "" : "s"})`;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * What changed from `base` to `next`, in form order: sections added, removed, renamed, re-described
 * or reordered; fields added, removed, moved, renamed or changed (type, required, help text, options,
 * limits) and reordered within a section. Fields of an added or removed section are summarised with
 * the section. Items are matched by key, which never changes once published.
 */
export function diffTemplateVersions(base: ComparableVersion, next: ComparableVersion): TemplateChange[] {
  const changes: TemplateChange[] = [];
  const baseSections = byOrderThenKey(base.sections);
  const nextSections = byOrderThenKey(next.sections);
  const baseByKey = new Map(baseSections.map((section) => [section.key, section]));
  const nextByKey = new Map(nextSections.map((section) => [section.key, section]));

  // Sections
  for (const section of nextSections) {
    const before = baseByKey.get(section.key);
    if (!before) {
      changes.push({ type: "added", text: `Added section “${section.title}”${fieldCountNote(section.fields.length)}` });
      continue;
    }
    if (before.title !== section.title) {
      changes.push({ type: "changed", text: `Renamed section “${before.title}” to “${section.title}”` });
    }
    if (!sameText(before.description, section.description)) {
      changes.push({ type: "changed", text: `Changed the description of “${section.title}”` });
    }
    if (before.kind !== section.kind) {
      changes.push({
        type: "changed",
        text: `Changed “${section.title}” from ${SECTION_KIND_NAMES[before.kind].toLowerCase()} to ${SECTION_KIND_NAMES[section.kind].toLowerCase()}`,
      });
    }
  }
  for (const section of baseSections) {
    if (!nextByKey.has(section.key)) {
      changes.push({ type: "removed", text: `Removed section “${section.title}”${fieldCountNote(section.fields.length)}` });
    }
  }
  const commonBefore = baseSections.filter((s) => nextByKey.has(s.key)).map((s) => s.key);
  const commonAfter = nextSections.filter((s) => baseByKey.has(s.key)).map((s) => s.key);
  if (!sameOrder(commonBefore, commonAfter)) changes.push({ type: "reordered", text: "Changed the order of the sections" });

  // Fields
  type Located = { field: ComparableField; sectionKey: string };
  const locate = (sections: readonly ComparableSection[]) => {
    const map = new Map<string, Located>();
    for (const section of sections) for (const field of section.fields) map.set(field.key, { field, sectionKey: section.key });
    return map;
  };
  const baseFields = locate(baseSections);
  const nextFields = locate(nextSections);

  for (const section of nextSections) {
    const before = baseByKey.get(section.key);
    if (!before) continue; // summarised with the added section
    const fields = byOrderThenKey(section.fields);
    for (const field of fields) {
      const old = baseFields.get(field.key);
      if (!old) {
        changes.push({ type: "added", text: `Added field “${field.label}” to “${section.title}”` });
        continue;
      }
      if (old.sectionKey !== section.key) {
        changes.push({ type: "changed", text: `Moved “${field.label}” to “${section.title}”` });
      }
      if (old.field.label !== field.label) {
        changes.push({ type: "changed", text: `Renamed field “${old.field.label}” to “${field.label}”` });
      }
      const details: string[] = [];
      if (old.field.field_type !== field.field_type) {
        details.push(
          `type (${FIELD_TYPE_LABELS[old.field.field_type].toLowerCase()} to ${FIELD_TYPE_LABELS[field.field_type].toLowerCase()})`,
        );
      }
      if (old.field.is_required !== field.is_required) details.push(field.is_required ? "now required" : "now optional");
      if (!sameText(old.field.help_text, field.help_text)) details.push("help text");
      if (stableJson(old.field.options) !== stableJson(field.options)) {
        details.push(field.field_type === "rating" ? "rating scale" : "options");
      }
      if (stableJson(old.field.validation) !== stableJson(field.validation)) details.push("limits");
      if (details.length > 0) changes.push({ type: "changed", text: `Changed “${field.label}”: ${details.join(", ")}` });
    }
    for (const field of byOrderThenKey(before.fields)) {
      if (!nextFields.has(field.key)) {
        changes.push({ type: "removed", text: `Removed field “${field.label}” from “${section.title}”` });
      }
    }
    const orderBefore = byOrderThenKey(before.fields)
      .filter((f) => nextFields.get(f.key)?.sectionKey === section.key)
      .map((f) => f.key);
    const orderAfter = fields.filter((f) => baseFields.get(f.key)?.sectionKey === section.key).map((f) => f.key);
    if (!sameOrder(orderBefore, orderAfter)) {
      changes.push({ type: "reordered", text: `Changed the order of the fields in “${section.title}”` });
    }
  }
  // Fields of a removed section that now sit in an added section are reported as moved.
  for (const section of nextSections) {
    if (baseByKey.has(section.key)) continue;
    for (const field of byOrderThenKey(section.fields)) {
      const old = baseFields.get(field.key);
      if (old && old.sectionKey !== section.key) {
        changes.push({ type: "changed", text: `Moved “${field.label}” to “${section.title}”` });
      }
    }
  }
  return changes;
}

/**
 * Narrative and founder-pulse sections (matched by key, in form order) whose title in `next` names
 * another C4 row than in `base`: months opened with `base` stay in the row of the old title and months
 * opened with `next` go in the row of the new one. Changes of capitals or spacing alone do not count.
 */
export function renamedC4Sections(
  base: ComparableVersion,
  next: ComparableVersion,
): { key: string; from: string; to: string }[] {
  const baseByKey = new Map(base.sections.map((section) => [section.key, section]));
  return byOrderThenKey(next.sections).flatMap((section) => {
    const before = baseByKey.get(section.key);
    if (!before || !isC4RowKind(before.kind) || !isC4RowKind(section.kind)) return [];
    if (c4RowName(before.title) === c4RowName(section.title)) return [];
    return [{ key: section.key, from: before.title.trim(), to: section.title.trim() }];
  });
}

// ---------------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------------

/**
 * Months as short ranges: ['2026-07-01', '2026-08-01', '2026-09-01'] → 'Jul–Sep 2026';
 * across years 'Nov 2026 – Feb 2027'; gaps separate ranges ('Jan–Jun 2026, Oct 2026'); beyond
 * `maxRanges` ranges: '…, and 2 more'. Malformed months are ignored; no months → ''.
 */
export function summariseMonths(months: readonly string[], maxRanges = 3): string {
  const keys = [...new Set(months.map((month) => parseMonthKey(month)).filter((key): key is string => key !== null))].sort();
  const runs: [string, string][] = [];
  for (const key of keys) {
    const last = runs[runs.length - 1];
    if (last && addMonths(last[1], 1) === key) last[1] = key;
    else runs.push([key, key]);
  }
  const labels = runs.map(([from, to]) => {
    if (from === to) return monthLabel(from);
    const a = parseMonthParts(from);
    const b = parseMonthParts(to);
    if (a.year === b.year) return `${MONTH_NAMES_SHORT[a.month - 1]}–${MONTH_NAMES_SHORT[b.month - 1]} ${a.year}`;
    return `${monthLabel(from)} – ${monthLabel(to)}`;
  });
  if (labels.length <= maxRanges) return labels.join(", ");
  return `${labels.slice(0, maxRanges).join(", ")} and ${labels.length - maxRanges} more`;
}

/** Short notes on a field's settings for the field list, e.g. ['6 options'], ['Scale 1–5'], ['No negatives', 'Max 100']. */
export function fieldSettingsSummary(field: {
  key: string;
  field_type: FieldType;
  options: Json | null;
  validation: Json | null;
}): string[] {
  const notes: string[] = [];
  if (isChoiceType(field.field_type)) {
    const count = parseFieldOptions(field).choices.length;
    const noun = field.field_type === "tags" ? "tag" : "option";
    notes.push(count === 0 ? `No ${noun}s yet` : `${count} ${noun}${count === 1 ? "" : "s"}`);
  } else if (field.field_type === "rating") {
    const rating = parseFieldOptions(field).rating;
    if (rating) notes.push(`Scale ${formatNumberTrimmed(rating.min, 0)}–${formatNumberTrimmed(rating.max, 0)}`);
  } else if (isNumberInputType(field.field_type)) {
    const rules = rulesFromField(field);
    if (refusesNegatives(field.key, rules)) notes.push("No negatives");
    const show = (n: number) => formatNumberTrimmed(n, 4);
    if (rules.min !== null && rules.max !== null) notes.push(`${show(rules.min)} to ${show(rules.max)}`);
    else if (rules.min !== null && rules.min !== 0) notes.push(`Min ${show(rules.min)}`);
    else if (rules.max !== null) notes.push(`Max ${show(rules.max)}`);
  } else if (isTextInputType(field.field_type)) {
    const maxLength = parseFieldValidation(field.validation)?.max_length;
    if (maxLength !== undefined) notes.push(`Max ${formatNumberTrimmed(maxLength, 0)} characters`);
  }
  return notes;
}
