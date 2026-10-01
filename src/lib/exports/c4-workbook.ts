// C4 workbook export (BRD A13, §10 "C4 workbook export", B17, B18; docs/ARCHITECTURE.md §6 "C4 export").
//
// Pure builder: loaded data in, ExcelJS workbook out (the loader is c4-data.ts). Four sheets, following
// the field lists of the BRD rather than any single legacy workbook (B17):
// - "C4": one row per narrative section of the template (the C4 categories, in template order) plus
//   Founder Pulse; one column per half-year from the first reported half to the last completed one, and
//   "Input Here" for the half-year in progress; a "Last Updated" row. A cell lists the monthly entries
//   ("Jul 2026: …"). Months without a narrative are stated ("No update: Aug 2026"), never filled.
// - "Revenue Lines": the company's own revenue segments (BRD B30: they add up to total revenue), total
//   revenue, ScaleUp's revenue lines for the company (B30: they need not add up), GP, GP %, NP, NP %, cash,
//   monthly burn, runway, headcount and revenue YoY %, monthly columns plus half-year totals
//   (periodTotals); for non-MYR companies an RM block converted with each month's FX rate (blank where no
//   rate is set).
// - "KPIs": one row per KPI (× dimension member), monthly columns.
// - "Monthly Grid": one row per month with status, every number (a column per segment of each kind),
//   derived metrics and KPIs.
//
// Only approved months feed the figures unless `include` is "all"; months that are not approved are then
// marked "(not yet approved)". In approved-only mode other months still appear (status shown, figures
// blank), so gaps are never silent. Segments are listed by id over time: a renamed segment with submitted
// figures is a new series (B30), and segments no longer used appear only where they have figures. A month
// still open for changes shows what the monthly form shows (segments.ts): the current segments' figures
// and, when the company has segments of its own, total revenue calculated from them.
import ExcelJS from "exceljs";
import type { Cell, Row, Worksheet } from "exceljs";

import {
  KPI_FREQUENCY_LABELS,
  NUMBER_FIELD_TYPES,
  REVENUE_SEGMENT_KIND_META,
  SUBMISSION_STATUS_META,
  SYSTEM_FIELD_KEYS,
} from "@/lib/constants";
import { currencySymbol, formatDate, formatDateTime, formatMoney, formatNumberTrimmed, toFiniteNumber } from "@/lib/format";
import {
  financialsFromValues,
  growthPct,
  gpPct,
  isCashflowPositive,
  npPct,
  periodTotals,
  runwayMonths,
  type MonthlyFinancials,
  type PeriodTotals,
} from "@/lib/metrics";
import {
  addMonths,
  compareMonths,
  halfOf,
  monthLabel,
  monthsBetween,
  parseInstant,
  parseMonthKey,
  todayMYT,
  type ClosePeriod,
  type DateKey,
  type MonthKey,
} from "@/lib/periods";
import type { Json } from "@/lib/supabase/database.types";
import { kpiCellKey } from "@/lib/targets";
import { parseFieldOptions, segmentKind } from "@/lib/types/domain";
import type { FieldType, KpiFrequency, KpiValueType, SectionKind, SubmissionStatus } from "@/lib/types/enums";

import { ENTERED_EARLIER_TOTAL_NOTE, shownRevenueTotal, shownSegmentAmounts } from "./segments";
import {
  NUMBER_FORMATS,
  applyPrintSetup,
  clampCellText,
  estimateRowHeight,
  excelDate,
  setColumnWidths,
  setWorkbookProperties,
  styleBodyCell,
  styleHeaderRow,
  styleMutedCell,
  styleSubtleCell,
  writeNote,
  writeTitle,
  type NumberFormatName,
} from "./xlsx";

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

/** "approved": only approved months feed the workbook (LP-facing); "all": every month, others marked. */
export type C4Include = "approved" | "all";

export const C4_INCLUDE_VALUES = ["approved", "all"] as const satisfies readonly C4Include[];

export type C4TemplateField = {
  key: string;
  label: string;
  field_type: FieldType;
  options: Json | null;
  is_system: boolean;
};

export type C4TemplateSection = { key: string; title: string; kind: SectionKind; fields: C4TemplateField[] };

/** A template version (a `TemplateVersionFull` fits): sections and fields in form order. */
export type C4Template = { id: string; sections: C4TemplateSection[] };

export type C4StoredValue = { value_number: number | null; value_text: string | null; value_json: Json | null };
export type C4StoredKpiValue = { value_number: number | null; value_text: string | null; value_bool: boolean | null };

/** One submission (any status) with its stored values. */
export type C4Month = {
  /** 'YYYY-MM-DD' (stored) or 'YYYY-MM'. */
  month: string;
  status: SubmissionStatus;
  template_version_id: string;
  submitted_at: string | null;
  approved_at: string | null;
  last_saved_at: string | null;
  /** 1 for MYR; the month's rate for other currencies; null when unknown or not visible. */
  fx_rate_to_myr: number | null;
  /** Template field values keyed by field key (may be empty for months that are not included). */
  values: Record<string, C4StoredValue>;
  /** Revenue segment amounts (both kinds) keyed by segment id. */
  segments: Record<string, number | null>;
  /** KPI cells keyed by kpiCellKey(kpi_id, dimension_member_id). */
  kpis: Record<string, C4StoredKpiValue>;
};

/**
 * A revenue segment (a `RevenueSegmentRow` fits). BRD B30: `kind` 'company' = the company's own segments,
 * defined by its owner, which add up to total revenue; 'scaleup' = ScaleUp's revenue lines for the
 * company, which need not add up (any other value counts as a ScaleUp line, like `segmentKind`).
 * Inactive = retired ("no longer used"): shown only where they have figures.
 */
export type C4Segment = {
  id: string;
  name: string;
  is_active: boolean;
  kind: string;
  /** Order within its kind (then name). */
  sort_order?: number;
};
export type C4KpiMember = { id: string; name: string; is_active: boolean };
export type C4Kpi = {
  id: string;
  name: string;
  unit: string | null;
  value_type: KpiValueType;
  frequency: KpiFrequency;
  is_active: boolean;
  dimension: { name: string } | null;
  /** Every member of the KPI's dimension (inactive ones too, for history); [] without a dimension. */
  members: C4KpiMember[];
};

export type C4WorkbookInput = {
  company: { name: string; legal_name: string | null; reporting_currency: string };
  include: C4Include;
  /** When the export was made (ISO instant). */
  generatedAt: string;
  /** Today in Malaysia time ('YYYY-MM-DD'); decides the half-year in progress. Defaults to generatedAt's date. */
  today?: string;
  /** The caller can see FX rates (ScaleUp staff): adds the RM block for non-MYR companies. */
  fxVisible: boolean;
  /** The current template version (row order of the C4 sheet); null when none is published. */
  currentTemplate: C4Template | null;
  /** The template versions the months were reported on (past months keep theirs). */
  templates: C4Template[];
  /**
   * All revenue segments of both kinds, any order (the company's own segments and ScaleUp's revenue
   * lines); retired ones appear only where an included month has a figure for them.
   */
  segments: C4Segment[];
  /** All KPIs (active first); inactive ones appear only when they have figures. */
  kpis: C4Kpi[];
  /** Every submission of the company, any order. */
  months: C4Month[];
};

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

