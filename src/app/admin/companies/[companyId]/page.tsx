import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { requireScaleUp } from "@/lib/auth/session";
import type { CompanyRow } from "@/lib/types/domain";

import { SectionErrorBoundary } from "../_components/section-error-boundary";
import { loadCompany } from "./_components/company-data";
import { CompanyHeader } from "./_components/company-header";
import { CompanyTabsNav } from "./_components/company-tabs-nav";
import { FundsTab } from "./_components/funds-tab";
import { InternalTab } from "./_components/internal-tab";
import { KpisTab } from "./_components/kpis-tab";
import { OverviewTab } from "./_components/overview-tab";
import { RevenueTab } from "./_components/revenue-tab";
import { TabSkeleton } from "./_components/tab-skeleton";
import { companyTabLabel, parseCompanyTab, type CompanyTab } from "./_components/tabs";
import { TeamTab } from "./_components/team-tab";
import { UpdatesTab } from "./_components/updates-tab";

type Params = Promise<{ companyId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { companyId } = await params;
  await requireScaleUp();
  try {
    const company = await loadCompany(companyId);
    return { title: company?.name ?? "Company" };
  } catch (e) {
    // The page reports the failure; the title just falls back.
    unstable_rethrow(e);
    return { title: "Company" };
  }
}

/**
 * One company for ScaleUp staff (BRD A1, A4), in tabs (?tab=): Overview · Funds & investment · Revenue
 * lines · KPIs · Team · Internal · Monthly updates. Each tab loads only its own data, and what a role may
 * change follows docs/ARCHITECTURE.md §1 (the database enforces it too).
 */
export default async function CompanyPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  const ctx = await requireScaleUp();
  const tab = parseCompanyTab(query.tab);

  // A failed load (e.g. a temporary database error) shows a message with "Try again" inside the admin
  // shell; notFound() passes through the boundary.
  return (
    <SectionErrorBoundary title="This company couldn't be loaded">
      <CompanyView companyId={companyId} tab={tab} ctx={ctx} />
    </SectionErrorBoundary>
  );
}

async function CompanyView({ companyId, tab, ctx }: { companyId: string; tab: CompanyTab; ctx: ScaleUpAccessContext }) {
  const company = await loadCompany(companyId);
  if (!company) notFound();

  return (
    <>
      <CompanyHeader company={company} />
      <CompanyTabsNav companyId={company.id} active={tab} />
      <div className="mt-6">
        <SectionErrorBoundary key={tab} title={`The ${companyTabLabel(tab)} tab couldn't be loaded`}>
          <Suspense fallback={<TabSkeleton />}>
            <CompanyTabContent tab={tab} ctx={ctx} company={company} />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </>
  );
}

function CompanyTabContent({ tab, ctx, company }: { tab: CompanyTab; ctx: ScaleUpAccessContext; company: CompanyRow }) {
  switch (tab) {
    case "funds":
      return <FundsTab ctx={ctx} company={company} />;
    case "revenue":
      return <RevenueTab ctx={ctx} company={company} />;
    case "kpis":
      return <KpisTab ctx={ctx} company={company} />;
    case "team":
      return <TeamTab ctx={ctx} company={company} />;
    case "internal":
      return <InternalTab ctx={ctx} company={company} />;
    case "updates":
      return <UpdatesTab ctx={ctx} company={company} />;
    case "overview":
      return <OverviewTab ctx={ctx} company={company} />;
  }
}
