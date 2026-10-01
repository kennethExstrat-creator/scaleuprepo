import "server-only";

// Server-side loading for the documents pages (portal and admin). Every query runs with the caller's
// RLS-scoped client (`await createClient()` from @/lib/supabase/server), so Row Level Security decides
// what is visible: company users see their own companies only and never a ScaleUp staff profile (the
// uploader / confirmer embeds are null for them), so the company side names those people
// "<full name> (ScaleUp)" through getStaffDisplayNames (rpc staff_display_names, BRD B28) — never an
// email or role. Results are assigned to typed variables (no casts) so tsc checks the select strings
// against the generated Database types.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { DataError, getFinancialSeries, getStaffDisplayNames, listCompanySubmissions } from "@/lib/data";
import { monthKeyToDate, type ClosePeriod } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import type { CompanyRow } from "@/lib/types/domain";

import {
  buildCompanyDocumentsView,
  buildPortfolioRows,
  staffIdsToResolve,
  type CloseRecord,
  type CompanyDocumentsView,
  type DocumentRecord,
  type DocumentsMode,
  type PortfolioClose,
  type PortfolioCompany,
  type PortfolioRow,
  type PortfolioSubmission,
  type StaffNames,
} from "./view-model";

type Client = SupabaseClient<Database>;

/** PostgREST returns at most this many rows per request (`[api] max_rows`); longer lists are paged. */
const PAGE_SIZE = 1000;

function queryFailed(operation: string, what: string, error: PostgrestError): DataError {
  return new DataError(operation, `could not ${what}: ${error.message}`, {
    code: error.code || undefined,
    details: error.details,
    hint: error.hint,
    cause: error,
  });
}

