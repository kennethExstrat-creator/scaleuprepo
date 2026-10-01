// Database-shaped fixtures (rows as PostgREST returns them, data-layer results) shared by the M9 loader
// and route tests.
import {
  partitionRevenueSegments,
  type CompanyConfig,
  type CompanyRow,
  type RevenueSegmentRow,
  type TemplateFieldRow,
  type TemplateSectionFull,
  type TemplateVersionFull,
} from "@/lib/types/domain";
import type { FieldType, SectionKind } from "@/lib/types/enums";

import type { Row } from "./fake-supabase";

export const BATIK = "c0000000-0000-4000-8000-000000000001";
export const T1 = "b1000000-0000-4000-8000-000000000001";
export const T2 = "b1000000-0000-4000-8000-000000000002";
export const MAY = "5a000000-0000-4000-8000-000000000005";
export const JUN = "5a000000-0000-4000-8000-000000000006";
export const OUTLET = "d1000000-0000-4000-8000-000000000000";
export const MONT_KIARA = "d1000000-0000-4000-8000-000000000001";
export const OLD_TOWN = "d1000000-0000-4000-8000-000000000002";
export const KPI = "e1000000-0000-4000-8000-000000000001";
export const RETAIL = "a1000000-0000-4000-8000-000000000001";
export const SAAS = "a1000000-0000-4000-8000-000000000002";
const CREATED = "2026-06-01T00:00:00Z";

export function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: BATIK,
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
    reporting_start_month: "2026-05-01",
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

export function templateField(versionId: string, sectionId: string, key: string, label: string, type: FieldType): TemplateFieldRow {
  return {
    id: `${sectionId}-${key}`,
    template_version_id: versionId,
    section_id: sectionId,
    key,
    label,
    help_text: null,
    field_type: type,
    is_required: false,
    is_system: false,
    options: null,
    validation: null,
    sort_order: 1,
    created_at: CREATED,
  };
}

export function templateSection(versionId: string, key: string, title: string, kind: SectionKind, fields: [string, string, FieldType][], order: number): TemplateSectionFull {
  const id = `${versionId}-${key}`;
  return {
    id,
    template_version_id: versionId,
    key,
    title,
    description: null,
    kind,
    sort_order: order,
    created_at: CREATED,
    fields: fields.map(([fieldKey, label, type]) => templateField(versionId, id, fieldKey, label, type)),
  };
}

export function templateVersion(id: string, versionNo: number, sections: TemplateSectionFull[]): TemplateVersionFull {
  return {
    id,
    template_id: "b0000000-0000-4000-8000-000000000001",
    version_no: versionNo,
    status: versionNo === 2 ? "published" : "archived",
    notes: null,
    created_by: null,
    created_at: CREATED,
    published_at: CREATED,
    published_by: null,
    template: {
      id: "b0000000-0000-4000-8000-000000000001",
      name: "Portfolio Update",
      description: null,
      is_default: true,
      created_at: CREATED,
    },
    sections,
  };
}

export function config(): CompanyConfig {
  const member = (id: string, name: string, active: boolean, order: number) => ({
    id,
    dimension_id: OUTLET,
    name,
    is_active: active,
    sort_order: order,
    created_at: CREATED,
  });
  const dimension = { id: OUTLET, company_id: BATIK, name: "Outlet", created_at: CREATED };
  // BRD B30: the company's own segment Retail and ScaleUp's revenue line SaaS (no longer used).
  const segments: RevenueSegmentRow[] = [
    { id: RETAIL, company_id: BATIK, name: "Retail", sort_order: 1, is_active: true, kind: "company", retired_at: null, created_at: CREATED },
    {
      id: SAAS,
      company_id: BATIK,
      name: "SaaS",
      sort_order: 1,
      is_active: false,
      kind: "scaleup",
      retired_at: "2026-07-01T00:00:00Z",
      created_at: CREATED,
    },
  ];
  return {
    company: company({ legal_name: "Batik Boutique Sdn Bhd" }),
    segments,
    ...partitionRevenueSegments(segments),
    kpis: [
      {
        id: KPI,
        company_id: BATIK,
        name: "Revenue per outlet",
        description: null,
        unit: "RM",
        value_type: "currency",
        frequency: "monthly",
        dimension_id: OUTLET,
        is_required: true,
        sort_order: 1,
        is_active: true,
        created_at: CREATED,
        updated_at: CREATED,
        dimension,
        members: [member(MONT_KIARA, "Mont Kiara", true, 1)],
      },
    ],
    dimensions: [{ ...dimension, members: [member(MONT_KIARA, "Mont Kiara", true, 1), member(OLD_TOWN, "Old Town", false, 2)] }],
    members: [],
  };
}

export function c4Tables(): Record<string, Row[]> {
  return {
    submissions: [
      { id: MAY, company_id: BATIK, month: "2026-05-01", status: "approved", template_version_id: T1, submitted_at: "2026-06-10T02:00:00Z", approved_at: "2026-06-19T03:00:00Z", last_saved_at: "2026-06-10T02:00:00Z" },
      { id: JUN, company_id: BATIK, month: "2026-06-01", status: "submitted", template_version_id: T2, submitted_at: "2026-07-10T02:00:00Z", approved_at: null, last_saved_at: "2026-07-10T02:00:00Z" },
    ],
    v_submission_financials: [
      { submission_id: MAY, company_id: BATIK, fx_rate_to_myr: 1 },
      { submission_id: JUN, company_id: BATIK, fx_rate_to_myr: 1 },
    ],
    submission_values: [
      { submission_id: MAY, field_key: "revenue_total", value_number: 100_000, value_text: null, value_json: null },
      { submission_id: MAY, field_key: "milestones_old", value_number: null, value_text: "Opened Mont Kiara.", value_json: null },
      { submission_id: JUN, field_key: "revenue_total", value_number: 110_000, value_text: null, value_json: null },
    ],
    submission_segment_values: [
      { submission_id: MAY, segment_id: RETAIL, amount: 100_000 },
      { submission_id: MAY, segment_id: SAAS, amount: 2_500 },
      { submission_id: JUN, segment_id: RETAIL, amount: 110_000 },
    ],
    submission_kpi_values: [
      { id: "k1", submission_id: MAY, kpi_id: KPI, dimension_member_id: OLD_TOWN, value_number: 5_000, value_text: null, value_bool: null },
    ],
  };
}
