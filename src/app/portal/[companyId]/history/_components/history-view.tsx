import { CalendarClockIcon, ChevronRightIcon, FileSpreadsheetIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Money } from "@/components/app/money";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OVERDUE_META, SUBMISSION_STATUS_META } from "@/lib/constants";
import { EMPTY_DISPLAY, formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";
import { SUBMISSION_STATUSES } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { historyCounts, historyRange, type HistoryRow } from "../_lib/history-model";

function When({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">{EMPTY_DISPLAY}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatDate(value)}
    </time>
  );
}

function Amount({ row, value }: { row: HistoryRow; value: number | null }) {
  // Months not submitted yet are work in progress: their figures are shown in grey.
  return <Money value={value} currency={row.currency} className={cn(row.status === "draft" && "text-muted-foreground")} />;
}

function rangeText(rows: HistoryRow[]): string | null {
  const range = historyRange(rows);
  if (!range) return null;
  const count = rows.length === 1 ? "1 month" : `${rows.length} months`;
  return range.from === range.to
    ? `${count}: ${monthLabel(range.from)}.`
    : `${count} from ${monthLabel(range.from)} to ${monthLabel(range.to)}.`;
}

/**
 * The history page: every month with its status, submitted and approved dates, revision and key
 * figures (newest first), each linking to the month's form; owners get "Download my data (Excel)".
 */
export function HistoryView({
  companyId,
  companyName,
  rows,
  canDownload,
  notReporting,
  readOnly = false,
}: {
  companyId: string;
  companyName: string;
  rows: HistoryRow[];
  /** Owners (canExport): the C4 workbook export, GET /api/exports/c4/<companyId> (module M9). */
  canDownload: boolean;
  /** No reporting start month (BRD B16): explains why the list is empty. */
  notReporting: boolean;
  /** Exited / written off (BRD B15): no months will open, so an empty list only says so. */
  readOnly?: boolean;
}) {
  const counts = historyCounts(rows);
  return (
    <>
      <PageHeader
        title="History"
        description="Every monthly update on the platform, with its status and key figures."
        actions={
          canDownload && rows.length > 0 ? (
            <Button asChild variant="outline">
              <a href={`/api/exports/c4/${companyId}`}>
                <FileSpreadsheetIcon data-icon="inline-start" />
                Download my data (Excel)
              </a>
            </Button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        readOnly ? (
          <EmptyState
            icon={HistoryIcon}
            title="No monthly updates on the platform"
            description="No monthly updates were reported on the platform before the company's records became read-only."
          />
        ) : notReporting ? (
          <EmptyState
            icon={CalendarClockIcon}
            title="Monthly reporting hasn't started yet"
            description="ScaleUp will let you know when monthly reporting starts. Your monthly updates will be listed here."
          />
        ) : (
          <EmptyState
            icon={HistoryIcon}
            title="No monthly updates yet"
            description="Your monthly updates will be listed here once the first month opens."
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{rangeText(rows)}</span>
            {SUBMISSION_STATUSES.filter((status) => counts[status] > 0).map((status) => (
              <ToneBadge key={status} tone={SUBMISSION_STATUS_META[status].tone}>
                {counts[status]} {SUBMISSION_STATUS_META[status].label.toLowerCase()}
              </ToneBadge>
            ))}
            {counts.overdue > 0 ? (
              <ToneBadge tone={OVERDUE_META.tone}>
                {counts.overdue} {OVERDUE_META.label.toLowerCase()}
              </ToneBadge>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            <Table>
              <TableCaption className="sr-only">
                Monthly updates of {companyName}, newest first, with status, dates and key figures.
              </TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Month</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                  <TableHead className="hidden md:table-cell">Approved</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Revision</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Revenue</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Net profit</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Cash in bank</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const href = `/portal/${companyId}/updates/${row.month}`;
                  const view = row.status === "submitted" || row.status === "approved";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link
                          href={href}
                          className="rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <abbr title={monthLabelLong(row.month)} className="no-underline">
                            {monthLabel(row.month)}
                          </abbr>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} overdue={row.isOverdue} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <When value={row.submittedAt} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <When value={row.approvedAt} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {row.revision > 0 ? row.revision : <span className="text-muted-foreground">{EMPTY_DISPLAY}</span>}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        <Amount row={row} value={row.revenue} />
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <Amount row={row} value={row.netProfit} />
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <Amount row={row} value={row.cash} />
                      </TableCell>
                      <TableCell className="pr-2 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={href}>
                            {view ? "View" : "Open"}
                            <span className="sr-only"> {monthLabelLong(row.month)}</span>
                            <ChevronRightIcon data-icon="inline-end" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {counts.draft > 0 ? (
            <p className="hidden text-xs text-muted-foreground sm:block">
              Figures in grey belong to months that have not been submitted yet.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
