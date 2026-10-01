// Pure model of the monthly form's editable values (the "draft"): conversion from the stored values,
// change detection against what the server has, the `save_submission_values` payload (docs/ARCHITECTURE.md
// §2.4 input rules) and number parsing for the text-based number inputs. Framework-free and client-safe
// (the Server Actions in src/lib/actions/submission.ts use the same types). Unit tests: tests/features/m5.
//
// Emptiness follows the database: null, blank text, [] and {} are empty (saving them deletes the stored
// row); 0 and `false` are values.

import { NUMBER_FIELD_TYPES, NUMBER_KPI_VALUE_TYPES, TEXT_FIELD_TYPES } from "@/lib/constants";
import { formatNumberInput, parseNumberInput, toFiniteNumber } from "@/lib/format";
import { parseKpiCellKey } from "@/lib/targets";
import { segmentsForMonth, type CompanyConfig, type Json, type SubmissionValues } from "@/lib/types/domain";
import type { FieldType, KpiValueType } from "@/lib/types/enums";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** One template field's value, in the column of its type (§2.2 storage rule). */
export type FieldDraft = { value_number: number | null; value_text: string | null; value_json: Json | null };

/** One KPI cell's value (value_number for number types, value_text for text, value_bool for Yes/No). */
export type KpiDraft = { value_number: number | null; value_text: string | null; value_bool: boolean | null };

/**
 * The form's values in the `SubmissionValuesInput` shape (so it feeds `toValidationInput` directly):
 * template fields by key, revenue segment amounts by segment id, KPI cells by `kpiCellKey(kpiId, memberId)`.
 */
export type DraftValues = {
  values: Record<string, FieldDraft>;
  segments: Record<string, number | null>;
  kpis: Record<string, KpiDraft>;
};

/** Keys of the entries that differ between two drafts. */
export type ChangeSet = { values: string[]; segments: string[]; kpis: string[] };

/** One `p_values` entry of save_submission_values: only the column of the field's type is sent. */
export type SaveValueEntry = {
  key: string;
  value_number?: number | null;
  value_text?: string | null;
  value_json?: boolean | string[] | null;
};

/** One `p_segments` entry; `amount: null` deletes the stored amount. */
export type SaveSegmentEntry = { segment_id: string; amount: number | null };

/** One `p_kpis` entry; `dimension_member_id` is null for a KPI without a dimension. */
export type SaveKpiEntry = {
  kpi_id: string;
  dimension_member_id: string | null;
  value_number?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
};

/** The changed entries of one autosave (an entry whose values are all empty deletes the stored row). */
export type SavePayload = { values: SaveValueEntry[]; segments: SaveSegmentEntry[]; kpis: SaveKpiEntry[] };

/** Field and KPI value types, so the payload sends each value in the right column. */
export type PayloadTypes = {
  fieldTypes: Readonly<Record<string, FieldType>>;
  kpiTypes: Readonly<Record<string, KpiValueType>>;
};

/** Largest magnitude the database accepts (|value| < 1e15). */
export const MAX_ABS_NUMBER = 1e15;
/** Decimals stored for template field and KPI numbers (numeric(20,4)). */
export const VALUE_SCALE = 4;
/** Decimals stored for revenue segment amounts (numeric(18,2)). */
export const SEGMENT_SCALE = 2;

const NUMBER_FIELDS = new Set<string>(NUMBER_FIELD_TYPES);
const TEXT_FIELDS = new Set<string>(TEXT_FIELD_TYPES);
const NUMBER_KPIS = new Set<string>(NUMBER_KPI_VALUE_TYPES);

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

export function emptyDraft(): DraftValues {
  return { values: {}, segments: {}, kpis: {} };
}