export type PreparedMonth = {
  key: MonthKey;
  status: SubmissionStatus;
  /** Feeds the figures and narrative (approved, or any status when include = "all"). */
  included: boolean;
  templateId: string;
  submittedAt: string | null;
  approvedAt: string | null;
  lastSavedAt: string | null;
  fx: number | null;
  /**
   * The figures the month shows. `revenue_total` follows shownRevenueTotal: for a month still open for
   * changes whose company has segments of its own, the sum of their figures (as the monthly form
   * calculates it), so it always agrees with the segments shown.
   */
  financials: MonthlyFinancials;
  /** Total revenue is a figure entered before the company's own segments were filled in (open months). */
  revenueEnteredEarlier: boolean;
  values: Record<string, C4StoredValue>;
  /** The segment figures the month shows (shownSegmentAmounts): numbers only, by segment id. */
  segments: Record<string, number>;
  kpis: Record<string, C4StoredKpiValue>;
};

export type C4Half = { period: ClosePeriod; inProgress: boolean; months: PreparedMonth[] };

export type NarrativeRow = { id: string; title: string; kind: SectionKind };

export type C4Model = {
  input: C4WorkbookInput;
  currency: string;
  today: DateKey;
  months: PreparedMonth[];
  byKey: Map<MonthKey, PreparedMonth>;
  templates: Map<string, C4Template>;
  halves: C4Half[];
  narrativeRows: NarrativeRow[];
};

const NARRATIVE_KINDS: readonly SectionKind[] = ["narrative", "pulse"];
const SYSTEM_KEYS: readonly string[] = SYSTEM_FIELD_KEYS;

function isNarrativeKind(kind: SectionKind): boolean {
  return NARRATIVE_KINDS.includes(kind);
}

/** Section titles are matched case- and space-insensitively (docs/ARCHITECTURE.md §3: by section title). */
function titleId(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function emptyFinancials(month: MonthKey): MonthlyFinancials {
  return financialsFromValues(month, {});
}

function prepareMonths(input: C4WorkbookInput): PreparedMonth[] {
  const active = input.segments.filter((segment) => segment.is_active);
  const activeSegmentIds = new Set(active.map((segment) => segment.id));
  // The company's own segments in use: an open month's total revenue is calculated from them (BRD B30).
  const companySegmentIds = active.filter((segment) => segmentKind(segment) === "company").map((segment) => segment.id);
  const byKey = new Map<MonthKey, PreparedMonth>();
  for (const month of input.months) {
    const key = parseMonthKey(month.month);
    if (!key) continue;
    const included = input.include === "all" || month.status === "approved";
    // Values of months that are not included are never shown, even when they were loaded.
    const stored = included ? financialsFromValues(key, month.values) : emptyFinancials(key);
    const revenue = included
      ? shownRevenueTotal(month, stored.revenue_total, companySegmentIds)
      : { total: null, enteredEarlier: false };
    byKey.set(key, {
      key,
      status: month.status,
      included,
      templateId: month.template_version_id,
      submittedAt: month.submitted_at,
      approvedAt: month.approved_at,
      lastSavedAt: month.last_saved_at,
      fx: toFiniteNumber(month.fx_rate_to_myr),
      financials: { ...stored, revenue_total: revenue.total },
      revenueEnteredEarlier: revenue.enteredEarlier,
      values: included ? month.values : {},
      segments: included ? shownSegmentAmounts(month, activeSegmentIds) : {},
      kpis: included ? month.kpis : {},
    });
  }
  return [...byKey.values()].sort((a, b) => compareMonths(a.key, b.key));
}

/** Half-years from the first reported one to the one in progress (today, Malaysia time). */
function buildHalves(months: PreparedMonth[], today: DateKey): C4Half[] {
  const current = halfOf(today);
  const first = months.length > 0 ? halfOf(months[0].key) : current;
  const last = months.length > 0 ? halfOf(months[months.length - 1].key) : current;
  const end = compareMonths(last.startMonth, current.startMonth) > 0 ? last : current;
  const halves: C4Half[] = [];
  for (let start = first.startMonth; compareMonths(start, end.startMonth) <= 0; start = addMonths(start, 6)) {
    const period = halfOf(start);
    halves.push({
      period,
      inProgress: period.label === current.label,
      months: months.filter((m) => halfOf(m.key).label === period.label),
    });
  }
  return halves;
}

/** C4 rows: narrative sections of the current template (in order), then any older ones, then pulse. */
function buildNarrativeRows(input: C4WorkbookInput): NarrativeRow[] {
  const rows: NarrativeRow[] = [];
  const seen = new Set<string>();
  const templates = input.currentTemplate ? [input.currentTemplate, ...input.templates] : input.templates;
  for (const template of templates) {
    for (const section of template.sections) {
      if (!isNarrativeKind(section.kind)) continue;
      const id = titleId(section.title);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, title: section.title.trim(), kind: section.kind });
    }
  }
  return [...rows.filter((row) => row.kind === "narrative"), ...rows.filter((row) => row.kind !== "narrative")];
}

export function buildC4Model(input: C4WorkbookInput): C4Model {
  const generatedMs = parseInstant(input.generatedAt) ?? Date.now();
  const today = input.today ?? todayMYT(generatedMs);
  const months = prepareMonths(input);
  const templates = new Map<string, C4Template>();
  for (const template of input.templates) templates.set(template.id, template);
  if (input.currentTemplate) templates.set(input.currentTemplate.id, input.currentTemplate);
  return {
    input,
    currency: input.company.reporting_currency.trim().toUpperCase() || "MYR",
    today,
    months,
    byKey: new Map(months.map((m) => [m.key, m])),
    templates,
    halves: buildHalves(months, today),
    narrativeRows: buildNarrativeRows(input),
  };
}

// ---------------------------------------------------------------------------------------------
// Narrative text
// ---------------------------------------------------------------------------------------------

/** Trimmed text with normalised line breaks; null when blank. */
function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : text;
}

