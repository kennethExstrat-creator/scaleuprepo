import "server-only";

// Server-side reads for the ScaleUp company and fund pages (M1). Every function takes the RLS-scoped
// client (`await createClient()` from @/lib/supabase/server), so Row Level Security decides what the caller
// sees; these pages are ScaleUp-only. Query results are assigned to typed variables (no casts), so tsc
// checks each select string against the generated Database types. Failures throw an Error naming what
// could not be loaded (pages show the error boundary; tabs catch it and show an inline message).

import type { SupabaseClient } from "@supabase/supabase-js";

import { toFiniteNumber } from "@/lib/format";
import { addMonths, currentMonthMYT, monthKeyToDate } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import type { MemberWithProfile } from "@/lib/types/domain";
import type { CompanyStatus, ScaleupRole } from "@/lib/types/enums";

import {
  compareCompanyNames,
  latestMonthByCompany,
  type CompanyListLatest,
  type CompanyListRow,
  type OverviewRowLike,
} from "./company-list";
import { personName, type CompanyInvestment, type FundOption, type PartnerOption } from "./types";

type Sb = SupabaseClient<Database>;
type QueryFailure = { message: string } | null;

/** How many months back the list looks for each company's latest month (keeps the query bounded). */
const LATEST_MONTH_WINDOW = 6;

function loadError(what: string, error: { message: string }): Error {
  return new Error(`Could not load ${what}: ${error.message}`);
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return compareCompanyNames(a.name, b.name);
}

/**
 * Every row of a query, page by page (PostgREST returns at most `max_rows` = 1000 rows per request).
 * The query must have a deterministic order.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryFailure }>,
  what: string,
  { pageSize = 1000, maxPages = 50 }: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw loadError(what, error);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Options for pickers
// ---------------------------------------------------------------------------------------------

type FundOptionRow = { id: string; code: string; name: string; is_active: boolean };

/** Every fund, by code. */
export async function loadFundOptions(sb: Sb): Promise<FundOption[]> {
  const { data, error } = await sb.from("funds").select("id, code, name, is_active");
  if (error) throw loadError("the funds", error);
  const rows: FundOptionRow[] = data;
  return rows
    .map((row) => ({ id: row.id, code: row.code, name: row.name, isActive: row.is_active }))
    .sort((a, b) => a.code.localeCompare(b.code, "en-GB", { numeric: true }));
}

type PartnerProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
  scaleup_role: ScaleupRole | null;
  is_active: boolean;
};

/**
 * People who can be partner-in-charge: active ScaleUp partners and Super Admins, by name. Ids in
 * `include` (e.g. the current partner-in-charge) are listed even when inactive.
 */
export async function loadPartnerOptions(sb: Sb, include: readonly string[] = []): Promise<PartnerOption[]> {
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, scaleup_role, is_active")
    .in("scaleup_role", ["partner", "super_admin"]);
  if (error) throw loadError("the partners", error);
  const rows: PartnerProfileRow[] = data;
  return rows
    .flatMap((row): PartnerOption[] =>
      row.scaleup_role && (row.is_active || include.includes(row.id))
        ? [{ id: row.id, name: personName(row), email: row.email, role: row.scaleup_role, isActive: row.is_active }]
        : [],
    )
    .sort(byName);
}

/** Sectors already used by companies, for the sector suggestions. */
export async function loadSectorSuggestions(sb: Sb): Promise<string[]> {
  const { data, error } = await sb.from("companies").select("sector").not("sector", "is", null);
  if (error) throw loadError("the sectors", error);
  const rows: { sector: string | null }[] = data;
  const sectors = new Set<string>();
  for (const row of rows) {
    const sector = row.sector?.trim();
    if (sector) sectors.add(sector);
  }
  return [...sectors].sort((a, b) => compareCompanyNames(a, b));
}

// ---------------------------------------------------------------------------------------------
// Companies list
// ---------------------------------------------------------------------------------------------

type CompanyListDbRow = {
  id: string;
  name: string;
  legal_name: string | null;
  sector: string | null;
  country: string | null;
  status: CompanyStatus;
  reporting_start_month: string | null;
  reporting_currency: string;
};
type CompanyFundDbRow = { company_id: string; fund: { id: string; code: string; name: string } | null };
type CompanyPartnerDbRow = {
  company_id: string;
  partner: { id: string; full_name: string | null; email: string; is_active: boolean } | null;
};

export type CompanyListData = {
  rows: CompanyListRow[];
  funds: FundOption[];
  /** Partners-in-charge assigned to at least one company (for the filter). */
  partners: { id: string; name: string; isActive: boolean }[];
};