/** The draft of stored values (bundle.current, a snapshot, or getSubmissionValues). */
export function toDraftValues(stored: SubmissionValues): DraftValues {
  const draft = emptyDraft();
  for (const [key, row] of Object.entries(stored.values)) {
    draft.values[key] = {
      value_number: toFiniteNumber(row.value_number),
      value_text: row.value_text,
      value_json: row.value_json,
    };
  }
  for (const [id, amount] of Object.entries(stored.segments)) draft.segments[id] = toFiniteNumber(amount);
  for (const [cellKey, row] of Object.entries(stored.kpis)) {
    draft.kpis[cellKey] = {
      value_number: toFiniteNumber(row.value_number),
      value_text: row.value_text,
      value_bool: typeof row.value_bool === "boolean" ? row.value_bool : null,
    };
  }
  return draft;
}

// ---------------------------------------------------------------------------------------------
// Emptiness and equality
// ---------------------------------------------------------------------------------------------

function blankText(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** A JSON value that carries no data: null, blank text, [] or {} (booleans and numbers are values). */
export function isEmptyJson(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Canonical text of a JSON value for comparisons: arrays of tags compare as sets. */
function jsonKey(value: unknown): string | null {
  if (isEmptyJson(value)) return null;
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.stringify(item)).sort());
  return JSON.stringify(value);
}

export function isEmptyFieldDraft(value: FieldDraft | null | undefined): boolean {
  if (!value) return true;
  return toFiniteNumber(value.value_number) === null && blankText(value.value_text) && isEmptyJson(value.value_json);
}

export function isEmptyKpiDraft(value: KpiDraft | null | undefined): boolean {
  if (!value) return true;
  return (
    toFiniteNumber(value.value_number) === null && blankText(value.value_text) && typeof value.value_bool !== "boolean"
  );
}

function fieldKey(value: FieldDraft | null | undefined): string {
  if (isEmptyFieldDraft(value)) return "";
  const v = value as FieldDraft;
  return JSON.stringify([
    toFiniteNumber(v.value_number),
    blankText(v.value_text) ? null : v.value_text,
    jsonKey(v.value_json),
  ]);
}

function kpiKey(value: KpiDraft | null | undefined): string {
  if (isEmptyKpiDraft(value)) return "";
  const v = value as KpiDraft;
  return JSON.stringify([
    toFiniteNumber(v.value_number),
    blankText(v.value_text) ? null : v.value_text,
    typeof v.value_bool === "boolean" ? v.value_bool : null,
  ]);
}

/** Same stored value (empty values are all equal; tags compare as sets). */
export function sameFieldDraft(a: FieldDraft | null | undefined, b: FieldDraft | null | undefined): boolean {
  return fieldKey(a) === fieldKey(b);
}

export function sameKpiDraft(a: KpiDraft | null | undefined, b: KpiDraft | null | undefined): boolean {
  return kpiKey(a) === kpiKey(b);
}

export function sameAmount(a: number | null | undefined, b: number | null | undefined): boolean {
  return toFiniteNumber(a) === toFiniteNumber(b);
}

// ---------------------------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------------------------

function unionKeys(...maps: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const map of maps) for (const key of Object.keys(map)) keys.add(key);
  return Array.from(keys).sort();
}

/** The entries of `next` whose value differs from `base` (e.g. base = what the server has). */
export function diffDraft(base: DraftValues, next: DraftValues): ChangeSet {
  return {
    values: unionKeys(base.values, next.values).filter((key) => !sameFieldDraft(base.values[key], next.values[key])),
    segments: unionKeys(base.segments, next.segments).filter((id) => !sameAmount(base.segments[id], next.segments[id])),
    kpis: unionKeys(base.kpis, next.kpis).filter((key) => !sameKpiDraft(base.kpis[key], next.kpis[key])),
  };
}

export function countChanges(changes: ChangeSet): number {
  return changes.values.length + changes.segments.length + changes.kpis.length;
}

export function hasChanges(changes: ChangeSet): boolean {
  return countChanges(changes) > 0;
}

export function emptyChangeSet(): ChangeSet {
  return { values: [], segments: [], kpis: [] };
}

