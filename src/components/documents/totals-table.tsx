import { Money } from "@/components/app/money";
import { ToneBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPct } from "@/lib/format";
import type { PeriodTotals } from "@/lib/metrics";
import { cn } from "@/lib/utils";

import {
  effectiveTotals,
  formatFigure,
  hasRestatement,
  PERIOD_FIGURES,
  type FigureKind,
  type RestatedTotals,
} from "./totals";
import type { RevenueComparison } from "./view-model";

function Figure({ kind, value, currency }: { kind: FigureKind; value: number | null; currency: string }) {
  if (kind === "money") return <Money value={value} currency={currency} />;
  return <span className="whitespace-nowrap tabular-nums">{formatFigure(kind, value, currency)}</span>;
}

/**
 * The period figures of a close: live totals while it is open; once confirmed, the totals stored at
 * confirmation and — when figures were restated — the confirmed figures beside them, restated ones marked.
 */
export function TotalsTable({
  totals,
  restated,
  variant,
  currency,
  caption,
  comparison = null,
}: {
  /** Live totals (open) or the stored `computed_totals` (confirmed). */
  totals: PeriodTotals;
  /** The confirmation's restated figures (ignored for live totals). */
  restated?: RestatedTotals | null;
  variant: "live" | "confirmed";
  currency: string;
  caption: string;
  /** Revenue against the previous quarter / half-year (QoQ, HoH; only when both periods are complete). */
  comparison?: RevenueComparison | null;
}) {
  const restatement = variant === "confirmed" && hasRestatement(restated) ? restated : null;
  const confirmed = restatement ? effectiveTotals(totals, restatement) : totals;
  const valueHeading = variant === "live" ? "Live total" : restatement ? "Calculated" : "Confirmed total";

  return (
    <div className="rounded-lg border">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">Figure</TableHead>
            <TableHead className={cn("text-right", !restatement && "pr-3")}>{valueHeading}</TableHead>
            {restatement ? <TableHead className="pr-3 text-right">As confirmed</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERIOD_FIGURES.map((figure) => {
            const isRestated = restatement !== null && Object.prototype.hasOwnProperty.call(restatement, figure.key);
            return (
              <TableRow key={figure.key} className={cn(isRestated && "bg-info/5 hover:bg-info/10")}>
                <TableCell className={cn("pl-3", figure.derived && "pl-6 text-muted-foreground")}>{figure.label}</TableCell>
                <TableCell className={cn("text-right", !restatement && "pr-3", isRestated && "text-muted-foreground")}>
                  <Figure kind={figure.kind} value={totals[figure.key]} currency={currency} />
                </TableCell>
                {restatement ? (
                  <TableCell className="pr-3 text-right">
                    {isRestated ? (
                      <span className="inline-flex items-center justify-end gap-2 font-semibold">
                        <ToneBadge tone="info">Restated</ToneBadge>
                        <Figure kind={figure.kind} value={confirmed[figure.key]} currency={currency} />
                      </span>
                    ) : (
                      <Figure kind={figure.kind} value={confirmed[figure.key]} currency={currency} />
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {comparison ? (
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Revenue vs {comparison.previousLabel}{" "}
            <abbr title={comparison.kind === "QoQ" ? "quarter on quarter" : "half-year on half-year"} className="no-underline">
              ({comparison.kind})
            </abbr>
          </span>
          <span className="text-right tabular-nums">
            <span className="font-semibold">
              {comparison.growthPct === null ? "—" : formatPct(comparison.growthPct, 1, { signed: true })}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {comparison.previousLabel}: {formatMoney(comparison.previousRevenue, currency)}
            </span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
