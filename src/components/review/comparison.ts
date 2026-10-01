// The review page's comparison table (BRD A7): this month against the prior month and the same month last
// year, for revenue (the company's own revenue segments, then total revenue), ScaleUp's revenue lines (BRD
// B30), profitability, cash, headcount, the company's KPIs (per dimension member) and the template's
// additional numbers. Pure and client-safe; formatting lives in ./review-format.
import { segmentTargetLabel, type TargetOption } from "@/components/comments/target-labels";
import { REVENUE_SEGMENT_KIND_META, SYSTEM_FIELD_LABELS, type RevenueSegmentKind, type SystemFieldKey } from "@/lib/constants";
import { toFiniteNumber } from "@/lib/format";
import { gpPct, growthPct, isCashflowPositive, npPct, runwayMonths, type MonthlyFinancials } from "@/lib/metrics";
import { monthLabel } from "@/lib/periods";
import { fieldTarget, kpiCellKey, kpiTarget, segmentTarget } from "@/lib/targets";
import {
  segmentsForMonth,
  sumSegmentAmounts,
  type CompanyConfig,
  type KpiDefinition,
  type KpiDimensionMemberRow,
  type RevenueSegmentRow,
  type SubmissionBundle,
  type SubmissionKpiValueRow,
  type SubmissionValueRow,
  type SubmissionValues,
  type TemplateFieldRow,
} from "@/lib/types/domain";
import type { FieldType, KpiValueType, SubmissionStatus } from "@/lib/types/enums";
import { isKpiDueInMonth } from "@/lib/validation";

/** How a row's values are shown. */
export type ComparisonKind = "money" | "number" | "integer" | "percent" | "runway" | "boolean" | "text";

/**
 * How a row's change is measured: `growth` (%, growthPct), `points` (percentage points, for margins and
 * percentages), `months` (runway difference) or `none` (yes/no and text).
 */
export type ChangeKind = "growth" | "points" | "months" | "none";

export type ComparisonValue = number | boolean | string | null;

export type ComparisonRow = {
  /** Unique within the table. */
  key: string;
  label: string;
  /** Rows of one KPI's dimension members share the KPI name here (shown as a group heading). */
  group: string | null;
  /** Small print, e.g. "No longer used" or "Half-yearly". */
  note: string | null;
  kind: ComparisonKind;
  /** Display unit of number KPIs, e.g. "cameras". */
  unit: string | null;
  /** Comment target (§2.5); null for derived rows (margins, runway). */
  target: string | null;
  /**
   * The row's name out of context, for its comment popover and the new-thread target select, e.g.
   * "Revenue: Online", "ScaleUp revenue line: AOnePay", "Revenue per outlet (Mont Kiara)".
   */
  commentLabel: string;
  /** `total` rows are emphasised (total revenue), `derived` rows are calculated by the platform. */
  emphasis: "normal" | "total" | "derived";
  current: ComparisonValue;
  previous: ComparisonValue;
  lastYear: ComparisonValue;
  /** Runway rows: which months were cash-flow positive (burn 0). */
  cashflowPositive: { current: boolean; previous: boolean; lastYear: boolean } | null;
  changeKind: ChangeKind;
  /** Change against the prior month (see ChangeKind); null when it cannot be computed. */
  change: number | null;
  /** Change against the same month last year. */
  yoy: number | null;
};

export type ComparisonSection = {
  key: string;
  title: string;
  /** One line under the title, e.g. how the revenue breakdown relates to total revenue. */
  description: string | null;
  rows: ComparisonRow[];
};

export type ComparisonInput = Pick<
  SubmissionBundle,
  "submission" | "config" | "template" | "current" | "previous" | "lastYear" | "financials"
>;

type Triple<T> = { current: T; previous: T; lastYear: T };

/** Note on a revenue segment that has been retired (renamed as a new series, or removed). */
export const RETIRED_SEGMENT_NOTE = "No longer used";

export function changeKindFor(kind: ComparisonKind): ChangeKind {
  switch (kind) {
    case "money":
    case "number":
    case "integer":
      return "growth";
    case "percent":
      return "points";
    case "runway":
      return "months";
    default:
      return "none";
  }
}