/** Whether an entry is part of a change set, e.g. the entries of a save in flight. */
export function changeSetHas(changes: ChangeSet, part: keyof ChangeSet, key: string): boolean {
  return changes[part].includes(key);
}

// ---------------------------------------------------------------------------------------------
// Save payload
// ---------------------------------------------------------------------------------------------

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function jsonPayload(value: Json | null | undefined): boolean | string[] | null {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const tags = value.filter((item): item is string => typeof item === "string");
    return tags.length > 0 ? tags : null;
  }
  return null;
}

/** The p_values entry for a field: its type's column only (all columns for an unknown type). */
export function fieldEntry(
  key: string,
  value: FieldDraft | null | undefined,
  type: FieldType | undefined,
): SaveValueEntry {
  const number = toFiniteNumber(value?.value_number);
  const text = textOrNull(value?.value_text);
  const json = jsonPayload(value?.value_json);
  if (type !== undefined && NUMBER_FIELDS.has(type)) return { key, value_number: number };
  if (type !== undefined && TEXT_FIELDS.has(type)) return { key, value_text: text };
  if (type === "tags" || type === "boolean") return { key, value_json: json };
  return { key, value_number: number, value_text: text, value_json: json };
}

/** The p_kpis entry for a KPI cell, or null when the cell key is malformed. */
export function kpiEntry(
  cellKey: string,
  value: KpiDraft | null | undefined,
  type: KpiValueType | undefined,
): SaveKpiEntry | null {
  const cell = parseKpiCellKey(cellKey);
  if (!cell) return null;
  const base = { kpi_id: cell.kpiId, dimension_member_id: cell.dimensionMemberId };
  const number = toFiniteNumber(value?.value_number);
  const text = textOrNull(value?.value_text);
  const bool = typeof value?.value_bool === "boolean" ? value.value_bool : null;
  if (type !== undefined && NUMBER_KPIS.has(type)) return { ...base, value_number: number };
  if (type === "text") return { ...base, value_text: text };
  if (type === "boolean") return { ...base, value_bool: bool };
  return { ...base, value_number: number, value_text: text, value_bool: bool };
}

/** The save_submission_values payload for the changed entries of `draft` (empty entries delete). */
export function buildSavePayload(draft: DraftValues, changes: ChangeSet, types: PayloadTypes): SavePayload {
  return {
    values: changes.values.map((key) => fieldEntry(key, draft.values[key], types.fieldTypes[key])),
    segments: changes.segments.map((id) => ({ segment_id: id, amount: toFiniteNumber(draft.segments[id]) })),
    kpis: changes.kpis.flatMap((cellKey) => {
      const cell = parseKpiCellKey(cellKey);
      const entry = kpiEntry(cellKey, draft.kpis[cellKey], cell ? types.kpiTypes[cell.kpiId] : undefined);
      return entry ? [entry] : [];
    }),
  };
}

/** Only the changed entries of `draft` (the values a save sends). */
export function pickChanged(draft: DraftValues, changes: ChangeSet): DraftValues {
  const picked = emptyDraft();
  for (const key of changes.values) if (key in draft.values) picked.values[key] = draft.values[key];
  for (const id of changes.segments) if (id in draft.segments) picked.segments[id] = draft.segments[id];
  for (const key of changes.kpis) if (key in draft.kpis) picked.kpis[key] = draft.kpis[key];
  return picked;
}

/**
 * The server state after a successful save: `base` with the changed entries replaced by the values that
 * were sent (`sent` = pickChanged at send time); empty values are removed, as the database deletes them.
 */
export function applySaved(base: DraftValues, sent: DraftValues, changes: ChangeSet): DraftValues {
  const next: DraftValues = { values: { ...base.values }, segments: { ...base.segments }, kpis: { ...base.kpis } };
  for (const key of changes.values) {
    const value = sent.values[key];
    if (isEmptyFieldDraft(value)) delete next.values[key];
    else next.values[key] = value;
  }
  for (const id of changes.segments) {
    const amount = toFiniteNumber(sent.segments[id]);
    if (amount === null) delete next.segments[id];
    else next.segments[id] = amount;
  }
  for (const key of changes.kpis) {
    const value = sent.kpis[key];
    if (isEmptyKpiDraft(value)) delete next.kpis[key];
    else next.kpis[key] = value;
  }
  return next;
}