/** A narrative/pulse value as text for the C4 sheet; null when empty. */
export function formatNarrativeValue(
  field: Pick<C4TemplateField, "field_type" | "options">,
  stored: C4StoredValue | undefined,
  currency = "MYR",
): string | null {
  if (!stored) return null;
  switch (field.field_type) {
    case "text":
    case "long_text":
    case "picklist":
      return cleanText(stored.value_text);
    case "tags": {
      const tags = Array.isArray(stored.value_json)
        ? stored.value_json.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
        : [];
      return tags.length > 0 ? tags.map((tag) => tag.trim()).join(", ") : null;
    }
    case "boolean":
      return typeof stored.value_json === "boolean" ? (stored.value_json ? "Yes" : "No") : null;
    case "rating": {
      const value = toFiniteNumber(stored.value_number);
      if (value === null) return null;
      const rating = parseFieldOptions(field).rating;
      const label = rating?.labels[String(value)];
      return `${formatNumberTrimmed(value, 2)} / ${formatNumberTrimmed(rating?.max ?? 5, 2)}${label ? ` (${label})` : ""}`;
    }
    case "currency": {
      const value = toFiniteNumber(stored.value_number);
      return value === null ? null : formatMoney(value, currency);
    }
    case "percent": {
      const value = toFiniteNumber(stored.value_number);
      return value === null ? null : `${formatNumberTrimmed(value, 2)}%`;
    }
    default: {
      const value = toFiniteNumber(stored.value_number);
      return value === null ? null : formatNumberTrimmed(value, 4);
    }
  }
}

function templateFor(model: C4Model, month: PreparedMonth): C4Template | undefined {
  return model.templates.get(month.templateId) ?? model.input.currentTemplate ?? undefined;
}

/** The narrative fields of a C4 row in a template (sections matched by title; system fields never). */
function rowFields(template: C4Template | undefined, rowId: string): C4TemplateField[] {
  if (!template) return [];
  return template.sections
    .filter((section) => isNarrativeKind(section.kind) && titleId(section.title) === rowId)
    .flatMap((section) => section.fields.filter((field) => !field.is_system && !SYSTEM_KEYS.includes(field.key)));
}

function narrativeEntries(
  model: C4Model,
  month: PreparedMonth,
  fields: C4TemplateField[],
): { label: string; text: string }[] {
  return fields.flatMap((field) => {
    const text = formatNarrativeValue(field, month.values[field.key], model.currency);
    return text ? [{ label: field.label.trim() || field.key, text }] : [];
  });
}

type NarrativeBlock =
  | { kind: "entry"; text: string }
  | { kind: "no_update" | "no_update_pending" | "pending"; month: string };

const BLOCK_PREFIX: Record<Exclude<NarrativeBlock["kind"], "entry">, string> = {
  no_update: "No update",
  no_update_pending: "No update (not yet approved)",
  pending: "Not yet approved",
};

/**
 * The text of one C4 cell: the monthly entries of `row` in the half-year, oldest first. Months without a
 * narrative are stated ("No update: Aug 2026") and months that are not included in approved-only mode
 * are named ("Not yet approved: Sep 2026"); consecutive months of the same kind share a line.
 */
export function c4CellText(model: C4Model, half: C4Half, row: Pick<NarrativeRow, "id">): string {
  if (half.months.length === 0) {
    return half.inProgress ? "No months reported yet." : "No monthly updates in this half-year.";
  }
  const blocks: NarrativeBlock[] = [];
  for (const month of half.months) {
    const label = monthLabel(month.key);
    if (!month.included) {
      blocks.push({ kind: "pending", month: label });
      continue;
    }
    const approved = month.status === "approved";
    const fields = rowFields(templateFor(model, month), row.id);
    const entries = narrativeEntries(model, month, fields);
    if (entries.length === 0) {
      blocks.push({ kind: approved ? "no_update" : "no_update_pending", month: label });
      continue;
    }
    const header = approved ? label : `${label} (not yet approved)`;
    const text =
      fields.length === 1
        ? `${header}: ${entries[0].text}`
        : `${header}:\n${entries.map((entry) => `• ${entry.label}: ${entry.text}`).join("\n")}`;
    blocks.push({ kind: "entry", text });
  }

  const lines: string[] = [];
  let run: { kind: Exclude<NarrativeBlock["kind"], "entry">; months: string[] } | null = null;
  const flush = () => {
    if (run) lines.push(`${BLOCK_PREFIX[run.kind]}: ${run.months.join(", ")}`);
    run = null;
  };
  for (const block of blocks) {
    if (block.kind === "entry") {
      flush();
      lines.push(block.text);
    } else if (run && run.kind === block.kind) {
      run.months.push(block.month);
    } else {
      flush();
      run = { kind: block.kind, months: [block.month] };
    }
  }
  flush();
  return clampCellText(lines.join("\n\n"));
}

/** When the half-year's included months were last updated (approved, submitted or saved), as a date. */
export function lastUpdatedText(half: C4Half): string | null {
  let latest: number | null = null;
  for (const month of half.months) {
    if (!month.included) continue;
    const stamp =
      month.status === "approved" ? month.approvedAt : (month.submittedAt ?? month.lastSavedAt ?? month.approvedAt);
    const ms = parseInstant(stamp);
    if (ms !== null && (latest === null || ms > latest)) latest = ms;
  }
  return latest === null ? null : formatDate(latest);
}

/** True when the month has any narrative or pulse entry. */
function hasNarrative(model: C4Model, month: PreparedMonth): boolean {
  if (!month.included) return false;
  const template = templateFor(model, month);
  if (!template) return false;
  return template.sections
    .filter((section) => isNarrativeKind(section.kind))
    .some((section) => narrativeEntries(model, month, rowFields(template, titleId(section.title))).length > 0);
}

// ---------------------------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------------------------

type MonthColumn = { kind: "month"; key: MonthKey; month: PreparedMonth | null };
type HalfColumn = { kind: "half"; period: ClosePeriod; included: PreparedMonth[]; totals: PeriodTotals };
type FigureColumn = MonthColumn | HalfColumn;

/** Every month from the first to the last reported one (gaps included). */
function monthColumns(model: C4Model): MonthColumn[] {
  if (model.months.length === 0) return [];
  const first = model.months[0].key;
  const last = model.months[model.months.length - 1].key;
  return monthsBetween(first, last).map((key) => ({ kind: "month", key, month: model.byKey.get(key) ?? null }));
}

/** Month columns with a half-year total after the last month of each half-year. */
function revenueLineColumns(model: C4Model): FigureColumn[] {
  const months = monthColumns(model);
  const columns: FigureColumn[] = [];
  months.forEach((column, index) => {
    columns.push(column);
    const period = halfOf(column.key);
    const next = months[index + 1];
    if (next && halfOf(next.key).label === period.label) return;
    const included = model.months.filter((m) => m.included && halfOf(m.key).label === period.label);
    columns.push({ kind: "half", period, included, totals: periodTotals(included.map((m) => m.financials)) });
  });
  return columns;
}

function includedMonth(model: C4Model, key: MonthKey): PreparedMonth | null {
  const month = model.byKey.get(key);
  return month && month.included ? month : null;
}

/** The values present added up (to 4 decimals, so cents never pick up floating-point noise); null when none. */
function sumPresent(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return Math.round(present.reduce((total, value) => total + value, 0) * 1e4) / 1e4 + 0;
}

function pctFraction(value: number | null): number | null {
  return value === null ? null : value / 100;
}

