import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { canExport } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { getCompany, getFinancialSeries, listCompanySubmissions } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { HistoryView } from "./_components/history-view";
import { buildHistoryRows } from "./_lib/history-model";

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

  return (
    <HistoryView
      companyId={companyId}
      companyName={company.name}
      rows={buildHistoryRows(submissions, series, company.reporting_currency.trim())}
      canDownload={canExport(ctx, companyId)}
      notReporting={company.reporting_start_month === null}
      readOnly={company.status !== "active"}
    />
  );
}
