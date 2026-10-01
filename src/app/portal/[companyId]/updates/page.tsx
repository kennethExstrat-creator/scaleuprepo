import { ArchiveIcon, ArrowRightIcon, CalendarClockIcon, ListOrderedIcon, MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { TONE_DOT_CLASSES } from "@/components/app/tone";
import { actionLabel, isEditableStatus } from "@/components/submission-form/presentation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canEnterData } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { NOT_YET_REPORTING_META } from "@/lib/constants";
import { getCompany, listCompanySubmissions, type SubmissionOverviewRow } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { addMonths, dateToMonthKey, monthKeyToDate, monthLabel, monthLabelLong } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { monthsNeedingAction } from "../_components/home-model";

export const metadata: Metadata = { title: "Monthly updates" };

type PageProps = { params: Promise<{ companyId: string }> };

function narrativeState(row: SubmissionOverviewRow): { label: string; filled: boolean } {
  if (row.has_narrative) return { label: "Filled in", filled: true };
  return { label: isEditableStatus(row.status) ? "Not yet" : "Skipped", filled: false };
}

/**
 * Why a draft is not required (null when it is): it comes before the reporting start month (left when
 * ScaleUp moved the start month later), or ScaleUp is not requesting monthly updates at the moment.
 */
type NotRequired = { label: string; title: string } | null;

function StatusCell({ row, notRequired }: { row: SubmissionOverviewRow; notRequired: NotRequired }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={row.status} overdue={row.is_overdue && row.status === "draft"} />
      {row.is_overdue && row.status !== "draft" ? <StatusBadge status={row.status} overdue /> : null}
      {row.is_overdue && row.days_overdue > 0 ? (
        <span className="text-xs text-destructive">
          {row.days_overdue} {row.days_overdue === 1 ? "day" : "days"}
        </span>
      ) : null}
      {notRequired ? (
        <span className="text-xs text-muted-foreground" title={notRequired.title}>
          {notRequired.label}
        </span>
      ) : null}
    </span>
  );
}

