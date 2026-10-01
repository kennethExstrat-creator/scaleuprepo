import { ScrollTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { canViewAudit } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { dateToMonthKey, type MonthKey } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { CompanyStatus } from "@/lib/types/enums";

import { C4ExportCard } from "./_components/c4-export-card";
import { DocumentPackCard } from "./_components/document-pack-card";
import { PortfolioExportCard } from "./_components/portfolio-export-card";
import type { ExportCompanyOption, ExportFundOption } from "./_components/types";

export const metadata: Metadata = { title: "Exports" };

type CompanyOptionRow = {
  id: string;
  name: string;
  status: CompanyStatus;
  reporting_start_month: string | null;
  submissions: { id: string }[];
};

type FundOptionRow = { id: string; code: string; name: string; is_active: boolean };

/** Exports (BRD A13): C4 workbook, portfolio data extract and document pack. Every ScaleUp role. */
export default async function ExportsPage() {
  const ctx = await requireScaleUp();
  const sb = await createClient();

  const [companiesRes, fundsRes, periodsRes] = await Promise.all([
    sb
      .from("companies")
      .select("id, name, status, reporting_start_month, submissions(id)")
      .order("name")
      .limit(1, { referencedTable: "submissions" }),
    sb.from("funds").select("id, code, name, is_active").order("code"),
    sb.from("reporting_periods").select("month").order("month", { ascending: false }),
  ]);
  if (companiesRes.error) throw new Error(`Could not load the companies: ${companiesRes.error.message}`);
  if (fundsRes.error) throw new Error(`Could not load the funds: ${fundsRes.error.message}`);
  if (periodsRes.error) throw new Error(`Could not load the reporting months: ${periodsRes.error.message}`);

  const companyRows: CompanyOptionRow[] = companiesRes.data;
  const fundRows: FundOptionRow[] = fundsRes.data;
  const periodRows: { month: string }[] = periodsRes.data;

  const companies: ExportCompanyOption[] = companyRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      notYetReporting: row.reporting_start_month === null,
      hasMonths: row.submissions.length > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base", numeric: true }));
  const funds: ExportFundOption[] = fundRows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
  }));
  const months: MonthKey[] = [...new Set(periodRows.map((row) => dateToMonthKey(row.month)))];

  return (
    <>
      <PageHeader
        title="Exports"
        description="Download the C4 workbook, portfolio figures and document packs. Only approved months feed LP-facing figures unless you choose otherwise."
      />
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <C4ExportCard companies={companies} />
        <PortfolioExportCard funds={funds} months={months} />
        <DocumentPackCard companies={companies} />
      </div>
      <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
        <ScrollTextIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Every export is recorded in the audit log with who made it and when.
          {canViewAudit(ctx) ? (
            <>
              {" "}
              <Link href="/admin/audit?action=export" className="font-medium text-primary underline-offset-4 hover:underline">
                See recent exports
              </Link>
            </>
          ) : null}
        </span>
      </p>
    </>
  );
}