/** Change from `base` to `current`: growth %, a difference (points / months), or null. */
export function computeChange(changeKind: ChangeKind, current: ComparisonValue, base: ComparisonValue): number | null {
  if (typeof current !== "number" || typeof base !== "number") return null;
  if (changeKind === "growth") return growthPct(current, base);
  if (changeKind === "points" || changeKind === "months") {
    const difference = current - base;
    return Number.isFinite(difference) ? Math.round(difference * 1e6) / 1e6 + 0 : null;
  }
  return null;
}

type RowInput = Pick<ComparisonRow, "key" | "label" | "kind" | "target" | "current" | "previous" | "lastYear"> &
  Partial<Pick<ComparisonRow, "group" | "note" | "unit" | "emphasis" | "cashflowPositive" | "commentLabel">>;

function makeRow(base: RowInput): ComparisonRow {
  const changeKind = changeKindFor(base.kind);
  const group = base.group ?? null;
  return {
    note: null,
    unit: null,
    emphasis: "normal",
    cashflowPositive: null,
    ...base,
    group,
    commentLabel: base.commentLabel ?? (group ? `${group} (${base.label})` : base.label),
    changeKind,
    change: computeChange(changeKind, base.current, base.previous),
    yoy: computeChange(changeKind, base.current, base.lastYear),
  };
}

function hasValue(value: ComparisonValue): boolean {
  return value !== null && value !== "";
}

function anyValue(values: Triple<ComparisonValue>): boolean {
  return hasValue(values.current) || hasValue(values.previous) || hasValue(values.lastYear);
}

/** The template's label for a system field (templates may relabel them), else the default label. */
function systemLabel(input: ComparisonInput, key: SystemFieldKey): string {
  for (const section of input.template.sections) {
    const field = section.fields.find((f) => f.key === key);
    if (field?.label.trim()) return field.label.trim();
  }
  return SYSTEM_FIELD_LABELS[key];
}

/**
 * A month's financials as the review shows them (BRD B30). While a month is open for changes (draft,
 * changes requested) and the company has revenue segments of its own, total revenue is their sum once one
 * has an amount: the stored total can be out of date after the owner changed the segments, until the
 * month is next saved — the monthly form and the exports show it the same way (src/lib/exports/segments.ts
 * shownRevenueTotal). Submitted and approved months, and companies without segments of their own, keep
 * their stored figures. ScaleUp revenue lines never count towards total revenue.
 */
export function shownFinancials(
  financials: MonthlyFinancials,
  month: { status: SubmissionStatus; values: Pick<SubmissionValues, "segments"> },
  config: Pick<CompanyConfig, "segments">,
): MonthlyFinancials {
  if (!isOpenStatus(month.status)) return financials;
  const own = segmentsForMonth(config, month.values, true).company;
  if (own.length === 0) return financials;
  const calculated = sumSegmentAmounts(own, month.values.segments);
  return calculated === null || calculated === financials.revenue_total
    ? financials
    : { ...financials, revenue_total: calculated };
}

function financialsTriple(input: ComparisonInput): Triple<MonthlyFinancials | null> {
  return {
    current: shownFinancials(input.financials, { status: input.submission.status, values: input.current }, input.config),
    previous: input.previous
      ? shownFinancials(
          input.previous.financials,
          { status: input.previous.submission.status, values: input.previous.values },
          input.config,
        )
      : null,
    lastYear: input.lastYear
      ? shownFinancials(
          input.lastYear.financials,
          { status: input.lastYear.submission.status, values: input.lastYear.values },
          input.config,
        )
      : null,
  };
}

function valuesTriple(input: ComparisonInput): Triple<SubmissionValues | null> {
  return {
    current: input.current,
    previous: input.previous?.values ?? null,
    lastYear: input.lastYear?.values ?? null,
  };
}

function mapTriple<T, U>(triple: Triple<T>, fn: (value: T) => U): Triple<U> {
  return { current: fn(triple.current), previous: fn(triple.previous), lastYear: fn(triple.lastYear) };
}

function systemRow(
  input: ComparisonInput,
  key: SystemFieldKey,
  kind: ComparisonKind,
  emphasis: ComparisonRow["emphasis"] = "normal",
): ComparisonRow {
  const values = mapTriple(financialsTriple(input), (f) => (f ? f[key] : null));
  return makeRow({ key: `field:${key}`, label: systemLabel(input, key), kind, target: fieldTarget(key), emphasis, ...values });
}