/** Revenue growth against the same month a year earlier (both months included). */
function monthYoy(model: C4Model, month: PreparedMonth): number | null {
  const lastYear = includedMonth(model, addMonths(month.key, -12));
  return lastYear ? growthPct(month.financials.revenue_total, lastYear.financials.revenue_total) : null;
}

/** Revenue growth against the previous month (both included). */
function monthMom(model: C4Model, month: PreparedMonth): number | null {
  const previous = includedMonth(model, addMonths(month.key, -1));
  return previous ? growthPct(month.financials.revenue_total, previous.financials.revenue_total) : null;
}

/**
 * Like-for-like half-year YoY: the revenue of the months present against the same calendar months a
 * year earlier; null unless every one of them has a figure a year earlier.
 */
function halfYoy(model: C4Model, included: PreparedMonth[]): number | null {
  let current = 0;
  let previous = 0;
  let any = false;
  for (const month of included) {
    const revenue = month.financials.revenue_total;
    if (revenue === null) continue;
    const lastYear = includedMonth(model, addMonths(month.key, -12))?.financials.revenue_total ?? null;
    if (lastYear === null) return null;
    current += revenue;
    previous += lastYear;
    any = true;
  }
  return any ? growthPct(current, previous) : null;
}

/** Σ amount × FX rate over the months that have the amount; null when one of them has no rate. */
function sumRm(months: readonly PreparedMonth[], pick: (m: PreparedMonth) => number | null): number | null {
  let total = 0;
  let any = false;
  for (const month of months) {
    const value = pick(month);
    if (value === null) continue;
    if (month.fx === null) return null;
    total += value * month.fx;
    any = true;
  }
  return any ? total : null;
}

function toRm(month: PreparedMonth, value: number | null): number | null {
  return value === null || month.fx === null ? null : value * month.fx;
}

/**
 * The figure of the half's latest included month (period end, like periodTotals: no back-fill when that
 * month has none), converted with that month's own rate.
 */
function periodEndRm(months: readonly PreparedMonth[], pick: (m: PreparedMonth) => number | null): number | null {
  const last = months[months.length - 1];
  return last ? toRm(last, pick(last)) : null;
}

function averageRm(months: readonly PreparedMonth[], pick: (m: PreparedMonth) => number | null): number | null {
  const withValue = months.filter((month) => pick(month) !== null);
  if (withValue.length === 0) return null;
  const total = sumRm(withValue, pick);
  return total === null ? null : total / withValue.length;
}

/** The segments of each kind the figures show (segmentBlocks). */
export type SegmentBlocks = { company: C4Segment[]; scaleup: C4Segment[] };

