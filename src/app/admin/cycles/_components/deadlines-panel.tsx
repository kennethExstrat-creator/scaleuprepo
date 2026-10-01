"use client";

import { ArrowRightIcon, CalendarClockIcon, CalendarPlusIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPANY_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";

import { plural, type DeadlineExtension, type ExtendTarget, type SentBack } from "../_lib/cycles-model";

function DueDates({ row }: { row: DeadlineExtension }) {
  return (
    <div className="flex flex-col gap-0.5 tabular-nums">
      <span className="flex flex-wrap items-center gap-1 whitespace-nowrap">
        <span className="text-muted-foreground line-through decoration-muted-foreground/50">
          {formatDate(row.originalDueDate)}
        </span>
        <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">moved to</span>
        <span className="font-medium">{formatDate(row.dueDate)}</span>
      </span>
      <span className="text-xs text-muted-foreground">{plural(row.daysAdded, "day")} later</span>
    </div>
  );
}

const SENT_BACK_WHAT: Record<SentBack["kind"], string> = {
  changes_requested: "sent back for changes",
  reopened: "reopened after approval",
};

/** "Renuka Sena, 14 Oct 2026, 10:05 · extended 2 times". */
function ByLine({ by, at, suffix }: { by: string | null; at: string; suffix?: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      {by ? `${by}, ` : ""}
      {formatDateTime(at)}
      {suffix ?? ""}
    </span>
  );
}

/** What set the current due date: the latest extension, or a send-back (after an earlier extension). */
function WhyCell({ row }: { row: DeadlineExtension }) {
  if (row.cause === "extended") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className={row.reason ? "text-pretty" : "text-muted-foreground"}>{row.reason ?? "No reason given."}</span>
        {row.extendedAt ? (
          <ByLine
            by={row.extendedBy}
            at={row.extendedAt}
            suffix={row.extensionCount > 1 ? ` · extended ${row.extensionCount} times` : undefined}
          />
        ) : null}
      </div>
    );
  }

  const what = row.sentBack ? SENT_BACK_WHAT[row.sentBack.kind] : "sent back or reopened";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-pretty">
        {row.extendedAt ? "Moved again" : "Moved"} when the month was {what}, to give time to resubmit.
      </span>
      {row.sentBack ? <ByLine by={row.sentBack.by} at={row.sentBack.at} /> : null}
      {row.extendedAt ? (
        <span className="text-xs text-pretty text-muted-foreground">
          Extended earlier{row.extendedTo ? ` to ${formatDate(row.extendedTo)}` : ""}
          {row.extendedBy ? ` by ${row.extendedBy}` : ""} on {formatDate(row.extendedAt)}
          {row.extensionCount > 1 ? ` (${plural(row.extensionCount, "extension")})` : ""}
          {row.reason ? `: ${row.reason}` : "."}
        </span>
      ) : null}
    </div>
  );
}

/** Under the company name: why its months cannot be extended here (inactive, not reporting, before start). */
function CompanyNote({ row }: { row: DeadlineExtension }) {
  let text: string | null = null;
  let title: string | undefined;
  if (row.extendBlock === "inactive") {
    text = COMPANY_STATUS_META[row.companyStatus].label;
  } else if (row.extendBlock === "not_reporting") {
    text = "Not reporting";
    title = "The company has no reporting start month, so this month is kept as history.";
  } else if (row.extendBlock === "before_start" && row.reportingStartMonth) {
    text = `Reports from ${monthLabel(row.reportingStartMonth)}`;
    title = "This month is before the company's reporting start month, so it is kept as history.";
  }
  if (!text) return null;
  return (
    <span className="text-xs font-normal text-muted-foreground" title={title}>
      {text}
    </span>
  );
}

/**
 * Months whose due date has moved (BRD A5 "extend deadline per company", B19): extended by ScaleUp, or moved
 * when a month was sent back. "Extend a deadline" opens the dialog; "Extend" / "Extend again" opens it on
 * that month, offered only for the months the dialog offers (cycles-model extendBlockOf).
 */
export function DeadlinesPanel({
  extensions,
  canExtend,
  hasChoices,
  onExtend,
  historyHref,
}: {
  extensions: DeadlineExtension[];
  canExtend: boolean;
  /** Some reporting company has a month that can be extended. */
  hasChoices: boolean;
  onExtend: (target: ExtendTarget | null) => void;
  /** The extensions in the audit log (null when the role cannot see it). */
  historyHref: string | null;
}) {
  const extendButton =
    canExtend && hasChoices ? (
      <Button variant="outline" size="sm" onClick={() => onExtend(null)}>
        <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
        Extend a deadline
      </Button>
    ) : null;

  if (extensions.length === 0) {
    return (
      <EmptyState
        icon={CalendarClockIcon}
        title="No deadlines have moved"
        description="Every month is due on the usual day. Extend a deadline when a company needs more time for a month; sending a month back also gives the company time to resubmit."
        action={extendButton}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {plural(extensions.length, "month")} with a later due date than usual, newest month first.
        </p>
        <div className="flex flex-wrap gap-2">
          {historyHref ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={historyHref}>
                <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                Change history
              </Link>
            </Button>
          ) : null}
          {extendButton}
        </div>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="min-w-40">Company</TableHead>
                <TableHead>Month</TableHead>
                <TableHead className="min-w-44">Due date</TableHead>
                <TableHead className="hidden min-w-64 md:table-cell">Why</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {extensions.map((row) => {
                const label = `${row.companyName}, ${monthLabelLong(row.month)}`;
                return (
                  <TableRow key={row.submissionId}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.companyName}</span>
                        <CompanyNote row={row} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/admin/review/${row.submissionId}`}
                        className="underline-offset-3 hover:underline"
                        title={`Open ${label}`}
                      >
                        {monthLabel(row.month)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <DueDates row={row} />
                    </TableCell>
                    <TableCell className="hidden max-w-md whitespace-normal md:table-cell">
                      <WhyCell row={row} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={row.status} overdue={row.isOverdue} />
                        {row.cause === "sent_back" ? (
                          <ToneBadge tone="neutral">
                            {row.sentBack?.kind === "reopened" ? "Reopened" : "Sent back"}
                          </ToneBadge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {canExtend && row.canExtendAgain ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onExtend({ companyId: row.companyId, submissionId: row.submissionId, label })}
                          aria-label={`Extend the deadline for ${label}`}
                        >
                          {row.extensionCount > 0 || row.cause === "extended" ? "Extend again" : "Extend"}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
