import { cn } from "@/lib/utils";

import { formatMoney } from "@/lib/format";

/**
 * Money amount via `formatMoney` ("RM 1,234,567"): tabular figures, negatives in red,
 * "—" for null. Right-align it in tables with the cell's own `text-right`.
 */
export function Money({
  value,
  currency = "MYR",
  compact,
  decimals,
  className,
}: {
  value: number | null | undefined;
  currency?: string;
  compact?: boolean;
  decimals?: number;
  className?: string;
}) {
  const negative = typeof value === "number" && value < 0;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", negative && "text-destructive", className)}>
      {formatMoney(value, currency, { compact, decimals })}
    </span>
  );
}
