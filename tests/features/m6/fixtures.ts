// Typed fixtures for the M6 unit tests: a Batik-like company with both revenue breakdowns (BRD B30: its own
// revenue segments Online and Retail, plus Wholesale retired; ScaleUp's revenue lines Corporate gifting,
// plus Export retired), an "Outlet" dimension, KPIs of several value types and a template with financials,
// additional numbers, narrative and pulse sections; September 2026 (current), August 2026 (prior month) and
// September 2025 (last year).
import type { RevenueSegmentKind } from "@/lib/constants";
import { kpiCellKey } from "@/lib/targets";
import {
  partitionRevenueSegments,
  toMonthlyFinancials,
  type CompanyConfig,
  type CompanyKpiRow,
  type CompanyRow,
  type Json,
  type KpiDefinition,
  type KpiDimensionMemberRow,
  type RevenueSegmentRow,
  type SubmissionBundle,
  type SubmissionKpiValueRow,
  type SubmissionRow,
  type SubmissionSnapshot,
  type SubmissionValueRow,
  type SubmissionValues,
  type TemplateFieldRow,
  type TemplateSectionFull,
  type TemplateVersionFull,
} from "@/lib/types/domain";
import type { FieldType, KpiFrequency, KpiValueType, SectionKind, SubmissionStatus } from "@/lib/types/enums";

export const TS = "2026-10-05T02:00:00.000000+00:00";

export const IDS = {
  company: "c0000000-0000-4000-8000-000000000001",
  template: "b0000000-0000-4000-8000-000000000001",
  version: "b1000000-0000-4000-8000-000000000001",
  sep: "90000000-0000-4000-8000-000000000009",
  aug: "90000000-0000-4000-8000-000000000008",
  sepLastYear: "90000000-0000-4000-8000-000000000109",
  segOnline: "f0000000-0000-4000-8000-000000000001",
  segRetail: "f0000000-0000-4000-8000-000000000002",
  segWholesale: "f0000000-0000-4000-8000-000000000003",
  lineGifting: "f0000000-0000-4000-8000-000000000011",
  lineExport: "f0000000-0000-4000-8000-000000000012",
  outlet: "d0000000-0000-4000-8000-000000000001",
  montKiara: "d1000000-0000-4000-8000-000000000001",
  theRow: "d1000000-0000-4000-8000-000000000002",
  closedOutlet: "d1000000-0000-4000-8000-000000000003",
  kpiRevenuePerOutlet: "e0000000-0000-4000-8000-000000000001",
  kpiProfitable: "e0000000-0000-4000-8000-000000000002",
  kpiDownloads: "e0000000-0000-4000-8000-000000000003",
  kpiNps: "e0000000-0000-4000-8000-000000000004",
  kpiOld: "e0000000-0000-4000-8000-000000000005",
  owner: "a1000000-0000-4000-8000-000000000001",
  contributor: "a1000000-0000-4000-8000-000000000002",
  partner: "a1000000-0000-4000-8000-000000000005",
  fundAdmin: "a1000000-0000-4000-8000-000000000006",
};

export function companyRow(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: IDS.company,
    name: "Batik Boutique",
    legal_name: null,
    registration_no: null,
    sector: null,
    country: "Malaysia",
    website: null,
    description: null,
    reporting_currency: "MYR",
    status: "active",
    status_changed_at: null,
    status_reason: null,
    reporting_start_month: "2026-07-01",
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

export function submissionRow(id: string, month: string, status: SubmissionStatus, overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id,
    company_id: IDS.company,
    period_id: `70000000-0000-4000-8000-0000000000${month.slice(5, 7)}`,
    month,
    template_version_id: IDS.version,
    status,
    due_date: "2026-10-15",
    original_due_date: null,
    extension_reason: null,
    submitted_at: null,
    submitted_by: null,
    declaration_text: null,
    approved_at: null,
    approved_by: null,
    revision: 0,
    last_saved_at: null,
    last_saved_by: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  };
}

/** A revenue segment: the company's own (`kind` 'company', the default) or a ScaleUp line; retired with `retiredAt`. */
export function segment(
  id: string,
  name: string,
  sort_order: number,
  opts: { kind?: RevenueSegmentKind; retiredAt?: string } = {},
): RevenueSegmentRow {
  return {
    id,
    company_id: IDS.company,
    name,
    sort_order,
    kind: opts.kind ?? "company",
    is_active: opts.retiredAt === undefined,
    retired_at: opts.retiredAt ?? null,
    created_at: TS,
  };
}

