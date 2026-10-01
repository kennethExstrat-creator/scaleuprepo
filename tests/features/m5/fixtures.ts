// A realistic SubmissionBundle for the monthly form tests: Batik Boutique, September 2026, with revenue
// segments (one inactive), outlet KPIs, a KPI without a dimension, narrative sections and founder pulse,
// and August as the previous month.

import {
  partitionRevenueSegments,
  type KpiDefinition,
  type RevenueSegmentRow,
  type SubmissionBundle,
  type SubmissionEventWithActor,
  type SubmissionRow,
  type SubmissionValueRow,
  type SubmissionValues,
  type TemplateFieldRow,
  type TemplateSectionFull,
} from "@/lib/types/domain";
import type { FieldType, SectionKind, SubmissionStatus } from "@/lib/types/enums";
import type { Json } from "@/lib/supabase/database.types";

export const IDS = {
  company: "c0000000-0000-4000-8000-000000000001",
  submission: "90000000-0000-4000-8000-000000000009",
  previous: "90000000-0000-4000-8000-000000000008",
  version: "b1000000-0000-4000-8000-000000000001",
  template: "b0000000-0000-4000-8000-000000000001",
  segRetail: "f0000000-0000-4000-8000-000000000001",
  segOnline: "f0000000-0000-4000-8000-000000000002",
  segOld: "f0000000-0000-4000-8000-000000000003",
  outlet: "d0000000-0000-4000-8000-000000000001",
  montKiara: "d1000000-0000-4000-8000-000000000001",
  theRow: "d1000000-0000-4000-8000-000000000002",
  kpiRevenue: "e0000000-0000-4000-8000-000000000001",
  kpiProfitable: "e0000000-0000-4000-8000-000000000003",
  kpiDownloads: "e0000000-0000-4000-8000-000000000005",
  owner: "a1000000-0000-4000-8000-000000000001",
};

const TS = "2026-09-30T06:00:00.000000+00:00";

let fieldSeq = 0;
export function field(
  sectionId: string,
  key: string,
  label: string,
  field_type: FieldType,
  extra: Partial<TemplateFieldRow> = {},
): TemplateFieldRow {
  fieldSeq += 1;
  return {
    id: `b3000000-0000-4000-8000-${String(fieldSeq).padStart(12, "0")}`,
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
    sort_order: fieldSeq,
    created_at: TS,
    ...extra,
  };
}

