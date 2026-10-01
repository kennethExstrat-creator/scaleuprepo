/**
 * Historical months import (BRD §6.1 "earlier history comes from the workbook migration", §12 "Historical
 * data (H2 2024 to H1 2026) is migrated from existing C4 workbooks at launch", B3). Used by
 * scripts/import-history.ts; tested against PGlite in tests/features/history-import.
 *
 * Months BEFORE a company's reporting start month (any month up to the last completed one for a company
 * that is not reporting yet) are created as APPROVED monthly updates, as a trusted system caller (a direct
 * database connection: audited with actor role "system" and action "import"):
 *   - the month's reporting period, when it does not exist yet (due day from platform_settings, template =
 *     the default template's published version unless one is given);
 *   - the submission (status approved, revision 1, submitted / approved now, no submitter or approver) and
 *     an "approved" timeline event "Imported from the historical workbook (<file>)";
 *   - its values: template fields by key (the seven core figures, narrative, founder pulse), revenue by the
 *     company's own segments (`segment:<name>`) and ScaleUp's revenue lines (`line:<name>`), company KPIs
 *     (`kpi:<name>` or `kpi:<name> [<member>]`).
 * Months already on the platform are skipped (never changed), so a re-run is harmless. Everything is
 * checked before anything is written; the CLI runs the whole import in ONE transaction (rolled back in a
 * dry run).
 *
 * Plain Node (tsx): no server-only imports.
 */
import { NON_NEGATIVE_FIELD_KEYS, REVENUE_SUM_TOLERANCE, SYSTEM_FIELD_KEYS, SYSTEM_FIELD_LABELS } from "../../src/lib/constants";
import { formatNumberTrimmed, parseNumberInput } from "../../src/lib/format";
import {
  addMonths,
  compareMonths,
  dueDateFor,
  lastCompletedMonth,
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  monthKeyToDate,
  monthLabel,
  parseMonthKey,
  type MonthKey,
} from "../../src/lib/periods";
import type { Json } from "../../src/lib/supabase/database.types";
import { normaliseSegmentName, parseFieldOptions, parseFieldValidation } from "../../src/lib/types/domain";
import type { FieldType, KpiFrequency, KpiValueType } from "../../src/lib/types/enums";
import { roundToScale } from "../../src/components/submission-form/draft";
import type { CellValue, Table } from "./tabular";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** What the import needs from a database connection (postgres.js `unsafe`, or PGlite in tests). */
export type SqlExecutor = { query<T>(text: string, params?: unknown[]): Promise<T[]> };

export type SegmentKind = "company" | "scaleup";

export type ImportOptions = {
  /** Accept months with core figures missing (reported as warnings); otherwise they are errors. */
  allowMissing: boolean;
  /** Add segments and revenue lines the company does not have as rows no longer in use (retired). */
  createSegments: boolean;
  /** Template version for reporting months the import creates; default the default template's published version. */
  templateVersionId: string | null;
  /** Today in Malaysia time ('YYYY-MM-DD'): only months before the current month can be imported. */
  today: string;
};

export type ImportMessage = { source: string; message: string };

type CompanyInfo = {
  id: string;
  name: string;
  status: string;
  reporting_start_month: string | null;
};

type FieldInfo = {
  template_version_id: string;
  key: string;
  label: string;
  field_type: FieldType;
  options: Json | null;
  validation: Json | null;
};

type SegmentInfo = {
  id: string;
  company_id: string;
  name: string;
  kind: string;
  is_active: boolean;
  sort_order: number;
  retired_at: string | null;
};

type KpiInfo = {
  id: string;
  company_id: string;
  name: string;
  value_type: KpiValueType;
  frequency: KpiFrequency;
  dimension_id: string | null;
};

type MemberInfo = { id: string; dimension_id: string; name: string; is_active: boolean };

type PeriodInfo = { id: string; month: string; due_date: string; template_version_id: string };

/** Everything the plan is checked against, read from the database. */
export type ImportContext = {
  companies: CompanyInfo[];
  dueDay: number;
  /** The template version for new reporting months (null when none is published). */
  defaultTemplateVersionId: string | null;
  periods: PeriodInfo[];
  /** Fields of every template version that matters (existing periods' and the default). */
  fields: FieldInfo[];
  segments: SegmentInfo[];
  kpis: KpiInfo[];
  members: MemberInfo[];
  /** Months the companies already have on the platform (company id → 'YYYY-MM' → status). */
  existing: Map<string, Map<MonthKey, string>>;
};

/** A segment a month refers to: an existing row, or one the import adds (retired). */
type SegmentRef = { existingId: string } | { create: string /* key into PlannedCompany.newSegments */ };

type PlannedValue = { key: string; value_number: number | null; value_text: string | null; value_json: Json | null };
type PlannedSegmentValue = { segment: SegmentRef; amount: number };
type PlannedKpiValue = {
  kpi_id: string;
  member_id: string | null;
  value_number: number | null;
  value_text: string | null;
  value_bool: boolean | null;
};

export type PlannedMonth = {
  source: string;
  month: MonthKey;
  values: PlannedValue[];
  segments: PlannedSegmentValue[];
  kpis: PlannedKpiValue[];
};

