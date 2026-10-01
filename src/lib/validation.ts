// Client-side mirror of the submission validation rules (docs/ARCHITECTURE.md §2.6 rules 1–5) for instant
// feedback in the monthly form. The SQL function `private.validate_submission()` (exposed through
// `get_submission_validation`, supabase/migrations/20260930000500_rpc.sql) is the source of truth and also
// enforces rule 6 (`prior_months`). For the values the database can store, validateSubmissionDraft returns
// exactly what the server returns (same targets, codes, messages and order) minus `prior_months`.
//
// Order (as in SQL): the seven system numbers in their fixed order (revenue_total, gross_profit, net_profit,
// cash_in_bank, burn_rate, headcount_ft, headcount_pt), the active company revenue segments, the revenue sum
// check, the active ScaleUp revenue lines (BRD B30), the other template fields in template order, then the
// KPI cells.
// Messages are plain British English and name the field, e.g. "Gross profit is required.",
// "Revenue for Retail is required." or
// "Total revenue (10,000.00) must equal the sum of your revenue segments (9,500.00)."
// Targets follow §2.5 (src/lib/targets.ts).

import {
  HEADCOUNT_FIELD_KEYS,
  NON_NEGATIVE_FIELD_KEYS,
  NUMBER_FIELD_TYPES,
  NUMBER_KPI_VALUE_TYPES,
  REVENUE_SUM_TOLERANCE,
  SYSTEM_FIELD_KEYS,
  type RevenueSegmentKind,
} from "@/lib/constants";
import { formatNumber, formatNumberTrimmed, toFiniteNumber } from "@/lib/format";
import { isHalfEnd } from "@/lib/periods";
import { fieldTarget, kpiCellKey, kpiTarget, segmentTarget } from "@/lib/targets";
import type { FieldType, KpiFrequency, KpiValueType, SectionKind } from "@/lib/types/enums";

/**
 * Codes of `private.validate_submission()`: `prior_months` is produced by the server only; `not_integer` is
 * also raised here for integer KPIs (a rule the server applies when saving, see kpiIssues).
 */
export type ValidationCode = "required" | "negative" | "not_integer" | "sum_mismatch" | "out_of_range" | "prior_months";

/** `code` is a string so server issues (`get_submission_validation`) can be merged in unchanged. */
export type ValidationIssue = { target: string; code: string; message: string };

export type ValidationInput = {
  /** Submission month, 'YYYY-MM' or 'YYYY-MM-DD'. */
  month: string;
  /** Template fields of the submission's template version, in template order. */
  fields: {
    key: string;
    label: string;
    field_type: FieldType;
    is_required: boolean;
    section_kind: SectionKind;
    /** Parsed `template_fields.validation` (only JSON numbers count for min/max, as in SQL). */
    validation?: { allow_negative?: boolean; min?: number; max?: number } | null;
  }[];
  /**
   * The company's revenue segments, sorted by `sort_order`, then name (inactive ones are ignored), with
   * their kind (BRD B30): `company` segments add up to total revenue; `scaleup` lines are only required.
   */
  segments: { id: string; name: string; is_active: boolean; kind: RevenueSegmentKind }[];
  /** The company's KPIs, sorted by `sort_order`, then name; `members` is null when the KPI has no dimension. */
  kpis: {
    id: string;
    name: string;
    is_active: boolean;
    is_required: boolean;
    frequency: KpiFrequency;
    value_type: KpiValueType;
    members: { id: string; name: string; is_active: boolean }[] | null;
  }[];
  /** Values keyed by field key. */
  values: Record<string, { value_number: number | null; value_text: string | null; value_json: unknown }>;
  /** Segment amounts keyed by segment id. */
  segmentValues: Record<string, number | null>;
  /** KPI values keyed by kpiCellKey(kpiId, memberId) from src/lib/targets.ts. */
  kpiValues: Record<string, { value_number: number | null; value_text: string | null; value_bool: boolean | null }>;
};

