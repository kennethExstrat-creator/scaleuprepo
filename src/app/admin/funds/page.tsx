import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { canManagePlatform } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { SectionErrorBoundary } from "@/app/admin/companies/_components/section-error-boundary";

import { loadFundsWithCounts } from "./_components/fund-queries";
import { FundsTableSkeleton } from "./_components/funds-skeleton";
import { AddFundButton, FundsTable } from "./_components/funds-table";

export const metadata: Metadata = { title: "Funds" };

/**
 * ScaleUp's funds (BRD A1) with the number of companies each holds. Every ScaleUp role can view them;
 * only Super Admins add and edit funds (docs/ARCHITECTURE.md §1).
 */
export default async function FundsPage() {
  const ctx = await requireScaleUp();
  const canManage = canManagePlatform(ctx);

  return (
    <>
      <PageHeader
        title="Funds"
        description="ScaleUp's funds and the companies they hold. A company can sit in more than one fund, with its own investment date, instrument and ownership in each."
        actions={canManage ? <AddFundButton /> : undefined}
      />
      <SectionErrorBoundary title="The funds couldn't be loaded">
        <Suspense fallback={<FundsTableSkeleton />}>
          <FundsList canManage={canManage} />
        </Suspense>
      </SectionErrorBoundary>
    </>
  );
}

async function FundsList({ canManage }: { canManage: boolean }) {
  const sb = await createClient();
  const funds = await loadFundsWithCounts(sb);
  return <FundsTable funds={funds} canManage={canManage} />;
}
