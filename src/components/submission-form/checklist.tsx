"use client";

import { ArrowRightIcon, CircleAlertIcon, CircleCheckIcon, HistoryIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SUBMISSION_EVENT_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { SubmissionEventWithActor } from "@/lib/types/domain";
import type { ValidationIssue } from "@/lib/validation";

import { actorLabel } from "./presentation";

const SHOWN_ISSUES = 8;

function eventLabel(event: string): string {
  const labels: Record<string, string> = SUBMISSION_EVENT_LABELS;
  return labels[event] ?? event;
}

/**
 * The numbers check at the end of the form (C6): what still stops the month from being submitted, each
 * with a link to its input, and the submit action (or who can submit).
 */
export function NumbersCheck({
  issues,
  unreadable,
  labelFor,
  onJump,
  action,
  note,
}: {
  issues: ValidationIssue[];
  /** Inputs whose text cannot be read ([target, message]). */
  unreadable: [string, string][];
  labelFor: (target: string) => string;
  onJump: (target: string) => void;
  action?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const all: ValidationIssue[] = [
    ...unreadable.map(([target, message]) => ({
      target,
      code: "unreadable",
      message: `${labelFor(target)}: ${message}`,
    })),
    ...issues,
  ];
  const shown = showAll ? all : all.slice(0, SHOWN_ISSUES);
  const complete = all.length === 0;

  return (
    <Card id="numbers-check" className="scroll-mt-32">
      <CardHeader>
        <CardTitle id="numbers-check-title" className="flex items-center gap-2 text-base">
          {complete ? (
            <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
          ) : (
            <CircleAlertIcon className="size-5 text-warning" aria-hidden="true" />
          )}
          <h3>{complete ? "All required figures are filled in" : "Before this month can be submitted"}</h3>
        </CardTitle>
        <CardDescription>
          {complete
            ? "ScaleUp also checks that every earlier month has been submitted."
            : `${all.length} ${all.length === 1 ? "thing needs" : "things need"} attention. Numbers are required every month; the narrative is optional.`}
        </CardDescription>
      </CardHeader>
      {complete ? null : (
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {shown.map((issue, index) => (
              <li
                key={`${issue.target}-${issue.code}-${index}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0 text-sm">{issue.message}</span>
                {issue.target !== "general" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    onClick={() => onJump(issue.target)}
                    aria-label={`Go to ${labelFor(issue.target)}`}
                  >
                    Go to field
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {all.length > SHOWN_ISSUES ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 px-0"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "Show fewer" : `Show all ${all.length}`}
            </Button>
          ) : null}
        </CardContent>
      )}
      {action || note ? (
        <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">{note}</div>
          {action ? <div className="flex justify-end">{action}</div> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/**
 * The month's timeline (newest first). ScaleUp staff appear to company users as "<full name> (ScaleUp)"
 * (BRD B28; the data layer names them), and to ScaleUp staff by name.
 */
export function ActivityCard({ events }: { events: SubmissionEventWithActor[] }) {
  if (events.length === 0) return null;
  const newestFirst = [...events].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle id="activity-title" className="flex items-center gap-2 text-base">
          <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3>Activity</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {newestFirst.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
              <p className="text-sm">
                <span className="font-medium">{eventLabel(event.event)}</span>
                <span className="text-muted-foreground"> by {actorLabel(event)}</span>
              </p>
              <p className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</p>
              {event.message?.trim() ? (
                <p className="text-sm break-words whitespace-pre-wrap text-foreground/80">{event.message}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