/** The fixture company's segments, in the data layer's order (active first, then sort order, then name). */
export function defaultSegments(): RevenueSegmentRow[] {
  return [
    segment(IDS.lineGifting, "Corporate gifting", 1, { kind: "scaleup" }),
    segment(IDS.segOnline, "Online", 1),
    segment(IDS.segRetail, "Retail", 2),
    segment(IDS.lineExport, "Export", 2, { kind: "scaleup", retiredAt: "2026-09-02T04:00:00.000000+00:00" }),
    segment(IDS.segWholesale, "Wholesale", 3, { retiredAt: "2026-06-30T04:00:00.000000+00:00" }),
  ];
}

/** A config with other revenue segments (the derived lists rebuilt, as getCompanyConfig does). */
export function withSegments(config: CompanyConfig, segments: RevenueSegmentRow[]): CompanyConfig {
  return { ...config, segments, ...partitionRevenueSegments(segments) };
}

function dimensionMember(id: string, name: string, sort_order: number, is_active = true): KpiDimensionMemberRow {
  return { id, dimension_id: IDS.outlet, name, sort_order, is_active, created_at: TS };
}

function kpiRow(
  id: string,
  name: string,
  opts: { valueType: KpiValueType; sort: number; frequency?: KpiFrequency; dimension?: boolean; active?: boolean; unit?: string | null },
): CompanyKpiRow {
  return {
    id,
    company_id: IDS.company,
    name,
    description: null,
    unit: opts.unit ?? null,
    value_type: opts.valueType,
    frequency: opts.frequency ?? "monthly",
    dimension_id: opts.dimension ? IDS.outlet : null,
    is_required: true,
    sort_order: opts.sort,
    is_active: opts.active ?? true,
    created_at: TS,
    updated_at: TS,
  };
}

const MEMBERS = [
  dimensionMember(IDS.montKiara, "Mont Kiara", 1),
  dimensionMember(IDS.theRow, "The Row", 2),
  dimensionMember(IDS.closedOutlet, "Closed Outlet", 3, false),
];

export function buildConfig(company: CompanyRow = companyRow()): CompanyConfig {
  const dimension = { id: IDS.outlet, company_id: IDS.company, name: "Outlet", created_at: TS };
  const activeMembers = MEMBERS.filter((m) => m.is_active);
  const withDimension = (row: CompanyKpiRow): KpiDefinition =>
    row.dimension_id ? { ...row, dimension, members: activeMembers } : { ...row, dimension: null, members: [] };
  const segments = defaultSegments();
  return {
    company,
    segments,
    ...partitionRevenueSegments(segments),
    kpis: [
      withDimension(kpiRow(IDS.kpiRevenuePerOutlet, "Revenue per outlet", { valueType: "currency", sort: 1, dimension: true, unit: "RM" })),
      withDimension(kpiRow(IDS.kpiProfitable, "Profitable", { valueType: "boolean", sort: 2 })),
      withDimension(kpiRow(IDS.kpiDownloads, "App downloads", { valueType: "integer", sort: 3, unit: "downloads" })),
      withDimension(kpiRow(IDS.kpiNps, "Customer NPS", { valueType: "number", sort: 4, frequency: "half_yearly" })),
      withDimension(kpiRow(IDS.kpiOld, "Old metric", { valueType: "number", sort: 5, active: false })),
    ],
    dimensions: [{ ...dimension, members: MEMBERS }],
    members: [
      {
        company_id: IDS.company,
        user_id: IDS.owner,
        role: "owner",
        is_active: true,
        invited_by: null,
        created_at: TS,
        updated_at: TS,
        profile: { id: IDS.owner, email: "aisha@batik.test", full_name: "Aisha Rahman", job_title: "CEO", is_active: true, terms_accepted_at: TS },
      },
      {
        company_id: IDS.company,
        user_id: IDS.contributor,
        role: "contributor",
        is_active: true,
        invited_by: IDS.owner,
        created_at: TS,
        updated_at: TS,
        profile: { id: IDS.contributor, email: "finance@batik.test", full_name: "Mei Tan", job_title: null, is_active: true, terms_accepted_at: TS },
      },
    ],
  };
}

let fieldCounter = 0;

export function field(
  sectionId: string,
  key: string,
  label: string,
  field_type: FieldType,
  sort_order: number,
  extra: Partial<TemplateFieldRow> = {},
): TemplateFieldRow {
  fieldCounter += 1;
  return {
    id: `b3000000-0000-4000-8000-${String(fieldCounter).padStart(12, "0")}`,
    template_version_id: IDS.version,
    section_id: sectionId,
    key,
    label,
    help_text: null,
    field_type,
    is_required: false,
    is_system: false,
    options: null,
    validation: null,
    sort_order,
    created_at: TS,
    ...extra,
  };
}

