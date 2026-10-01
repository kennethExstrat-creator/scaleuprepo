import { ArrowRightIcon, FolderOpenIcon } from "lucide-react";
import Link from "next/link";

import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PERIOD_CLOSE_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { dateToMonthKey, halfOf, isHalfEnd, quarterOf } from "@/lib/periods";
import type { ClosePeriodType, PeriodCloseStatus } from "@/lib/types/enums";

/** A period_closes row covering the reviewed month. */
export type CoveringClose = {
  id: string;
  label: string;
  period_type: ClosePeriodType;
  status: PeriodCloseStatus;
  period_end: string;
  confirmed_at: string | null;
};

/**
 * At quarter and half ends (Mar, Jun, Sep, Dec): the state of the period close(s) ending with this month and a
 * link to the company's documents and management accounts (/admin/documents?company=<id>).
 */
export function PeriodCloseCard({ companyId, month, closes }: { companyId: string; month: string; closes: CoveringClose[] }) {
  const monthKey = dateToMonthKey(month);
  const periods = [quarterOf(monthKey), ...(isHalfEnd(monthKey) ? [halfOf(monthKey)] : [])];
  const endingHere = periods.map((period) => ({
    period,
    close: closes.find((close) => close.period_type === period.type && dateToMonthKey(close.period_end) === period.endMonth) ?? null,
  }));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <FolderOpenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {periods.map((period) => period.label).join(" and ")} close
          </h2>
        </CardTitle>
        <CardDescription>
          The company confirms the period totals and uploads its management accounts once every month of the period
          is submitted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2 text-sm">
          {endingHere.map(({ period, close }) => (
            <li key={period.label} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{period.label}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {period.rangeLabel}
                  {close?.status === "confirmed" && close.confirmed_at ? ` · confirmed ${formatDate(close.confirmed_at)}` : ""}
                </p>
              </div>
              {close ? (
                <ToneBadge tone={PERIOD_CLOSE_STATUS_META[close.status].tone}>{PERIOD_CLOSE_STATUS_META[close.status].label}</ToneBadge>
              ) : (
                <span className="text-xs text-muted-foreground">Not opened</span>
              )}
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/admin/documents?company=${companyId}`}>
            Documents and period closes
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
