import { ChevronRightIcon, FileCheckIcon, LockIcon } from "lucide-react";
import Link from "next/link";

import { ToneBadge } from "@/components/app/status-badge";
import type { PortfolioRow } from "@/components/documents/view-model";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPANY_STATUS_META, NOT_YET_REPORTING_META, PERIOD_CLOSE_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { ClosePeriod } from "@/lib/periods";

/** An open close of an exited or written-off company: read-only, it can no longer be confirmed. */
function isLockedOpen(row: PortfolioRow): boolean {
  return row.close?.status === "open" && row.companyStatus !== "active";
}

function StatusCell({ row, period }: { row: PortfolioRow; period: ClosePeriod }) {
  const { close } = row;
  if (!close) {
    if (row.notYetReporting) {
      return (
        <ToneBadge tone={NOT_YET_REPORTING_META.tone} title={NOT_YET_REPORTING_META.description}>
          {NOT_YET_REPORTING_META.label}
        </ToneBadge>
      );
    }
    return (
      <ToneBadge tone="neutral" title={`No ${period.label} close: the company started reporting later or stopped before.`}>
        No close
      </ToneBadge>
    );
  }
  if (isLockedOpen(row)) {
    return (
      <ToneBadge
        tone="neutral"
        title={`${COMPANY_STATUS_META[row.companyStatus].label}: the company is no longer active, so this close can no longer be confirmed`}
      >
        <LockIcon className="size-3" aria-hidden="true" />
        Not confirmed
      </ToneBadge>
    );
  }
  if (close.status === "open" && close.readyToConfirm) {
    return (
      <ToneBadge tone="info" title="Every month is submitted and management accounts are uploaded">
        Ready to confirm
      </ToneBadge>
    );
  }
  const meta = PERIOD_CLOSE_STATUS_META[close.status];
  return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>;
}

/**
 * The portfolio for one period: each company's close status (open closes of exited and written-off
 * companies read "Not confirmed": they can no longer be confirmed), months submitted (x of y),
 * management accounts on file and whether the totals were restated. Rows open the company's documents.
 */
export function PortfolioTable({
  rows,
  period,
  companyHref,
}: {
  rows: readonly PortfolioRow[];
  period: ClosePeriod;
  /** Link to a company's documents for this period. */
  companyHref: (companyId: string) => string;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableCaption className="sr-only">
          {period.label} closes by company: status, months submitted, management accounts and restatements
        </TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Company</TableHead>
            <TableHead className="hidden md:table-cell">Fund</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Months submitted</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Management accounts</TableHead>
            <TableHead className="hidden lg:table-cell">Restated</TableHead>
            <TableHead className="hidden md:table-cell">Confirmed</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const { close } = row;
            const href = companyHref(row.companyId);
            const companyStatus = COMPANY_STATUS_META[row.companyStatus];
            const muted = close === null;
            return (
              <TableRow key={row.companyId} className={muted ? "text-muted-foreground" : undefined}>
                <TableCell className="pl-4 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={href}
                      className="font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {row.companyName}
                    </Link>
                    {row.companyStatus !== "active" ? <ToneBadge tone={companyStatus.tone}>{companyStatus.label}</ToneBadge> : null}
                  </div>
                  {close ? (
                    <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                      {close.submittedMonths} of {close.countedMonths} months · {close.managementAccounts}{" "}
                      {close.managementAccounts === 1 ? "accounts file" : "accounts files"}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">{row.fundCodes.length > 0 ? row.fundCodes.join(", ") : "—"}</TableCell>
                <TableCell>
                  <StatusCell row={row} period={period} />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  {close ? (
                    <div className="ml-auto flex w-24 flex-col items-end gap-1">
                      <span className="tabular-nums">
                        {close.submittedMonths} of {close.countedMonths}
                      </span>
                      <Progress
                        value={close.countedMonths === 0 ? 100 : (close.submittedMonths / close.countedMonths) * 100}
                        className="h-1"
                        aria-label={`${close.submittedMonths} of ${close.countedMonths} months submitted`}
                      />
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden text-right lg:table-cell">
                  {close ? (
                    close.managementAccounts > 0 ? (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <FileCheckIcon className="size-4 text-success" aria-hidden="true" />
                        {close.managementAccounts} {close.managementAccounts === 1 ? "file" : "files"}
                      </span>
                    ) : close.status === "open" && !isLockedOpen(row) ? (
                      <span className="text-warning">None yet</span>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {close?.status === "confirmed" ? (close.restated ? <ToneBadge tone="info">Restated</ToneBadge> : "No") : "—"}
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{close?.confirmedAt ? formatDate(close.confirmedAt) : "—"}</TableCell>
                <TableCell className="pr-4 text-right">
                  <Button asChild variant="ghost" size="icon-sm">
                    <Link href={href} aria-label={`Open the documents of ${row.companyName}`}>
                      <ChevronRightIcon aria-hidden="true" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