function section(index: number, key: string, title: string, kind: SectionKind, fields: (sectionId: string) => TemplateFieldRow[]): TemplateSectionFull {
  const id = `b2000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return { id, template_version_id: IDS.version, key, title, description: null, kind, sort_order: index, created_at: TS, fields: fields(id) };
}

export function buildTemplate(): TemplateVersionFull {
  return {
    id: IDS.version,
    template_id: IDS.template,
    version_no: 1,
    status: "published",
    notes: null,
    created_by: null,
    published_at: TS,
    published_by: null,
    created_at: TS,
    template: { id: IDS.template, name: "Portfolio Update", description: null, is_default: true, created_at: TS },
    sections: [
      section(1, "financials", "Financials", "financials", (s) => [
        field(s, "revenue_total", "Total revenue", "currency", 1, { is_system: true, is_required: true }),
        field(s, "gross_profit", "Gross profit", "currency", 2, { is_system: true, is_required: true }),
        field(s, "net_profit", "Net profit", "currency", 3, { is_system: true, is_required: true }),
        field(s, "cash_in_bank", "Cash in bank (month end)", "currency", 4, { is_system: true, is_required: true }),
        field(s, "burn_rate", "Burn rate (per month)", "currency", 5, { is_system: true, is_required: true }),
      ]),
      section(2, "headcount", "Headcount", "headcount", (s) => [
        field(s, "headcount_ft", "Full-time headcount", "integer", 1, { is_system: true, is_required: true }),
        field(s, "headcount_pt", "Part-time headcount", "integer", 2, { is_system: true, is_required: true }),
      ]),
      section(3, "kpis", "Company KPIs", "kpis", () => []),
      section(4, "unit_economics", "Unit economics", "custom_numbers", (s) => [
        field(s, "cac", "Customer acquisition cost", "currency", 1),
        field(s, "conversion", "Conversion rate", "percent", 2),
        field(s, "orders", "Orders", "integer", 3),
      ]),
      section(5, "company_summary", "Company Summary", "narrative", (s) => [
        field(s, "key_milestones", "Key milestones", "long_text", 1, { help_text: "  What happened this month?  " }),
      ]),
      section(6, "investment", "Investment", "narrative", (s) => [
        field(s, "fundraising_status", "Fundraising status", "picklist", 1, {
          options: { options: ["Not raising", "Actively raising"] },
        }),
        field(s, "fundraising_commentary", "Fundraising commentary", "long_text", 2),
      ]),
      section(7, "compliance_regulation", "Compliance and Regulation", "narrative", (s) => [
        field(s, "compliance_updates", "Licences and regulatory matters", "long_text", 1),
      ]),
      section(8, "founder_pulse", "Founder Pulse", "pulse", (s) => [
        field(s, "team_morale", "Team morale", "rating", 1, {
          options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } },
        }),
        field(s, "help_tags", "Help needed (tags)", "tags", 2),
        field(s, "needs_intro", "Needs an introduction", "boolean", 3),
      ]),
    ],
  };
}

type ValueSpec = { n?: number; t?: string; j?: Json };
type KpiSpec = { kpi: string; member?: string | null; n?: number; b?: boolean; t?: string };

export function values(
  submissionId: string,
  spec: { values?: Record<string, ValueSpec>; segments?: Record<string, number | null>; kpis?: KpiSpec[] },
): SubmissionValues {
  const result: SubmissionValues = { values: {}, segments: { ...(spec.segments ?? {}) }, kpis: {} };
  for (const [key, v] of Object.entries(spec.values ?? {})) {
    const row: SubmissionValueRow = {
      submission_id: submissionId,
      field_key: key,
      value_number: v.n ?? null,
      value_text: v.t ?? null,
      value_json: v.j ?? null,
      created_at: TS,
      updated_at: TS,
      updated_by: null,
    };
    result.values[key] = row;
  }
  for (const [index, cell] of (spec.kpis ?? []).entries()) {
    const row: SubmissionKpiValueRow = {
      id: `e9000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      submission_id: submissionId,
      kpi_id: cell.kpi,
      dimension_member_id: cell.member ?? null,
      value_number: cell.n ?? null,
      value_text: cell.t ?? null,
      value_bool: cell.b ?? null,
      created_at: TS,
      updated_at: TS,
      updated_by: null,
    };
    result.kpis[kpiCellKey(cell.kpi, cell.member ?? null)] = row;
  }
  return result;
}

export function snapshot(submission: SubmissionRow, v: SubmissionValues): SubmissionSnapshot {
  return { submission, values: v, financials: toMonthlyFinancials(submission.month, v) };
}