/** Every row of a query, fetched page by page (`page(from, to)` must order by a unique column). */
async function fetchAllRows<T>(
  operation: string,
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw queryFailed(operation, what, error);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/**
 * Opens any months and period closes that are due (`open_due_periods()`, idempotent), so a close shows
 * up as soon as its last month opens even before the daily job runs. Best effort: a failure (e.g. no
 * published default template yet) is logged and the page still renders.
 */
export async function openDuePeriods(sb: Client): Promise<void> {
  try {
    const { error } = await sb.rpc("open_due_periods");
    if (error) console.warn("[documents] open_due_periods failed", error.code, error.message);
  } catch (e) {
    console.warn("[documents] open_due_periods failed", e);
  }
}

// ---------------------------------------------------------------------------------------------
// One company (portal page and /admin/documents?company=)
// ---------------------------------------------------------------------------------------------

/**
 * "<full name> (ScaleUp)" by lower-case id for those of `ids` that belong to ScaleUp staff (BRD B28):
 * one staff_display_names request, none without ids. Best effort: if the names cannot be loaded (e.g.
 * the function is not deployed yet) the failure is logged and the result is undefined, so the people
 * the caller cannot read show as "ScaleUp".
 */
async function loadStaffNames(sb: Client, ids: readonly string[]): Promise<StaffNames | undefined> {
  if (ids.length === 0) return {};
  try {
    return await getStaffDisplayNames(sb, ids);
  } catch (e) {
    console.warn("[documents] could not load the names of ScaleUp staff", e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * A company's period closes (with months, live totals, confirmation and documents) and its other
 * documents, shaped for `mode`. Company side: ScaleUp staff who uploaded or confirmed are named
 * "<full name> (ScaleUp)" (one extra staff_display_names request when there are any, BRD B28).
 */
export async function loadCompanyDocuments(sb: Client, company: CompanyRow, mode: DocumentsMode): Promise<CompanyDocumentsView> {
  const op = "loadCompanyDocuments";
  const [closesRes, documents, months, financials] = await Promise.all([
    sb
      .from("period_closes")
      .select(
        "id, period_type, period_start, period_end, label, status, confirmed_at, confirmed_by, computed_totals, restated_totals, restatement_reason, confirmer:profiles!period_closes_confirmed_by_fkey(full_name, email, scaleup_role)",
      )
      .eq("company_id", company.id)
      .order("period_end", { ascending: false }),
    fetchAllRows(op, `load the documents of company ${company.id}`, (from, to) =>
      sb
        .from("documents")
        .select(
          "id, period_close_id, doc_type, file_name, mime_type, size_bytes, version, uploaded_at, uploaded_by, uploader:profiles!documents_uploaded_by_fkey(full_name, email, scaleup_role)",
        )
        .eq("company_id", company.id)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    listCompanySubmissions(sb, company.id),
    getFinancialSeries(sb, company.id),
  ]);
  if (closesRes.error) throw queryFailed(op, `load the period closes of company ${company.id}`, closesRes.error);

  const closes: CloseRecord[] = closesRes.data;
  const documentRows: DocumentRecord[] = documents;
  // ScaleUp pages read every profile (names with roles); company users need the staff display names.
  const staffNames = mode === "company" ? await loadStaffNames(sb, staffIdsToResolve(closes, documentRows)) : undefined;
  return buildCompanyDocumentsView({
    mode,
    company,
    closes,
    documents: documentRows,
    months: months.map((row) => ({ id: row.id, month: row.month, status: row.status, is_overdue: row.is_overdue })),
    financials,
    staffNames,
  });
}

// ---------------------------------------------------------------------------------------------
// Portfolio (ScaleUp): one period across every company
// ---------------------------------------------------------------------------------------------

/** The first period start and the last period end of any close (the period selector's range). */
export async function loadCloseRange(sb: Client): Promise<{ firstStart: string; lastEnd: string } | null> {
  const op = "loadCloseRange";
  const [firstRes, lastRes] = await Promise.all([
    sb.from("period_closes").select("period_start").order("period_start", { ascending: true }).limit(1).maybeSingle(),
    sb.from("period_closes").select("period_end").order("period_end", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (firstRes.error) throw queryFailed(op, "load the earliest period close", firstRes.error);
  if (lastRes.error) throw queryFailed(op, "load the latest period close", lastRes.error);
  const first: { period_start: string } | null = firstRes.data;
  const last: { period_end: string } | null = lastRes.data;
  return first && last ? { firstStart: first.period_start, lastEnd: last.period_end } : null;
}

export type FundOption = { code: string; name: string };

export type PortfolioPeriod = { rows: PortfolioRow[]; funds: FundOption[] };

/**
 * Every company with its close for `period` (status, months submitted x of y, management accounts,
 * restated) and the funds for the fund filter. ScaleUp staff only (fund data is ScaleUp-only).
 */
export async function loadPortfolioPeriod(sb: Client, period: ClosePeriod): Promise<PortfolioPeriod> {
  const op = "loadPortfolioPeriod";
  const lastMonth = monthKeyToDate(period.endMonth);
  const [companies, closes, submissions, accounts, investments, fundsRes] = await Promise.all([
    fetchAllRows(op, "load the companies", (from, to) =>
      sb.from("companies").select("id, name, status, reporting_start_month").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows(op, `load the ${period.label} closes`, (from, to) =>
      sb
        .from("period_closes")
        .select("id, company_id, status, restated_totals, confirmed_at")
        .eq("period_type", period.type)
        .eq("period_start", period.start)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows(op, `load the ${period.label} monthly updates`, (from, to) =>
      sb
        .from("submissions")
        .select("id, company_id, month, status")
        .gte("month", period.start)
        .lte("month", lastMonth)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows(op, `load the ${period.label} management accounts`, (from, to) =>
      sb
        .from("documents")
        .select("id, period_close_id, close:period_closes!documents_period_close_id_fkey!inner(period_type, period_start)")
        .eq("doc_type", "management_accounts")
        .eq("close.period_type", period.type)
        .eq("close.period_start", period.start)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows(op, "load the fund investments", (from, to) =>
      sb
        .from("fund_investments")
        .select("id, company_id, fund:funds!fund_investments_fund_id_fkey(code)")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    sb.from("funds").select("code, name").order("code", { ascending: true }),
  ]);
  if (fundsRes.error) throw queryFailed(op, "load the funds", fundsRes.error);

  const companyRows: PortfolioCompany[] = companies;
  const closeRows: PortfolioClose[] = closes;
  const submissionRows: PortfolioSubmission[] = submissions;
  const funds: FundOption[] = fundsRes.data;
  const rows = buildPortfolioRows({
    period,
    companies: companyRows,
    closes: closeRows,
    submissions: submissionRows,
    managementAccountCloseIds: accounts.map((doc) => doc.period_close_id),
    funds: investments.flatMap((investment) => (investment.fund ? [{ company_id: investment.company_id, code: investment.fund.code }] : [])),
  });
  return { rows, funds };
}