export type NewSegment = { key: string; kind: SegmentKind; name: string; sortOrder: number; lastMonth: MonthKey };

export type PlannedCompany = {
  companyId: string;
  companyName: string;
  files: string[];
  months: PlannedMonth[];
  newSegments: NewSegment[];
};

export type ImportPlan = {
  companies: PlannedCompany[];
  /** Reporting months the import creates ('YYYY-MM'), oldest first. */
  newPeriods: MonthKey[];
  /** Template version of the reporting months the import creates. */
  templateVersionId: string | null;
  errors: ImportMessage[];
  warnings: ImportMessage[];
  /** Months already on the platform (left unchanged). */
  skipped: ImportMessage[];
};

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

export type Column =
  | { kind: "company" }
  | { kind: "month" }
  | { kind: "ignored" }
  | { kind: "field"; key: string }
  | { kind: "segment"; segmentKind: SegmentKind; name: string }
  | { kind: "kpi"; name: string; member: string | null };

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * What a header names: `company`, `month`, a template field key (`revenue_total`, `key_milestones`, …),
 * `segment:<name>` (the company's own revenue segment), `line:<name>` (a ScaleUp revenue line),
 * `kpi:<name>` / `kpi:<name> [<member>]`; headers starting with `#` are ignored (notes). Null = unknown.
 */
export function classifyHeader(header: string): Column | null {
  const text = header.trim();
  const lower = text.toLowerCase();
  if (lower === "company") return { kind: "company" };
  if (lower === "month") return { kind: "month" };
  if (text.startsWith("#")) return { kind: "ignored" };
  const segment = /^(segment|line)\s*:\s*(.+)$/i.exec(text);
  if (segment) {
    const name = normaliseSegmentName(segment[2]);
    if (!name) return null;
    return { kind: "segment", segmentKind: segment[1].toLowerCase() === "segment" ? "company" : "scaleup", name };
  }
  const kpi = /^kpi\s*:\s*(.+?)\s*(?:\[\s*(.+?)\s*\])?$/i.exec(text);
  if (kpi) return { kind: "kpi", name: kpi[1].trim(), member: kpi[2]?.trim() || null };
  if (FIELD_KEY_RE.test(lower)) return { kind: "field", key: lower };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------------------------

const MONTH_NAME_INDEX = new Map<string, number>();
MONTH_NAMES_SHORT.forEach((name, index) => MONTH_NAME_INDEX.set(name.toLowerCase(), index + 1));
MONTH_NAMES_LONG.forEach((name, index) => MONTH_NAME_INDEX.set(name.toLowerCase(), index + 1));
MONTH_NAME_INDEX.set("sept", 9);

/** A month cell: 'YYYY-MM', 'YYYY-MM-DD', 'Jul 2025', 'July 2025', or an Excel date. Null when unreadable. */
export function parseMonthCell(value: CellValue): MonthKey | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return parseMonthKey(`${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (iso) {
    const key = `${iso[1]}-${iso[2].padStart(2, "0")}`;
    if (iso[3] !== undefined && parseMonthKey(`${key}-${iso[3].padStart(2, "0")}`) === null) return null;
    return parseMonthKey(key);
  }
  const named = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTH_NAME_INDEX.get(named[1].toLowerCase());
    return month ? parseMonthKey(`${named[2]}-${String(month).padStart(2, "0")}`) : null;
  }
  return null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function textOf(value: CellValue): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

/** A number cell (Excel numbers as they are; text like '1,234.50', 'RM 1,234', '(1,000)'; a trailing % for percent). */
export function parseNumberCell(value: CellValue, options: { percent?: boolean } = {}): Parsed<number> {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, message: "is not a number" };
  }
  if (typeof value !== "string") return { ok: false, message: "must be a number" };
  const text = options.percent ? value.trim().replace(/\s*%$/, "") : value.trim();
  const parsed = parseNumberInput(text);
  return parsed === null ? { ok: false, message: `must be a number (got "${value.trim()}")` } : { ok: true, value: parsed };
}

const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

/** A Yes/No cell. */
export function parseBooleanCell(value: CellValue): Parsed<boolean> {
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number" && (value === 0 || value === 1)) return { ok: true, value: value === 1 };
  const text = textOf(value).toLowerCase();
  if (YES.has(text)) return { ok: true, value: true };
  if (NO.has(text)) return { ok: true, value: false };
  return { ok: false, message: `must be Yes or No (got "${textOf(value)}")` };
}

/**
 * Rounds to `scale` decimals the way Postgres stores a JSON number in numeric(p, scale): exact decimal
 * rounding of the number's shortest text, half away from zero (the monthly form's own rule).
 */
export function roundTo(value: number, scale: number): number {
  return roundToScale(value, scale);
}

const MAX_ABS = 1e15;
const TEXT_MAX = 20_000;
const KPI_TEXT_MAX = 2_000;
const TAGS_MAX = 50;

function amountText(value: number): string {
  return formatNumberTrimmed(value, 2);
}

/** One template field value in its storage column (§2.2), with the database's input rules. */
function parseFieldValue(field: FieldInfo, cell: CellValue): Parsed<PlannedValue> {
  const base = { key: field.key, value_number: null, value_text: null, value_json: null };
  const validation = parseFieldValidation(field.validation) ?? {};
  switch (field.field_type) {
    case "currency":
    case "number":
    case "integer":
    case "percent":
    case "rating": {
      const parsed = parseNumberCell(cell, { percent: field.field_type === "percent" });
      if (!parsed.ok) return parsed;
      const value = roundTo(parsed.value, 4);
      if (Math.abs(value) >= MAX_ABS) return { ok: false, message: "is too large" };
      const integer = field.field_type === "integer" || field.field_type === "rating";
      if (integer && !Number.isInteger(value)) return { ok: false, message: "must be a whole number" };
      const nonNegative =
        (NON_NEGATIVE_FIELD_KEYS as readonly string[]).includes(field.key) ||
        validation.allow_negative === false ||
        validation.min === 0;
      if (value < 0 && nonNegative) return { ok: false, message: "cannot be negative" };
      if (field.field_type === "rating") {
        const rating = parseFieldOptions({ field_type: "rating", options: field.options }).rating;
        const min = rating?.min ?? 1;
        const max = rating?.max ?? 5;
        if (value < min || value > max) return { ok: false, message: `must be between ${min} and ${max}` };
      } else {
        if (validation.min !== undefined && value < validation.min) {
          return { ok: false, message: `must be at least ${formatNumberTrimmed(validation.min, 4)}` };
        }
        if (validation.max !== undefined && value > validation.max) {
          return { ok: false, message: `must be at most ${formatNumberTrimmed(validation.max, 4)}` };
        }
      }
      return { ok: true, value: { ...base, value_number: value } };
    }
    case "text":
    case "long_text": {
      const text = textOf(cell).replace(/\r\n?/g, "\n");
      const max = validation.max_length ?? TEXT_MAX;
      if (text.length > max) return { ok: false, message: `is longer than ${max.toLocaleString("en-GB")} characters` };
      return { ok: true, value: { ...base, value_text: text } };
    }
    case "picklist": {
      const choices = parseFieldOptions({ field_type: "picklist", options: field.options }).choices;
      const text = textOf(cell);
      const choice = choices.find((option) => option.toLowerCase() === text.toLowerCase());
      if (!choice) return { ok: false, message: `must be one of: ${choices.join(", ")} (got "${text}")` };
      return { ok: true, value: { ...base, value_text: choice } };
    }
    case "tags": {
      const choices = parseFieldOptions({ field_type: "tags", options: field.options }).choices;
      const tags: string[] = [];
      for (const raw of textOf(cell).split(";")) {
        const tag = raw.trim();
        if (!tag) continue;
        const choice = choices.find((option) => option.toLowerCase() === tag.toLowerCase());
        if (!choice) return { ok: false, message: `has a tag that is not one of the options: "${tag}" (separate tags with ";")` };
        if (!tags.includes(choice)) tags.push(choice);
      }
      if (tags.length > TAGS_MAX) return { ok: false, message: `has more than ${TAGS_MAX} tags` };
      return { ok: true, value: { ...base, value_json: tags } };
    }
    case "boolean": {
      const parsed = parseBooleanCell(cell);
      return parsed.ok ? { ok: true, value: { ...base, value_json: parsed.value } } : parsed;
    }
  }
}

/** One KPI value in its column (§2.4: whole numbers for integer KPIs, Yes/No, text up to 2,000 characters). */
function parseKpiValue(kpi: KpiInfo, cell: CellValue): Parsed<Omit<PlannedKpiValue, "kpi_id" | "member_id">> {
  const base = { value_number: null, value_text: null, value_bool: null };
  switch (kpi.value_type) {
    case "number":
    case "integer":
    case "currency":
    case "percent": {
      const parsed = parseNumberCell(cell, { percent: kpi.value_type === "percent" });
      if (!parsed.ok) return parsed;
      const value = roundTo(parsed.value, 4);
      if (Math.abs(value) >= MAX_ABS) return { ok: false, message: "is too large" };
      if (kpi.value_type === "integer" && !Number.isInteger(value)) return { ok: false, message: "must be a whole number" };
      return { ok: true, value: { ...base, value_number: value } };
    }
    case "boolean": {
      const parsed = parseBooleanCell(cell);
      return parsed.ok ? { ok: true, value: { ...base, value_bool: parsed.value } } : parsed;
    }
    case "text": {
      const text = textOf(cell);
      if (text.length > KPI_TEXT_MAX) return { ok: false, message: `is longer than ${KPI_TEXT_MAX.toLocaleString("en-GB")} characters` };
      return { ok: true, value: { ...base, value_text: text } };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the context
// ---------------------------------------------------------------------------------------------

/** Values as JSON text: no array parameters (they behave differently across drivers and poolers). */
function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}

/** Reads what the plan is checked against. Pass the company ids the files refer to (all of them is fine). */
export async function loadImportContext(sql: SqlExecutor, options: { templateVersionId: string | null }): Promise<ImportContext> {
  const companies = await sql.query<CompanyInfo>(
    `select c.id::text as id, c.name, c.status::text as status, c.reporting_start_month::text as reporting_start_month
       from public.companies c order by c.name`,
  );
  const settings = await sql.query<{ due_day: number }>("select s.due_day::int as due_day from public.platform_settings s where s.id = 1");
  let defaultTemplateVersionId: string | null = null;
  if (options.templateVersionId) {
    const found = await sql.query<{ id: string; status: string }>(
      "select tv.id::text as id, tv.status::text as status from public.template_versions tv where tv.id::text = $1",
      [options.templateVersionId.toLowerCase()],
    );
    if (found.length === 0) throw new Error(`There is no template version ${options.templateVersionId}.`);
    if (found[0].status === "draft") throw new Error("That template version is still a draft: publish it first, or leave --template-version out.");
    defaultTemplateVersionId = found[0].id;
  } else {
    const current = await sql.query<{ id: string }>(
      `select tv.id::text as id
         from public.template_versions tv
         join public.templates t on t.id = tv.template_id
        where t.is_default and tv.status = 'published'
        limit 1`,
    );
    defaultTemplateVersionId = current[0]?.id ?? null;
  }
  const periods = await sql.query<PeriodInfo>(
    `select p.id::text as id, p.month::text as month, p.due_date::text as due_date, p.template_version_id::text as template_version_id
       from public.reporting_periods p order by p.month`,
  );
  const versionIds = [...new Set([...periods.map((period) => period.template_version_id), ...(defaultTemplateVersionId ? [defaultTemplateVersionId] : [])])];
  const fields = await sql.query<FieldInfo>(
    `select f.template_version_id::text as template_version_id, f.key, f.label, f.field_type::text as field_type, f.options, f.validation
       from public.template_fields f
      where f.template_version_id::text in (select jsonb_array_elements_text($1::jsonb))`,
    [jsonParam(versionIds)],
  );
  const segments = await sql.query<SegmentInfo>(
    `select rs.id::text as id, rs.company_id::text as company_id, rs.name, rs.kind, rs.is_active, rs.sort_order::int as sort_order,
            rs.retired_at::text as retired_at
       from public.revenue_segments rs
      order by rs.company_id, rs.is_active desc, rs.sort_order, rs.name`,
  );
  const kpis = await sql.query<KpiInfo>(
    `select k.id::text as id, k.company_id::text as company_id, k.name, k.value_type::text as value_type,
            k.frequency::text as frequency, k.dimension_id::text as dimension_id
       from public.company_kpis k
      order by k.company_id, k.sort_order, k.name`,
  );
  const members = await sql.query<MemberInfo>(
    `select m.id::text as id, m.dimension_id::text as dimension_id, m.name, m.is_active
       from public.kpi_dimension_members m
      order by m.dimension_id, m.sort_order, m.name`,
  );
  const submissions = await sql.query<{ company_id: string; month: string; status: string }>(
    "select s.company_id::text as company_id, s.month::text as month, s.status::text as status from public.submissions s",
  );
  const existing = new Map<string, Map<MonthKey, string>>();
  for (const row of submissions) {
    const key = parseMonthKey(row.month);
    if (!key) continue;
    const months = existing.get(row.company_id) ?? new Map<MonthKey, string>();
    months.set(key, row.status);
    existing.set(row.company_id, months);
  }
  return {
    companies,
    dueDay: settings[0]?.due_day ?? 15,
    defaultTemplateVersionId,
    periods,
    fields: fields.map((field) => ({ ...field, options: field.options ?? null, validation: field.validation ?? null })),
    segments,
    kpis,
    members,
    existing,
  };
}

// ---------------------------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TEXT: Record<string, string> = {
  draft: "not submitted yet",
  submitted: "submitted",
  changes_requested: "sent back for changes",
  approved: "approved",
};

function foldName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function listNames(names: string[]): string {
  return names.length === 0 ? "none" : names.map((name) => `"${name}"`).join(", ");
}

/** The month after `month` at midnight in Malaysia: when a segment the import adds stopped being used. */
function retiredAtFor(lastMonth: MonthKey): string {
  return `${monthKeyToDate(addMonths(lastMonth, 1))}T00:00:00+08:00`;
}

export function retiredAtOf(segment: Pick<NewSegment, "lastMonth">): string {
  return retiredAtFor(segment.lastMonth);
}

type Row = { source: string; file: string; cells: Record<string, CellValue> };

/**
 * Checks every row against the database context and builds what to write. Errors leave nothing to write
 * (the CLI stops); warnings are reported; months already on the platform are skipped.
 */
export function planImport(context: ImportContext, tables: Table[], options: ImportOptions): ImportPlan {
  const errors: ImportMessage[] = [];
  const warnings: ImportMessage[] = [];
  const skipped: ImportMessage[] = [];
  const error = (source: string, message: string) => errors.push({ source, message });

  // Columns of every file.
  const columnsByFile = new Map<string, Map<string, Column>>();
  for (const table of tables) {
    const columns = new Map<string, Column>();
    for (const header of table.headers) {
      const column = classifyHeader(header);
      if (!column) {
        error(
          table.file,
          `Unknown column "${header}". Use company, month, a template field key (e.g. revenue_total, key_milestones), ` +
            '"segment:<name>", "line:<name>", "kpi:<name>" or "kpi:<name> [<member>]"; start a column with # to ignore it.',
        );
        continue;
      }
      columns.set(header, column);
    }
    for (const required of ["company", "month"] as const) {
      if (![...columns.values()].some((column) => column.kind === required)) error(table.file, `The "${required}" column is missing.`);
    }
    columnsByFile.set(table.file, columns);
  }
  if (errors.length > 0) {
    return { companies: [], newPeriods: [], templateVersionId: context.defaultTemplateVersionId, errors, warnings, skipped };
  }

  const companiesById = new Map(context.companies.map((company) => [company.id.toLowerCase(), company]));
  const companiesByName = new Map<string, CompanyInfo[]>();
  for (const company of context.companies) {
    const key = foldName(company.name);
    companiesByName.set(key, [...(companiesByName.get(key) ?? []), company]);
  }
  const periodsByMonth = new Map<MonthKey, PeriodInfo>();
  for (const period of context.periods) {
    const key = parseMonthKey(period.month);
    if (key) periodsByMonth.set(key, period);
  }
  const fieldsByVersion = new Map<string, Map<string, FieldInfo>>();
  for (const field of context.fields) {
    const map = fieldsByVersion.get(field.template_version_id) ?? new Map<string, FieldInfo>();
    map.set(field.key, field);
    fieldsByVersion.set(field.template_version_id, map);
  }
  const lastMonth = lastCompletedMonth(options.today);

  const rows: Row[] = tables.flatMap((table) => table.rows.map((row) => ({ source: row.source, file: table.file, cells: row.cells })));
  const seen = new Map<string, string>(); // company id + month → source
  const planned = new Map<string, PlannedCompany>();
  const newPeriods = new Set<MonthKey>();

  for (const row of rows) {
    const columns = columnsByFile.get(row.file) ?? new Map<string, Column>();
    const cell = (kind: "company" | "month"): CellValue => {
      for (const [header, column] of columns) if (column.kind === kind) return row.cells[header] ?? null;
      return null;
    };

    // Company and month.
    const companyCell = textOf(cell("company"));
    if (!companyCell) {
      error(row.source, "The company is missing.");
      continue;
    }
    let company: CompanyInfo | undefined;
    if (UUID_RE.test(companyCell)) {
      company = companiesById.get(companyCell.toLowerCase());
    } else {
      const matches = companiesByName.get(foldName(companyCell)) ?? [];
      if (matches.length > 1) {
        error(row.source, `More than one company is called "${companyCell}": use the company id instead.`);
        continue;
      }
      company = matches[0];
    }
    if (!company) {
      error(row.source, `There is no company called "${companyCell}". Add it on the platform first (or check the spelling).`);
      continue;
    }
    const monthCell = cell("month");
    const month = parseMonthCell(monthCell);
    if (!month) {
      error(row.source, `The month "${textOf(monthCell)}" is not a month: use YYYY-MM (e.g. 2025-07) or "Jul 2025".`);
      continue;
    }
    const label = `${company.name}, ${monthLabel(month)}`;
    if (compareMonths(month, lastMonth) > 0) {
      error(row.source, `${label}: only months that have ended can be imported (the latest is ${monthLabel(lastMonth)}).`);
      continue;
    }
    const startMonth = parseMonthKey(company.reporting_start_month);
    if (startMonth && compareMonths(month, startMonth) >= 0) {
      error(
        row.source,
        `${label}: ${company.name} reports on the platform from ${monthLabel(startMonth)}, so only earlier months come from the workbooks.`,
      );
      continue;
    }
    const duplicateOf = seen.get(`${company.id}:${month}`);
    if (duplicateOf) {
      error(row.source, `${label} is also on ${duplicateOf}: each company and month can only be imported once.`);
      continue;
    }
    seen.set(`${company.id}:${month}`, row.source);
    const existingStatus = context.existing.get(company.id)?.get(month);
    if (existingStatus) {
      skipped.push({ source: row.source, message: `${label} is already on the platform (${STATUS_TEXT[existingStatus] ?? existingStatus}): left unchanged.` });
      continue;
    }

    // Template of the month: an existing reporting month keeps its own version.
    const period = periodsByMonth.get(month);
    const versionId = period?.template_version_id ?? context.defaultTemplateVersionId;
    if (!versionId) {
      error(row.source, `${label}: no reporting template is published. Publish the default template first.`);
      continue;
    }
    if (!period) newPeriods.add(month);
    const fields = fieldsByVersion.get(versionId) ?? new Map<string, FieldInfo>();

    let plan = planned.get(company.id);
    if (!plan) {
      plan = { companyId: company.id, companyName: company.name, files: [], months: [], newSegments: [] };
      planned.set(company.id, plan);
    }
    if (!plan.files.includes(row.file)) plan.files.push(row.file);

    const entry: PlannedMonth = { source: row.source, month, values: [], segments: [], kpis: [] };
    const rowErrors: string[] = [];
    /** Template fields with a value in the row, valid or not (an invalid one is reported once, not as missing). */
    const provided = new Set<string>();
    let companySegmentSum = 0;
    let companySegmentCount = 0;

    for (const [header, column] of columns) {
      const value = row.cells[header] ?? null;
      if (value === null || column.kind === "company" || column.kind === "month" || column.kind === "ignored") continue;

      if (column.kind === "field") {
        const field = fields.get(column.key);
        if (!field) {
          rowErrors.push(`"${header}" is not a field of the reporting template used for ${monthLabel(month)}.`);
          continue;
        }
        provided.add(field.key);
        const parsed = parseFieldValue(field, value);
        if (!parsed.ok) rowErrors.push(`${field.label} (${header}) ${parsed.message}.`);
        else entry.values.push(parsed.value);
        continue;
      }

      if (column.kind === "segment") {
        const parsed = parseNumberCell(value);
        if (!parsed.ok) {
          rowErrors.push(`Revenue for ${column.name} (${header}) ${parsed.message}.`);
          continue;
        }
        const amount = roundTo(parsed.value, 2);
        if (amount < 0) {
          rowErrors.push(`Revenue for ${column.name} cannot be negative.`);
          continue;
        }
        if (Math.abs(amount) >= MAX_ABS) {
          rowErrors.push(`Revenue for ${column.name} is too large.`);
          continue;
        }
        const ref = resolveSegment(context, plan, company, column.segmentKind, column.name, month, options);
        if ("message" in ref) {
          rowErrors.push(ref.message);
          continue;
        }
        entry.segments.push({ segment: ref, amount });
        if (column.segmentKind === "company") {
          companySegmentSum = roundTo(companySegmentSum + amount, 2);
          companySegmentCount += 1;
        }
        continue;
      }

      // KPI
      const kpi = context.kpis.find((candidate) => candidate.company_id === company.id && foldName(candidate.name) === foldName(column.name));
      if (!kpi) {
        const names = context.kpis.filter((candidate) => candidate.company_id === company.id).map((candidate) => candidate.name);
        rowErrors.push(`${company.name} has no KPI called "${column.name}" (its KPIs: ${listNames(names)}).`);
        continue;
      }
      let memberId: string | null = null;
      if (kpi.dimension_id) {
        if (!column.member) {
          rowErrors.push(`"${kpi.name}" is reported per dimension member: name it in the column, e.g. "kpi:${kpi.name} [<member>]".`);
          continue;
        }
        const member = context.members.find(
          (candidate) => candidate.dimension_id === kpi.dimension_id && foldName(candidate.name) === foldName(column.member ?? ""),
        );
        if (!member) {
          const names = context.members.filter((candidate) => candidate.dimension_id === kpi.dimension_id).map((candidate) => candidate.name);
          rowErrors.push(`"${kpi.name}" has no member called "${column.member}" (its members: ${listNames(names)}).`);
          continue;
        }
        memberId = member.id;
      } else if (column.member) {
        rowErrors.push(`"${kpi.name}" is not reported per dimension member: use the column "kpi:${kpi.name}".`);
        continue;
      }
      const monthNumber = Number(month.slice(5, 7));
      if (kpi.frequency === "half_yearly" && monthNumber !== 6 && monthNumber !== 12) {
        rowErrors.push(`"${kpi.name}" is reported in June and December only.`);
        continue;
      }
      const parsed = parseKpiValue(kpi, value);
      if (!parsed.ok) rowErrors.push(`${kpi.name}${column.member ? ` (${column.member})` : ""} ${parsed.message}.`);
      else entry.kpis.push({ kpi_id: kpi.id, member_id: memberId, ...parsed.value });
    }

    // Total revenue and the company's own segments (BRD B30: they add up to total revenue).
    const totalIndex = entry.values.findIndex((value) => value.key === "revenue_total");
    if (companySegmentCount > 0) {
      if (totalIndex < 0) {
        if (fields.has("revenue_total")) entry.values.push({ key: "revenue_total", value_number: companySegmentSum, value_text: null, value_json: null });
      } else {
        const total = entry.values[totalIndex].value_number ?? 0;
        if (Math.abs(total - companySegmentSum) > REVENUE_SUM_TOLERANCE) {
          rowErrors.push(
            `Total revenue (${amountText(total)}) does not equal the sum of the revenue segments (${amountText(companySegmentSum)}).`,
          );
        }
      }
    }

    // The core figures (BRD §6.1: numbers are mandatory every month).
    const missing = SYSTEM_FIELD_KEYS.filter(
      (key) => fields.has(key) && !provided.has(key) && !entry.values.some((value) => value.key === key),
    );
    if (missing.length > 0) {
      const text = `${missing.map((key) => SYSTEM_FIELD_LABELS[key]).join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`;
      if (options.allowMissing) warnings.push({ source: row.source, message: `${label}: ${text}` });
      else rowErrors.push(`${text} (Run with --allow-missing to import months with gaps.)`);
    }

    if (rowErrors.length > 0) {
      for (const message of rowErrors) error(row.source, `${label}: ${message}`);
      continue;
    }
    plan.months.push(entry);
  }

  const companies = [...planned.values()]
    .map((plan) => ({ ...plan, months: [...plan.months].sort((a, b) => compareMonths(a.month, b.month)) }))
    .filter((plan) => plan.months.length > 0)
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "en-GB", { sensitivity: "base" }));
  // Segments to add: only those used by months that are imported.
  for (const plan of companies) {
    const used = new Set(plan.months.flatMap((month) => month.segments.flatMap((value) => ("create" in value.segment ? [value.segment.create] : []))));
    plan.newSegments = plan.newSegments.filter((segment) => used.has(segment.key));
  }
  const importedMonths = new Set(companies.flatMap((plan) => plan.months.map((month) => month.month)));
  return {
    companies,
    newPeriods: [...newPeriods].filter((month) => importedMonths.has(month)).sort(compareMonths),
    templateVersionId: context.defaultTemplateVersionId,
    errors,
    warnings,
    skipped,
  };
}

/** The segment a column names: an existing one of that kind (in use first), or one to add (retired). */
function resolveSegment(
  context: ImportContext,
  plan: PlannedCompany,
  company: CompanyInfo,
  kind: SegmentKind,
  name: string,
  month: MonthKey,
  options: ImportOptions,
): SegmentRef | { message: string } {
  const candidates = context.segments.filter(
    (segment) => segment.company_id === company.id && (segment.kind === "company" ? "company" : "scaleup") === kind && foldName(segment.name) === foldName(name),
  );
  const active = candidates.find((segment) => segment.is_active);
  if (active) return { existingId: active.id };
  const retired = candidates.sort((a, b) => (b.retired_at ?? "").localeCompare(a.retired_at ?? ""))[0];
  if (retired) return { existingId: retired.id };

  const key = `${kind}:${foldName(name)}`;
  const planned = plan.newSegments.find((segment) => segment.key === key);
  if (planned) {
    if (compareMonths(month, planned.lastMonth) > 0) planned.lastMonth = month;
    return { create: key };
  }
  if (!options.createSegments) {
    const names = context.segments
      .filter((segment) => segment.company_id === company.id && (segment.kind === "company" ? "company" : "scaleup") === kind)
      .map((segment) => segment.name);
    const what = kind === "company" ? "revenue segment" : "ScaleUp revenue line";
    return {
      message:
        `${company.name} has no ${what} called "${name}" (its ${what}s: ${listNames(names)}). ` +
        "Run with --create-segments to add it as one no longer in use, or check the spelling.",
    };
  }
  const existingOrders = context.segments.filter((segment) => segment.company_id === company.id).map((segment) => segment.sort_order);
  const sortOrder = Math.max(0, ...existingOrders) + 100 + plan.newSegments.length;
  plan.newSegments.push({ key, kind, name: normaliseSegmentName(name), sortOrder, lastMonth: month });
  return { create: key };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

export type ImportResult = {
  periodsCreated: number;
  monthsImported: number;
  segmentsCreated: { companyName: string; kind: SegmentKind; name: string }[];
};

function describeFiles(files: string[]): string {
  return files.length === 1 ? files[0] : `${files.slice(0, -1).join(", ")} and ${files[files.length - 1]}`;
}

/**
 * Writes a plan with no errors: reporting months, segments to add, then per company its months (approved),
 * values, segment figures, KPI values and timeline events — a few set-based statements per company. Run it
 * inside a transaction (the CLI does).
 */
export async function applyImport(sql: SqlExecutor, plan: ImportPlan, context: Pick<ImportContext, "dueDay">): Promise<ImportResult> {
  if (plan.errors.length > 0) throw new Error("The import has errors: nothing can be written.");
  const result: ImportResult = { periodsCreated: 0, monthsImported: 0, segmentsCreated: [] };

  if (plan.newPeriods.length > 0) {
    if (!plan.templateVersionId) throw new Error("No reporting template is published.");
    await sql.query("select private.set_audit_context('import', $1, false, null, true)", [
      `Reporting months opened for the historical workbook import: ${plan.newPeriods.map(monthLabel).join(", ")}`,
    ]);
    const created = await sql.query<{ month: string }>(
      `insert into public.reporting_periods (month, due_date, template_version_id, opened_by)
       select x.month, x.due_date, $2::uuid, null
         from jsonb_to_recordset($1::jsonb) as x(month date, due_date date)
       on conflict (month) do nothing
       returning month::text as month`,
      [
        jsonParam(plan.newPeriods.map((month) => ({ month: monthKeyToDate(month), due_date: dueDateFor(month, context.dueDay) }))),
        plan.templateVersionId,
      ],
    );
    result.periodsCreated = created.length;
  }

  for (const company of plan.companies) {
    const files = describeFiles(company.files);
    const range =
      company.months.length === 1
        ? monthLabel(company.months[0].month)
        : `${monthLabel(company.months[0].month)} – ${monthLabel(company.months[company.months.length - 1].month)}`;
    await sql.query("select private.set_audit_context('import', $1, false, $2::uuid, true)", [
      `Imported from the historical workbook (${files}): ${range}`,
      company.companyId,
    ]);

    // Segments and revenue lines the company did not have: added as rows no longer in use.
    const segmentIds = new Map<string, string>();
    if (company.newSegments.length > 0) {
      const rows = await sql.query<{ id: string; kind: string; name: string }>(
        `insert into public.revenue_segments (company_id, kind, name, sort_order, is_active, retired_at)
         select $1::uuid, x.kind, x.name, x.sort_order, false, x.retired_at
           from jsonb_to_recordset($2::jsonb) as x(kind text, name text, sort_order int, retired_at timestamptz)
         returning id::text as id, kind, name`,
        [
          company.companyId,
          jsonParam(
            company.newSegments.map((segment) => ({
              kind: segment.kind,
              name: segment.name,
              sort_order: segment.sortOrder,
              retired_at: retiredAtOf(segment),
            })),
          ),
        ],
      );
      for (const segment of company.newSegments) {
        const row = rows.find((candidate) => candidate.kind === segment.kind && candidate.name === segment.name);
        if (!row) throw new Error(`Could not add the segment "${segment.name}" for ${company.companyName}.`);
        segmentIds.set(segment.key, row.id);
        result.segmentsCreated.push({ companyName: company.companyName, kind: segment.kind, name: segment.name });
      }
    }

    const months = company.months.map((month) => monthKeyToDate(month.month));
    const inserted = await sql.query<{ id: string; month: string }>(
      `insert into public.submissions (
         company_id, period_id, month, template_version_id, status, due_date, submitted_at, approved_at, revision,
         last_saved_at
       )
       select $1::uuid, p.id, p.month, p.template_version_id, 'approved', p.due_date, now(), now(), 1, now()
         from jsonb_array_elements_text($2::jsonb) as m(month)
         join public.reporting_periods p on p.month = m.month::date
       returning id::text as id, month::text as month`,
      [company.companyId, jsonParam(months)],
    );
    if (inserted.length !== months.length) {
      throw new Error(`Could not create every month of ${company.companyName} (${inserted.length} of ${months.length}).`);
    }
    result.monthsImported += inserted.length;

    const values = company.months.flatMap((month) =>
      month.values.map((value) => ({ month: monthKeyToDate(month.month), ...value })),
    );
    if (values.length > 0) {
      await sql.query(
        `insert into public.submission_values (submission_id, field_key, value_number, value_text, value_json, updated_at, updated_by)
         select s.id, x.key, x.value_number, x.value_text, x.value_json, now(), null
           from jsonb_to_recordset($2::jsonb) as x(month date, key text, value_number numeric, value_text text, value_json jsonb)
           join public.submissions s on s.company_id = $1::uuid and s.month = x.month`,
        [company.companyId, jsonParam(values)],
      );
    }

    const segmentValues = company.months.flatMap((month) =>
      month.segments.map((value) => {
        const id = "existingId" in value.segment ? value.segment.existingId : segmentIds.get(value.segment.create);
        if (!id) throw new Error(`A revenue segment of ${company.companyName} was not created.`);
        return { month: monthKeyToDate(month.month), segment_id: id, amount: value.amount };
      }),
    );
    if (segmentValues.length > 0) {
      await sql.query(
        `insert into public.submission_segment_values (submission_id, segment_id, amount, updated_at, updated_by)
         select s.id, x.segment_id, x.amount, now(), null
           from jsonb_to_recordset($2::jsonb) as x(month date, segment_id uuid, amount numeric)
           join public.submissions s on s.company_id = $1::uuid and s.month = x.month`,
        [company.companyId, jsonParam(segmentValues)],
      );
    }

    const kpiValues = company.months.flatMap((month) => month.kpis.map((value) => ({ month: monthKeyToDate(month.month), ...value })));
    if (kpiValues.length > 0) {
      await sql.query(
        `insert into public.submission_kpi_values (
           submission_id, kpi_id, dimension_member_id, value_number, value_text, value_bool, updated_at, updated_by
         )
         select s.id, x.kpi_id, x.member_id, x.value_number, x.value_text, x.value_bool, now(), null
           from jsonb_to_recordset($2::jsonb)
                as x(month date, kpi_id uuid, member_id uuid, value_number numeric, value_text text, value_bool boolean)
           join public.submissions s on s.company_id = $1::uuid and s.month = x.month`,
        [company.companyId, jsonParam(kpiValues)],
      );
    }

    await sql.query(
      `insert into public.submission_events (submission_id, event, actor_id, message)
       select s.id, 'approved', null, $3
         from jsonb_array_elements_text($2::jsonb) as m(month)
         join public.submissions s on s.company_id = $1::uuid and s.month = m.month::date`,
      [company.companyId, jsonParam(months), `Imported from the historical workbook (${files}).`],
    );
  }
  await sql.query("select private.clear_audit_context()");
  return result;
}

/** 'YYYY-MM' list as a readable span, e.g. "Jul 2024 – Jun 2026 (24 months)". */
export function describeMonths(months: readonly MonthKey[]): string {
  if (months.length === 0) return "no months";
  const sorted = [...months].sort(compareMonths);
  const count = `${sorted.length} ${sorted.length === 1 ? "month" : "months"}`;
  if (sorted.length === 1) return `${monthLabel(sorted[0])} (${count})`;
  return `${monthLabel(sorted[0])} – ${monthLabel(sorted[sorted.length - 1])} (${count})`;
}
