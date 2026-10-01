import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { canManagePlatform } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { CompaniesExplorer } from "./_components/companies-explorer";
import { CompaniesListSkeleton } from "./_components/companies-list-skeleton";
import { filtersToQueryString, parseCompanyFilters, sanitiseFilters } from "./_components/company-list";
import { loadCompanyList } from "./_components/queries";
import { SectionErrorBoundary } from "./_components/section-error-boundary";

export const metadata: Metadata = { title: "Companies" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * All portfolio companies (BRD A1) for every ScaleUp role: funds, sector, status, reporting start (or
 * "Not yet reporting"), latest month and partner-in-charge, with search and filters (?q=, fund, status,
 * partner, reporting). Super Admins add companies.
 */
export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireScaleUp();
  const canCreate = canManagePlatform(ctx);

  return (
    <>
      <PageHeader
        title="Companies"
        description="Portfolio companies with their funds, reporting status and partner-in-charge."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/admin/companies/new">
                <PlusIcon data-icon="inline-start" />
                Add company
              </Link>
            </Button>
          ) : undefined
        }
      />
      <SectionErrorBoundary title="The companies couldn't be loaded">
        <Suspense fallback={<CompaniesListSkeleton />}>
          <CompaniesList searchParams={searchParams} canCreate={canCreate} />
        </Suspense>
      </SectionErrorBoundary>
    </>
  );
}

async function CompaniesList({ searchParams, canCreate }: { searchParams: SearchParams; canCreate: boolean }) {
  const sb = await createClient();
  const [data, params] = await Promise.all([loadCompanyList(sb), searchParams]);
  const filters = sanitiseFilters(parseCompanyFilters(params), {
    fundCodes: data.funds.map((fund) => fund.code),
    partnerIds: data.partners.map((partner) => partner.id),
  });
  return (
    <CompaniesExplorer
      key={filtersToQueryString(filters)}
      rows={data.rows}
      funds={data.funds}
      partners={data.partners}
      initialFilters={filters}
      canCreate={canCreate}
    />
  );
}
