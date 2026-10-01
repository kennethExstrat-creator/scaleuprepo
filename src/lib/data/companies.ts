import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  partitionRevenueSegments,
  type CompanyConfig,
  type CompanyInternalWithPartner,
  type CompanyRow,
  type KpiDefinition,
  type KpiDimensionWithMembers,
  type MemberWithProfile,
  type RevenueSegmentRow,
} from "@/lib/types/domain";

import { notFoundError, queryError } from "./errors";
import { isUuid, sortCompanyMembers, sortConfigRows, sortDimensions } from "./shared";

/**
 * The company, or null when it does not exist or the caller may not see it (RLS: ScaleUp staff and the
 * company's own members).
 */
export async function getCompany(sb: SupabaseClient<Database>, companyId: string): Promise<CompanyRow | null> {
  if (!isUuid(companyId)) return null;
  const { data, error } = await sb.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw queryError("getCompany", `load company ${companyId}`, error);
  return data;
}

/**
 * The company's ScaleUp-internal record (BRD §6.3: partner-in-charge, internal rating, exit strategy,
 * notes) with the partner-in-charge's profile, or null when the caller may not see it — Row Level Security
 * shows it to ScaleUp staff only (company users always get null) — or the company does not exist. Pass it
 * to canApprove / canReopen / canEditInternal. Every company has exactly one such row (update it, never
 * insert); only Super Admins change `partner_in_charge_id` (canAssignPartner).
 */
export async function getCompanyInternal(
  sb: SupabaseClient<Database>,
  companyId: string,
): Promise<CompanyInternalWithPartner | null> {
  if (!isUuid(companyId)) return null;
  const { data, error } = await sb
    .from("company_internal")
    .select("*, partner:profiles!company_internal_partner_in_charge_id_fkey(id, full_name, email, scaleup_role, is_active)")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw queryError("getCompanyInternal", `load the internal record of company ${companyId}`, error);
  if (!data) return null;
  // The embedded profile is null when no partner is assigned (or, in theory, when RLS hides it).
  const { partner, ...internal } = data;
  return { ...internal, partner: partner ?? null };
}

/**
 * Everything that shapes the company's monthly form, in one round trip (five parallel queries):
 * - `company`;
 * - `segments`: all revenue segments of both kinds (BRD B30), active first, then `sort_order`, then name;
 *   `companySegments` (the company's own, active: they add up to total revenue), `scaleupSegments`
 *   (ScaleUp's revenue lines, active) and `retiredCompanySegments` (most recently retired first) — see
 *   segmentsForMonth for a month's segments;
 * - `kpis`: all KPIs (active first, then `sort_order`, then name), each with its dimension and the
 *   dimension's ACTIVE members (sorted); filter on `kpi.is_active` for input;
 * - `dimensions`: all KPI dimensions (by name) with all their members (active first);
 * - `members`: all memberships with profiles (active first, owners first, then by name).
 * Throws a not-found DataError (isNotFoundError) when the company does not exist or is not visible.
 */
export async function getCompanyConfig(sb: SupabaseClient<Database>, companyId: string): Promise<CompanyConfig> {
  const op = "getCompanyConfig";
  if (!isUuid(companyId)) throw notFoundError(op, `company ${JSON.stringify(companyId)}`);

  const [companyRes, segmentsRes, kpisRes, dimensionsRes, membersRes] = await Promise.all([
    sb.from("companies").select("*").eq("id", companyId).maybeSingle(),
    sb.from("revenue_segments").select("*").eq("company_id", companyId),
    sb.from("company_kpis").select("*").eq("company_id", companyId),
    sb
      .from("kpi_dimensions")
      .select("*, members:kpi_dimension_members!kpi_dimension_members_dimension_id_fkey(*)")
      .eq("company_id", companyId),
    sb
      .from("company_members")
      .select(
        "*, profile:profiles!company_members_user_id_fkey(id, email, full_name, job_title, is_active, terms_accepted_at)",
      )
      .eq("company_id", companyId),
  ]);

  if (companyRes.error) throw queryError(op, `load company ${companyId}`, companyRes.error);
  if (!companyRes.data) throw notFoundError(op, `company ${companyId}`);
  if (segmentsRes.error) {
    throw queryError(op, `load the revenue segments of company ${companyId}`, segmentsRes.error);
  }
  if (kpisRes.error) throw queryError(op, `load the KPIs of company ${companyId}`, kpisRes.error);
  if (dimensionsRes.error) {
    throw queryError(op, `load the KPI dimensions of company ${companyId}`, dimensionsRes.error);
  }
  if (membersRes.error) throw queryError(op, `load the members of company ${companyId}`, membersRes.error);

  const dimensions: KpiDimensionWithMembers[] = sortDimensions(
    dimensionsRes.data.map(({ members, ...dimension }) => ({ ...dimension, members: sortConfigRows(members ?? []) })),
  );
  const dimensionsById = new Map(dimensions.map((dimension) => [dimension.id, dimension]));

  const kpis: KpiDefinition[] = sortConfigRows(kpisRes.data).map((kpi) => {
    const found = kpi.dimension_id === null ? undefined : dimensionsById.get(kpi.dimension_id);
    if (!found) return { ...kpi, dimension: null, members: [] };
    const { members, ...dimension } = found;
    return { ...kpi, dimension, members: members.filter((member) => member.is_active) };
  });

  const members: MemberWithProfile[] = sortCompanyMembers(
    // The embedded profile is typed non-null (the FK is NOT NULL), but RLS can still hide it.
    membersRes.data.map(({ profile, ...member }) => ({ ...member, profile: profile ?? null })),
  );

  const segments: RevenueSegmentRow[] = sortConfigRows(segmentsRes.data);

  return {
    company: companyRes.data,
    segments,
    ...partitionRevenueSegments(segments),
    kpis,
    dimensions,
    members,
  };
}
