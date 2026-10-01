import { ArrowDownRightIcon, ArrowUpRightIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMPTY_DISPLAY, formatMoney, formatNumber, formatPct, formatRunway } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";
import { cn } from "@/lib/utils";

import type { LatestFigures } from "./home-model";

function Stat({
  label,
  value,
  negative,
  children,
}: {
  label: string;
  value: string;
  negative?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tracking-tight break-words", negative && "text-destructive")}>
        {value}
      </dd>
      {children ? <dd className="text-xs text-pretty text-muted-foreground">{children}</dd> : null}
    </div>
  );
}

function isNegative(value: number | null): boolean {
  return value !== null && value < 0;
}

/**
 * The last submitted (or approved) month's key figures (BRD C2): revenue with month-on-month change,
 * gross and net margin, cash, runway and headcount, in the company's reporting currency.
 */
export function LatestFiguresCard({ companyId, figures }: { companyId: string; figures: LatestFigures | null }) {
  const historyLink = (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/portal/${companyId}/history`}>
        <HistoryIcon data-icon="inline-start" />
        History
      </Link>
    </Button>
  );

  if (!figures) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-semibold">
            <h2>Latest figures</h2>
          </CardTitle>
          <CardDescription>Your figures appear here once your first monthly update is submitted.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { point, previous } = figures;
  const currency = point.currency;
  const growth = figures.revenueGrowth;
  const up = growth !== null && growth > 0;
  const down = growth !== null && growth < 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h2>Latest figures</h2>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>
            {monthLabelLong(point.month)}
            {currency !== "MYR" ? ` · in ${currency}` : ""}
          </span>
          <StatusBadge status={point.status} />
        </CardDescription>
        <CardAction>{historyLink}</CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
          <Stat
            label="Revenue"
            value={formatMoney(point.revenue_total, currency)}
            negative={isNegative(point.revenue_total)}
          >
            {growth !== null && previous ? (
              <span
                className={cn("inline-flex items-center gap-0.5", up && "text-success", down && "text-destructive")}
              >
                {up ? <ArrowUpRightIcon aria-hidden="true" className="size-3.5" /> : null}
                {down ? <ArrowDownRightIcon aria-hidden="true" className="size-3.5" /> : null}
                {formatPct(growth, 1, { signed: true })} vs {monthLabel(previous.month)}
              </span>
            ) : (
              "No previous month to compare"
            )}
          </Stat>
          <Stat label="Gross margin" value={formatPct(figures.gpPct)} negative={isNegative(figures.gpPct)}>
            Gross profit {formatMoney(point.gross_profit, currency)}
          </Stat>
          <Stat label="Net margin" value={formatPct(figures.npPct)} negative={isNegative(figures.npPct)}>
            Net profit {formatMoney(point.net_profit, currency)}
          </Stat>
          <Stat
            label="Cash in bank"
            value={formatMoney(point.cash_in_bank, currency)}
            negative={isNegative(point.cash_in_bank)}
          >
            {figures.cashflowPositive
              ? "Cash-flow positive"
              : point.burn_rate === null
                ? "Month end"
                : `Burn ${formatMoney(point.burn_rate, currency)} a month`}
          </Stat>
          <Stat label="Runway" value={formatRunway(figures.runwayMonths, { cashflowPositive: figures.cashflowPositive })}>
            {figures.cashflowPositive ? "No monthly burn" : "Cash divided by monthly burn"}
          </Stat>
          <Stat label="Headcount" value={figures.headcount === null ? EMPTY_DISPLAY : formatNumber(figures.headcount)}>
            {formatNumber(point.headcount_ft)} full-time · {formatNumber(point.headcount_pt)} part-time
          </Stat>
        </dl>
      </CardContent>
    </Card>
  );
}