// ---------------------------------------------------------------------------------------------
// Revenue segments (BRD B30)
// ---------------------------------------------------------------------------------------------

/**
 * Whether a month is still open for changes (draft, changes requested): such a month follows the company's
 * current revenue segments, while a submitted or approved month keeps exactly the segments it has figures
 * for (segmentsForMonth, BRD B30).
 */
export function isOpenStatus(status: SubmissionStatus): boolean {
  return status === "draft" || status === "changes_requested";
}

type MonthState = { status: SubmissionStatus; values: SubmissionValues };

function monthsTriple(input: ComparisonInput): Triple<MonthState | null> {
  return {
    current: { status: input.submission.status, values: input.current },
    previous: input.previous ? { status: input.previous.submission.status, values: input.previous.values } : null,
    lastYear: input.lastYear ? { status: input.lastYear.submission.status, values: input.lastYear.values } : null,
  };
}

/** The segments of one kind each month shows (segmentsForMonth; none for a month without an update). */
function shownSegments(input: ComparisonInput, kind: RevenueSegmentKind): Triple<RevenueSegmentRow[]> {
  return mapTriple(monthsTriple(input), (month): RevenueSegmentRow[] =>
    month ? segmentsForMonth(input.config, month.values, isOpenStatus(month.status))[kind] : [],
  );
}

/**
 * The rows of one revenue breakdown, matched across the three months by segment id: each month shows the
 * segments `segmentsForMonth` gives it (an open month: the current segments; a submitted or approved one:
 * the segments it has figures for, retired ones included), and a segment a month does not show reads as
 * no value there — so a renamed segment's new series and its old name are separate rows, each with a dash
 * in the months where it did not exist. Order: this month's segments as it shows them, then those only the
 * prior month or the same month last year show.
 */
function segmentRows(input: ComparisonInput, kind: RevenueSegmentKind): ComparisonRow[] {
  const months = monthsTriple(input);
  const shown = shownSegments(input, kind);
  const segments: RevenueSegmentRow[] = [];
  const seen = new Set<string>();
  for (const segment of [...shown.current, ...shown.previous, ...shown.lastYear]) {
    if (seen.has(segment.id)) continue;
    seen.add(segment.id);
    segments.push(segment);
  }

  return segments.map((segment) => {
    const amount = (key: keyof Triple<unknown>): number | null =>
      shown[key].some((candidate) => candidate.id === segment.id)
        ? toFiniteNumber(months[key]?.values.segments[segment.id])
        : null;
    return makeRow({
      key: `segment:${segment.id}`,
      label: segment.name,
      commentLabel: segmentTargetLabel(segment),
      note: segment.is_active ? null : RETIRED_SEGMENT_NOTE,
      kind: "money",
      target: segmentTarget(segment.id),
      current: amount("current"),
      previous: amount("previous"),
      lastYear: amount("lastYear"),
    });
  });
}

/**
 * The month's ScaleUp revenue lines added up (computeFlags' `scaleupLinesTotal`, BRD B30): the lines the
 * month shows (segmentsForMonth), null when none has an amount.
 */
