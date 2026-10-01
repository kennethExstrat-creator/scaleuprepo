import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app/page-header";
import { requireScaleUp } from "@/lib/auth/session";
import { getPlatformSettings } from "@/lib/data";
import { todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

import { loadFundOptions, loadPartnerOptions, loadSectorSuggestions } from "../_components/queries";
import { startMonthBounds, startMonthOptions } from "../_components/reporting";
import { SectionErrorBoundary } from "../_components/section-error-boundary";
import { NewCompanyForm } from "./_components/new-company-form";
import { NewCompanyFormSkeleton } from "./_components/new-company-skeleton";

export const metadata: Metadata = { title: "Add company" };

/** Add a portfolio company (BRD A1) — Super Admin only. */
export default async function NewCompanyPage() {
  await requireScaleUp(["super_admin"]);

  return (
    <>
      <PageHeader
        title="Add company"
        description="Add a portfolio company, map it to its funds and decide when it starts monthly reporting."
        breadcrumbs={[{ label: "Companies", href: "/admin/companies" }, { label: "Add company" }]}
      />
      <SectionErrorBoundary title="The form couldn't be loaded">
        <Suspense fallback={<NewCompanyFormSkeleton />}>
          <NewCompanyFormLoader />
        </Suspense>
      </SectionErrorBoundary>
    </>
  );
}

async function NewCompanyFormLoader() {
  const sb = await createClient();
  const [funds, partners, sectors, settings] = await Promise.all([
    loadFundOptions(sb),
    loadPartnerOptions(sb),
    loadSectorSuggestions(sb),
    getPlatformSettings(sb),
  ]);
  const today = todayMYT();
  const bounds = startMonthBounds(settings.default_reporting_start, today);

  return (
    <NewCompanyForm
      funds={funds}
      partners={partners}
      sectors={sectors}
      startMonths={startMonthOptions(bounds, null)}
      today={today}
      dueDay={settings.due_day}
      graceDays={settings.backfill_grace_days}
    />
  );
}