/** Active segments first, then by `sort_order`, name and id (a stable order whatever the input order). */
function bySegmentDisplayOrder(a: C4Segment, b: C4Segment): number {
  return (
    Number(b.is_active) - Number(a.is_active) ||
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    a.name.localeCompare(b.name, "en-GB", { sensitivity: "base", numeric: true }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The rows / columns per kind (BRD B30): the company's own revenue segments and ScaleUp's revenue lines,
 * each by id over time — the active ones, then those no longer used that have a figure in an included
 * month (a renamed segment with submitted figures continues as a new series, so both appear).
 */
export function segmentBlocks(model: Pick<C4Model, "input" | "months">): SegmentBlocks {
  const withFigures = new Set<string>();
  for (const month of model.months) {
    if (!month.included) continue;
    for (const id of Object.keys(month.segments)) withFigures.add(id);
  }
  const shown = model.input.segments
    .filter((segment) => segment.is_active || withFigures.has(segment.id))
    .sort(bySegmentDisplayOrder);
  return {
    company: shown.filter((segment) => segmentKind(segment) === "company"),
    scaleup: shown.filter((segment) => segmentKind(segment) === "scaleup"),
  };
}

/** A segment's name, with "(no longer used)" for a retired one. */
export function segmentLabel(segment: Pick<C4Segment, "name" | "is_active">): string {
  const name = segment.name.trim();
  return segment.is_active ? name : `${name} (no longer used)`;
}

/** Block headings of the Revenue Lines sheet (BRD B30). */
export const COMPANY_SEGMENTS_HEADING = "Company revenue segments (add up to total revenue)";
export const SCALEUP_LINES_HEADING = "ScaleUp revenue lines (need not add up to total revenue)";

/**
 * The sheet note on the two revenue breakdowns (only when the company has segments of either kind). With
 * every month included, it also says how months still open for changes show total revenue.
 */
export function segmentsNote(blocks: SegmentBlocks, include: C4Include): string | null {
  if (blocks.company.length === 0 && blocks.scaleup.length === 0) return null;
  const openMonths =
    include === "all" && blocks.company.length > 0
      ? " Months still open for changes show total revenue as the sum of their segments, as the monthly form calculates it."
      : "";
  return `Revenue segments are the company's own breakdown and add up to total revenue; ScaleUp revenue lines are set by ScaleUp for the company and need not add up. Segments no longer used are shown where they have figures.${openMonths}`;
}

type KpiLine = { kpi: C4Kpi; member: C4KpiMember | null; cellKey: string };

/** KPI rows: active KPIs (× active members), plus inactive KPIs/members that have values in included months. */
function kpiLines(model: C4Model): KpiLine[] {
  const hasValue = (cellKey: string) =>
    model.months.some((m) => {
      const stored = m.included ? m.kpis[cellKey] : undefined;
      return (
        stored !== undefined &&
        (stored.value_number !== null || stored.value_bool !== null || cleanText(stored.value_text) !== null)
      );
    });
  const lines: KpiLine[] = [];
  for (const kpi of model.input.kpis) {
    const candidates: KpiLine[] =
      kpi.dimension === null
        ? [{ kpi, member: null, cellKey: kpiCellKey(kpi.id, null) }]
        : kpi.members.map((member) => ({ kpi, member, cellKey: kpiCellKey(kpi.id, member.id) }));
    for (const line of candidates) {
      const active = kpi.is_active && (line.member === null || line.member.is_active);
      if (active || hasValue(line.cellKey)) lines.push(line);
    }
  }
  return lines;
}

/** A cell's value, number format and, optionally, an Excel note (shown when hovering over the cell). */
type CellContent = { value: number | string | null; format?: NumberFormatName; note?: string };

function kpiCellContent(kpi: C4Kpi, stored: C4StoredKpiValue | undefined): CellContent {
  if (!stored) return { value: null };
  switch (kpi.value_type) {
    case "boolean":
      return { value: stored.value_bool === null ? null : stored.value_bool ? "Yes" : "No" };
    case "text":
      return { value: cleanText(stored.value_text) };
    case "percent":
      return { value: pctFraction(toFiniteNumber(stored.value_number)), format: "pct" };
    case "currency":
      return { value: toFiniteNumber(stored.value_number), format: "money" };
    case "integer":
      return { value: toFiniteNumber(stored.value_number), format: "integer" };
    default:
      return { value: toFiniteNumber(stored.value_number), format: "decimal" };
  }
}

function kpiUnit(kpi: C4Kpi, currency: string): string {
  const unit = kpi.unit?.trim();
  if (unit) return unit;
  if (kpi.value_type === "currency") return currencySymbol(currency);
  if (kpi.value_type === "percent") return "%";
  return "";
}

type CustomNumberField = { key: string; label: string; field_type: FieldType };

/** Number fields beyond the seven system figures (e.g. "Additional numbers", team morale), by key. */
function customNumberFields(model: C4Model): CustomNumberField[] {
  const fields: CustomNumberField[] = [];
  const seen = new Set<string>();
  const templates = model.input.currentTemplate
    ? [model.input.currentTemplate, ...model.input.templates]
    : model.input.templates;
  for (const template of templates) {
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (field.is_system || SYSTEM_KEYS.includes(field.key) || seen.has(field.key)) continue;
        if (!NUMBER_FIELD_TYPES.includes(field.field_type)) continue;
        seen.add(field.key);
        fields.push({ key: field.key, label: field.label.trim() || field.key, field_type: field.field_type });
      }
    }
  }
  return fields;
}

function customFieldContent(field: CustomNumberField, stored: C4StoredValue | undefined): CellContent {
  const value = toFiniteNumber(stored?.value_number);
  switch (field.field_type) {
    case "percent":
      return { value: pctFraction(value), format: "pct" };
    case "currency":
      return { value, format: "money" };
    case "integer":
    case "rating":
      return { value, format: "integer" };
    default:
      return { value, format: "decimal" };
  }
}

// ---------------------------------------------------------------------------------------------
// Sheet writing helpers
// ---------------------------------------------------------------------------------------------

function writeContent(cell: Cell, content: CellContent): void {
  cell.value = content.value;
  if (typeof content.value === "number" && content.format) cell.numFmt = NUMBER_FORMATS[content.format];
  if (typeof content.value === "string") cell.alignment = { horizontal: "right", vertical: "top", wrapText: true };
  if (content.note) cell.note = content.note;
}

/**
 * Total revenue as a month shows it (in the reporting currency, or converted with `convert`), with a note
 * when it is a figure entered before the company's own segments were filled in (BRD B30).
 */
function revenueTotalContent(month: PreparedMonth, convert: (value: number | null) => number | null = (v) => v): CellContent {
  return {
    value: convert(month.financials.revenue_total),
    format: "money",
    ...(month.revenueEnteredEarlier ? { note: ENTERED_EARLIER_TOTAL_NOTE } : {}),
  };
}

function statusLabel(month: PreparedMonth | null): string {
  return month ? SUBMISSION_STATUS_META[month.status].label : "No update";
}

function includedCountText(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"} included`;
}

function includeNote(include: C4Include): string {
  return include === "approved"
    ? "Approved months only: months not yet approved are listed without figures."
    : "All months: figures of months not yet approved are included and marked by their status.";
}

function currencyNote(currency: string): string {
  return currency === "MYR" ? "Amounts in RM." : `Amounts in ${currency} (the company's reporting currency).`;
}

function freeze(sheet: Worksheet, xSplit: number, ySplit: number): void {
  sheet.views = [{ state: "frozen", xSplit, ySplit }];
}

function labelCell(row: Row, text: string, options: { bold?: boolean; indent?: number } = {}): Cell {
  const cell = row.getCell(1);
  cell.value = text;
  cell.font = { bold: options.bold ?? false };
  cell.alignment = { vertical: "top", wrapText: true, indent: options.indent ?? 0 };
  styleBodyCell(cell);
  return cell;
}

// ---------------------------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------------------------

const C4_HEADER_ROW = 4;
const C4_LABEL_WIDTH = 30;
const C4_HALF_WIDTH = 60;

function writeC4Sheet(workbook: ExcelJS.Workbook, model: C4Model): void {
  const { input, halves } = model;
  const sheet = workbook.addWorksheet("C4", { properties: { tabColor: { argb: "FFE2743A" } } });
  const lastCol = 1 + Math.max(1, halves.length);
  setColumnWidths(sheet, [C4_LABEL_WIDTH, ...halves.map(() => C4_HALF_WIDTH)]);

  const companyRow = sheet.getRow(1);
  companyRow.getCell(1).value = "Company";
  companyRow.getCell(1).font = { bold: true };
  const legal = input.company.legal_name?.trim();
  companyRow.getCell(2).value =
    legal && legal !== input.company.name ? `${input.company.name} (${legal})` : input.company.name;
  companyRow.getCell(2).font = { bold: true, size: 13 };
  if (lastCol > 2) sheet.mergeCells(1, 2, 1, lastCol);

  const exportedRow = sheet.getRow(2);
  exportedRow.getCell(1).value = "Exported";
  exportedRow.getCell(1).font = { bold: true };
  exportedRow.getCell(2).value = `${formatDateTime(input.generatedAt)} (Malaysia time). ${includeNote(input.include)}`;
  exportedRow.getCell(2).font = { italic: true, size: 9 };
  if (lastCol > 2) sheet.mergeCells(2, 2, 2, lastCol);

  const header = sheet.getRow(C4_HEADER_ROW);
  header.getCell(1).value = "Category";
  halves.forEach((half, index) => {
    header.getCell(index + 2).value = half.inProgress ? `Input Here (${half.period.label})` : half.period.label;
  });
  styleHeaderRow(header, 1, lastCol, { horizontal: "left" });

  const updated = sheet.getRow(C4_HEADER_ROW + 1);
  labelCell(updated, "Last Updated", { bold: true });
  halves.forEach((half, index) => {
    const cell = updated.getCell(index + 2);
    cell.value = lastUpdatedText(half) ?? "—";
    cell.font = { italic: true };
    styleBodyCell(cell);
  });

  let rowNumber = C4_HEADER_ROW + 2;
  if (model.narrativeRows.length === 0) {
    const row = sheet.getRow(rowNumber++);
    labelCell(row, "No narrative sections are defined in the reporting template.");
  }
  for (const narrativeRow of model.narrativeRows) {
    const row = sheet.getRow(rowNumber++);
    labelCell(row, narrativeRow.title, { bold: true });
    const texts = halves.map((half) => c4CellText(model, half, narrativeRow));
    texts.forEach((text, index) => {
      const cell = row.getCell(index + 2);
      cell.value = text;
      cell.alignment = { vertical: "top", wrapText: true };
      styleBodyCell(cell);
    });
    row.height = estimateRowHeight(texts.map((text) => ({ text, width: C4_HALF_WIDTH })), 30);
  }

  writeNote(
    sheet,
    rowNumber + 1,
    "Each cell lists that half-year's monthly entries, oldest first. Months without a narrative are listed as “No update”; nothing is filled in.",
  );

  freeze(sheet, 1, C4_HEADER_ROW + 1);
  applyPrintSetup(sheet, {
    titleRows: `${C4_HEADER_ROW}:${C4_HEADER_ROW + 1}`,
    titleColumns: "A:A",
    footer: `${input.company.name} · C4`,
  });
}

type FigureLine = {
  label: string;
  bold?: boolean;
  indent?: number;
  month: (month: PreparedMonth) => CellContent;
  half: (column: HalfColumn) => CellContent;
};

/** A label-only row that opens a group of lines (e.g. the company's revenue segments). */
type FigureHeading = { heading: string };
type FigureRow = FigureLine | FigureHeading;

const FIGURES_HEADER_ROW = 4;

function writeHeadingRow(row: Row, text: string, lastCol: number): void {
  const label = labelCell(row, text);
  label.font = { bold: true, italic: true };
  label.alignment = { vertical: "middle", wrapText: false };
  for (let col = 1; col <= lastCol; col++) {
    const cell = row.getCell(col);
    styleSubtleCell(cell);
    styleBodyCell(cell);
  }
}

function writeFigureRows(
  sheet: Worksheet,
  startRow: number,
  columns: readonly FigureColumn[],
  lines: readonly FigureRow[],
): number {
  let rowNumber = startRow;
  for (const line of lines) {
    const row = sheet.getRow(rowNumber++);
    if ("heading" in line) {
      writeHeadingRow(row, line.heading, columns.length + 1);
      continue;
    }
    labelCell(row, line.label, { bold: line.bold, indent: line.indent });
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 2);
      if (column.kind === "half") {
        writeContent(cell, line.half(column));
        styleSubtleCell(cell, { bold: true });
      } else if (column.month && column.month.included) {
        writeContent(cell, line.month(column.month));
        if (line.bold) cell.font = { ...cell.font, bold: true };
      } else {
        styleMutedCell(cell);
      }
      styleBodyCell(cell);
    });
  }
  return rowNumber;
}

