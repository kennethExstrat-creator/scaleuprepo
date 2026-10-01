import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCompanyConfig, getCurrentTemplateVersion, getTemplateVersion, isNotFoundError } from "@/lib/data";
import { toFiniteNumber } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import { kpiCellKey } from "@/lib/targets";
import type { TemplateVersionFull } from "@/lib/types/domain";

import type { C4Include, C4Kpi, C4Month, C4StoredKpiValue, C4StoredValue, C4WorkbookInput } from "./c4-workbook";
import { exportQueryError, fetchAllPages, fetchByIdChunks } from "./fetch-all";

// Loads everything the C4 workbook needs with the caller's RLS-scoped client (ScaleUp staff, or an owner
// of the company). Company users never receive ScaleUp-internal data here: nothing is read from
// company_internal, fund_investments or profiles, and FX rates are ScaleUp-only (fx_rate_to_myr is null
// for company users, and the RM block is only added for ScaleUp callers).

const OP = "loadC4WorkbookInput";

type SubmissionListRow = {
  id: string;
  month: string;
  status: Database["public"]["Enums"]["submission_status"];
  template_version_id: string;
  submitted_at: string | null;
  approved_at: string | null;
  last_saved_at: string | null;
};

type FxRow = { submission_id: string | null; fx_rate_to_myr: number | null };

type ValueRow = {
  submission_id: string;
  field_key: string;
  value_number: number | null;
  value_text: string | null;
  value_json: Database["public"]["Tables"]["submission_values"]["Row"]["value_json"];
};

type SegmentValueRow = { submission_id: string; segment_id: string; amount: number | null };

type KpiValueRow = {
  submission_id: string;
  kpi_id: string;
  dimension_member_id: string | null;
  value_number: number | null;
  value_text: string | null;
  value_bool: boolean | null;
};

/**
 * The C4 workbook input for a company, or null when the company does not exist or is not visible.
 * `include` decides which months' values are loaded (approved only, or every month); every month is
 * listed either way so the workbook can state which months are not approved yet.
 */