/**
 * Adopts newer server values (e.g. a co-worker's edits, or the page re-rendered after a save): entries the
 * person has not changed (draft = saved) and that are not being saved right now (`busy`) take the server
 * value; every entry's baseline becomes the server value, so a changed entry stays unsaved only while it
 * differs from the server.
 */
export function mergeServerValues(
  draft: DraftValues,
  saved: DraftValues,
  server: DraftValues,
  busy: ChangeSet = emptyChangeSet(),
): { draft: DraftValues; saved: DraftValues } {
  const nextDraft: DraftValues = {
    values: { ...draft.values },
    segments: { ...draft.segments },
    kpis: { ...draft.kpis },
  };
  const nextSaved: DraftValues = {
    values: { ...server.values },
    segments: { ...server.segments },
    kpis: { ...server.kpis },
  };

  for (const key of unionKeys(draft.values, saved.values, server.values)) {
    if (!sameFieldDraft(draft.values[key], saved.values[key]) || changeSetHas(busy, "values", key)) continue;
    if (key in server.values) nextDraft.values[key] = server.values[key];
    else delete nextDraft.values[key];
  }
  for (const id of unionKeys(draft.segments, saved.segments, server.segments)) {
    if (!sameAmount(draft.segments[id], saved.segments[id]) || changeSetHas(busy, "segments", id)) continue;
    if (id in server.segments) nextDraft.segments[id] = server.segments[id];
    else delete nextDraft.segments[id];
  }
  for (const key of unionKeys(draft.kpis, saved.kpis, server.kpis)) {
    if (!sameKpiDraft(draft.kpis[key], saved.kpis[key]) || changeSetHas(busy, "kpis", key)) continue;
    if (key in server.kpis) nextDraft.kpis[key] = server.kpis[key];
    else delete nextDraft.kpis[key];
  }
  return { draft: nextDraft, saved: nextSaved };
}

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

export function withFieldValue(draft: DraftValues, key: string, value: FieldDraft | null): DraftValues {
  const values = { ...draft.values };
  if (value === null) delete values[key];
  else values[key] = value;
  return { ...draft, values };
}

export function withKpiValue(draft: DraftValues, cellKey: string, value: KpiDraft | null): DraftValues {
  const kpis = { ...draft.kpis };
  if (value === null) delete kpis[cellKey];
  else kpis[cellKey] = value;
  return { ...draft, kpis };
}

export function numberDraft(value: number | null): FieldDraft {
  return { value_number: value, value_text: null, value_json: null };
}

export function textDraft(value: string | null): FieldDraft {
  return { value_number: null, value_text: value, value_json: null };
}

export function jsonDraft(value: boolean | string[] | null): FieldDraft {
  return { value_number: null, value_text: null, value_json: value };
}

/**
 * Sum of the active segments' amounts that are filled in (null when none is), exact to 4 decimals like
 * the validation mirror. Pass the company's OWN segments (BRD B30, kind 'company'): with them, total
 * revenue is this sum (read-only in the form). ScaleUp revenue lines never count towards it.
 */
export function segmentTotal(
  segments: ReadonlyArray<{ id: string; is_active: boolean }>,
  amounts: Readonly<Record<string, number | null | undefined>>,
): number | null {
  let any = false;
  let scaled = 0;
  for (const segment of segments) {
    if (!segment.is_active) continue;
    const amount = toFiniteNumber(amounts[segment.id]);
    if (amount === null) continue;
    any = true;
    scaled += Math.round(amount * 1e4);
  }
  return any ? scaled / 1e4 + 0 : null;
}

/**
 * Sets one revenue amount and nothing else: for ScaleUp revenue lines (BRD B30, kind 'scaleup'), which are
 * reported every month but are not part of total revenue.
 */