export const SEP_VALUES = values(IDS.sep, {
  values: {
    revenue_total: { n: 150000 },
    gross_profit: { n: 60000 },
    net_profit: { n: -15000 },
    cash_in_bank: { n: 400000 },
    burn_rate: { n: 50000 },
    headcount_ft: { n: 12 },
    headcount_pt: { n: 3 },
    cac: { n: 250 },
    conversion: { n: 2.5 },
    orders: { n: 800 },
    key_milestones: { t: "Opened a new outlet in Mont Kiara." },
    fundraising_status: { t: "Actively raising" },
    fundraising_commentary: { t: "   " },
    team_morale: { n: 4 },
    help_tags: { j: ["Hiring", "Finance"] },
    needs_intro: { j: false },
  },
  segments: { [IDS.segOnline]: 100000, [IDS.segRetail]: 50000, [IDS.lineGifting]: 20000 },
  kpis: [
    { kpi: IDS.kpiRevenuePerOutlet, member: IDS.montKiara, n: 30000 },
    { kpi: IDS.kpiRevenuePerOutlet, member: IDS.theRow, n: 20000 },
    { kpi: IDS.kpiProfitable, b: true },
    { kpi: IDS.kpiDownloads, n: 1200 },
  ],
});

export const AUG_VALUES = values(IDS.aug, {
  values: {
    revenue_total: { n: 100000 },
    gross_profit: { n: 45000 },
    net_profit: { n: -20000 },
    cash_in_bank: { n: 450000 },
    burn_rate: { n: 0 },
    headcount_ft: { n: 10 },
    headcount_pt: { n: 3 },
    cac: { n: 300 },
    conversion: { n: 2 },
    key_milestones: { t: "Signed the lease." },
    team_morale: { n: 5 },
  },
  segments: { [IDS.segOnline]: 70000, [IDS.segRetail]: 30000, [IDS.lineGifting]: 15000, [IDS.lineExport]: 5000 },
  kpis: [
    { kpi: IDS.kpiRevenuePerOutlet, member: IDS.montKiara, n: 25000 },
    { kpi: IDS.kpiRevenuePerOutlet, member: IDS.theRow, n: 15000 },
    { kpi: IDS.kpiRevenuePerOutlet, member: IDS.closedOutlet, n: 5000 },
    { kpi: IDS.kpiProfitable, b: false },
    { kpi: IDS.kpiDownloads, n: 1000 },
    { kpi: IDS.kpiOld, n: 7 },
  ],
});

export const SEP_LAST_YEAR_VALUES = values(IDS.sepLastYear, {
  values: {
    revenue_total: { n: 80000 },
    gross_profit: { n: 30000 },
    net_profit: { n: -10000 },
    cash_in_bank: { n: 200000 },
    burn_rate: { n: 40000 },
    headcount_ft: { n: 8 },
    headcount_pt: { n: 2 },
  },
  segments: { [IDS.segWholesale]: 80000 },
});

/**
 * The review bundle for September 2026 (prior month and last year present unless switched off). Scenario
 * tests can replace the company's revenue segments, this month's and the prior month's values and the prior
 * month's status.
 */
export function buildBundle(
  opts: {
    month?: string;
    status?: SubmissionStatus;
    previous?: boolean;
    previousStatus?: SubmissionStatus;
    lastYear?: boolean;
    company?: Partial<CompanyRow>;
    segments?: RevenueSegmentRow[];
    current?: SubmissionValues;
    previousValues?: SubmissionValues;
  } = {},
): SubmissionBundle {
  const month = opts.month ?? "2026-09-01";
  const company = companyRow(opts.company);
  const submission = submissionRow(IDS.sep, month, opts.status ?? "submitted", { revision: 1 });
  const config = opts.segments ? withSegments(buildConfig(company), opts.segments) : buildConfig(company);
  const current = opts.current ?? SEP_VALUES;
  return {
    submission,
    company,
    config,
    template: buildTemplate(),
    current,
    previous:
      opts.previous === false
        ? null
        : snapshot(submissionRow(IDS.aug, "2026-08-01", opts.previousStatus ?? "approved"), opts.previousValues ?? AUG_VALUES),
    lastYear: opts.lastYear === false ? null : snapshot(submissionRow(IDS.sepLastYear, "2025-09-01", "approved"), SEP_LAST_YEAR_VALUES),
    events: [],
    financials: toMonthlyFinancials(month, current),
    clientSettings: { require_mfa: true, terms_version: "2026-09", declaration_text: "I confirm.", due_day: 15, owner_contributor_limit: 4 },
    settings: null,
  };
}