/** One template field as passed to validateSubmissionDraft. */
export type ValidationField = ValidationInput["fields"][number];
/** One company KPI as passed to validateSubmissionDraft. */
export type ValidationKpi = ValidationInput["kpis"][number];
type FieldDef = ValidationField;

/** One KPI input cell for a month (a KPI, or a KPI × active dimension member). */
export type KpiCell = {
  kpiId: string;
  /** Dimension member id, or null for a KPI without a dimension. */
  memberId: string | null;
  /** "App downloads" or "Revenue per outlet (Mont Kiara)". */
  label: string;
  kpiName: string;
  memberName: string | null;
  /** Key into ValidationInput.kpiValues: kpiCellKey(kpiId, memberId). */
  cellKey: string;
  /** Validation/comment target: kpiTarget(kpiId, memberId). */
  target: string;
  required: boolean;
  valueType: KpiValueType;
};

// ---------------------------------------------------------------------------------------------
// Emptiness
// ---------------------------------------------------------------------------------------------

const NUMBER_TYPES = new Set<string>([...NUMBER_FIELD_TYPES, ...NUMBER_KPI_VALUE_TYPES]);
const TEXT_TYPES = new Set<string>(["text", "long_text", "picklist"]);
const VALUE_KEYS = ["value_number", "value_text", "value_json", "value_bool"];

type StoredValue = { value_number?: unknown; value_text?: unknown; value_json?: unknown; value_bool?: unknown };

function isStoredValue(value: unknown): value is StoredValue {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    VALUE_KEYS.some((key) => key in (value as Record<string, unknown>))
  );
}

