import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { requireCompanyAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import type { HomeData } from "./_components/home-model";
import { HomeLoadError } from "./_components/home-notices";
import { HomeView } from "./_components/home-view";
import { loadHome } from "./_components/load-home";

export const metadata: Metadata = { title: "Home" };

/**
 * Company home (BRD C2): the month to work on next with its due date, overdue months in red, changes
 * requested by ScaleUp, open comment threads, the latest submitted figures and the next quarter / half
 * close. Opens due months on load (open_due_periods). ScaleUp people are named "<full name> (ScaleUp)"
 * through staff_display_names (BRD B28); nothing ScaleUp-internal is read.
 */
export default async function CompanyHomePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);

  let data: HomeData | null;
  try {
    data = await loadHome(await createClient(), companyId);
  } catch (e) {
    unstable_rethrow(e);
    console.error("[portal home] could not load the home page", e);
    return (
      <>
        <PageHeader title="Home" />
        <HomeLoadError companyId={companyId} />
      </>
    );
  }
  if (!data) notFound();

  return <HomeView companyId={companyId} companyRole={ctx.companyRole} data={data} />;
}