export function section(
  n: number,
  key: string,
  title: string,
  kind: SectionKind,
  fields: TemplateFieldRow[],
): TemplateSectionFull {
  return {
    id: `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    template_version_id: IDS.version,
    key,
    title,
    description: null,
    kind,
    sort_order: n,
    created_at: TS,
    fields,
  };
}

const S = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SECTIONS: TemplateSectionFull[] = [
  section(1, "financials", "Financials", "financials", [
    field(S(1), "revenue_total", "Total revenue", "currency", {
      is_required: true,
      is_system: true,
      validation: { min: 0 },
    }),
    field(S(1), "gross_profit", "Gross profit", "currency", {
      is_required: true,
      is_system: true,
      validation: { allow_negative: true },
    }),
    field(S(1), "net_profit", "Net profit", "currency", {
      is_required: true,
      is_system: true,
      validation: { allow_negative: true },
    }),
    field(S(1), "cash_in_bank", "Cash in bank (month end)", "currency", {
      is_required: true,
      is_system: true,
      validation: { min: 0 },
    }),
    field(S(1), "burn_rate", "Burn rate (per month)", "currency", {
      is_required: true,
      is_system: true,
      help_text: "Enter 0 if cash-flow positive",
      validation: { min: 0 },
    }),
  ]),
  section(2, "headcount", "Headcount", "headcount", [
    field(S(2), "headcount_ft", "Full-time headcount", "integer", {
      is_required: true,
      is_system: true,
      validation: { min: 0 },
    }),
    field(S(2), "headcount_pt", "Part-time headcount", "integer", {
      is_required: true,
      is_system: true,
      validation: { min: 0 },
    }),
  ]),
  section(3, "kpis", "Company KPIs", "kpis", []),
  section(4, "company_summary", "Company Summary", "narrative", [
    field(S(4), "key_milestones", "Key milestones", "long_text"),
  ]),
  section(10, "investment", "Investment", "narrative", [
    field(S(10), "fundraising_status", "Fundraising status", "picklist", {
      options: { options: ["Not raising", "Preparing to raise", "Actively raising"] },
    }),
    field(S(10), "fundraising_commentary", "Fundraising commentary", "long_text"),
  ]),
  section(13, "founder_pulse", "Founder Pulse", "pulse", [
    field(S(13), "team_morale", "Team morale", "rating", {
      options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } },
    }),
    field(S(13), "next_month_goals", "Next month goals", "long_text"),
    field(S(13), "help_tags", "Help needed (tags)", "tags", {
      options: { options: ["Fundraising", "Hiring", "Sales introductions"] },
    }),
  ]),
];

// The company's own revenue segments (BRD B30: kind 'company', they add up to total revenue); a retired
// one carries its retired_at.
function segment(id: string, name: string, sort_order: number, is_active = true): RevenueSegmentRow {
  return {
    id,
    company_id: IDS.company,
    name,
    sort_order,
    is_active,
    kind: "company",
    retired_at: is_active ? null : TS,
    created_at: TS,
  };
}

export const SEGMENTS: RevenueSegmentRow[] = [
  segment(IDS.segRetail, "Retail", 1),
  segment(IDS.segOnline, "Online", 2),
  segment(IDS.segOld, "Wholesale (closed)", 3, false),
];

const dimension = { id: IDS.outlet, company_id: IDS.company, name: "Outlet", created_at: TS };
const members = [
  { id: IDS.montKiara, dimension_id: IDS.outlet, name: "Mont Kiara", sort_order: 1, is_active: true, created_at: TS },
  { id: IDS.theRow, dimension_id: IDS.outlet, name: "The Row", sort_order: 2, is_active: true, created_at: TS },
];

function kpi(
  id: string,
  name: string,
  value_type: KpiDefinition["value_type"],
  withDimension: boolean,
  sort_order: number,
  unit: string | null,
): KpiDefinition {
  return {
    id,
    company_id: IDS.company,
    name,
    description: null,
    unit,
    value_type,
    frequency: "monthly",
    dimension_id: withDimension ? IDS.outlet : null,
    is_required: true,
    sort_order,
    is_active: true,
    created_at: TS,
    updated_at: TS,
    dimension: withDimension ? dimension : null,
    members: withDimension ? members : [],
  };
}

export const KPIS: KpiDefinition[] = [
  kpi(IDS.kpiRevenue, "Revenue per outlet", "currency", true, 1, "RM"),
  kpi(IDS.kpiProfitable, "Profitable", "boolean", true, 2, null),
  kpi(IDS.kpiDownloads, "App downloads", "integer", false, 3, "downloads"),
];

function valueRow(
  submission_id: string,
  field_key: string,
  v: { n?: number; t?: string; j?: Json },
): SubmissionValueRow {
  return {
    submission_id,
    field_key,
    value_number: v.n ?? null,
    value_text: v.t ?? null,
    value_json: v.j ?? null,
    created_at: TS,
    updated_at: TS,
    updated_by: IDS.owner,
  };
}

export function submissionRow(status: SubmissionStatus, extra: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: IDS.submission,
    company_id: IDS.company,
    period_id: "70000000-0000-4000-8000-000000000009",
    month: "2026-09-01",
    template_version_id: IDS.version,
    status,
    due_date: "2026-10-15",
    original_due_date: null,
    extension_reason: null,
    submitted_at: status === "draft" ? null : "2026-10-03T02:00:00+00:00",
    submitted_by: status === "draft" ? null : IDS.owner,
    declaration_text: null,
    approved_at: status === "approved" ? "2026-10-06T02:00:00+00:00" : null,
    approved_by: null,
    revision: status === "draft" ? 0 : 1,
    last_saved_at: "2026-09-30T06:05:00+00:00",
    last_saved_by: IDS.owner,
    created_at: TS,
    updated_at: TS,
    ...extra,
  };
}

export const CURRENT: SubmissionValues = {
  values: {
    revenue_total: valueRow(IDS.submission, "revenue_total", { n: 1000 }),
    gross_profit: valueRow(IDS.submission, "gross_profit", { n: -150 }),
    key_milestones: valueRow(IDS.submission, "key_milestones", { t: "Opened Merdeka 118" }),
  },
  segments: { [IDS.segRetail]: 700, [IDS.segOnline]: 300 },
  kpis: {},
};

const PREVIOUS_VALUES: SubmissionValues = {
  values: {
    revenue_total: valueRow(IDS.previous, "revenue_total", { n: 800 }),
    next_month_goals: valueRow(IDS.previous, "next_month_goals", { t: "Hire a finance lead" }),
    key_milestones: valueRow(IDS.previous, "key_milestones", { t: "Signed the Westin lease" }),
  },
  segments: { [IDS.segRetail]: 800 },
  kpis: {},
};

export function makeBundle(
  status: SubmissionStatus = "draft",
  options: {
    events?: SubmissionEventWithActor[];
    companyStatus?: "active" | "exited" | "written_off";
    current?: SubmissionValues;
    /** Template sections (default SECTIONS). */
    sections?: TemplateSectionFull[];
  } = {},
): SubmissionBundle {
  const company = {
    id: IDS.company,
    name: "Batik Boutique",
    legal_name: null,
    registration_no: null,
    sector: null,
    country: "Malaysia",
    website: null,
    description: null,
    reporting_currency: "MYR",
    status: options.companyStatus ?? "active",
    status_changed_at: null,
    status_reason: null,
    reporting_start_month: "2026-07-01",
    created_at: TS,
    updated_at: TS,
  } satisfies SubmissionBundle["company"];
  const previousSubmission = {
    ...submissionRow("approved"),
    id: IDS.previous,
    month: "2026-08-01",
    due_date: "2026-09-15",
  };
  return {
    submission: submissionRow(status),
    company,
    config: {
      company,
      segments: SEGMENTS,
      kpis: KPIS,
      dimensions: [{ ...dimension, members }],
      members: [],
      ...partitionRevenueSegments(SEGMENTS),
    },
    template: {
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
      sections: options.sections ?? SECTIONS,
    },
    current: options.current ?? CURRENT,
    previous: {
      submission: previousSubmission,
      values: PREVIOUS_VALUES,
      financials: {
        month: "2026-08-01",
        revenue_total: 800,
        gross_profit: null,
        net_profit: null,
        cash_in_bank: null,
        burn_rate: null,
        headcount_ft: null,
        headcount_pt: null,
      },
    },
    lastYear: null,
    events: options.events ?? [],
    financials: {
      month: "2026-09-01",
      revenue_total: 1000,
      gross_profit: -150,
      net_profit: null,
      cash_in_bank: null,
      burn_rate: null,
      headcount_ft: null,
      headcount_pt: null,
    },
    clientSettings: {
      require_mfa: true,
      terms_version: "2026-09",
      declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
      due_day: 15,
      owner_contributor_limit: 4,
    },
    settings: null,
  };
}

let eventId = 0;

export function event(kind: string, extra: Partial<SubmissionEventWithActor> = {}): SubmissionEventWithActor {
  eventId += 1;
  return {
    id: eventId,
    submission_id: IDS.submission,
    event: kind,
    actor_id: null,
    message: null,
    created_at: "2026-10-04T03:00:00+00:00",
    actor: null,
    actor_name: null,
    ...extra,
  };
}
