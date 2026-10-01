"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CloudIcon,
  CloudOffIcon,
  MessageSquareIcon,
  RotateCwIcon,
} from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/app/status-badge";
import { CommentThreadsPanel, type CommentMode } from "@/components/comments/comment-threads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, formatTime } from "@/lib/format";
import { daysOverdue, monthLabelLong, toMYTDate } from "@/lib/periods";
import type { SubmissionBundle } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

import type { DraftSnapshot } from "./draft-store";

// ---------------------------------------------------------------------------------------------
// Save indicator
// ---------------------------------------------------------------------------------------------

/** "Saving…", "Saved 14:05", "Couldn't save · Retry" (announced politely to screen readers). */
export function SaveIndicator({
  snapshot,
  today,
  onRetry,
}: {
  snapshot: DraftSnapshot;
  today: string;
  onRetry: () => void;
}) {
  const invalidCount = Object.keys(snapshot.invalid).length;
  let content: React.ReactNode;
  if (snapshot.status === "error") {
    content = (
      <>
        <CloudOffIcon className="size-4 text-destructive" aria-hidden="true" />
        <span className="text-destructive" title={snapshot.error ?? undefined}>
          Couldn&apos;t save
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={onRetry} className="text-destructive">
          <RotateCwIcon data-icon="inline-start" />
          Retry
        </Button>
      </>
    );
  } else if (snapshot.status === "saving" || snapshot.status === "pending") {
    content = (
      <>
        <Spinner className="size-3.5" aria-hidden="true" />
        <span>Saving…</span>
      </>
    );
  } else if (invalidCount > 0) {
    content = (
      <>
        <CircleAlertIcon className="size-4 text-warning" aria-hidden="true" />
        <span>{invalidCount === 1 ? "1 value can't be saved" : `${invalidCount} values can't be saved`}</span>
      </>
    );
  } else if (snapshot.lastSavedAt) {
    const sameDay = toMYTDate(snapshot.lastSavedAt) === today;
    content = (
      <>
        <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
        <span>Saved {sameDay ? formatTime(snapshot.lastSavedAt) : formatDate(snapshot.lastSavedAt)}</span>
      </>
    );
  } else {
    content = (
      <>
        <CloudIcon className="size-4" aria-hidden="true" />
        <span>Changes save automatically</span>
      </>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-7 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
    >
      {content}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Comments sheet
// ---------------------------------------------------------------------------------------------

export function CommentsSheetButton({
  submissionId,
  monthLabel,
  mode,
  canStartThreads,
  unresolved,
  targetLabels,
}: {
  submissionId: string;
  monthLabel: string;
  mode: CommentMode;
  canStartThreads: boolean;
  unresolved: number;
  /** Names of the targets: each thread's label and the new-thread target choices (commentTargetLabels). */
  targetLabels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={unresolved > 0 ? `Comments, ${unresolved} unresolved` : "Comments"}
        >
          <MessageSquareIcon data-icon="inline-start" />
          <span className="hidden sm:inline">Comments</span>
          {unresolved > 0 ? (
            <Badge className="h-4 min-w-4 px-1 text-[0.65rem] tabular-nums" aria-hidden="true">
              {unresolved}
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Comments</SheetTitle>
          <SheetDescription>
            {monthLabel} ·{" "}
            {unresolved === 0
              ? "no unresolved threads"
              : unresolved === 1
                ? "1 unresolved thread"
                : `${unresolved} unresolved threads`}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <CommentThreadsPanel
            submissionId={submissionId}
            mode={mode}
            canStartThreads={canStartThreads}
            targetLabels={targetLabels}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Sticky bar
// ---------------------------------------------------------------------------------------------

export type FormHeaderProps = {
  bundle: SubmissionBundle;
  overdue: boolean;
  today: string;
  editable: boolean;
  snapshot: DraftSnapshot;
  onRetry: () => void;
  comments: {
    mode: CommentMode;
    canStartThreads: boolean;
    unresolved: number;
    targetLabels: Record<string, string>;
  } | null;
  /** The primary action (Review and submit) or a note in its place. */
  action?: React.ReactNode;
};

/** Sticky bar under the app header: month, status, due date, save state, comments and the main action. */
export function FormHeader({ bundle, overdue, today, editable, snapshot, onRetry, comments, action }: FormHeaderProps) {
  const { submission } = bundle;
  const month = monthLabelLong(submission.month);
  const late = overdue ? daysOverdue(submission.due_date, today) : 0;
  const due = overdue
    ? `Overdue: was due ${formatDate(submission.due_date)}${late > 0 ? ` (${late} ${late === 1 ? "day" : "days"} ago)` : ""}`
    : `Due ${formatDate(submission.due_date)}${submission.original_due_date ? ` (extended from ${formatDate(submission.original_due_date)})` : ""}`;
  // Exited and written-off companies can't submit any more (BRD B15, B21): no due date to show.
  const showDue =
    bundle.company.status === "active" && (submission.status === "draft" || submission.status === "changes_requested");

  return (
    <div className="sticky top-14 z-10 rounded-xl border bg-background/95 px-3 py-2 shadow-xs backdrop-blur supports-backdrop-filter:bg-background/85">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <h2 className="truncate text-sm font-semibold sm:text-base">{month}</h2>
          <StatusBadge status={submission.status} overdue={overdue} />
          {showDue ? (
            <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
              {due}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? <SaveIndicator snapshot={snapshot} today={today} onRetry={onRetry} /> : null}
          {comments ? (
            <CommentsSheetButton
              submissionId={submission.id}
              monthLabel={month}
              mode={comments.mode}
              canStartThreads={comments.canStartThreads}
              unresolved={comments.unresolved}
              targetLabels={comments.targetLabels}
            />
          ) : null}
          {action}
        </div>
      </div>
    </div>
  );
}
