import { canManageTemplates } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { partitionRevenueSegments, segmentKind, type CompanyRow, type RevenueSegmentRow } from "@/lib/types/domain";

import { loadSegmentUsage } from "../../_components/queries";
import { inDisplayOrder } from "../../_components/reorder";
import { CompanySegmentsPanel, type CompanySegmentItem } from "./company-segments-panel";
import type { ConfigItem } from "./config-item-list";
import { loadCompanyRevenueSegments } from "./revenue-data";
import { RevenueLinesEditor } from "./revenue-lines-editor";

/**
 * The "ScaleUp revenue lines" tab (BRD §6.1, B30): ScaleUp's revenue lines for the company (kind
 * 'scaleup': every ScaleUp role reads them; Super Admins and Fund Admins manage them, canManageTemplates;
 * they need not add up to total revenue) and, read-only, the company's own revenue segments (kind
 * 'company', set by its owner).
 */
export async function RevenueTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const segments = await loadCompanyRevenueSegments(sb, company.id);
  const lines = inDisplayOrder(segments.filter((segment) => segmentKind(segment) === "scaleup"));
  const own = partitionRevenueSegments(segments);
  const usage = await loadSegmentUsage(
    sb,
    [...lines, ...own.companySegments, ...own.retiredCompanySegments].map((segment) => segment.id),
  );

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
      <CompanySegmentsPanel
        companyName={company.name}
        active={own.companySegments.map(segmentItem)}
        retired={own.retiredCompanySegments.map(segmentItem)}
      />
    </div>
  );
}
