import { ArrowRightIcon, CircleAlertIcon, MessageSquareTextIcon, MessageSquareWarningIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";

import { plural, updateHref, type ChangeRequest, type HomeSubmission } from "./home-model";

/** Overdue months, in red (BRD C2: "any month with missing numbers flagged red"). */
export function MissingNumbersCard({ companyId, months }: { companyId: string; months: HomeSubmission[] }) {
  if (months.length === 0) return null;
  return (
    <Card className="bg-destructive/[0.03] ring-destructive/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold text-destructive">
          <CircleAlertIcon aria-hidden="true" className="size-4" />
          <h2>Missing numbers</h2>
        </CardTitle>
        <CardDescription className="text-pretty">
          {months.length === 1 ? "This month is" : "These months are"} past the due date. Numbers can&apos;t be
          skipped, and months are submitted in order, starting with the earliest.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-destructive/15">
          {months.map((month) => (
            <li key={month.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium">{monthLabelLong(month.month)}</p>
                <p className="text-xs text-muted-foreground">
                  Due {formatDate(month.due_date)} ·{" "}
                  <span className="font-medium text-destructive">{plural(month.days_overdue, "day")} overdue</span>
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={updateHref(companyId, month.month)}>
                  Open<span className="sr-only"> {monthLabelLong(month.month)}</span>
                  <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Months ScaleUp sent back, with the latest message signed by its author as the company sees them:
 * "Renuka Sena (ScaleUp)", or "ScaleUp" when nobody can be named (BRD B28; never an email or role).
 */
export function ChangesRequestedCard({ companyId, requests }: { companyId: string; requests: ChangeRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <MessageSquareWarningIcon aria-hidden="true" className="size-4 text-warning" />
          <h2>Changes requested</h2>
        </CardTitle>
        <CardDescription className="text-pretty">
          ScaleUp asked you to update {requests.length === 1 ? "this month" : "these months"} and submit again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {requests.map(({ submission, message, author, requestedAt, kind }) => (
            <li key={submission.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium">{monthLabelLong(submission.month)}</p>
                <p className="text-xs text-muted-foreground">Resubmit by {formatDate(submission.due_date)}</p>
              </div>
              <figure className="flex flex-col gap-1">
                <blockquote className="line-clamp-5 border-l-2 border-warning/40 pl-3 text-sm whitespace-pre-line text-pretty">
                  {message ?? "No message was added."}
                </blockquote>
                <figcaption className="pl-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{author}</span>
                  {requestedAt ? (
                    <>
                      {" · "}
                      <time dateTime={requestedAt} title={formatDateTime(requestedAt)}>
                        {formatDate(requestedAt)}
                      </time>
                    </>
                  ) : null}
                  {kind === "reopened" ? " · approved month reopened" : ""}
                </figcaption>
              </figure>
              <div>
                <Button asChild size="sm">
                  <Link href={updateHref(companyId, submission.month)}>
                    Make changes<span className="sr-only"> to {monthLabelLong(submission.month)}</span>
                    <ArrowRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Unresolved shared comment threads, per month (BRD C2, C7). Neutral wording: a thread may be ScaleUp's
 * or the company's own (an owner's amendment request is a shared thread too), and v_submission_overview
 * only counts them.
 */
export function CommentsCard({
  companyId,
  total,
  months,
  readOnly = false,
}: {
  companyId: string;
  total: number;
  months: HomeSubmission[];
  /** Exited / written-off companies: members can no longer reply or resolve. */
  readOnly?: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <MessageSquareTextIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>Open comment threads</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No open comment threads.</p>
        ) : (
          <>
            <p className="text-sm text-pretty">
              <span className="text-2xl font-semibold">{total}</span>{" "}
              <span className="text-muted-foreground">
                open {total === 1 ? "thread" : "threads"} on your monthly updates
              </span>
            </p>
            {readOnly ? (
              <p className="text-xs text-pretty text-muted-foreground">
                You can still read these threads, but no longer reply.
              </p>
            ) : null}
            <ul className="flex flex-col gap-1">
              {months.map((month) => (
                <li key={month.id}>
                  <Link
                    href={updateHref(companyId, month.month)}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">{monthLabel(month.month)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {plural(month.open_threads, "open thread")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
