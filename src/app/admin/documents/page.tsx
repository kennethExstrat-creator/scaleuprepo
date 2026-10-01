import { Building2Icon, FolderOpenIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PeriodClosePanel } from "@/components/documents/period-close-panel";
import { loadCloseRange, loadPortfolioPeriod, openDuePeriods } from "@/components/documents/queries";
import {
  compareClosesNewestFirst,
  parsePeriodKey,
  periodKey,
  periodOptionsBetween,
  summarisePortfolio,
  upcomingClose,
  type PortfolioSummary,
} from "@/components/documents/view-model";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { firstParam } from "@/lib/auth/redirects";
import { isUuid, requireScaleUp } from "@/lib/auth/session";
import { getCompany } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { todayMYT, type ClosePeriod } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

import { PeriodFilters } from "./_components/period-filters";
import { PortfolioTable } from "./_components/portfolio-table";

export const metadata: Metadata = { title: "Documents" };

type SearchParams = Record<string, string | string[] | undefined>;

/** /admin/documents with the given filters (period key, fund code, company id). */
function documentsHref(params: { period?: string | null; fund?: string | null; company?: string | null }): string {
  const query = new URLSearchParams();
  if (params.company) query.set("company", params.company);
  if (params.period) query.set("period", params.period);
  if (params.fund) query.set("fund", params.fund);
  const text = query.toString();
  return text ? `/admin/documents?${text}` : "/admin/documents";
}

/**
 * ScaleUp documents (every ScaleUp role): the portfolio's quarter and half-year closes for a period
 * (?period=Q3-2026, &fund=SV1), or one company's closes and documents (?company=<id>) where Fund Admins
 * upload and confirm on its behalf and Super Admins / Fund Admins reopen confirmed closes.
 */
export default async function AdminDocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireScaleUp();
  const query = await searchParams;
  const companyParam = firstParam(query.company);
  const periodParam = firstParam(query.period) ?? null;
  const fundParam = firstParam(query.fund) ?? null;

  const sb = await createClient();
  // A close appears once its last month opens: make sure due months and closes exist (idempotent).
  await openDuePeriods(sb);

  if (companyParam !== undefined) {
    if (!isUuid(companyParam)) notFound();
    const company = await getCompany(sb, companyParam);
    if (!company) notFound();
    const period = parsePeriodKey(periodParam);
    const closeParam = firstParam(query.close);
    return (
      <>
        <PageHeader
          title={company.name}
          description="Quarter and half-year closes, management accounts and supporting files."
          breadcrumbs={[
            { label: "Documents", href: documentsHref({ period: period ? periodKey(period) : null, fund: fundParam }) },
            { label: company.name },
          ]}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/companies/${company.id}`}>
                <Building2Icon data-icon="inline-start" aria-hidden="true" />
                Company profile
              </Link>
            </Button>
          }
        />
        <PeriodClosePanel
          company={company}
          mode="scaleup"
          ctx={ctx}
          focusCloseId={isUuid(closeParam) ? closeParam.toLowerCase() : null}
          focusPeriodLabel={period?.label ?? null}
        />
      </>
    );
  }

  const range = await loadCloseRange(sb);
  const options = range ? periodOptionsBetween(range.firstStart, range.lastEnd) : [];
  const requested = parsePeriodKey(periodParam);
  const period: ClosePeriod | null = requested ?? options[0] ?? null;

  if (!period) {
    const next = upcomingClose(null, todayMYT());
    return (
      <>
        <PageHeader title="Documents" description="Quarter and half-year closes and management accounts across the portfolio." />
        <EmptyState
          icon={FolderOpenIcon}
          title="No period closes yet"
          description={`A close is created for each reporting company once the last month of a quarter or half-year opens. The ${next.period.label} closes open on ${formatDate(next.opensOn)}.`}
        />
      </>
    );
  }

  // Keep a requested period in the selector even when no close of it exists.
  const periodOptions = options.some((option) => option.label === period.label)
    ? options
    : [...options, period].sort((a, b) =>
        compareClosesNewestFirst(
          { period_end: a.end, period_type: a.type, label: a.label },
          { period_end: b.end, period_type: b.type, label: b.label },
        ),
      );
  const { rows, funds } = await loadPortfolioPeriod(sb, period);
  const fund = fundParam && funds.some((option) => option.code === fundParam) ? fundParam : null;
  const visibleRows = fund ? rows.filter((row) => row.fundCodes.includes(fund)) : rows;
  const summary = summarisePortfolio(visibleRows);
  const key = periodKey(period);

  return (
    <>
      <PageHeader
        title="Documents"
        description={`${period.label} (${period.rangeLabel}): who has confirmed the period totals, what is still missing, and the management accounts on file.`}
        actions={
          <PeriodFilters
            periods={periodOptions.map((option) => ({ key: periodKey(option), label: option.label, rangeLabel: option.rangeLabel }))}
            period={key}
            funds={funds}
            fund={fund}
          />
        }
      />
      <div className="flex flex-col gap-6">
        <SummaryTiles summary={summary} />
        {visibleRows.length === 0 ? (
          <EmptyState
            icon={FolderOpenIcon}
            title="No companies"
            description={fund ? `No company is mapped to ${fund}.` : "No companies have been added yet."}
          />
        ) : (
          <PortfolioTable
            rows={visibleRows}
            period={period}
            companyHref={(companyId) => documentsHref({ company: companyId, period: key, fund })}
          />
        )}
      </div>
    </>
  );
}

function SummaryTiles({ summary }: { summary: PortfolioSummary }) {
  // Open closes of exited and written-off companies are neither ready nor waiting: they can no longer
  // be confirmed, so they are counted separately and mentioned in the "Still open" hint.
  const stillOpenHint =
    summary.readOnly > 0
      ? `Waiting for months or management accounts. ${summary.readOnly} more can no longer be confirmed (company no longer active).`
      : "Waiting for months or management accounts";
  const tiles = [
    { label: "Confirmed", value: `${summary.confirmed} of ${summary.withClose}`, hint: "Closes confirmed" },
    { label: "Ready to confirm", value: String(summary.readyToConfirm), hint: "Every month in, accounts uploaded" },
    { label: "Still open", value: String(summary.waiting), hint: stillOpenHint },
    {
      label: "No close",
      value: String(summary.companies - summary.withClose),
      hint: "Not yet reporting, or not reporting in this period",
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <Card size="sm" className="h-full">
            <CardContent className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground">{tile.label}</p>
              <p className="font-heading text-2xl font-semibold tabular-nums">{tile.value}</p>
              <p className="text-xs text-muted-foreground">{tile.hint}</p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
