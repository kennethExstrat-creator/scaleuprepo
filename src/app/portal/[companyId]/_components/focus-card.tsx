import { ArrowRightIcon, CalendarClockIcon, CircleCheckIcon, EyeIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/app/status-badge";
import { TONE_TEXT_CLASSES } from "@/components/app/tone";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { dateToMonthKey, monthLabel, monthLabelLong, type DateKey } from "@/lib/periods";
import type { CompanyRole } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { dueStatus, monthListText, nextMonthTiming, updateHref, type HomeSubmission, type NextMonth } from "./home-model";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * The month to work on next (the earliest month still to submit): due date, status and a "Continue
 * update" button (BRD C2).
 */
export function FocusCard({
  companyId,
  focus,
  later,
  companyRole,
  today,
}: {
  companyId: string;
  focus: HomeSubmission;
  /** The other months still to submit after this one, oldest first (monthsNeedingAction). */
  later: HomeSubmission[];
  companyRole: CompanyRole;
  today: DateKey;
}) {
  const due = dueStatus(focus, today);
  const started = focus.last_saved_at !== null || focus.status === "changes_requested";
  return (
    <Card className={cn(focus.is_overdue && "ring-destructive/30")}>
      <CardHeader>
        <CardDescription>
          {focus.status === "changes_requested" ? "Changes requested by ScaleUp" : "Your next monthly update"}
        </CardDescription>
        <CardTitle className="text-xl font-semibold">
          <h2>{monthLabelLong(focus.month)}</h2>
        </CardTitle>
        <CardAction>
          <StatusBadge status={focus.status} overdue={focus.is_overdue} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Detail label="Due date">
            {formatDate(focus.due_date)}
            <span className={cn("block text-xs font-normal", TONE_TEXT_CLASSES[due.tone])}>{due.text}</span>
          </Detail>
          <Detail label="Last saved">
            {focus.last_saved_at ? formatDateTime(focus.last_saved_at) : "Not started yet"}
          </Detail>
          <Detail label="Last submitted">
            {focus.submitted_at ? formatDate(focus.submitted_at) : "Not submitted yet"}
          </Detail>
        </dl>
        {focus.status === "changes_requested" ? (
          <p className="text-sm text-pretty">
            ScaleUp asked for changes to this month. Read their message, update the figures and submit it again.
          </p>
        ) : null}
        {later.length > 0 ? (
          <p className="text-sm text-pretty text-muted-foreground">
            Months are submitted in order. After {monthLabel(focus.month)}, {monthListText(later)}{" "}
            {later.length === 1 ? "is" : "are"} still to submit.
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-pretty text-muted-foreground">
          {companyRole === "owner"
            ? "Numbers are required every month; the narrative is optional."
            : "Your company owner submits the update once the numbers are complete."}
        </p>
        <Button asChild className="shrink-0">
          <Link href={updateHref(companyId, focus.month)}>
            {started ? "Continue update" : "Start update"}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Nothing to submit: the latest submitted month's status and when the next month opens. */
export function UpToDateCard({
  companyId,
  latest,
  next,
}: {
  companyId: string;
  /** The newest submitted or approved month (latestSubmittedMonth). */
  latest: HomeSubmission;
  next: NextMonth | null;
}) {
  const review =
    latest.status === "approved"
      ? `was approved${latest.approved_at ? ` on ${formatDate(latest.approved_at)}` : ""}.`
      : `is with ScaleUp for review${latest.submitted_at ? ` (submitted ${formatDate(latest.submitted_at)})` : ""}.`;
  return (
    <Card>
      <CardHeader>
        <CardDescription>Monthly updates</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
          <CircleCheckIcon aria-hidden="true" className="size-5 text-success" />
          <h2>You&apos;re up to date</h2>
        </CardTitle>
        <CardAction>
          <StatusBadge status={latest.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-pretty">
        <p>
          {monthLabelLong(latest.month)} {review}
        </p>
        {next ? (
          <p className="text-muted-foreground">
            Next: {monthLabelLong(next.month)} {nextMonthTiming(next)}.
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={updateHref(companyId, latest.month)}>
            <EyeIcon data-icon="inline-start" />
            View {monthLabel(latest.month)}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

/** A reporting start month is set, but no month has opened yet. */
export function StartsLaterCard({ next }: { next: NextMonth }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Monthly updates</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl font-semibold">
          <CalendarClockIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          <h2>Reporting starts with {monthLabelLong(next.month)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-pretty text-muted-foreground">
        Your first monthly update ({monthLabelLong(next.month)}) {nextMonthTiming(next)}. You&apos;ll enter the
        month&apos;s financials, headcount and KPIs; the narrative is optional.
      </CardContent>
    </Card>
  );
}

/** Exited / written-off companies: the latest month, view only. */
export function ReadOnlyLatestCard({ companyId, latest }: { companyId: string; latest: HomeSubmission }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Latest monthly update</CardDescription>
        <CardTitle className="text-xl font-semibold">
          <h2>{monthLabelLong(latest.month)}</h2>
        </CardTitle>
        <CardAction>
          <StatusBadge status={latest.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {latest.submitted_at ? `Submitted ${formatDate(latest.submitted_at)}.` : "This month was not submitted."}
        {latest.approved_at ? ` Approved ${formatDate(latest.approved_at)}.` : ""}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={`/portal/${companyId}/updates/${dateToMonthKey(latest.month)}`}>
            <EyeIcon data-icon="inline-start" />
            View {monthLabel(latest.month)}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
