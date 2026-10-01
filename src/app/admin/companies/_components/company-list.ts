// Pure helpers for the companies list (/admin/companies): the row shape, the URL filters
// (?q=&fund=&status=&partner=&reporting=) and in-memory filtering. Client-safe; unit-tested in
// tests/features/m1/company-list.test.ts.
import { COMPANY_STATUSES, type CompanyStatus, type SubmissionStatus } from "@/lib/types/enums";

/** The latest month of a company, from v_submission_overview. */
export type CompanyListLatest = {
  submissionId: string;
  /** 'YYYY-MM-DD' (first of the month). */
  month: string;
  status: SubmissionStatus;
  isOverdue: boolean;
  daysOverdue: number;
};

export type CompanyListRow = {
  id: string;
  name: string;
  legalName: string | null;
  sector: string | null;
  country: string | null;
  status: CompanyStatus;
  /** 'YYYY-MM-DD'; null = "Not yet reporting" (BRD B16). */
  reportingStartMonth: string | null;
  reportingCurrency: string;
  /** Funds holding the company, sorted by code. */
  funds: { id: string; code: string; name: string }[];
  /** The partner-in-charge (company_internal, ScaleUp-only); null when unassigned. */
  partner: { id: string; name: string; isActive: boolean } | null;
  latest: CompanyListLatest | null;
};

/** `reporting=yes` (has a start month) or `reporting=no` ("Not yet reporting"). */
export type ReportingFilter = "yes" | "no";

export type CompanyFilters = {
  /** Free-text search on name and legal name. */
  q: string;
  /** Fund code (upper case), e.g. "SV1". */
  fund: string | null;
  status: CompanyStatus | null;
  /** Partner-in-charge profile id, or UNASSIGNED_PARTNER. */
  partner: string | null;
  reporting: ReportingFilter | null;
};

/** `?partner=none`: companies without a partner-in-charge. */
export const UNASSIGNED_PARTNER = "none";

export const NO_FILTERS: CompanyFilters = { q: "", fund: null, status: null, partner: null, reporting: null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FUND_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
const MAX_QUERY_LENGTH = 100;

type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams;

function readParam(params: SearchParamsInput, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? "";
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function isCompanyStatus(value: string): value is CompanyStatus {
  return (COMPANY_STATUSES as readonly string[]).includes(value);
}

/** Reads the list filters from the URL; unknown or malformed values are ignored. */
export function parseCompanyFilters(params: SearchParamsInput): CompanyFilters {
  const q = readParam(params, "q").trim().slice(0, MAX_QUERY_LENGTH);
  const fundCode = readParam(params, "fund").trim().toUpperCase();
  const status = readParam(params, "status").trim();
  const partner = readParam(params, "partner").trim().toLowerCase();
  const reporting = readParam(params, "reporting").trim();
  return {
    q,
    fund: FUND_CODE_RE.test(fundCode) ? fundCode : null,
    status: isCompanyStatus(status) ? status : null,
    partner: partner === UNASSIGNED_PARTNER || UUID_RE.test(partner) ? partner : null,
    reporting: reporting === "yes" || reporting === "no" ? reporting : null,
  };
}

/** Drops a fund or partner filter that matches nothing on the page (e.g. an old link). */
export function sanitiseFilters(
  filters: CompanyFilters,
  known: { fundCodes: readonly string[]; partnerIds: readonly string[] },
): CompanyFilters {
  const fund = filters.fund && known.fundCodes.some((code) => code.toUpperCase() === filters.fund) ? filters.fund : null;
  const partner =
    filters.partner === UNASSIGNED_PARTNER || (filters.partner && known.partnerIds.includes(filters.partner))
      ? filters.partner
      : null;
  return { ...filters, fund, partner };
}

/** The query string for the filters ("" when none are set), e.g. "?fund=SV1&status=active". */
export function filtersToQueryString(filters: CompanyFilters): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q) params.set("q", q);
  if (filters.fund) params.set("fund", filters.fund);
  if (filters.status) params.set("status", filters.status);
  if (filters.partner) params.set("partner", filters.partner);
  if (filters.reporting) params.set("reporting", filters.reporting);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function hasActiveFilters(filters: CompanyFilters): boolean {
  return filtersToQueryString(filters) !== "";
}

/** Case-, accent- and whitespace-insensitive text for searching ("Café  Ölé" → "cafe ole"). */
export function normaliseForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The rows that match every filter, in their original order. */
export function filterCompanies(rows: readonly CompanyListRow[], filters: CompanyFilters): CompanyListRow[] {
  const query = normaliseForSearch(filters.q);
  return rows.filter((row) => {
    if (query && !normaliseForSearch(`${row.name} ${row.legalName ?? ""}`).includes(query)) return false;
    if (filters.fund && !row.funds.some((fund) => fund.code.toUpperCase() === filters.fund)) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.partner === UNASSIGNED_PARTNER) {
      if (row.partner !== null) return false;
    } else if (filters.partner && row.partner?.id !== filters.partner) {
      return false;
    }
    if (filters.reporting === "yes" && row.reportingStartMonth === null) return false;
    if (filters.reporting === "no" && row.reportingStartMonth !== null) return false;
    return true;
  });
}

/** Company names in human order ("Outlet 2" before "Outlet 10", case- and accent-insensitive). */
export function compareCompanyNames(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

/** A v_submission_overview row as generated (every view column is nullable). */
export type OverviewRowLike = {
  id: string | null;
  company_id: string | null;
  month: string | null;
  status: SubmissionStatus | null;
  is_overdue: boolean | null;
  days_overdue: number | null;
};

/** Each company's newest month (rows missing their identity columns are skipped). */
export function latestMonthByCompany(rows: readonly OverviewRowLike[]): Map<string, CompanyListLatest> {
  const latest = new Map<string, CompanyListLatest>();
  for (const row of rows) {
    if (!row.id || !row.company_id || !row.month || !row.status) continue;
    const current = latest.get(row.company_id);
    if (current && current.month >= row.month) continue;
    latest.set(row.company_id, {
      submissionId: row.id,
      month: row.month,
      status: row.status,
      isOverdue: row.is_overdue ?? false,
      daysOverdue: row.days_overdue ?? 0,
    });
  }
  return latest;
}

/** Counts for the summary line above the table. */
export function summariseCompanies(rows: readonly CompanyListRow[]): {
  total: number;
  active: number;
  reporting: number;
  notYetReporting: number;
} {
  let active = 0;
  let reporting = 0;
  for (const row of rows) {
    if (row.status === "active") active += 1;
    if (row.reportingStartMonth !== null) reporting += 1;
  }
  return { total: rows.length, active, reporting, notYetReporting: rows.length - reporting };
}