function writeFigureHeader(
  sheet: Worksheet,
  columns: readonly FigureColumn[],
  firstHeader: string,
  include: C4Include,
): void {
  const header = sheet.getRow(FIGURES_HEADER_ROW);
  header.getCell(1).value = firstHeader;
  columns.forEach((column, index) => {
    header.getCell(index + 2).value = column.kind === "half" ? column.period.label : monthLabel(column.key);
  });
  styleHeaderRow(header, 1, columns.length + 1, { horizontal: "center" });
  header.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };

  const status = sheet.getRow(FIGURES_HEADER_ROW + 1);
  labelCell(status, "Status", { bold: true });
  columns.forEach((column, index) => {
    const cell = status.getCell(index + 2);
    if (column.kind === "half") {
      cell.value = includedCountText(column.included.length);
      styleSubtleCell(cell, { bold: true });
    } else {
      cell.value = statusLabel(column.month);
      if (!column.month || !column.month.included) styleMutedCell(cell);
      else if (include === "all" && column.month.status !== "approved") cell.font = { italic: true };
    }
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    styleBodyCell(cell);
  });
}

function runwayContent(cash: number | null, burn: number | null): CellContent {
  if (burn !== null && burn <= 0) return { value: "Cash-flow positive" };
  return { value: runwayMonths({ cash_in_bank: cash, burn_rate: burn }), format: "runway" };
}

function writeRevenueLinesSheet(workbook: ExcelJS.Workbook, model: C4Model): void {
  const { input, currency } = model;
  const sheet = workbook.addWorksheet("Revenue Lines");
  const columns = revenueLineColumns(model);
  setColumnWidths(sheet, [32, ...columns.map((column) => (column.kind === "half" ? 15 : 13))]);
  writeTitle(sheet, 1, `Revenue Lines · ${input.company.name}`);
  writeNote(
    sheet,
    2,
    `${currencyNote(currency)} ${includeNote(input.include)} Half-year columns: revenue and profit summed, cash and headcount at the latest month, burn averaged, runway = cash ÷ average burn.`,
  );

  if (columns.length === 0) {
    writeNote(sheet, FIGURES_HEADER_ROW, "No monthly updates yet.");
    applyPrintSetup(sheet, { footer: `${input.company.name} · Revenue Lines` });
    return;
  }
  writeFigureHeader(sheet, columns, `Line (${currencySymbol(currency)})`, input.include);

  const blocks = segmentBlocks(model);
  const note = segmentsNote(blocks, input.include);
  if (note) writeNote(sheet, 3, note);
  const money = (value: number | null): CellContent => ({ value, format: "money" });
  const segmentLine = (segment: C4Segment): FigureLine => ({
    label: segmentLabel(segment),
    indent: 1,
    month: (m) => money(m.segments[segment.id] ?? null),
    half: (h) => money(sumPresent(h.included.map((m) => m.segments[segment.id]))),
  });
  const lines: FigureRow[] = [
    // BRD B30: the company's own segments add up to total revenue; ScaleUp's lines are a separate view.
    ...(blocks.company.length > 0 ? [{ heading: COMPANY_SEGMENTS_HEADING }, ...blocks.company.map(segmentLine)] : []),
    {
      label: "Total revenue",
      bold: true,
      month: (m) => revenueTotalContent(m),
      half: (h) => money(h.totals.revenue_total),
    },
    ...(blocks.scaleup.length > 0 ? [{ heading: SCALEUP_LINES_HEADING }, ...blocks.scaleup.map(segmentLine)] : []),
    {
      label: "Gross profit",
      bold: true,
      month: (m) => money(m.financials.gross_profit),
      half: (h) => money(h.totals.gross_profit),
    },
    {
      label: "GP %",
      indent: 1,
      month: (m) => ({ value: pctFraction(gpPct(m.financials)), format: "pct" }),
      half: (h) => ({ value: pctFraction(h.totals.gp_pct), format: "pct" }),
    },
    {
      label: "Net profit",
      bold: true,
      month: (m) => money(m.financials.net_profit),
      half: (h) => money(h.totals.net_profit),
    },
    {
      label: "NP %",
      indent: 1,
      month: (m) => ({ value: pctFraction(npPct(m.financials)), format: "pct" }),
      half: (h) => ({ value: pctFraction(h.totals.np_pct), format: "pct" }),
    },
    {
      label: "Cash in bank (month end)",
      bold: true,
      month: (m) => money(m.financials.cash_in_bank),
      half: (h) => money(h.totals.cash_in_bank),
    },
    {
      label: "Monthly burn",
      month: (m) => money(m.financials.burn_rate),
      half: (h) => money(h.totals.avg_burn_rate),
    },
    {
      label: "Runway (months)",
      month: (m) =>
        isCashflowPositive(m.financials)
          ? { value: "Cash-flow positive" }
          : { value: runwayMonths(m.financials), format: "runway" },
      half: (h) => runwayContent(h.totals.cash_in_bank, h.totals.avg_burn_rate),
    },
    {
      label: "Headcount (full-time)",
      month: (m) => ({ value: m.financials.headcount_ft, format: "integer" }),
      half: (h) => ({ value: h.totals.headcount_ft, format: "integer" }),
    },
    {
      label: "Headcount (part-time)",
      month: (m) => ({ value: m.financials.headcount_pt, format: "integer" }),
      half: (h) => ({ value: h.totals.headcount_pt, format: "integer" }),
    },
    {
      label: "Revenue YoY %",
      month: (m) => ({ value: pctFraction(monthYoy(model, m)), format: "pct" }),
      half: (h) => ({ value: pctFraction(halfYoy(model, h.included)), format: "pct" }),
    },
  ];
  const afterFigures = writeFigureRows(sheet, FIGURES_HEADER_ROW + 2, columns, lines);

  if (input.fxVisible && currency !== "MYR") {
    const blockHeader = sheet.getRow(afterFigures + 1);
    blockHeader.getCell(1).value = `RM equivalent (${currency} × the month's FX rate to MYR; blank where no rate is set)`;
    styleHeaderRow(blockHeader, 1, columns.length + 1, { horizontal: "left" });
    const rm = (value: number | null): CellContent => ({ value, format: "money" });
    const rmSegmentLine = (segment: C4Segment): FigureLine => ({
      label: `${segmentLabel(segment)} (RM)`,
      indent: 1,
      month: (m) => rm(toRm(m, m.segments[segment.id] ?? null)),
      half: (h) => rm(sumRm(h.included, (m) => m.segments[segment.id] ?? null)),
    });
    const rmLines: FigureRow[] = [
      {
        label: `FX rate (${currency} to MYR)`,
        month: (m) => ({ value: m.fx, format: "fx" }),
        half: () => ({ value: null }),
      },
      ...(blocks.company.length > 0 ? [{ heading: COMPANY_SEGMENTS_HEADING }, ...blocks.company.map(rmSegmentLine)] : []),
      {
        label: "Total revenue (RM)",
        bold: true,
        month: (m) => revenueTotalContent(m, (value) => toRm(m, value)),
        half: (h) => rm(sumRm(h.included, (m) => m.financials.revenue_total)),
      },
      ...(blocks.scaleup.length > 0 ? [{ heading: SCALEUP_LINES_HEADING }, ...blocks.scaleup.map(rmSegmentLine)] : []),
      {
        label: "Gross profit (RM)",
        month: (m) => rm(toRm(m, m.financials.gross_profit)),
        half: (h) => rm(sumRm(h.included, (m) => m.financials.gross_profit)),
      },
      {
        label: "Net profit (RM)",
        month: (m) => rm(toRm(m, m.financials.net_profit)),
        half: (h) => rm(sumRm(h.included, (m) => m.financials.net_profit)),
      },
      {
        label: "Cash in bank (RM)",
        month: (m) => rm(toRm(m, m.financials.cash_in_bank)),
        half: (h) => rm(periodEndRm(h.included, (m) => m.financials.cash_in_bank)),
      },
      {
        label: "Monthly burn (RM)",
        month: (m) => rm(toRm(m, m.financials.burn_rate)),
        half: (h) => rm(averageRm(h.included, (m) => m.financials.burn_rate)),
      },
    ];
    writeFigureRows(sheet, afterFigures + 2, columns, rmLines);
  }

  freeze(sheet, 1, FIGURES_HEADER_ROW + 1);
  applyPrintSetup(sheet, {
    titleRows: `${FIGURES_HEADER_ROW}:${FIGURES_HEADER_ROW + 1}`,
    titleColumns: "A:A",
    footer: `${input.company.name} · Revenue Lines`,
  });
}