/**
 * Everything the companies list shows: companies with their funds, partner-in-charge and latest month
 * (v_submission_overview, the last six months), plus the filter options. Sorted by name.
 */
export async function loadCompanyList(sb: Sb): Promise<CompanyListData> {
  const since = monthKeyToDate(addMonths(currentMonthMYT(), -LATEST_MONTH_WINDOW));
  const [companiesRes, fundsRes, partnersRes, fundOptions, overview] = await Promise.all([
    sb
      .from("companies")
      .select("id, name, legal_name, sector, country, status, reporting_start_month, reporting_currency"),
    sb.from("fund_investments").select("company_id, fund:funds!fund_investments_fund_id_fkey(id, code, name)"),
    sb
      .from("company_internal")
      .select("company_id, partner:profiles!company_internal_partner_in_charge_id_fkey(id, full_name, email, is_active)"),
    loadFundOptions(sb),
    fetchAllPages(
      (from, to) =>
        sb
          .from("v_submission_overview")
          .select("id, company_id, month, status, is_overdue, days_overdue")
          .gte("month", since)
          .order("month", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      "the latest monthly updates",
    ),
  ]);
  if (companiesRes.error) throw loadError("the companies", companiesRes.error);
  if (fundsRes.error) throw loadError("the fund mappings", fundsRes.error);
  if (partnersRes.error) throw loadError("the partners-in-charge", partnersRes.error);

  const companies: CompanyListDbRow[] = companiesRes.data;
  const fundRows: CompanyFundDbRow[] = fundsRes.data;
  const partnerRows: CompanyPartnerDbRow[] = partnersRes.data;
  const overviewRows: OverviewRowLike[] = overview;

  const fundsByCompany = new Map<string, CompanyListRow["funds"]>();
  for (const row of fundRows) {
    if (!row.fund) continue;
    const list = fundsByCompany.get(row.company_id) ?? [];
    list.push({ id: row.fund.id, code: row.fund.code, name: row.fund.name });
    fundsByCompany.set(row.company_id, list);
  }
  for (const list of fundsByCompany.values()) list.sort((a, b) => a.code.localeCompare(b.code, "en-GB"));

  const partnerByCompany = new Map<string, NonNullable<CompanyListRow["partner"]>>();
  for (const row of partnerRows) {
    if (row.partner) {
      partnerByCompany.set(row.company_id, {
        id: row.partner.id,
        name: personName(row.partner),
        isActive: row.partner.is_active,
      });
    }
  }

  const latest: Map<string, CompanyListLatest> = latestMonthByCompany(overviewRows);

  const rows: CompanyListRow[] = companies
    .map((company) => ({
      id: company.id,
      name: company.name,
      legalName: company.legal_name,
      sector: company.sector,
      country: company.country,
      status: company.status,
      reportingStartMonth: company.reporting_start_month,
      reportingCurrency: company.reporting_currency.trim(),
      funds: fundsByCompany.get(company.id) ?? [],
      partner: partnerByCompany.get(company.id) ?? null,
      latest: latest.get(company.id) ?? null,
    }))
    .sort(byName);

  const partners = new Map<string, { id: string; name: string; isActive: boolean }>();
  for (const partner of partnerByCompany.values()) partners.set(partner.id, partner);

  return { rows, funds: fundOptions, partners: [...partners.values()].sort(byName) };
}

// ---------------------------------------------------------------------------------------------
// One company
// ---------------------------------------------------------------------------------------------

type InvestmentDbRow = {
  id: string;
  fund_id: string;
  investment_date: string | null;
  instrument: string | null;
  ownership_pct: number | null;
  notes: string | null;
  fund: { id: string; code: string; name: string; is_active: boolean } | null;
};

/** The company's fund investments (one per fund, BRD B2), by fund code. */
export async function loadCompanyInvestments(sb: Sb, companyId: string): Promise<CompanyInvestment[]> {
  const { data, error } = await sb
    .from("fund_investments")
    .select(
      "id, fund_id, investment_date, instrument, ownership_pct, notes, fund:funds!fund_investments_fund_id_fkey(id, code, name, is_active)",
    )
    .eq("company_id", companyId);
  if (error) throw loadError("the fund investments", error);
  const rows: InvestmentDbRow[] = data;
  return rows
    .map((row) => ({
      id: row.id,
      fundId: row.fund_id,
      fundCode: row.fund?.code ?? "?",
      fundName: row.fund?.name ?? "Unknown fund",
      fundActive: row.fund?.is_active ?? false,
      investmentDate: row.investment_date,
      instrument: row.instrument,
      ownershipPct: toFiniteNumber(row.ownership_pct),
      notes: row.notes,
    }))
    .sort((a, b) => a.fundCode.localeCompare(b.fundCode, "en-GB", { numeric: true }));
}

/** The company's newest month (v_submission_overview), or null when it has none. */
export async function loadLatestMonth(sb: Sb, companyId: string): Promise<CompanyListLatest | null> {
  const { data, error } = await sb
    .from("v_submission_overview")
    .select("id, company_id, month, status, is_overdue, days_overdue")
    .eq("company_id", companyId)
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw loadError("the latest monthly update", error);
  const rows: OverviewRowLike[] = data;
  return latestMonthByCompany(rows).get(companyId) ?? null;
}

/**
 * True once the company has reported anything: a month that is no longer a draft, or a draft with saved
 * values. Its reporting currency is then locked (the stored figures are in that currency).
 */
export async function hasReportedFigures(sb: Sb, companyId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("submissions")
    .select("id")
    .eq("company_id", companyId)
    .or("status.neq.draft,last_saved_at.not.is.null")
    .limit(1);
  if (error) throw loadError("the monthly updates", error);
  const rows: { id: string }[] = data;
  return rows.length > 0;
}

/** The company's memberships with profiles: active first, owners first, then by name. */
export async function loadCompanyMembers(sb: Sb, companyId: string): Promise<MemberWithProfile[]> {
  const { data, error } = await sb
    .from("company_members")
    .select(
      "*, profile:profiles!company_members_user_id_fkey(id, email, full_name, job_title, is_active, terms_accepted_at)",
    )
    .eq("company_id", companyId);
  if (error) throw loadError("the team", error);
  const members: MemberWithProfile[] = data.map(({ profile, ...member }) => ({ ...member, profile: profile ?? null }));
  return members.sort(
    (a, b) =>
      Number(b.is_active) - Number(a.is_active) ||
      Number(a.role !== "owner") - Number(b.role !== "owner") ||
      compareCompanyNames(personName(a.profile), personName(b.profile)),
  );
}

/** Name and email of a profile (ScaleUp staff can read every profile), or null. */
export async function loadPersonName(sb: Sb, profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const { data, error } = await sb.from("profiles").select("full_name, email").eq("id", profileId).maybeSingle();
  if (error) throw loadError("a profile", error);
  const row: { full_name: string | null; email: string } | null = data;
  return row ? personName(row) : null;
}

/** How many months have a figure for each revenue line (lines with figures cannot be deleted). */
export async function loadSegmentUsage(sb: Sb, segmentIds: readonly string[]): Promise<Record<string, number>> {
  if (segmentIds.length === 0) return {};
  const rows = await fetchAllPages(
    (from, to) =>
      sb
        .from("submission_segment_values")
        .select("submission_id, segment_id")
        .in("segment_id", [...segmentIds])
        .order("submission_id", { ascending: true })
        .order("segment_id", { ascending: true })
        .range(from, to),
    "the revenue line figures",
  );
  const usage: Record<string, number> = {};
  for (const row of rows) usage[row.segment_id] = (usage[row.segment_id] ?? 0) + 1;
  return usage;
}

export type KpiUsage = {
  /** Months with at least one figure, per KPI. */
  byKpi: Record<string, number>;
  /** Months with a figure, per dimension member. */
  byMember: Record<string, number>;
};

/** How many months have figures for each KPI and dimension member (used ones cannot be deleted). */
export async function loadKpiUsage(sb: Sb, kpiIds: readonly string[]): Promise<KpiUsage> {
  if (kpiIds.length === 0) return { byKpi: {}, byMember: {} };
  const rows = await fetchAllPages(
    (from, to) =>
      sb
        .from("submission_kpi_values")
        .select("id, submission_id, kpi_id, dimension_member_id")
        .in("kpi_id", [...kpiIds])
        .order("id", { ascending: true })
        .range(from, to),
    "the KPI figures",
  );
  const kpiMonths = new Map<string, Set<string>>();
  const memberMonths = new Map<string, Set<string>>();
  for (const row of rows) {
    const kpiSet = kpiMonths.get(row.kpi_id) ?? new Set<string>();
    kpiSet.add(row.submission_id);
    kpiMonths.set(row.kpi_id, kpiSet);
    if (row.dimension_member_id) {
      const memberSet = memberMonths.get(row.dimension_member_id) ?? new Set<string>();
      memberSet.add(row.submission_id);
      memberMonths.set(row.dimension_member_id, memberSet);
    }
  }
  const byKpi: Record<string, number> = {};
  for (const [id, months] of kpiMonths) byKpi[id] = months.size;
  const byMember: Record<string, number> = {};
  for (const [id, months] of memberMonths) byMember[id] = months.size;
  return { byKpi, byMember };
}
