import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { monthKeyToDate, type MonthKey } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";

import { exportQueryError, fetchAllPages, fetchByIdChunks } from "./fetch-all";
import { isOpenForChanges } from "./segments";
import {
  buildPortfolioRows,
  buildPortfolioSegmentRows,
  type PortfolioFinancialRow,
  type PortfolioRow,
  type PortfolioSegment,
  type PortfolioSegmentRow,
  type PortfolioSegmentValue,
  type PortfolioStatusFilter,
} from "./portfolio";

// Loads the portfolio data extract with the caller's RLS-scoped client (ScaleUp staff: fund_investments
// and FX rates are ScaleUp-only). Reads v_submission_financials page by page (PostgREST caps each
// response at 1000 rows), so a full-fund export takes a handful of requests. Revenue segment figures (BRD
// B30) are read by submission in chunks of 100 ids, a few chunks at a time: every month's for the Excel
// "Revenue segments" sheet, otherwise only those of months still open for changes, whose revenue is
// calculated from the company's own segments as the monthly form does (segments.ts).

const OP = "loadPortfolioData";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PortfolioQuery = {
  /** Fund id or code (case-insensitive); null = every fund (and companies not mapped to one). */
  fund: string | null;
  from: MonthKey | null;
  to: MonthKey | null;
  status: PortfolioStatusFilter;
  /** Also load the revenue segment figures (the Excel "Revenue segments" sheet). */
  withSegments?: boolean;
};

export type PortfolioFund = { id: string; code: string; name: string };

export type PortfolioData =
  | {
      found: true;
      fund: PortfolioFund | null;
      rows: PortfolioRow[];
      /** The segment figures of `rows`' months; null unless `withSegments`. */
      segmentRows: PortfolioSegmentRow[] | null;
    }
  | { found: false };

type ViewRow = {
  submission_id: string | null;
  company_id: string | null;
  month: string | null;
  status: PortfolioFinancialRow["status"] | null;
  currency: string | null;
  fx_rate_to_myr: number | null;
  revenue_total: number | null;
  gross_profit: number | null;
  net_profit: number | null;
  cash_in_bank: number | null;
  burn_rate: number | null;
  headcount_ft: number | null;
  headcount_pt: number | null;
};

const VIEW_COLUMNS =
  "submission_id, company_id, month, status, currency, fx_rate_to_myr, revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt";

/** Resolves a fund id or code against the fund list; undefined when there is no such fund. */
export function findFund(funds: readonly PortfolioFund[], idOrCode: string): PortfolioFund | undefined {
  const value = idOrCode.trim();
  if (UUID_RE.test(value)) return funds.find((fund) => fund.id.toLowerCase() === value.toLowerCase());
  return funds.find((fund) => fund.code.toLowerCase() === value.toLowerCase());
}

/** Every revenue segment (both kinds, retired ones too) of the companies, and the months' figures. */
async function loadSegmentFigures(
  sb: SupabaseClient<Database>,
  companyIds: readonly string[],
  submissionIds: readonly string[],
): Promise<{ segments: PortfolioSegment[]; values: PortfolioSegmentValue[] }> {
  const [segments, values] = await Promise.all([
    fetchByIdChunks(companyIds, (chunk) =>
      fetchAllPages<PortfolioSegment>(OP, "load the revenue segments", (from, to) =>
        sb
          .from("revenue_segments")
          .select("id, company_id, name, kind, is_active, sort_order")
          .in("company_id", chunk)
          .order("company_id")
          .order("id")
          .range(from, to),
      ),
    ),
    fetchByIdChunks(submissionIds, (chunk) =>
      fetchAllPages<PortfolioSegmentValue>(OP, "load the revenue segment figures", (from, to) =>
        sb
          .from("submission_segment_values")
          .select("submission_id, segment_id, amount")
          .in("submission_id", chunk)
          .order("submission_id")
          .order("segment_id")
          .range(from, to),
      ),
    ),
  ]);
  return { segments, values };
}

