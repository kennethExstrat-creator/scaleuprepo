// Seed-like rows (docs/ARCHITECTURE.md §2.9 / §3) in deliberately scrambled order, so sorting is tested.
import type { ClientSettings } from "@/lib/types/domain";

import type { TableData } from "./fake-postgrest";

export const IDS = {
  template: "b0000000-0000-4000-8000-000000000001",
  otherTemplate: "b0000000-0000-4000-8000-000000000002",
  v1: "b1000000-0000-4000-8000-000000000001",
  v2draft: "b1000000-0000-4000-8000-000000000002",
  otherV1: "b1000000-0000-4000-8000-000000000003",
  batik: "c0000000-0000-4000-8000-000000000001",
  recqa: "c0000000-0000-4000-8000-000000000002",
  outlet: "d0000000-0000-4000-8000-000000000001",
  productDim: "d0000000-0000-4000-8000-000000000002",
  montKiara: "d1000000-0000-4000-8000-000000000001",
  theRow: "d1000000-0000-4000-8000-000000000002",
  ioi: "d1000000-0000-4000-8000-000000000003",
  westin: "d1000000-0000-4000-8000-000000000004",
  merdeka: "d1000000-0000-4000-8000-000000000005",
  kpiRevenuePerOutlet: "e0000000-0000-4000-8000-000000000001",
  kpiBreakEven: "e0000000-0000-4000-8000-000000000002",
  kpiProfitable: "e0000000-0000-4000-8000-000000000003",
  kpiOld: "e0000000-0000-4000-8000-000000000008",
  kpiHalfYearly: "e0000000-0000-4000-8000-000000000009",
  segOnline: "f0000000-0000-4000-8000-000000000001",
  segRetail: "f0000000-0000-4000-8000-000000000002",
  segWholesale: "f0000000-0000-4000-8000-000000000003",
  segCorporate: "f0000000-0000-4000-8000-000000000004",
  owner: "a1000000-0000-4000-8000-000000000001",
  contributor: "a1000000-0000-4000-8000-000000000002",
  formerContributor: "a1000000-0000-4000-8000-000000000003",
  hiddenUser: "a1000000-0000-4000-8000-000000000004",
  partner: "a1000000-0000-4000-8000-000000000005",
  subSep: "90000000-0000-4000-8000-000000000009",
  subAug: "90000000-0000-4000-8000-000000000008",
  subJul: "90000000-0000-4000-8000-000000000007",
  subSepLastYear: "90000000-0000-4000-8000-000000000109",
  subOtherCompanyAug: "90000000-0000-4000-8000-000000000208",
};

const ts = "2026-09-30T06:00:00.000000+00:00";

function section(id: string, versionId: string, key: string, title: string, kind: string, sort_order: number) {
  return { id, template_version_id: versionId, key, title, description: null, kind, sort_order, created_at: ts };
}

function field(
  id: string,
  sectionId: string,
  key: string,
  label: string,
  field_type: string,
  sort_order: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    template_version_id: IDS.v1,
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
    created_at: ts,
    ...extra,
  };
}

const S = {
  financials: "b2000000-0000-4000-8000-000000000001",
  headcount: "b2000000-0000-4000-8000-000000000002",
  kpis: "b2000000-0000-4000-8000-000000000003",
  summary: "b2000000-0000-4000-8000-000000000004",
  investment: "b2000000-0000-4000-8000-000000000010",
  pulse: "b2000000-0000-4000-8000-000000000013",
  // same sort_order as `investment`: ties are broken by key ('compliance…' < 'investment')
  compliance: "b2000000-0000-4000-8000-000000000011",
};

export const SECTION_IDS = S;

function sub(id: string, company_id: string, month: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    company_id,
    period_id: `70000000-0000-4000-8000-0000000000${month.slice(5, 7)}`,
    month,
    template_version_id: IDS.v1,
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
    created_at: ts,
    updated_at: ts,
    ...extra,
  };
}

function value(submission_id: string, field_key: string, v: { n?: number; t?: string; j?: unknown }) {
  return {
    submission_id,
    field_key,
    value_number: v.n ?? null,
    value_text: v.t ?? null,
    value_json: v.j ?? null,
    created_at: ts,
    updated_at: ts,
    updated_by: IDS.owner,
  };
}

function profile(id: string, email: string, full_name: string | null, scaleup_role: string | null = null) {
  return {
    id,
    email,
    full_name,
    job_title: null,
    scaleup_role,
    is_active: true,
    terms_accepted_at: ts,
    terms_version: "2026-09",
    created_at: ts,
    updated_at: ts,
  };
}

