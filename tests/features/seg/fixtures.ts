// Fixtures for the revenue segments UI tests (BRD B30): a company with its own revenue segments (Retail,
// Online; Wholesale retired) and ScaleUp revenue lines (AOnePay; Legacy line inactive), and monthly form
// bundles for September 2026 with August as the previous month.

import {
  partitionRevenueSegments,
  type CompanyRow,
  type RevenueSegmentRow,
  type SubmissionBundle,
  type SubmissionRow,
  type SubmissionValueRow,
  type SubmissionValues,
  type TemplateFieldRow,
  type TemplateSectionFull,
} from "@/lib/types/domain";
import type { FieldType, SectionKind, SubmissionStatus } from "@/lib/types/enums";

export const IDS = {
  company: "c0000000-0000-4000-8000-000000000021",
  submission: "90000000-0000-4000-8000-000000000021",
  previous: "90000000-0000-4000-8000-000000000020",
  version: "b1000000-0000-4000-8000-000000000001",
  template: "b0000000-0000-4000-8000-000000000001",
  retail: "f1000000-0000-4000-8000-000000000001",
  online: "f1000000-0000-4000-8000-000000000002",
  wholesale: "f1000000-0000-4000-8000-000000000003",
  aonePay: "f2000000-0000-4000-8000-000000000001",
  legacyLine: "f2000000-0000-4000-8000-000000000002",
  owner: "a1000000-0000-4000-8000-000000000001",
};

export const TS = "2026-07-01T02:00:00+00:00";
export const RETIRED_AT = "2026-09-20T02:00:00+00:00";

export function segmentRow(
  id: string,
  name: string,
  kind: "company" | "scaleup",
  sort_order: number,
  active = true,
): RevenueSegmentRow {
  return {
    id,
    company_id: IDS.company,
    name,
    kind,
    sort_order,
    is_active: active,
    retired_at: active ? null : RETIRED_AT,
    created_at: TS,
  };
}

export const RETAIL = segmentRow(IDS.retail, "Retail", "company", 1);
export const ONLINE = segmentRow(IDS.online, "Online", "company", 2);
export const WHOLESALE = segmentRow(IDS.wholesale, "Wholesale", "company", 3, false);
export const AONEPAY = segmentRow(IDS.aonePay, "AOnePay", "scaleup", 10);
export const LEGACY_LINE = segmentRow(IDS.legacyLine, "Legacy line", "scaleup", 20, false);

/** Both kinds, active and retired. */
export const ALL_SEGMENTS: RevenueSegmentRow[] = [RETAIL, ONLINE, WHOLESALE, AONEPAY, LEGACY_LINE];

let fieldSeq = 0;
function field(sectionId: string, key: string, label: string, field_type: FieldType): TemplateFieldRow {
  fieldSeq += 1;
  return {
    id: `b3000000-0000-4000-8000-${String(fieldSeq).padStart(12, "0")}`,
    template_version_id: IDS.version,
    section_id: sectionId,
    key,
    label,
    help_text: null,
    field_type,
    is_required: true,
    is_system: true,
    options: null,
    validation: key === "gross_profit" || key === "net_profit" ? { allow_negative: true } : { min: 0 },
    sort_order: fieldSeq,
    created_at: TS,
  };
}

function section(n: number, key: string, title: string, kind: SectionKind, fields: TemplateFieldRow[]): TemplateSectionFull {
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
    field(S(1), "revenue_total", "Total revenue", "currency"),
    field(S(1), "gross_profit", "Gross profit", "currency"),
    field(S(1), "net_profit", "Net profit", "currency"),
    field(S(1), "cash_in_bank", "Cash in bank (month end)", "currency"),
    field(S(1), "burn_rate", "Burn rate (per month)", "currency"),
  ]),
  section(2, "headcount", "Headcount", "headcount", [
    field(S(2), "headcount_ft", "Full-time headcount", "integer"),
    field(S(2), "headcount_pt", "Part-time headcount", "integer"),
  ]),
];

export function valueRow(submission_id: string, field_key: string, value: number): SubmissionValueRow {
  return {
    submission_id,
    field_key,
    value_number: value,
    value_text: null,
    value_json: null,
    created_at: TS,
    updated_at: TS,
    updated_by: IDS.owner,
  };
}

export function values(total: number | null, segments: Record<string, number | null>): SubmissionValues {
  return {
    values: total === null ? {} : { revenue_total: valueRow(IDS.submission, "revenue_total", total) },
    segments,
    kpis: {},
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

export function companyRow(status: CompanyRow["status"] = "active"): CompanyRow {
  return {
    id: IDS.company,
    name: "Demo Company",
    legal_name: null,
    registration_no: null,
    sector: null,
    country: "Malaysia",
    website: null,
    description: null,
    reporting_currency: "MYR",
    status,
    status_changed_at: null,
    status_reason: null,
    reporting_start_month: "2026-07-01",
    created_at: TS,
    updated_at: TS,
  };
}

export function makeBundle(
  status: SubmissionStatus = "draft",
  options: {
    segments?: RevenueSegmentRow[];
    current?: SubmissionValues;
    previous?: SubmissionValues;
    companyStatus?: CompanyRow["status"];
  } = {},
): SubmissionBundle {
  const company = companyRow(options.companyStatus ?? "active");
  const segments = options.segments ?? ALL_SEGMENTS;
  const current = options.current ?? values(1000, { [IDS.retail]: 700, [IDS.online]: 300 });
  const previousValues = options.previous ?? values(800, { [IDS.retail]: 800, [IDS.aonePay]: 120 });
  const empty = {
    gross_profit: null,
    net_profit: null,
    cash_in_bank: null,
    burn_rate: null,
    headcount_ft: null,
    headcount_pt: null,
  };
  return {
    submission: submissionRow(status),
    company,
    config: {
      company,
      segments,
      ...partitionRevenueSegments(segments),
      kpis: [],
      dimensions: [],
      members: [],
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
      sections: SECTIONS,
    },
    current,
    previous: {
      submission: { ...submissionRow("approved"), id: IDS.previous, month: "2026-08-01", due_date: "2026-09-15" },
      values: previousValues,
      financials: { month: "2026-08-01", revenue_total: 800, ...empty },
    },
    lastYear: null,
    events: [],
    financials: {
      month: "2026-09-01",
      revenue_total: current.values.revenue_total?.value_number ?? null,
      ...empty,
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