function DueCell({ row }: { row: SubmissionOverviewRow }) {
  if (!isEditableStatus(row.status) && row.submitted_at) {
    return (
      <span className="flex flex-col">
        <span>Submitted {formatDate(row.submitted_at)}</span>
        <span className="text-xs text-muted-foreground">Due {formatDate(row.due_date)}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span className={cn(row.is_overdue && "font-medium text-destructive")}>{formatDate(row.due_date)}</span>
      {row.original_due_date ? (
        <span className="text-xs text-muted-foreground">Extended from {formatDate(row.original_due_date)}</span>
      ) : null}
    </span>
  );
}

function ThreadsCell({ count }: { count: number }) {
  if (count === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <span className="inline-flex items-center gap-1 text-warning">
      <MessageSquareIcon className="size-3.5" aria-hidden="true" />
      {count} open
    </span>
  );
}

/** Monthly updates of a company: every month with its status, due date, narrative and open comments. */
export default async function MonthlyUpdatesPage({ params }: PageProps) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const sb = await createClient();

  // Opens any month that has become due (idempotent; also run nightly). Company users always get 0.
  const { error: openError } = await sb.rpc("open_due_periods");
  if (openError) console.error("[updates] open_due_periods failed:", openError.message);

  const [company, rows] = await Promise.all([getCompany(sb, companyId), listCompanySubmissions(sb, companyId)]);
  if (!company) notFound();

  const active = company.status === "active";
  const canEdit = canEnterData(ctx, companyId);
  const startMonth = company.reporting_start_month ? dateToMonthKey(company.reporting_start_month) : null;
  // The months ScaleUp still requests, as the home page counts them (monthsNeedingAction): months sent
  // back, and drafts from the reporting start month on. Drafts left from before a start month that was
  // moved later (or after it was cleared) are not required: never overdue, and "submit months in order"
  // skips them (docs/ARCHITECTURE.md §2.6 rule 6).
  const requested = active ? monthsNeedingAction(rows, company.reporting_start_month) : [];
  const requestedIds = new Set(requested.map((row) => row.id));
  const notRequired = (row: SubmissionOverviewRow): NotRequired => {
    if (!active || row.status !== "draft" || requestedIds.has(row.id)) return null;
    return startMonth && dateToMonthKey(row.month) < startMonth
      ? {
          label: "Not required",
          title: `Before your reporting start month (${monthLabelLong(startMonth)}): you don't need to submit it.`,
        }
      : { label: "Not required", title: "ScaleUp isn't requesting this month: you don't need to submit it." };
  };
  // The month to work on next: the earliest one still requested (months are submitted in order, B5).
  const next = canEdit ? (requested[0] ?? null) : null;
  const base = `/portal/${companyId}/updates`;
  const toSubmit = active ? requested.length : rows.filter((row) => isEditableStatus(row.status)).length;
  const inReview = rows.filter((row) => row.status === "submitted").length;
  const approved = rows.filter((row) => row.status === "approved").length;
  const summary =
    rows.length === 0
      ? null
      : [
          `${rows.length} ${rows.length === 1 ? "month" : "months"}`,
          toSubmit > 0 ? `${toSubmit} to submit` : null,
          inReview > 0 ? `${inReview} awaiting review` : null,
          approved > 0 ? `${approved} approved` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        className="mb-0"
        title="Monthly updates"
        description={
          summary ?? "Your figures for each month: numbers are required every month, the narrative is optional."
        }
        actions={
          next ? (
            <Button asChild>
              <Link href={`${base}/${dateToMonthKey(next.month)}`}>
                {actionLabel(next)} {monthLabelLong(next.month)}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : null
        }
      />

      {!active ? (
        <Alert className="border-border bg-muted/40">
          <ArchiveIcon />
          <AlertTitle>
            {company.name} is no longer an active portfolio company, so its records are read-only.
          </AlertTitle>
          <AlertDescription>You can still open past months to see what was submitted.</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        startMonth === null ? (
          <EmptyState
            icon={CalendarClockIcon}
            title={NOT_YET_REPORTING_META.label}
            description={`ScaleUp hasn't set the first month ${company.name} reports on yet. Your monthly updates will appear here once it has.`}
          />
        ) : (
          <EmptyState
            icon={CalendarClockIcon}
            title="No monthly updates yet"
            description={`Your first monthly update, for ${monthLabelLong(startMonth)}, opens on ${formatDate(
              monthKeyToDate(addMonths(startMonth, 1)),
            )}.`}
          />
        )
      ) : (
        <>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ListOrderedIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Months are submitted in order: a month can only be submitted once every earlier month has been submitted.
              {startMonth === null && active ? " ScaleUp isn't requesting new monthly updates at the moment." : ""}
            </span>
          </p>

          {/* Phones: one card per month. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => {
              const key = dateToMonthKey(row.month);
              const narrative = narrativeState(row);
              const skip = notRequired(row);
              const needsWork = canEdit && isEditableStatus(row.status) && !skip;
              return (
                <li key={row.id}>
                  <Link
                    href={`${base}/${key}`}
                    className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">{monthLabelLong(row.month)}</span>
                      <StatusCell row={row} notRequired={skip} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Due {formatDate(row.due_date)}</span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 rounded-full",
                            narrative.filled ? TONE_DOT_CLASSES.success : "bg-muted-foreground/40",
                          )}
                        />
                        Narrative: {narrative.label.toLowerCase()}
                      </span>
                      {row.open_threads > 0 ? <ThreadsCell count={row.open_threads} /> : null}
                      {needsWork ? <span className="ml-auto font-medium text-primary">{actionLabel(row)}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Larger screens: a table. */}
          <Card className="hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Month</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Narrative</TableHead>
                  <TableHead>Comments</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const key = dateToMonthKey(row.month);
                  const narrative = narrativeState(row);
                  const skip = notRequired(row);
                  const needsWork = canEdit && isEditableStatus(row.status) && !skip;
                  const isNext = next?.id === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link href={`${base}/${key}`} className="hover:underline">
                          {monthLabelLong(row.month)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusCell row={row} notRequired={skip} />
                      </TableCell>
                      <TableCell>
                        <DueCell row={row} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-2 rounded-full",
                              narrative.filled ? TONE_DOT_CLASSES.success : "bg-muted-foreground/40",
                            )}
                          />
                          {narrative.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ThreadsCell count={row.open_threads} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button asChild size="sm" variant={isNext ? "default" : needsWork ? "outline" : "ghost"}>
                          <Link
                            href={`${base}/${key}`}
                            aria-label={`${needsWork ? actionLabel(row) : "View"} ${monthLabel(row.month)}`}
                          >
                            {needsWork ? actionLabel(row) : "View"}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