/** What `get_client_settings()` returns for the seeded settings (every signed-in user may read it). */
export const CLIENT_SETTINGS: ClientSettings = {
  require_mfa: true,
  terms_version: "2026-09",
  declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
  due_day: 15,
  owner_contributor_limit: 4,
};

export function seed(): TableData {
  return {
    platform_settings: [
      {
        id: 1,
        due_day: 15,
        escalation_days: 14,
        backfill_grace_days: 14,
        revenue_swing_pct: 30,
        min_runway_months: 6,
        require_mfa: true,
        default_reporting_start: "2026-07-01",
        declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
        terms_version: "2026-09",
        owner_contributor_limit: 4,
        updated_by: null,
        created_at: ts,
        updated_at: ts,
      },
    ],
    templates: [
      { id: IDS.otherTemplate, name: "Legacy form", description: null, is_default: false, created_at: ts },
      { id: IDS.template, name: "Portfolio Update", description: "C4", is_default: true, created_at: ts },
    ],
    template_versions: [
      { id: IDS.otherV1, template_id: IDS.otherTemplate, version_no: 1, status: "published", notes: null, created_by: null, published_at: ts, published_by: null, created_at: ts },
      { id: IDS.v2draft, template_id: IDS.template, version_no: 2, status: "draft", notes: null, created_by: null, published_at: null, published_by: null, created_at: ts },
      { id: IDS.v1, template_id: IDS.template, version_no: 1, status: "published", notes: "Initial version", created_by: null, published_at: ts, published_by: null, created_at: ts },
    ],
    template_sections: [
      section(S.pulse, IDS.v1, "founder_pulse", "Founder Pulse", "pulse", 13),
      section(S.investment, IDS.v1, "investment", "Investment", "narrative", 10),
      section(S.compliance, IDS.v1, "compliance_regulation", "Compliance and Regulation", "narrative", 10),
      section(S.financials, IDS.v1, "financials", "Financials", "financials", 1),
      section(S.kpis, IDS.v1, "kpis", "Company KPIs", "kpis", 3),
      section(S.headcount, IDS.v1, "headcount", "Headcount", "headcount", 2),
      section(S.summary, IDS.v1, "company_summary", "Company Summary", "narrative", 4),
      // other versions' sections must never leak into v1
      section("b2000000-0000-4000-8000-000000000099", IDS.otherV1, "financials", "Old financials", "financials", 1),
    ],
    template_fields: [
      field("b3000000-0000-4000-8000-000000000023", S.pulse, "help_tags", "Help needed (tags)", "tags", 4, {
        options: { options: ["Fundraising", "Hiring", 42, "Other"] },
      }),
      field("b3000000-0000-4000-8000-000000000020", S.pulse, "team_morale", "Team morale", "rating", 1, {
        options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high", "3": 3 } },
      }),
      field("b3000000-0000-4000-8000-000000000016", S.investment, "fundraising_status", "Fundraising status", "picklist", 1, {
        options: { options: ["Not raising", "Actively raising"] },
      }),
      field("b3000000-0000-4000-8000-000000000018", S.compliance, "compliance_updates", "Licences and regulatory matters", "long_text", 1, {
        is_required: true,
        validation: { max_length: "4000" },
      }),
      field("b3000000-0000-4000-8000-000000000005", S.financials, "burn_rate", "Burn rate (per month)", "currency", 5, { is_required: true, is_system: true, validation: { min: 0 } }),
      field("b3000000-0000-4000-8000-000000000001", S.financials, "revenue_total", "Total revenue", "currency", 1, { is_required: true, is_system: true, validation: { min: 0 } }),
      field("b3000000-0000-4000-8000-000000000003", S.financials, "net_profit", "Net profit", "currency", 3, { is_required: true, is_system: true, validation: { allow_negative: true } }),
      field("b3000000-0000-4000-8000-000000000002", S.financials, "gross_profit", "Gross profit", "currency", 2, { is_required: true, is_system: true, validation: { allow_negative: true } }),
      field("b3000000-0000-4000-8000-000000000004", S.financials, "cash_in_bank", "Cash in bank (month end)", "currency", 4, { is_required: true, is_system: true, validation: { min: 0 } }),
      field("b3000000-0000-4000-8000-000000000007", S.headcount, "headcount_pt", "Part-time headcount", "integer", 2, { is_required: true, is_system: true, validation: { min: 0 } }),
      field("b3000000-0000-4000-8000-000000000006", S.headcount, "headcount_ft", "Full-time headcount", "integer", 1, { is_required: true, is_system: true, validation: { min: 0 } }),
      field("b3000000-0000-4000-8000-000000000008", S.summary, "key_milestones", "Key milestones", "long_text", 1),
      // same sort_order as key_milestones: tie broken by key ('another_note' < 'key_milestones')
      field("b3000000-0000-4000-8000-000000000030", S.summary, "another_note", "Another note", "text", 1),
      { ...field("b3000000-0000-4000-8000-000000000099", "b2000000-0000-4000-8000-000000000099", "revenue_total", "Old revenue", "currency", 1), template_version_id: IDS.otherV1 },
    ],
    companies: [
      {
        id: IDS.batik,
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
        created_at: ts,
        updated_at: ts,
      },
    ],
    // ScaleUp-internal (RLS: ScaleUp staff only). Batik Boutique has a partner-in-charge, RECQA none.
    company_internal: [
      {
        company_id: IDS.recqa,
        partner_in_charge_id: null,
        internal_rating: null,
        exit_strategy_status: null,
        exit_strategy_notes: null,
        notes: null,
        updated_by: null,
        created_at: ts,
        updated_at: ts,
      },
      {
        company_id: IDS.batik,
        partner_in_charge_id: IDS.partner,
        internal_rating: "watch",
        exit_strategy_status: "Trade sale",
        exit_strategy_notes: null,
        notes: "Keep an eye on churn",
        updated_by: IDS.partner,
        created_at: ts,
        updated_at: ts,
      },
    ],
    // Batik Boutique's own revenue segments (BRD B30: kind 'company', they add up to total revenue);
    // Wholesale is retired. RECQA has a ScaleUp revenue line.
    revenue_segments: [
      { id: IDS.segWholesale, company_id: IDS.batik, kind: "company", name: "Wholesale", sort_order: 0, is_active: false, retired_at: ts, created_at: ts },
      { id: IDS.segRetail, company_id: IDS.batik, kind: "company", name: "Retail", sort_order: 2, is_active: true, retired_at: null, created_at: ts },
      { id: IDS.segOnline, company_id: IDS.batik, kind: "company", name: "Online", sort_order: 1, is_active: true, retired_at: null, created_at: ts },
      { id: IDS.segCorporate, company_id: IDS.batik, kind: "company", name: "Corporate", sort_order: 1, is_active: true, retired_at: null, created_at: ts },
      { id: "f0000000-0000-4000-8000-000000000099", company_id: IDS.recqa, kind: "scaleup", name: "RECQA only", sort_order: 0, is_active: true, retired_at: null, created_at: ts },
    ],
    kpi_dimensions: [
      { id: IDS.productDim, company_id: IDS.batik, name: "Product", created_at: ts },
      { id: IDS.outlet, company_id: IDS.batik, name: "Outlet", created_at: ts },
    ],
    kpi_dimension_members: [
      { id: IDS.merdeka, dimension_id: IDS.outlet, name: "Merdeka 118", sort_order: 5, is_active: true, created_at: ts },
      { id: IDS.westin, dimension_id: IDS.outlet, name: "Westin Desaru", sort_order: 4, is_active: false, created_at: ts },
      { id: IDS.montKiara, dimension_id: IDS.outlet, name: "Mont Kiara", sort_order: 1, is_active: true, created_at: ts },
      { id: IDS.ioi, dimension_id: IDS.outlet, name: "IOI City Mall", sort_order: 3, is_active: true, created_at: ts },
      { id: IDS.theRow, dimension_id: IDS.outlet, name: "The Row", sort_order: 2, is_active: true, created_at: ts },
    ],
    company_kpis: [
      { id: IDS.kpiProfitable, company_id: IDS.batik, name: "Profitable", description: null, unit: null, value_type: "boolean", frequency: "monthly", dimension_id: IDS.outlet, is_required: true, sort_order: 3, is_active: true, created_at: ts, updated_at: ts },
      { id: IDS.kpiOld, company_id: IDS.batik, name: "Old KPI", description: null, unit: null, value_type: "number", frequency: "monthly", dimension_id: null, is_required: true, sort_order: 0, is_active: false, created_at: ts, updated_at: ts },
      { id: IDS.kpiRevenuePerOutlet, company_id: IDS.batik, name: "Revenue per outlet", description: null, unit: "RM", value_type: "currency", frequency: "monthly", dimension_id: IDS.outlet, is_required: true, sort_order: 1, is_active: true, created_at: ts, updated_at: ts },
      { id: IDS.kpiHalfYearly, company_id: IDS.batik, name: "Customer NPS", description: null, unit: null, value_type: "integer", frequency: "half_yearly", dimension_id: null, is_required: true, sort_order: 4, is_active: true, created_at: ts, updated_at: ts },
      { id: IDS.kpiBreakEven, company_id: IDS.batik, name: "Monthly break-even", description: null, unit: "RM", value_type: "currency", frequency: "monthly", dimension_id: IDS.outlet, is_required: true, sort_order: 2, is_active: true, created_at: ts, updated_at: ts },
    ],
    profiles: [
      profile(IDS.owner, "aisyah@batik.example", "Aisyah Rahman"),
      profile(IDS.contributor, "ben@batik.example", null),
      profile(IDS.formerContributor, "chen@batik.example", "Chen Wei"),
      profile(IDS.partner, "priya@scaleup.example", "Priya Nair", "partner"),
      // IDS.hiddenUser has no visible profile (RLS)
    ],
    company_members: [
      { company_id: IDS.batik, user_id: IDS.formerContributor, role: "contributor", is_active: false, invited_by: IDS.owner, created_at: ts, updated_at: ts },
      { company_id: IDS.batik, user_id: IDS.contributor, role: "contributor", is_active: true, invited_by: IDS.owner, created_at: ts, updated_at: ts },
      { company_id: IDS.batik, user_id: IDS.hiddenUser, role: "contributor", is_active: true, invited_by: null, created_at: ts, updated_at: ts },
      { company_id: IDS.batik, user_id: IDS.owner, role: "owner", is_active: true, invited_by: null, created_at: ts, updated_at: ts },
    ],
    submissions: [
      sub(IDS.subJul, IDS.batik, "2026-07-01", "approved"),
      sub(IDS.subSep, IDS.batik, "2026-09-01", "changes_requested", { revision: 1 }),
      sub(IDS.subOtherCompanyAug, IDS.recqa, "2026-08-01", "submitted"),
      sub(IDS.subAug, IDS.batik, "2026-08-01", "submitted", { revision: 1 }),
      sub(IDS.subSepLastYear, IDS.batik, "2025-09-01", "approved", { template_version_id: IDS.otherV1 }),
    ],
    submission_values: [
      value(IDS.subSep, "revenue_total", { n: 300 }),
      value(IDS.subSep, "gross_profit", { n: 120 }),
      value(IDS.subSep, "net_profit", { n: -10.5 }),
      value(IDS.subSep, "cash_in_bank", { n: 1000 }),
      value(IDS.subSep, "burn_rate", { n: 50 }),
      value(IDS.subSep, "headcount_ft", { n: 10 }),
      value(IDS.subSep, "headcount_pt", { n: 2 }),
      value(IDS.subSep, "key_milestones", { t: "Opened Merdeka 118" }),
      value(IDS.subSep, "help_tags", { j: ["Hiring"] }),
      value(IDS.subAug, "revenue_total", { n: 200 }),
      value(IDS.subAug, "gross_profit", { n: 80 }),
      value(IDS.subAug, "key_milestones", { t: "August milestones" }),
      value(IDS.subSepLastYear, "revenue_total", { n: 100 }),
      value(IDS.subJul, "revenue_total", { n: 999 }),
      value(IDS.subOtherCompanyAug, "revenue_total", { n: 777 }),
    ],
    submission_segment_values: [
      { submission_id: IDS.subSep, segment_id: IDS.segOnline, amount: 100, created_at: ts, updated_at: ts, updated_by: IDS.owner },
      { submission_id: IDS.subSep, segment_id: IDS.segRetail, amount: 150, created_at: ts, updated_at: ts, updated_by: IDS.owner },
      { submission_id: IDS.subSep, segment_id: IDS.segCorporate, amount: 50.25, created_at: ts, updated_at: ts, updated_by: IDS.owner },
      { submission_id: IDS.subAug, segment_id: IDS.segOnline, amount: 200, created_at: ts, updated_at: ts, updated_by: IDS.owner },
    ],
    submission_kpi_values: [
      { id: "60000000-0000-4000-8000-000000000001", submission_id: IDS.subSep, kpi_id: IDS.kpiRevenuePerOutlet, dimension_member_id: IDS.montKiara, value_number: 120, value_text: null, value_bool: null, created_at: ts, updated_at: ts, updated_by: IDS.owner },
      { id: "60000000-0000-4000-8000-000000000002", submission_id: IDS.subSep, kpi_id: IDS.kpiProfitable, dimension_member_id: IDS.theRow, value_number: null, value_text: null, value_bool: false, created_at: ts, updated_at: ts, updated_by: IDS.owner },
      { id: "60000000-0000-4000-8000-000000000003", submission_id: IDS.subAug, kpi_id: IDS.kpiRevenuePerOutlet, dimension_member_id: IDS.montKiara, value_number: 90, value_text: null, value_bool: null, created_at: ts, updated_at: ts, updated_by: IDS.owner },
    ],
    submission_events: [
      { id: 12, submission_id: IDS.subSep, event: "changes_requested", actor_id: IDS.partner, message: "Please check GP", created_at: "2026-09-29T02:00:00.5+00:00" },
      { id: 11, submission_id: IDS.subSep, event: "submitted", actor_id: IDS.owner, message: null, created_at: "2026-09-28T10:00:00.123456+00:00" },
      { id: 14, submission_id: IDS.subSep, event: "deadline_extended", actor_id: null, message: "System", created_at: "2026-09-29T02:00:00.500001+00:00" },
      { id: 13, submission_id: IDS.subSep, event: "resubmitted", actor_id: IDS.hiddenUser, message: null, created_at: "2026-09-29T02:00:00.500001+00:00" },
      { id: 20, submission_id: IDS.subAug, event: "submitted", actor_id: IDS.contributor, message: null, created_at: ts },
    ],
    v_submission_overview: [
      { id: IDS.subAug, company_id: IDS.batik, month: "2026-08-01", status: "submitted", due_date: "2026-09-15", original_due_date: null, submitted_at: ts, approved_at: null, revision: 1, last_saved_at: ts, is_overdue: false, days_overdue: 0, has_narrative: true, open_threads: 0 },
      { id: IDS.subSep, company_id: IDS.batik, month: "2026-09-01", status: "changes_requested", due_date: "2026-10-15", original_due_date: null, submitted_at: ts, approved_at: null, revision: 1, last_saved_at: ts, is_overdue: false, days_overdue: 0, has_narrative: true, open_threads: 2 },
      { id: IDS.subJul, company_id: IDS.batik, month: "2026-07-01", status: "approved", due_date: "2026-08-15", original_due_date: null, submitted_at: ts, approved_at: ts, revision: 1, last_saved_at: ts, is_overdue: null, days_overdue: null, has_narrative: null, open_threads: null },
      { id: null, company_id: IDS.batik, month: "2026-06-01", status: "draft", due_date: "2026-07-15", original_due_date: null, submitted_at: null, approved_at: null, revision: 0, last_saved_at: null, is_overdue: false, days_overdue: 0, has_narrative: false, open_threads: 0 },
      { id: IDS.subOtherCompanyAug, company_id: IDS.recqa, month: "2026-08-01", status: "submitted", due_date: "2026-09-15", original_due_date: null, submitted_at: ts, approved_at: null, revision: 1, last_saved_at: ts, is_overdue: false, days_overdue: 0, has_narrative: false, open_threads: 0 },
    ],
    v_submission_financials: [
      { submission_id: IDS.subSep, company_id: IDS.batik, month: "2026-09-01", status: "changes_requested", due_date: "2026-10-15", submitted_at: ts, approved_at: null, currency: "MYR", fx_rate_to_myr: 1, revenue_total: 300, gross_profit: 120, net_profit: -10.5, cash_in_bank: 1000, burn_rate: 50, headcount_ft: 10, headcount_pt: 2 },
      { submission_id: IDS.subJul, company_id: IDS.batik, month: "2026-07-01", status: "approved", due_date: "2026-08-15", submitted_at: ts, approved_at: ts, currency: "MYR", fx_rate_to_myr: 1, revenue_total: 999, gross_profit: null, net_profit: null, cash_in_bank: null, burn_rate: null, headcount_ft: null, headcount_pt: null },
      { submission_id: IDS.subAug, company_id: IDS.batik, month: "2026-08-01", status: "submitted", due_date: "2026-09-15", submitted_at: ts, approved_at: null, currency: "MYR", fx_rate_to_myr: 1, revenue_total: 200, gross_profit: 80, net_profit: null, cash_in_bank: null, burn_rate: null, headcount_ft: null, headcount_pt: null },
      { submission_id: IDS.subSepLastYear, company_id: IDS.batik, month: "2025-09-01", status: "approved", due_date: "2025-10-15", submitted_at: ts, approved_at: ts, currency: "MYR", fx_rate_to_myr: 1, revenue_total: 100, gross_profit: null, net_profit: null, cash_in_bank: null, burn_rate: null, headcount_ft: null, headcount_pt: null },
      { submission_id: IDS.subOtherCompanyAug, company_id: IDS.recqa, month: "2026-08-01", status: "submitted", due_date: "2026-09-15", submitted_at: ts, approved_at: null, currency: "USD", fx_rate_to_myr: null, revenue_total: 777, gross_profit: null, net_profit: null, cash_in_bank: null, burn_rate: null, headcount_ft: null, headcount_pt: null },
    ],
  };
}
