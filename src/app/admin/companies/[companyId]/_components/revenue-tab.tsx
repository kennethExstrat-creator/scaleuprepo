import { canManageCompanySegments, canManageTemplates } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { partitionRevenueSegments, segmentKind, type CompanyRow, type RevenueSegmentRow } from "@/lib/types/domain";

import { RetiredSegments } from "@/app/portal/[companyId]/segments/_components/segment-lists";
import { SegmentsEditor } from "@/app/portal/[companyId]/segments/_components/segments-editor";
import { loadSegmentsPage } from "@/app/portal/[companyId]/segments/_lib/load-segments";
import { segmentsKey } from "@/app/portal/[companyId]/segments/_lib/segments-model";

import { loadSegmentUsage } from "../../_components/queries";
import { inDisplayOrder } from "../../_components/reorder";
import { saveCompanySegmentsOnBehalfAction } from "./company-segments-actions";
import { CompanySegmentsPanel, type CompanySegmentItem } from "./company-segments-panel";
import type { ConfigItem } from "./config-item-list";
import { loadCompanyRevenueSegments } from "./revenue-data";
import { RevenueLinesEditor } from "./revenue-lines-editor";

/**
 * The "ScaleUp revenue lines" tab (BRD §6.1, B30): ScaleUp's revenue lines for the company (kind
 * 'scaleup': every ScaleUp role reads them; Super Admins and Fund Admins manage them, canManageTemplates;
 * they need not add up to total revenue) and the company's own revenue segments (kind 'company', set by its
 * owner). Super Admins and Fund Admins can also change the company's own segments on the owner's behalf
 * while the company is active (canManageCompanySegments; the owner's editor with the same comparability
 * warning, audited as on behalf); everyone else sees them read-only.
 */
export async function RevenueTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const segments = await loadCompanyRevenueSegments(sb, company.id);
  const lines = inDisplayOrder(segments.filter((segment) => segmentKind(segment) === "scaleup"));
  const own = partitionRevenueSegments(segments);
  const editOwn = canManageCompanySegments(ctx, company.id, company.status);
  const [usage, ownPage] = await Promise.all([
    loadSegmentUsage(
      sb,
      [...lines, ...own.companySegments, ...own.retiredCompanySegments].map((segment) => segment.id),
    ),
    // The owner's editor needs the months each segment has figures in and the months not submitted yet.
    editOwn ? loadSegmentsPage(sb, company.id) : Promise.resolve(null),
  ]);

  const lineItems: ConfigItem[] = lines.map((line) => ({
    id: line.id,
    name: line.name,
    sort_order: line.sort_order,
    is_active: line.is_active,
    usedIn: usage[line.id] ?? 0,
  }));
  const segmentItem = (segment: RevenueSegmentRow): CompanySegmentItem => ({
    id: segment.id,
    name: segment.name,
    addedAt: segment.created_at,
    retiredAt: segment.retired_at ?? null,
    usedIn: usage[segment.id] ?? 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <RevenueLinesEditor
        companyId={company.id}
        companyName={company.name}
        lines={lineItems}
        canManage={canManageTemplates(ctx)}
      />
      {ownPage ? (
        <section aria-label={`${company.name}'s own revenue segments`} className="flex flex-col gap-4">
          <SegmentsEditor
            key={segmentsKey(ownPage.current)}
            companyId={company.id}
            companyName={company.name}
            current={ownPage.current}
            hasRetired={ownPage.retired.length > 0}
            usage={ownPage.usage}
            openMonths={ownPage.openMonths}
            audience="scaleup"
            saveAction={saveCompanySegmentsOnBehalfAction}
          />
          <RetiredSegments segments={ownPage.retired} usage={ownPage.usage} />
        </section>
      ) : (
        <CompanySegmentsPanel
          companyName={company.name}
          active={own.companySegments.map(segmentItem)}
          retired={own.retiredCompanySegments.map(segmentItem)}
        />
      )}
    </div>
  );
}