export async function loadC4WorkbookInput(
  sb: SupabaseClient<Database>,
  companyId: string,
  options: { include: C4Include; fxVisible: boolean; generatedAt: string; today?: string },
): Promise<C4WorkbookInput | null> {
  const [configResult, submissionsRes, fxRes, currentTemplate] = await Promise.all([
    getCompanyConfig(sb, companyId).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    sb
      .from("submissions")
      .select("id, month, status, template_version_id, submitted_at, approved_at, last_saved_at")
      .eq("company_id", companyId)
      .order("month", { ascending: true }),
    sb.from("v_submission_financials").select("submission_id, fx_rate_to_myr").eq("company_id", companyId),
    getCurrentTemplateVersion(sb),
  ]);
  if (!configResult.ok) {
    if (isNotFoundError(configResult.error)) return null;
    throw configResult.error;
  }
  const config = configResult.value;
  if (submissionsRes.error) throw exportQueryError(OP, `load the monthly updates of company ${companyId}`, submissionsRes.error);
  if (fxRes.error) throw exportQueryError(OP, `load the FX rates of company ${companyId}`, fxRes.error);

  const submissions: SubmissionListRow[] = submissionsRes.data;
  const fxRows: FxRow[] = fxRes.data;
  const fxBySubmission = new Map<string, number | null>();
  for (const row of fxRows) {
    if (row.submission_id) fxBySubmission.set(row.submission_id, toFiniteNumber(row.fx_rate_to_myr));
  }

  const included = submissions.filter((s) => options.include === "all" || s.status === "approved");
  const includedIds = included.map((s) => s.id);

  const templateIds = [...new Set(included.map((s) => s.template_version_id))].filter(
    (id) => id !== currentTemplate?.id,
  );
  const [values, segmentValues, kpiValues, templates] = await Promise.all([
    fetchByIdChunks(includedIds, (chunk) =>
      fetchAllPages<ValueRow>(OP, "load the monthly values", (from, to) =>
        sb
          .from("submission_values")
          .select("submission_id, field_key, value_number, value_text, value_json")
          .in("submission_id", chunk)
          .order("submission_id")
          .order("field_key")
          .range(from, to),
      ),
    ),
    fetchByIdChunks(includedIds, (chunk) =>
      fetchAllPages<SegmentValueRow>(OP, "load the segment revenue", (from, to) =>
        sb
          .from("submission_segment_values")
          .select("submission_id, segment_id, amount")
          .in("submission_id", chunk)
          .order("submission_id")
          .order("segment_id")
          .range(from, to),
      ),
    ),
    fetchByIdChunks(includedIds, (chunk) =>
      fetchAllPages<KpiValueRow>(OP, "load the KPI values", (from, to) =>
        sb
          .from("submission_kpi_values")
          .select("submission_id, kpi_id, dimension_member_id, value_number, value_text, value_bool")
          .in("submission_id", chunk)
          .order("submission_id")
          .order("id")
          .range(from, to),
      ),
    ),
    Promise.all(templateIds.map((id) => getTemplateVersion(sb, id))),
  ]);

  const valuesBySubmission = new Map<string, Record<string, C4StoredValue>>();
  for (const row of values) {
    const map = valuesBySubmission.get(row.submission_id) ?? {};
    map[row.field_key] = { value_number: row.value_number, value_text: row.value_text, value_json: row.value_json };
    valuesBySubmission.set(row.submission_id, map);
  }
  const segmentsBySubmission = new Map<string, Record<string, number | null>>();
  for (const row of segmentValues) {
    const map = segmentsBySubmission.get(row.submission_id) ?? {};
    map[row.segment_id] = toFiniteNumber(row.amount);
    segmentsBySubmission.set(row.submission_id, map);
  }
  const kpisBySubmission = new Map<string, Record<string, C4StoredKpiValue>>();
  for (const row of kpiValues) {
    const map = kpisBySubmission.get(row.submission_id) ?? {};
    map[kpiCellKey(row.kpi_id, row.dimension_member_id)] = {
      value_number: row.value_number,
      value_text: row.value_text,
      value_bool: row.value_bool,
    };
    kpisBySubmission.set(row.submission_id, map);
  }

  const months: C4Month[] = submissions.map((s) => ({
    month: s.month,
    status: s.status,
    template_version_id: s.template_version_id,
    submitted_at: s.submitted_at,
    approved_at: s.approved_at,
    last_saved_at: s.last_saved_at,
    fx_rate_to_myr: fxBySubmission.get(s.id) ?? null,
    values: valuesBySubmission.get(s.id) ?? {},
    segments: segmentsBySubmission.get(s.id) ?? {},
    kpis: kpisBySubmission.get(s.id) ?? {},
  }));

  const dimensionMembers = new Map(config.dimensions.map((dimension) => [dimension.id, dimension.members]));
  const kpis: C4Kpi[] = config.kpis.map((kpi) => ({
    id: kpi.id,
    name: kpi.name,
    unit: kpi.unit,
    value_type: kpi.value_type,
    frequency: kpi.frequency,
    is_active: kpi.is_active,
    dimension: kpi.dimension ? { name: kpi.dimension.name } : null,
    // Every member of the dimension (inactive ones keep their history); the KPI definition lists only
    // the active ones.
    members: kpi.dimension_id ? (dimensionMembers.get(kpi.dimension_id) ?? kpi.members) : [],
  }));

  const usedTemplates: TemplateVersionFull[] = currentTemplate ? [currentTemplate, ...templates] : templates;
  return {
    company: {
      name: config.company.name,
      legal_name: config.company.legal_name,
      reporting_currency: config.company.reporting_currency.trim(),
    },
    include: options.include,
    generatedAt: options.generatedAt,
    today: options.today,
    fxVisible: options.fxVisible,
    currentTemplate,
    templates: usedTemplates,
    segments: config.segments,
    kpis,
    months,
  };
}