/** The extract's rows (sorted by company, then month), or `found: false` for an unknown fund. */
export async function loadPortfolioData(sb: SupabaseClient<Database>, query: PortfolioQuery): Promise<PortfolioData> {
  const [fundsRes, investmentsRes, companiesRes] = await Promise.all([
    sb.from("funds").select("id, code, name").order("code"),
    sb.from("fund_investments").select("fund_id, company_id"),
    sb.from("companies").select("id, name").order("name"),
  ]);
  if (fundsRes.error) throw exportQueryError(OP, "load the funds", fundsRes.error);
  if (investmentsRes.error) throw exportQueryError(OP, "load the fund investments", investmentsRes.error);
  if (companiesRes.error) throw exportQueryError(OP, "load the companies", companiesRes.error);
  const funds: PortfolioFund[] = fundsRes.data;
  const investments: { fund_id: string; company_id: string }[] = investmentsRes.data;
  const companies: { id: string; name: string }[] = companiesRes.data;

  const fund: PortfolioFund | null = query.fund ? (findFund(funds, query.fund) ?? null) : null;
  if (query.fund && !fund) return { found: false };
  const fundId = fund?.id ?? null;
  const companyIds =
    fundId === null
      ? null
      : investments.filter((investment) => investment.fund_id === fundId).map((investment) => investment.company_id);
  if (companyIds && companyIds.length === 0) {
    return { found: true, fund, rows: [], segmentRows: query.withSegments ? [] : null };
  }

  const from = query.from ? monthKeyToDate(query.from) : null;
  const to = query.to ? monthKeyToDate(query.to) : null;
  const loadPage = (chunk: string[] | null) =>
    fetchAllPages<ViewRow>(OP, "load the monthly figures", (start, end) => {
      let request = sb.from("v_submission_financials").select(VIEW_COLUMNS);
      if (chunk) request = request.in("company_id", chunk);
      if (from) request = request.gte("month", from);
      if (to) request = request.lte("month", to);
      if (query.status === "approved") request = request.eq("status", "approved");
      return request.order("month").order("company_id").order("submission_id").range(start, end);
    });
  const viewRows = companyIds ? await fetchByIdChunks(companyIds, (chunk) => loadPage(chunk)) : await loadPage(null);

  const financials: PortfolioFinancialRow[] = viewRows.flatMap((row) =>
    row.company_id && row.month && row.status && row.currency
      ? [
          {
            submission_id: row.submission_id,
            company_id: row.company_id,
            month: row.month,
            status: row.status,
            currency: row.currency,
            fx_rate_to_myr: row.fx_rate_to_myr,
            revenue_total: row.revenue_total,
            gross_profit: row.gross_profit,
            net_profit: row.net_profit,
            cash_in_bank: row.cash_in_bank,
            burn_rate: row.burn_rate,
            headcount_ft: row.headcount_ft,
            headcount_pt: row.headcount_pt,
          },
        ]
      : [],
  );
  // The months whose segment figures are needed: all of them for the Excel sheet, otherwise the open ones.
  const visible = new Set(companies.map((company) => company.id));
  const segmentMonths = financials.flatMap((row) =>
    row.submission_id && visible.has(row.company_id) && (query.withSegments || isOpenForChanges(row.status))
      ? [{ companyId: row.company_id, submissionId: row.submission_id }]
      : [],
  );
  const { segments, values } =
    segmentMonths.length > 0
      ? await loadSegmentFigures(
          sb,
          segmentMonths.map((month) => month.companyId),
          segmentMonths.map((month) => month.submissionId),
        )
      : { segments: [], values: [] };

  const rows = buildPortfolioRows({ companies, funds, investments, financials, segments, segmentValues: values });
  return {
    found: true,
    fund,
    rows,
    segmentRows: query.withSegments ? buildPortfolioSegmentRows(rows, segments, values) : null,
  };
}