export function scaleupLinesTotal(input: Pick<ComparisonInput, "submission" | "config" | "current">): number | null {
  const shown = segmentsForMonth(input.config, input.current, isOpenStatus(input.submission.status));
  return sumSegmentAmounts(shown.scaleup, input.current.segments);
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/**
 * The prior month's label when the company's own revenue segments this month differ from that month's
 * (added, renamed as a new series or removed — BRD B30's comparability concern), else null.
 */
export function companySegmentsChangedSince(input: ComparisonInput): string | null {
  if (!input.previous) return null;
  const shown = shownSegments(input, "company");
  const current = new Set(shown.current.map((segment) => segment.id));
  const previous = new Set(shown.previous.map((segment) => segment.id));
  const same = current.size === previous.size && [...current].every((id) => previous.has(id));
  return same ? null : monthLabel(input.previous.submission.month);
}

/** The company's own revenue segments (they add up to total revenue), then total revenue. */
function revenueSection(input: ComparisonInput): ComparisonSection {
  const segments = segmentRows(input, "company");
  const total = systemRow(input, "revenue_total", "money", segments.length > 0 ? "total" : "normal");
  const changedSince = segments.length > 0 ? companySegmentsChangedSince(input) : null;
  const description =
    segments.length === 0
      ? null
      : `Revenue segments defined by the company. They add up to total revenue.${
          changedSince ? ` This month's segments differ from those of ${changedSince}, so some rows do not compare like for like.` : ""
        }`;
  return { key: "revenue", title: "Revenue", description, rows: [...segments, total] };
}

/** ScaleUp's revenue lines for the company: reported every month, no sum rule (left out when there are none). */
function scaleupLinesSection(input: ComparisonInput): ComparisonSection {
  return {
    key: "scaleup_lines",
    title: REVENUE_SEGMENT_KIND_META.scaleup.plural,
    description: "Defined by ScaleUp for this company. They need not add up to total revenue.",
    rows: segmentRows(input, "scaleup"),
  };
}

function profitabilitySection(input: ComparisonInput): ComparisonSection {
  const financials = financialsTriple(input);
  return {
    key: "profitability",
    title: "Profitability",
    description: null,
    rows: [
      systemRow(input, "gross_profit", "money"),
      makeRow({
        key: "derived:gp_pct",
        label: "GP %",
        kind: "percent",
        target: null,
        emphasis: "derived",
        ...mapTriple(financials, (f) => gpPct(f)),
      }),
      systemRow(input, "net_profit", "money"),
      makeRow({
        key: "derived:np_pct",
        label: "NP %",
        kind: "percent",
        target: null,
        emphasis: "derived",
        ...mapTriple(financials, (f) => npPct(f)),
      }),
    ],
  };
}

function cashSection(input: ComparisonInput): ComparisonSection {
  const financials = financialsTriple(input);
  const positive = mapTriple(financials, (f) => isCashflowPositive(f));
  const runway = mapTriple(financials, (f) => runwayMonths(f));
  return {
    key: "cash",
    title: "Cash and burn",
    description: null,
    rows: [
      systemRow(input, "cash_in_bank", "money"),
      systemRow(input, "burn_rate", "money"),
      makeRow({
        key: "derived:runway",
        label: "Runway",
        kind: "runway",
        target: null,
        emphasis: "derived",
        cashflowPositive: positive,
        ...runway,
      }),
    ],
  };
}

function headcountSection(input: ComparisonInput): ComparisonSection {
  return {
    key: "headcount",
    title: "Headcount",
    description: null,
    rows: [systemRow(input, "headcount_ft", "integer"), systemRow(input, "headcount_pt", "integer")],
  };
}

function kpiKind(valueType: KpiValueType): ComparisonKind {
  switch (valueType) {
    case "currency":
      return "money";
    case "integer":
      return "integer";
    case "percent":
      return "percent";
    case "boolean":
      return "boolean";
    case "text":
      return "text";
    default:
      return "number";
  }
}

/** A KPI cell's stored value in the column of its value type. */
export function kpiCellValue(valueType: KpiValueType, row: SubmissionKpiValueRow | undefined): ComparisonValue {
  if (!row) return null;
  if (valueType === "boolean") return typeof row.value_bool === "boolean" ? row.value_bool : null;
  if (valueType === "text") return row.value_text?.trim() || null;
  return toFiniteNumber(row.value_number);
}

function kpiSection(input: ComparisonInput): ComparisonSection {
  const values = valuesTriple(input);
  const month = input.submission.month;
  const dimensionMembers = new Map(input.config.dimensions.map((dimension) => [dimension.id, dimension.members]));

  const rows = input.config.kpis.flatMap((kpi: KpiDefinition): ComparisonRow[] => {
    const due = kpi.is_active && isKpiDueInMonth(kpi, month);
    const kind = kpiKind(kpi.value_type);
    const unit = kind === "number" || kind === "integer" ? kpi.unit?.trim() || null : null;
    const kpiNote = !kpi.is_active ? "Inactive KPI" : kpi.frequency === "half_yearly" ? "Half-yearly" : null;
    const cell = (member: KpiDimensionMemberRow | null) =>
      mapTriple(values, (v) => (v ? kpiCellValue(kpi.value_type, v.kpis[kpiCellKey(kpi.id, member?.id ?? null)]) : null));

    if (kpi.dimension_id === null) {
      const triple = cell(null);
      if (!due && !anyValue(triple)) return [];
      return [
        makeRow({ key: `kpi:${kpi.id}`, label: kpi.name, note: kpiNote, kind, unit, target: kpiTarget(kpi.id), ...triple }),
      ];
    }

    const members = dimensionMembers.get(kpi.dimension_id) ?? kpi.members;
    return members.flatMap((member): ComparisonRow[] => {
      const triple = cell(member);
      if (!(due && member.is_active) && !anyValue(triple)) return [];
      return [
        makeRow({
          key: `kpi:${kpi.id}:${member.id}`,
          label: member.name,
          group: kpi.name,
          note: member.is_active ? kpiNote : "Inactive",
          kind,
          unit,
          target: kpiTarget(kpi.id, member.id),
          ...triple,
        }),
      ];
    });
  });

  return { key: "kpis", title: "Company KPIs", description: null, rows };
}

function fieldKind(fieldType: FieldType): ComparisonKind {
  switch (fieldType) {
    case "currency":
      return "money";
    case "integer":
      return "integer";
    case "percent":
      return "percent";
    case "number":
    case "rating":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "text";
  }
}

/** A template field's stored value in the column of its type (tags joined with commas). */
export function fieldValue(fieldType: FieldType, row: SubmissionValueRow | undefined): ComparisonValue {
  if (!row) return null;
  switch (fieldType) {
    case "currency":
    case "number":
    case "integer":
    case "percent":
    case "rating":
      return toFiniteNumber(row.value_number);
    case "boolean":
      return typeof row.value_json === "boolean" ? row.value_json : null;
    case "tags": {
      const tags = Array.isArray(row.value_json) ? row.value_json.filter((tag) => typeof tag === "string") : [];
      return tags.length > 0 ? tags.join(", ") : null;
    }
    default:
      return row.value_text?.trim() || null;
  }
}

function customSections(input: ComparisonInput): ComparisonSection[] {
  const values = valuesTriple(input);
  return input.template.sections
    .filter((section) => section.kind === "custom_numbers")
    .map((section) => ({
      key: `section:${section.key}`,
      title: section.title,
      description: null,
      rows: section.fields.map((field: TemplateFieldRow) =>
        makeRow({
          key: `field:${field.key}`,
          label: field.label,
          kind: fieldKind(field.field_type),
          target: fieldTarget(field.key),
          ...mapTriple(values, (v) => (v ? fieldValue(field.field_type, v.values[field.key]) : null)),
        }),
      ),
    }));
}

/**
 * The comparison table's sections, in order: Revenue (the company's own revenue segments, then total
 * revenue), ScaleUp revenue lines (BRD B30: no total), Profitability (GP, GP %, NP, NP %), Cash and burn
 * (cash, burn, runway), Headcount, Company KPIs (KPIs due this month — per active dimension member — plus
 * any other cell with a value in one of the three months) and the template's additional-numbers sections.
 * Revenue segments are matched across the months by id (see segmentRows). Empty sections are left out.
 */
export function buildComparisonSections(input: ComparisonInput): ComparisonSection[] {
  return [
    revenueSection(input),
    scaleupLinesSection(input),
    profitabilitySection(input),
    cashSection(input),
    headcountSection(input),
    kpiSection(input),
    ...customSections(input),
  ].filter((section) => section.rows.length > 0);
}

/**
 * What a reviewer can start a comment thread on from the review page's comments panel: every row of the
 * comparison table that has a target, grouped by its section, then the narrative and founder-pulse fields
 * grouped by theirs ('General' is added by the select).
 */
export function reviewTargetOptions(
  sections: ReadonlyArray<ComparisonSection>,
  narrative: ReadonlyArray<{ title: string; fields: ReadonlyArray<{ target: string; label: string }> }>,
): TargetOption[] {
  const options: TargetOption[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.target) options.push({ value: row.target, label: row.commentLabel, group: section.title });
    }
  }
  for (const section of narrative) {
    for (const field of section.fields) options.push({ value: field.target, label: field.label, group: section.title });
  }
  return options;
}
