import { InfoIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { canManageCompanySegments } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { COMPANY_STATUS_LABELS } from "@/lib/constants";
import { isNotFoundError } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { RetiredSegments, ScaleUpLinesCard, SegmentsReadOnly } from "./_components/segment-lists";
import { SegmentsEditor } from "./_components/segments-editor";
import { loadSegmentsPage, type SegmentsPageData } from "./_lib/load-segments";
import { segmentsKey } from "./_lib/segments-model";

export const metadata: Metadata = { title: "Revenue segments" };

/**
 * /portal/[companyId]/segments (BRD §6.1, B30): the company's own revenue segments. They add up to total
 * revenue, which the monthly form calculates from them, and they are reused every month. The owner of an
 * active company adds, renames, reorders and removes them (changing segments in use asks to confirm the
 * comparability warning first); contributors and every member of an exited or written-off company see them
 * read-only (BRD B21). Months already submitted keep their segment names and figures; months not yet
 * submitted follow the saved segments (the database applies it, set_company_revenue_segments). ScaleUp's
 * revenue lines are listed separately: they need not add up to total revenue.
 */
export default async function RevenueSegmentsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const sb = await createClient();

  let data: SegmentsPageData;
  try {
    data = await loadSegmentsPage(sb, companyId);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }

  const { company } = data;
  const active = company.status === "active";
  // The owner of an active company (canManageCompanySegments; the membership carries the company status).
  const canEdit = canManageCompanySegments(ctx, companyId) && active;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        className="mb-0"
        title="Revenue segments"
        description={`How ${company.name} breaks down its total revenue. The segments add up to total revenue and are reused every month, so your figures stay comparable.`}
      />

      {!active ? (
        <Alert>
          <LockIcon aria-hidden="true" />
          <AlertDescription>
            {company.name} is no longer an active portfolio company ({COMPANY_STATUS_LABELS[company.status]}), so its
            revenue segments can&apos;t be changed.
          </AlertDescription>
        </Alert>
      ) : !canEdit ? (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            Only company owners can change the revenue segments. Ask an owner if a segment needs to be added,
            renamed or removed.
          </AlertDescription>
        </Alert>
      ) : null}

      {canEdit ? (
        <SegmentsEditor
          key={segmentsKey(data.current)}
          companyId={company.id}
          companyName={company.name}
          current={data.current}
          hasRetired={data.retired.length > 0}
          usage={data.usage}
          openMonths={data.openMonths}
        />
      ) : (
        <SegmentsReadOnly companyName={company.name} segments={data.current} usage={data.usage} active={active} />
      )}

      <RetiredSegments segments={data.retired} usage={data.usage} />
      <ScaleUpLinesCard lines={data.scaleupLines} />
    </div>
  );
}