function isBlankText(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** Emptiness of a bare/JSON value: null, undefined, NaN, blank text, [] and {} are empty; 0 and false are values. */
function isBlankJson(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * True when a value carries no data. Accepts a stored row (`{ value_number, value_text, value_json }` or a
 * KPI row with `value_bool`) or a bare value. Boolean `false` and the number 0 are values; blank or
 * whitespace-only text, `[]` (no tags), NaN, null and undefined are empty.
 * With `type`, only the column that type is stored in counts (currency/number/integer/percent/rating →
 * value_number; text/long_text/picklist → value_text; tags → value_json; boolean → value_bool or value_json).
 * For rows the database stores (each value in its type's column) this matches the SQL emptiness checks.
 */
export function isEmptyValue(value: unknown, type?: FieldType | KpiValueType): boolean {
  if (!isStoredValue(value)) return isBlankJson(value);
  if (type !== undefined) {
    if (NUMBER_TYPES.has(type)) return toFiniteNumber(value.value_number) === null;
    if (TEXT_TYPES.has(type)) return isBlankText(value.value_text);
    if (type === "boolean") return typeof value.value_bool !== "boolean" && typeof value.value_json !== "boolean";
    if (type === "tags") return isBlankJson(value.value_json);
  }
  return (
    toFiniteNumber(value.value_number) === null &&
    isBlankText(value.value_text) &&
    isBlankJson(value.value_json) &&
    typeof value.value_bool !== "boolean"
  );
}

// ---------------------------------------------------------------------------------------------
// KPI cells
// ---------------------------------------------------------------------------------------------

/** Half-yearly KPIs are collected in June and December submissions only. Accepts 'YYYY-MM' or 'YYYY-MM-DD'. */
export function isHalfYearMonth(month: string): boolean {
  return isHalfEnd(month);
}

/** Whether a KPI of this frequency is collected in `month` (monthly: always; half-yearly: June/December). */
export function isKpiDueInMonth(kpi: Pick<ValidationKpi, "frequency">, month: string): boolean {
  return kpi.frequency !== "half_yearly" || isHalfYearMonth(month);
}

/**
 * Every KPI input cell collected in the input's month: active KPIs that are due this month, one cell per
 * KPI without a dimension, or one per **active** member when the KPI has a dimension (none when it has no
 * active members). Includes optional KPIs (`required: false`). Order follows `kpis` and `members`.
 */
export function kpiCellsForMonth(input: Pick<ValidationInput, "month" | "kpis">): KpiCell[] {
  const cells: KpiCell[] = [];
  let halfYear: boolean | null = null;
  for (const kpi of input.kpis ?? []) {
    if (!kpi.is_active) continue;
    if (kpi.frequency === "half_yearly") {
      halfYear ??= isHalfYearMonth(input.month);
      if (!halfYear) continue;
    }
    const base = { kpiId: kpi.id, kpiName: kpi.name, required: kpi.is_required, valueType: kpi.value_type };
    if (kpi.members === null || kpi.members === undefined) {
      cells.push({
        ...base,
        memberId: null,
        memberName: null,
        label: kpi.name,
        cellKey: kpiCellKey(kpi.id, null),
        target: kpiTarget(kpi.id, null),
      });
      continue;
    }
    for (const member of kpi.members) {
      if (!member.is_active) continue;
      cells.push({
        ...base,
        memberId: member.id,
        memberName: member.name,
        label: `${kpi.name} (${member.name})`,
        cellKey: kpiCellKey(kpi.id, member.id),
        target: kpiTarget(kpi.id, member.id),
      });
    }
  }
  return cells;
}

/**
 * The KPI cells that must have a value this month (§2.6 rule 5): active, required KPIs — monthly ones every
 * month, half-yearly ones only in June and December — per active dimension member when the KPI has one.
 * Each cell has `{ kpiId, memberId, label }` plus `cellKey`, `target` and the other KpiCell fields.
 */
export function requiredKpiCells(input: Pick<ValidationInput, "month" | "kpis">): KpiCell[] {
  return kpiCellsForMonth(input).filter((cell) => cell.required);
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const SYSTEM_KEYS = new Set<string>(SYSTEM_FIELD_KEYS);
const HEADCOUNT_KEYS = new Set<string>(HEADCOUNT_FIELD_KEYS);
const NON_NEGATIVE_KEYS = new Set<string>(NON_NEGATIVE_FIELD_KEYS);
const SCALE = 1e4; // DB numerics have at most 4 decimals; compare as exact integers
const TOLERANCE_SCALED = Math.round(REVENUE_SUM_TOLERANCE * SCALE);

function issue(target: string, code: ValidationCode, message: string): ValidationIssue {
  return { target, code, message };
}

/** A finite JSON number from a validation setting, else null (SQL only reads JSON numbers). */
function settingNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * SQL `initcap(replace(key, '_', ' '))`: the label SQL uses for a system field the template lacks
 * (cannot happen for a published version, which must contain every system field).
 */
function fallbackLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/[A-Za-z0-9]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** SQL `private.amount_label()`: grouped, exactly two decimals, rounded half away from zero ('1,234.50'). */
function amountLabel(scaled: number): string {
  const cents = Math.sign(scaled) * Math.floor((Math.abs(scaled) + 50) / 100);
  return formatNumber(cents / 100, 2);
}

/**
 * SQL `private.number_issues()` for one present number, in this order:
 * - `negative`: below zero where the field cannot be negative — the non-negative system figures, or a
 *   field whose validation sets `allow_negative: false` or `min: 0`;
 * - `not_integer`: integer fields (the headcounts and `integer` template fields);
 * - `out_of_range`: below `validation.min` / above `validation.max` (not repeated when already negative).
 */
function numberIssues(
  target: string,
  label: string,
  value: number,
  whole: boolean,
  nonNegative: boolean,
  rule: FieldDef["validation"],
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const min = settingNumber(rule?.min);
  const max = settingNumber(rule?.max);
  const negative = value < 0 && (nonNegative || rule?.allow_negative === false || min === 0);
  if (negative) out.push(issue(target, "negative", `${label} cannot be negative.`));
  if (whole && !Number.isInteger(value)) out.push(issue(target, "not_integer", `${label} must be a whole number.`));
  if (!negative) {
    const show = (n: number) => formatNumberTrimmed(n, 4); // SQL private.number_label()
    if (min !== null && max !== null && (value < min || value > max)) {
      out.push(issue(target, "out_of_range", `${label} must be between ${show(min)} and ${show(max)}.`));
    } else if (min !== null && value < min) {
      out.push(issue(target, "out_of_range", `${label} must be at least ${show(min)}.`));
    } else if (max !== null && value > max) {
      out.push(issue(target, "out_of_range", `${label} must be at most ${show(max)}.`));
    }
  }
  return out;
}

/** Rules 1 and 3: the seven system numbers in their fixed order, whatever the template's order or flags. */
function systemFieldIssues(input: ValidationInput, fieldsByKey: ReadonlyMap<string, FieldDef>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const key of SYSTEM_FIELD_KEYS) {
    const field = fieldsByKey.get(key);
    const label = field?.label || fallbackLabel(key);
    const target = fieldTarget(key);
    const value = toFiniteNumber(input.values?.[key]?.value_number);
    if (value === null) {
      out.push(issue(target, "required", `${label} is required.`));
      continue;
    }
    out.push(...numberIssues(target, label, value, HEADCOUNT_KEYS.has(key), NON_NEGATIVE_KEYS.has(key), field?.validation));
  }
  return out;
}

/** `company` for the company's own segments; anything else is a ScaleUp revenue line (the database default). */
function isCompanyKind(segment: { kind?: string | null }): boolean {
  return segment.kind === "company";
}

/**
 * Rules 2 and 3 for revenue segments (BRD B30):
 * - every active COMPANY segment needs a non-negative amount, and once every one has an amount, total
 *   revenue must equal their sum within ±0.01 (`sum_mismatch`);
 * - every active ScaleUp revenue line needs a non-negative amount; ScaleUp lines have no sum rule.
 * Company segments and the sum check come first, then the ScaleUp lines (the SQL order).
 */
function segmentIssues(input: ValidationInput, fieldsByKey: ReadonlyMap<string, FieldDef>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const active = (input.segments ?? []).filter((segment) => segment.is_active);
  const companySegments = active.filter(isCompanyKind);
  const scaleupLines = active.filter((segment) => !isCompanyKind(segment));

  const amountIssues = (segment: { id: string; name: string }): { amount: number | null; issues: ValidationIssue[] } => {
    const amount = toFiniteNumber(input.segmentValues?.[segment.id]);
    const target = segmentTarget(segment.id);
    if (amount === null) return { amount, issues: [issue(target, "required", `Revenue for ${segment.name} is required.`)] };
    if (amount < 0) return { amount, issues: [issue(target, "negative", `Revenue for ${segment.name} cannot be negative.`)] };
    return { amount, issues: [] };
  };

  let missing = false;
  let sumScaled = 0;
  for (const segment of companySegments) {
    const { amount, issues } = amountIssues(segment);
    out.push(...issues);
    if (amount === null) missing = true;
    else sumScaled += Math.round(amount * SCALE);
  }

  const total = toFiniteNumber(input.values?.revenue_total?.value_number);
  if (companySegments.length > 0 && !missing && total !== null) {
    const totalScaled = Math.round(total * SCALE);
    if (Math.abs(totalScaled - sumScaled) > TOLERANCE_SCALED) {
      const label = fieldsByKey.get("revenue_total")?.label || "Total revenue";
      out.push(
        issue(
          fieldTarget("revenue_total"),
          "sum_mismatch",
          `${label} (${amountLabel(totalScaled)}) must equal the sum of your revenue segments (${amountLabel(sumScaled)}).`,
        ),
      );
    }
  }

  for (const line of scaleupLines) out.push(...amountIssues(line).issues);
  return out;
}

/** Rule 4 for the other template fields, plus the number rules of number fields that have a value. */
function templateFieldIssues(field: FieldDef, input: ValidationInput): ValidationIssue[] {
  const label = field.label || field.key;
  const target = fieldTarget(field.key);
  const row = input.values?.[field.key];
  if (isEmptyValue(row ?? null, field.field_type)) {
    return field.is_required ? [issue(target, "required", `${label} is required.`)] : [];
  }
  if (!NUMBER_FIELD_TYPES.includes(field.field_type)) return [];
  const value = toFiniteNumber(row?.value_number);
  if (value === null) return [];
  return numberIssues(target, label, value, field.field_type === "integer", false, field.validation);
}

/**
 * Rule 5: every required KPI cell of the month needs a value. Also flags a non-whole value in an `integer`
 * KPI (`not_integer`): the server never stores one (save_submission_values rejects it with
 * '"<KPI>" must be a whole number.'), so this lets the form show the problem before autosave fails.
 */
function kpiIssues(input: ValidationInput): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const cell of kpiCellsForMonth(input)) {
    const row = input.kpiValues?.[cell.cellKey];
    if (isEmptyValue(row ?? null, cell.valueType)) {
      if (cell.required) out.push(issue(cell.target, "required", `${cell.label} is required.`));
      continue;
    }
    if (cell.valueType === "integer") {
      const value = toFiniteNumber(row?.value_number);
      if (value !== null && !Number.isInteger(value)) {
        out.push(issue(cell.target, "not_integer", `${cell.label} must be a whole number.`));
      }
    }
  }
  return out;
}

/**
 * Validates a draft submission against §2.6 rules 1–5 exactly as `private.validate_submission()` does
 * (rule 6, `prior_months`, is server-side only):
 * 1. The seven system numbers are required (whatever the template's `is_required` says).
 * 2. Revenue segments (BRD B30): every active segment of either kind needs an amount ("Revenue for
 *    <segment> is required."); with active COMPANY segments, once all of them are entered, `revenue_total`
 *    must equal their sum within ±0.01 (`sum_mismatch`, "… must equal the sum of your revenue segments
 *    …"). ScaleUp revenue lines need not add up. Inactive (retired) segments are ignored.
 * 3. `revenue_total`, segment amounts, `cash_in_bank`, `burn_rate` and the headcounts cannot be negative
 *    (`gross_profit` and `net_profit` can, unless their validation sets `allow_negative: false` or
 *    `min: 0`); headcounts must be whole numbers (`not_integer`); `validation.min`/`max` give
 *    `out_of_range` (skipped when the value is already `negative`).
 * 4. Any other template field marked required needs a value (narrative/pulse fields are optional unless
 *    marked required; boolean `false` counts as a value; blank text and empty tags do not). Number fields
 *    that have a value follow the same number rules (`integer` fields must be whole numbers; `negative`
 *    for `allow_negative: false` or `min: 0`; `out_of_range` for min/max).
 * 5. Active, required KPIs need a value — monthly ones every month, half-yearly ones in June and December
 *    only — per active dimension member when the KPI has a dimension.
 * Issues come back in the SQL order (see the file header). Pass the fields, segments and KPIs sorted as
 * the data layer returns them (`toValidationInput` in src/lib/types/domain.ts builds this input).
 */
export function validateSubmissionDraft(input: ValidationInput): ValidationIssue[] {
  const fields = input.fields ?? [];
  const fieldsByKey = new Map<string, FieldDef>();
  for (const field of fields) if (!fieldsByKey.has(field.key)) fieldsByKey.set(field.key, field);

  const issues: ValidationIssue[] = [...systemFieldIssues(input, fieldsByKey), ...segmentIssues(input, fieldsByKey)];
  const seen = new Set<string>();
  for (const field of fields) {
    if (SYSTEM_KEYS.has(field.key) || seen.has(field.key)) continue;
    seen.add(field.key);
    issues.push(...templateFieldIssues(field, input));
  }
  issues.push(...kpiIssues(input));
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Helpers for displaying issues
// ---------------------------------------------------------------------------------------------

/** Issues grouped by target, preserving order: { 'field:gross_profit': [...], 'segment:<id>': [...] }. */
export function groupIssuesByTarget(issues: ReadonlyArray<ValidationIssue>): Record<string, ValidationIssue[]> {
  const grouped: Record<string, ValidationIssue[]> = {};
  for (const item of issues) (grouped[item.target] ??= []).push(item);
  return grouped;
}

/** First message per target — the `fieldErrors` shape of ActionResult. */
export function toFieldErrors(issues: ReadonlyArray<ValidationIssue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of issues) errors[item.target] ??= item.message;
  return errors;
}
