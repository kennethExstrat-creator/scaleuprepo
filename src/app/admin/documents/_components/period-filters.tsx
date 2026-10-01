"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

const ALL_FUNDS = "all";

export type PeriodFilterOption = { key: string; label: string; rangeLabel: string };
export type FundFilterOption = { code: string; name: string };

/** Period (Q3 2026, H2 2026, …) and fund selectors of the portfolio view; they change the URL (?period=&fund=). */
export function PeriodFilters({
  periods,
  period,
  funds,
  fund,
}: {
  periods: readonly PeriodFilterOption[];
  period: string;
  funds: readonly FundFilterOption[];
  fund: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(next: { period?: string; fund?: string | null }) {
    const params = new URLSearchParams();
    params.set("period", next.period ?? period);
    const nextFund = next.fund === undefined ? fund : next.fund;
    if (nextFund) params.set("fund", nextFund);
    startTransition(() => router.push(`/admin/documents?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      <Select value={period} onValueChange={(value) => go({ period: value })} disabled={pending}>
        <SelectTrigger aria-label="Period" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {periods.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              <span>{option.label}</span>
              <span className="text-muted-foreground">{option.rangeLabel}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {funds.length > 0 ? (
        <Select
          value={fund ?? ALL_FUNDS}
          onValueChange={(value) => go({ fund: value === ALL_FUNDS ? null : value })}
          disabled={pending}
        >
          <SelectTrigger aria-label="Fund" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value={ALL_FUNDS}>All funds</SelectItem>
            {funds.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                {option.code}
                <span className="sr-only"> ({option.name})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {pending ? <Spinner className="text-muted-foreground" /> : null}
    </div>
  );
}
