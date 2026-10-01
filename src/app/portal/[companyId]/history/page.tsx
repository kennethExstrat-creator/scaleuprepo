import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { canExport } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { getCompany, getFinancialSeries, listCompanySubmissions } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { isOpenForChanges } from "@/lib/exports/segments";

import { HistoryView } from "./_components/history-view";
import { buildHistoryRows } from "./_lib/history-model";
import { loadOpenMonthRevenue } from "./_lib/load-open-revenue";

export const metadata: Metadata = { title: "History" };

/**
 * Company history: every month with its status, submitted and approved dates, revision and key figures,
 * each linking to the month's form (read-only once submitted). Owners can download their data as Excel
 * (the C4 workbook, GET /api/exports/c4/<companyId>, module M9).
 */
export default async function CompanyHistoryPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const sb = await createClient();
  const [company, submissions, series] = await Promise.all([
    getCompany(sb, companyId),
    listCompanySubmissions(sb, companyId),
    getFinancialSeries(sb, companyId),
  ]);
  if (!company) notFound();
  // Months still open for changes show total revenue as the sum of the company's own segments (BRD B30),
  // as the monthly form and the review page do: their stored total can be out of date after a segment change.
  const openRevenue = await loadOpenMonthRevenue(
    sb,
    companyId,
    submissions.filter((row) => isOpenForChanges(row.status)).map((row) => row.id),
  );

  return (
    <HistoryView
      companyId={companyId}
      companyName={company.name}
      rows={buildHistoryRows(submissions, series, company.reporting_currency.trim(), openRevenue)}
      canDownload={canExport(ctx, companyId)}
      notReporting={company.reporting_start_month === null}
      readOnly={company.status !== "active"}
    />
  );
}
