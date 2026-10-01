import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { PeriodClosePanel } from "@/components/documents/period-close-panel";
import { openDuePeriods } from "@/components/documents/queries";
import { firstParam } from "@/lib/auth/redirects";
import { isUuid, requireCompanyAccess } from "@/lib/auth/session";
import { getCompany } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };

/**
 * Company portal: quarter and half-year closes (confirm the totals, upload management accounts) and the
 * company's other documents (BRD C4). `?close=<id>` opens that close (e.g. from a link on the home page).
 */
export default async function PortalDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const query = await searchParams;
  const focus = firstParam(query.close);

  const sb = await createClient();
  // A close appears once its last month opens: make sure due months and closes exist (idempotent).
  await openDuePeriods(sb);
  const company = await getCompany(sb, companyId);
  if (!company) notFound();

  return (
    <>
      <PageHeader
        title="Documents"
        description="Confirm your quarter and half-year totals, and keep your management accounts and supporting files in one place."
      />
      <PeriodClosePanel
        company={company}
        mode="company"
        ctx={ctx}
        focusCloseId={isUuid(focus) ? focus.toLowerCase() : null}
      />
    </>
  );
}
