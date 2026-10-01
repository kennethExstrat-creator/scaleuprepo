import Link from "next/link";

import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { MISSING_META } from "@/lib/constants";
import { monthLabel } from "@/lib/periods";
import { cn } from "@/lib/utils";

import type { CloseMonth, DocumentsMode } from "./view-model";

/** Where a month of the close opens: the company's monthly update, or the ScaleUp review page. */
function monthHref(month: CloseMonth, mode: DocumentsMode, companyId: string): string | null {
  if (!month.submissionId) return null;
  return mode === "company" ? `/portal/${companyId}/updates/${month.month}` : `/admin/review/${month.submissionId}`;
}

/**
 * The months of a close with their status (red when overdue). Months before the company's reporting
 * start are shown but not counted. Each month links to its update (company) or review page (ScaleUp).
 */
export function CloseMonths({
  months,
  mode,
  companyId,
}: {
  months: readonly CloseMonth[];
  mode: DocumentsMode;
  companyId: string;
}) {
  return (
    <ul className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", months.length > 3 && "lg:grid-cols-6")}>
      {months.map((month) => {
        const href = month.counted ? monthHref(month, mode, companyId) : null;
        const content = (
          <>
            <span className="text-xs font-medium text-muted-foreground">{monthLabel(month.month)}</span>
            {!month.counted ? (
              <span className="text-xs text-muted-foreground">Before reporting start</span>
            ) : month.status ? (
              <StatusBadge status={month.status} overdue={month.overdue} />
            ) : (
              <ToneBadge tone={MISSING_META.tone} title={MISSING_META.description}>
                {MISSING_META.label}
              </ToneBadge>
            )}
          </>
        );
        const tileClass = cn(
          "flex h-full flex-col gap-1.5 rounded-lg border px-3 py-2",
          !month.counted && "border-dashed bg-muted/30",
        );
        return (
          <li key={month.month}>
            {href ? (
              <Link
                href={href}
                className={cn(
                  tileClass,
                  "transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
                title={mode === "company" ? "Open the monthly update" : "Open the review page"}
              >
                {content}
              </Link>
            ) : (
              <div className={tileClass}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