export function withSegmentValue(draft: DraftValues, segmentId: string, amount: number | null): DraftValues {
  const segments = { ...draft.segments };
  if (amount === null) delete segments[segmentId];
  else segments[segmentId] = amount;
  return { ...draft, segments };
}

/**
 * Sets the amount of one of the company's own revenue segments and keeps total revenue equal to the sum
 * of `segments` (the company's own ACTIVE segments, BRD B30). An id that is not one of them is set without
 * touching total revenue (as `withSegmentValue`), so a ScaleUp revenue line can never change the total.
 */
export function withSegmentAmount(
  draft: DraftValues,
  segments: ReadonlyArray<{ id: string; is_active: boolean }>,
  segmentId: string,
  amount: number | null,
): DraftValues {
  const next = withSegmentValue(draft, segmentId, amount);
  if (!segments.some((segment) => segment.id === segmentId && segment.is_active)) return next;
  const total = segmentTotal(segments, next.segments);
  const values = { ...draft.values };
  if (total === null) delete values.revenue_total;
  else values.revenue_total = numberDraft(total);
  return { ...next, values };
}

/**
 * With the company's own active revenue segments (pass only those, BRD B30), total revenue must equal
 * their sum: when at least one of them has an amount and the stored total differs, returns the draft with
 * the total corrected (it is then saved like any other change). Otherwise returns `draft` unchanged (a
 * stored total is kept while no segment is filled in yet).
 */
export function reconcileRevenueTotal(
  draft: DraftValues,
  segments: ReadonlyArray<{ id: string; is_active: boolean }>,
): DraftValues {
  if (!segments.some((segment) => segment.is_active)) return draft;
  const total = segmentTotal(segments, draft.segments);
  if (total === null) return draft;
  if (toFiniteNumber(draft.values.revenue_total?.value_number) === total) return draft;
  return { ...draft, values: { ...draft.values, revenue_total: numberDraft(total) } };
}

/**
 * `reconcileRevenueTotal` with the company's own segments in use according to `config` (BRD B30; ScaleUp
 * revenue lines and retired segments never count) — for a month open for changes. The form runs it when
 * it opens and again whenever the server sends a newer bundle: the owner may have changed the segments
 * while the form was open (e.g. removed one, whose figure the database then cleared), and total revenue
 * must follow the segments now in use. Returns `draft` itself when nothing changes.
 */
export function reconcileWithCompanySegments(draft: DraftValues, config: Pick<CompanyConfig, "segments">): DraftValues {
  return reconcileRevenueTotal(draft, segmentsForMonth(config, draft, true).company);
}

