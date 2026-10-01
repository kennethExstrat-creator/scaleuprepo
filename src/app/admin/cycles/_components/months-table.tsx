"use client";

import { CalendarRangeIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { TONE_DOT_CLASSES } from "@/components/app/tone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OVERDUE_META, SUBMISSION_STATUS_META, type Tone } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabelLong, type MonthKey } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { laterDueNote, type CycleMonth, type MonthProgress } from "../_lib/cycles-model";

/** Months shown before "Show all". */
const INITIAL_MONTHS = 12;

type Segment = { key: keyof MonthProgress; label: string; tone: Tone };

/** The progress buckets in display order (they partition `total`). */
const SEGMENTS: Segment[] = [
  { key: "approved", label: SUBMISSION_STATUS_META.approved.label, tone: "success" },
  { key: "awaitingReview", label: "Awaiting review", tone: "info" },
  { key: "changesRequested", label: SUBMISSION_STATUS_META.changes_requested.label, tone: "warning" },
  { key: "notSubmitted", label: SUBMISSION_STATUS_META.draft.label, tone: "neutral" },
  { key: "overdue", label: OVERDUE_META.label, tone: "danger" },
];

/** "2 approved, 1 awaiting review, 1 overdue" (screen readers and the bar's tooltip). */
export function progressText(progress: MonthProgress): string {
  if (progress.total === 0) return "No companies report this month.";
  return SEGMENTS.filter((segment) => progress[segment.key] > 0)
    .map((segment) => `${progress[segment.key]} ${segment.label.toLowerCase()}`)
    .join(", ");
}

/** A stacked bar of the month's statuses (approved → overdue). */
export function ProgressBar({ progress, className }: { progress: MonthProgress; className?: string }) {
  const text = progressText(progress);
  if (progress.total === 0) {
    return <div className={cn("h-2 rounded-full bg-muted", className)} role="img" aria-label={text} title={text} />;
  }
  return (
    <div className={cn("flex h-2 overflow-hidden rounded-full bg-muted", className)} role="img" aria-label={text} title={text}>
      {SEGMENTS.map((segment) => {
        const value = progress[segment.key];
        if (value <= 0) return null;
        return (
          <span
            key={segment.key}
            className={cn("h-full", TONE_DOT_CLASSES[segment.tone])}
            style={{ width: `${(value / progress.total) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {SEGMENTS.map((segment) => (
        <li key={segment.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2 rounded-full", TONE_DOT_CLASSES[segment.tone])} />
          {segment.label}
        </li>
      ))}
    </ul>
  );
}

function OpenedCell({ month }: { month: CycleMonth }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {month.openedBy ?? "Automatically"}
        {month.openedEarly ? (
          <ToneBadge tone="info" title="Opened before the month ended">
            Early
          </ToneBadge>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {month.openedManually ? formatDateTime(month.openedAt) : formatDate(month.openedAt)}
      </span>
    </div>
  );
}

/**
 * The reporting months, newest first: who opened them and when, the usual due date (and the companies due
 * later), the template version, and how many companies have submitted, been approved or are overdue.
 */
export function MonthsTable({ months, currentMonth }: { months: CycleMonth[]; currentMonth: MonthKey }) {
  const [showAll, setShowAll] = useState(false);

  if (months.length === 0) {
    return (
      <EmptyState
        icon={CalendarRangeIcon}
        title="No reporting months yet"
        description="Months open automatically on the 1st of the following month once companies have a reporting start month and the default template is published."
      />
    );
  }

  const visible = showAll ? months : months.slice(0, INITIAL_MONTHS);

  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="min-w-36">Month</TableHead>
                <TableHead className="hidden min-w-40 md:table-cell">Opened</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="hidden lg:table-cell">Template</TableHead>
                <TableHead className="text-right">Companies</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Approved</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="hidden min-w-40 xl:table-cell">
                  <span className="sr-only">Progress</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((month) => {
                const { progress } = month;
                const laterDue = laterDueNote(month.laterDue, progress.total, formatDate);
                return (
                  <TableRow key={month.month}>
                    <TableCell className="font-medium">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {monthLabelLong(month.month)}
                        {month.month === currentMonth ? <ToneBadge tone="success">This month</ToneBadge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <OpenedCell month={month} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <div className="flex flex-col gap-0.5">
                        <span>{formatDate(month.dueDate)}</span>
                        {laterDue ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Companies due later: the month opened after its usual due date, or the deadline was extended or moved when the month was sent back."
                          >
                            {laterDue}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {month.templateLabel ? (
                        <span className="flex flex-col gap-0.5">
                          <span>{month.templateLabel}</span>
                          {month.templateSuperseded ? (
                            <span className="text-xs text-muted-foreground">Since replaced</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{progress.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{progress.submitted}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{progress.approved}</TableCell>
                    <TableCell
                      className={cn("text-right tabular-nums", progress.overdue > 0 && "font-medium text-destructive")}
                    >
                      {progress.overdue}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <ProgressBar progress={progress} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Legend />
          <p className="max-w-3xl text-xs text-pretty text-muted-foreground">
            Due is the month&apos;s usual due date; the note under it counts companies due later (the month opened
            after that date and has a grace period from opening, or the deadline was extended or moved when the
            month was sent back). Submitted counts months awaiting review and approved months. A month sent back for
            changes counts again once it is resubmitted. Overdue months are not submitted, or sent back, and past
            their own due date.
          </p>
        </div>
        {months.length > INITIAL_MONTHS ? (
          <Button variant="outline" size="sm" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
            {showAll ? <ChevronUpIcon data-icon="inline-start" /> : <ChevronDownIcon data-icon="inline-start" />}
            {showAll ? `Show the latest ${INITIAL_MONTHS}` : `Show all ${months.length} months`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
