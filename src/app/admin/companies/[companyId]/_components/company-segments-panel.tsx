// The company's own revenue segments on the ScaleUp company page (BRD B30), read-only: the segments in
// use (in order; total revenue is calculated from them) and those no longer used, with when they were
// added and retired. The company owner manages them on /portal/<id>/segments.

import { ChartPieIcon, EyeIcon } from "lucide-react";

import { ToneBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";

/** One segment as the panel shows it. */
export type CompanySegmentItem = {
  id: string;
  name: string;
  /** When it was added (`created_at`). */
  addedAt: string;
  /** When it stopped being used (`retired_at`), for retired segments. */
  retiredAt: string | null;
  /** Months with figures for it. */
  usedIn: number;
};

function monthsText(count: number): string {
  if (count === 0) return "No figures yet";
  return `Figures in ${count} ${count === 1 ? "month" : "months"}`;
}

export function CompanySegmentsPanel({
  companyName,
  active,
  retired,
}: {
  companyName: string;
  /** In use, in order. */
  active: CompanySegmentItem[];
  /** No longer used, most recently retired first. */
  retired: CompanySegmentItem[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h2>Company revenue segments</h2>
          <ToneBadge tone="neutral">
            <EyeIcon className="size-3" aria-hidden="true" />
            Read-only
          </ToneBadge>
        </CardTitle>
        <CardDescription>
          {companyName}&apos;s own breakdown of total revenue, set by the company owner in the company portal. Total
          revenue is calculated from these segments. Months already submitted keep the segments they were submitted
          with.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active.length === 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            <ChartPieIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {retired.length > 0
              ? `${companyName} no longer uses revenue segments of its own, so it enters total revenue directly.`
              : `${companyName} hasn't set up revenue segments of its own, so it enters total revenue directly.`}
          </p>
        ) : (
          <ol className="divide-y rounded-lg border" aria-label="Revenue segments in use, in order">
            {active.map((segment, index) => (
              <li key={segment.id} className="flex items-baseline gap-3 px-3 py-2">
                <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 font-medium break-words">{segment.name}</span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {monthsText(segment.usedIn)}
                  <span className="block" title={formatDateTime(segment.addedAt)}>
                    Added {formatDate(segment.addedAt)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {retired.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">No longer used</h3>
            <ul className="divide-y rounded-lg border">
              {retired.map((segment) => (
                <li key={segment.id} className="flex items-baseline gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 break-words text-muted-foreground">{segment.name}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {monthsText(segment.usedIn)}
                    <span className="block">
                      Added {formatDate(segment.addedAt)}
                      {segment.retiredAt ? (
                        <span title={formatDateTime(segment.retiredAt)}> · Retired {formatDate(segment.retiredAt)}</span>
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