/** Tags in the order of the field's options (unknown tags last, in their given order), without duplicates. */
export function normaliseTags(selected: ReadonlyArray<string>, options: ReadonlyArray<string>): string[] {
  const chosen = new Set(selected);
  const ordered = options.filter((option) => chosen.has(option));
  const known = new Set(options);
  const extra = Array.from(new Set(selected.filter((tag) => !known.has(tag))));
  return [...ordered, ...extra];
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** Rounds the decimal digits of a non-negative number string, half away from zero. */
function roundDigits(intPart: string, fraction: string, scale: number): string {
  if (fraction.length <= scale) return fraction.length > 0 ? `${intPart}.${fraction}` : intPart;
  const digits = `${intPart}${fraction.slice(0, scale)}`.split("");
  if (fraction.charCodeAt(scale) >= 53 /* '5' */) {
    let i = digits.length - 1;
    for (; i >= 0; i--) {
      if (digits[i] === "9") {
        digits[i] = "0";
      } else {
        digits[i] = String(Number(digits[i]) + 1);
        break;
      }
    }
    if (i < 0) digits.unshift("1");
  }
  const joined = digits.join("");
  if (scale === 0) return joined;
  const cut = joined.length - scale;
  return `${joined.slice(0, cut)}.${joined.slice(cut)}`;
}

/**
 * Rounds to `scale` decimals the way Postgres stores a JSON number in numeric(p, scale): exact decimal
 * rounding of the number's shortest text, half away from zero (1.005 → 1.01, -2.5 → -3 at scale 0).
 */
export function roundToScale(value: number, scale: number): number {
  if (!Number.isFinite(value)) return value;
  const abs = Math.abs(value);
  let text = String(abs);
  if (/e/i.test(text)) text = abs.toFixed(Math.min(20, Math.max(scale + 1, 0)));
  const [intPart, fraction = ""] = text.split(".");
  const rounded = Number(roundDigits(intPart, fraction, Math.max(0, Math.trunc(scale))));
  return (value < 0 && rounded !== 0 ? -rounded : rounded) + 0;
}

export type NumberParseResult = { ok: true; value: number | null } | { ok: false; message: string };

/**
 * Parses what someone typed into a number box (parseNumberInput: '1,234.50', 'RM 1,234', '(1,000)', …):
 * empty → null (clears the value); rounded to `scale` decimals (default 4); `integer` refuses decimals
 * (used for whole-number KPIs, which the database refuses to store); `percent` accepts a trailing '%'.
 */
export function parseNumberField(
  raw: string,
  opts: { integer?: boolean; scale?: number; percent?: boolean } = {},
): NumberParseResult {
  let text = raw.trim();
  if (opts.percent) text = text.replace(/\s*%$/, "");
  if (text === "") return { ok: true, value: null };
  const parsed = parseNumberInput(text);
  if (parsed === null) {
    return {
      ok: false,
      message: opts.integer ? "Enter a whole number, for example 12." : "Enter a number, for example 1,234.50.",
    };
  }
  if (Math.abs(parsed) >= MAX_ABS_NUMBER) return { ok: false, message: "That number is too large." };
  const value = roundToScale(parsed, opts.scale ?? VALUE_SCALE);
  if (opts.integer && !Number.isInteger(value))
    return { ok: false, message: "Enter a whole number, without decimals." };
  return { ok: true, value };
}

/** A leading minus sign (also the true minus and the en dash pasted from documents). */
const LEADING_MINUS_RE = /^[-−–]\s*/;

/** The number in a box's text, a trailing '%' allowed (null when it is not a number). */
function numberInText(text: string): number | null {
  return parseNumberInput(text.trim().replace(/\s*%$/, ""));
}

/**
 * Whether a number box's text is negative, as the ± button shows it: '-1,200', '(1,200)' and 'RM -5', and
 * also a lone '-' or '-0' (a negative number being typed).
 */
export function isNegativeText(text: string): boolean {
  const number = numberInText(text);
  if (number !== null && number !== 0) return number < 0;
  const trimmed = text.trim();
  return LEADING_MINUS_RE.test(trimmed) || trimmed.startsWith("(");
}

/**
 * A number box's text with its sign switched (the ± button: the decimal keypad of iPhones has no minus
 * key). A number is negated and shown plainly ('1,234.5' → '-1,234.5', '(1,000)' → '1,000', 'RM -5' →
 * '5', '12%' → '-12%'); an empty box becomes '-' to start a negative number and '-' empties it again;
 * zero and other text gain or lose a leading minus ('0' → '-0', '12a' → '-12a').
 */
export function toggleSignText(text: string): string {
  const trimmed = text.trim();
  const percent = /\s*%$/.test(trimmed) ? "%" : "";
  const body = percent ? trimmed.replace(/\s*%$/, "") : trimmed;
  if (body === "") return "-";
  const number = parseNumberInput(body);
  if (number !== null && number !== 0) return `${formatNumberInput(-number)}${percent}`;
  if (LEADING_MINUS_RE.test(body)) return `${body.replace(LEADING_MINUS_RE, "")}${percent}`;
  if (body.startsWith("(") && body.endsWith(")")) return `${body.slice(1, -1).trim()}${percent}`;
  return `-${body.replace(/^\+\s*/, "")}${percent}`;
}