function writeKpisSheet(workbook: ExcelJS.Workbook, model: C4Model): void {
  const { input, currency } = model;
  const sheet = workbook.addWorksheet("KPIs");
  const columns = monthColumns(model);
  const labelColumns = 4;
  setColumnWidths(sheet, [30, 20, 12, 16, ...columns.map(() => 12)]);
  writeTitle(sheet, 1, `Company KPIs · ${input.company.name}`);
  writeNote(sheet, 2, `${includeNote(input.include)} Half-yearly KPIs are reported in June and December.`);

  const lines = kpiLines(model);
  const header = sheet.getRow(FIGURES_HEADER_ROW);
  ["KPI", "Member", "Unit", "Frequency"].forEach((text, index) => {
    header.getCell(index + 1).value = text;
  });
  columns.forEach((column, index) => {
    header.getCell(labelColumns + index + 1).value = monthLabel(column.key);
  });
  styleHeaderRow(header, 1, labelColumns + columns.length, { horizontal: "center" });
  for (let col = 1; col <= labelColumns; col++) {
    header.getCell(col).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  const status = sheet.getRow(FIGURES_HEADER_ROW + 1);
  labelCell(status, "Status", { bold: true });
  for (let col = 2; col <= labelColumns; col++) styleBodyCell(status.getCell(col));
  columns.forEach((column, index) => {
    const cell = status.getCell(labelColumns + index + 1);
    cell.value = statusLabel(column.month);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (!column.month || !column.month.included) styleMutedCell(cell);
    styleBodyCell(cell);
  });

  let rowNumber = FIGURES_HEADER_ROW + 2;
  if (lines.length === 0) {
    labelCell(sheet.getRow(rowNumber++), "No company KPIs are set up.");
  }
  for (const line of lines) {
    const row = sheet.getRow(rowNumber++);
    labelCell(row, line.kpi.is_active ? line.kpi.name : `${line.kpi.name} (inactive)`, { bold: true });
    const memberCell = row.getCell(2);
    memberCell.value = line.member
      ? `${line.member.name}${line.member.is_active ? "" : " (inactive)"}`
      : line.kpi.dimension
        ? line.kpi.dimension.name
        : "—";
    const unitCell = row.getCell(3);
    unitCell.value = kpiUnit(line.kpi, currency) || "—";
    const frequencyCell = row.getCell(4);
    frequencyCell.value = KPI_FREQUENCY_LABELS[line.kpi.frequency];
    for (const cell of [memberCell, unitCell, frequencyCell]) {
      cell.alignment = { vertical: "top", wrapText: true };
      styleBodyCell(cell);
    }
    columns.forEach((column, index) => {
      const cell = row.getCell(labelColumns + index + 1);
      if (column.month && column.month.included) {
        writeContent(cell, kpiCellContent(line.kpi, column.month.kpis[line.cellKey]));
      } else {
        styleMutedCell(cell);
      }
      styleBodyCell(cell);
    });
  }

  freeze(sheet, 2, FIGURES_HEADER_ROW + 1);
  applyPrintSetup(sheet, {
    titleRows: `${FIGURES_HEADER_ROW}:${FIGURES_HEADER_ROW + 1}`,
    titleColumns: "A:B",
    footer: `${input.company.name} · KPIs`,
  });
}

type GridColumn = {
  header: string;
  width: number;
  /** Written for every month (status, dates); otherwise only for included months. */
  always?: boolean;
  value: (month: PreparedMonth) => CellContent | Date | null;
};

function dateOnly(stamp: string | null): Date | null {
  const ms = parseInstant(stamp);
  return ms === null ? null : excelDate(todayMYT(ms));
}

function writeMonthlyGridSheet(workbook: ExcelJS.Workbook, model: C4Model): void {
  const { input, currency } = model;
  const sheet = workbook.addWorksheet("Monthly Grid");
  writeTitle(sheet, 1, `Monthly Grid · ${input.company.name}`);
  writeNote(sheet, 2, `${currencyNote(currency)} ${includeNote(input.include)}`);

  const blocks = segmentBlocks(model);
  const note = segmentsNote(blocks, input.include);
  if (note) writeNote(sheet, 3, note);
  const customFields = customNumberFields(model);
  const kpis = kpiLines(model);
  const money = (value: number | null): CellContent => ({ value, format: "money" });
  const showFx = input.fxVisible && currency !== "MYR";

  const columns: GridColumn[] = [
    { header: "Month", width: 11, always: true, value: (m) => excelDate(m.key) },
    { header: "Status", width: 18, always: true, value: (m) => ({ value: SUBMISSION_STATUS_META[m.status].label }) },
    { header: "Submitted", width: 13, always: true, value: (m) => dateOnly(m.submittedAt) },
    { header: "Approved", width: 13, always: true, value: (m) => dateOnly(m.approvedAt) },
    ...(showFx
      ? [
          {
            header: `FX rate (${currency} to MYR)`,
            width: 12,
            always: true,
            value: (m: PreparedMonth): CellContent => ({ value: m.fx, format: "fx" }),
          },
        ]
      : []),
    { header: "Total revenue", width: 14, value: (m) => revenueTotalContent(m) },
    // BRD B30: a column per segment of each kind (its name at the time; retired ones labelled).
    ...[...blocks.company, ...blocks.scaleup].map(
      (segment): GridColumn => ({
        header: `${REVENUE_SEGMENT_KIND_META[segmentKind(segment)].label}: ${segmentLabel(segment)}`,
        width: 15,
        value: (m) => money(m.segments[segment.id] ?? null),
      }),
    ),
    { header: "Gross profit", width: 14, value: (m) => money(m.financials.gross_profit) },
    { header: "Net profit", width: 14, value: (m) => money(m.financials.net_profit) },
    { header: "Cash in bank", width: 14, value: (m) => money(m.financials.cash_in_bank) },
    { header: "Monthly burn", width: 14, value: (m) => money(m.financials.burn_rate) },
    { header: "Headcount FT", width: 11, value: (m) => ({ value: m.financials.headcount_ft, format: "integer" }) },
    { header: "Headcount PT", width: 11, value: (m) => ({ value: m.financials.headcount_pt, format: "integer" }) },
    ...customFields.map(
      (field): GridColumn => ({
        header: field.label,
        width: 14,
        value: (m) => customFieldContent(field, m.values[field.key]),
      }),
    ),
    { header: "GP %", width: 9, value: (m) => ({ value: pctFraction(gpPct(m.financials)), format: "pct" }) },
    { header: "NP %", width: 9, value: (m) => ({ value: pctFraction(npPct(m.financials)), format: "pct" }) },
    {
      header: "Runway (months)",
      width: 13,
      value: (m) =>
        isCashflowPositive(m.financials)
          ? { value: "Cash-flow positive" }
          : { value: runwayMonths(m.financials), format: "runway" },
    },
    { header: "Revenue MoM %", width: 10, value: (m) => ({ value: pctFraction(monthMom(model, m)), format: "pct" }) },
    { header: "Revenue YoY %", width: 10, value: (m) => ({ value: pctFraction(monthYoy(model, m)), format: "pct" }) },
    ...kpis.map(
      (line): GridColumn => ({
        header: line.member ? `${line.kpi.name}: ${line.member.name}` : line.kpi.name,
        width: 16,
        value: (m) => kpiCellContent(line.kpi, m.kpis[line.cellKey]),
      }),
    ),
    {
      header: "Narrative",
      width: 12,
      value: (m) => ({ value: hasNarrative(model, m) ? "Provided" : "No update" }),
    },
  ];

  setColumnWidths(
    sheet,
    columns.map((column) => column.width),
  );
  const header = sheet.getRow(FIGURES_HEADER_ROW);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });
  styleHeaderRow(header, 1, columns.length, { horizontal: "center" });
  // Tall enough for the longest wrapped header (segment names can be up to 80 characters).
  header.height = estimateRowHeight(
    columns.map((column) => ({ text: column.header, width: column.width })),
    45,
  );

  let rowNumber = FIGURES_HEADER_ROW + 1;
  if (model.months.length === 0) writeNote(sheet, rowNumber++, "No monthly updates yet.");
  for (const month of model.months) {
    const row = sheet.getRow(rowNumber++);
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      if (column.always || month.included) {
        const content = column.value(month);
        if (content instanceof Date) {
          cell.value = content;
          cell.numFmt = index === 0 ? NUMBER_FORMATS.month : NUMBER_FORMATS.date;
          cell.alignment = { horizontal: "left" };
        } else if (content !== null) {
          writeContent(cell, content);
          if (typeof content.value === "string" && column.always) cell.alignment = { horizontal: "left" };
        }
      }
      if (!month.included) styleMutedCell(cell);
      styleBodyCell(cell);
    });
  }

  if (model.months.length > 0) {
    sheet.autoFilter = {
      from: { row: FIGURES_HEADER_ROW, column: 1 },
      to: { row: FIGURES_HEADER_ROW + model.months.length, column: columns.length },
    };
  }
  freeze(sheet, 1, FIGURES_HEADER_ROW);
  applyPrintSetup(sheet, {
    titleRows: `${FIGURES_HEADER_ROW}:${FIGURES_HEADER_ROW}`,
    titleColumns: "A:A",
    footer: `${input.company.name} · Monthly Grid`,
  });
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** Builds the C4 workbook (sheets "C4", "Revenue Lines", "KPIs", "Monthly Grid") from loaded data. */
export function buildC4Workbook(input: C4WorkbookInput): ExcelJS.Workbook {
  const model = buildC4Model(input);
  const workbook = new ExcelJS.Workbook();
  setWorkbookProperties(workbook, {
    title: `C4 workbook · ${input.company.name}`,
    created: new Date(parseInstant(input.generatedAt) ?? Date.now()),
  });
  writeC4Sheet(workbook, model);
  writeRevenueLinesSheet(workbook, model);
  writeKpisSheet(workbook, model);
  writeMonthlyGridSheet(workbook, model);
  return workbook;
}

/** Download file name, e.g. "Batik Boutique C4 workbook 2026-09-30.xlsx". */
export function c4WorkbookFileName(companyName: string, today: string, include: C4Include): string {
  return `${companyName} C4 workbook ${today}${include === "all" ? " (all months)" : ""}.xlsx`;
}
