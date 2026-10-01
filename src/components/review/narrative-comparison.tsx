import { ChevronDownIcon, MessageSquareIcon } from "lucide-react";

import { FieldCommentButton } from "@/components/comments/comment-threads";
import type { CommentCounts, CommentThread } from "@/components/comments/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatNumberTrimmed } from "@/lib/format";
import { cn } from "@/lib/utils";

import { splitNarrativeSections, type NarrativeDisplay, type NarrativeField, type NarrativeSection } from "./narrative";

type CommentsInfo = {
  submissionId: string;
  canStartThreads: boolean;
  threadsByTarget: Record<string, CommentThread[]>;
  counts: CommentCounts;
};

export type NarrativeComparisonProps = {
  sections: NarrativeSection[];
  currentLabel: string;
  previousLabel: string;
  /** False when there is no update for the prior month. */
  hasPrevious: boolean;
  comments: CommentsInfo;
};

function RatingScale({ value, min, max }: { value: number; min: number; max: number }) {
  const steps = max - min + 1;
  if (!Number.isInteger(steps) || steps < 2 || steps > 10) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: steps }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", min + i <= value ? "bg-primary" : "bg-muted-foreground/20")} />
      ))}
    </span>
  );
}

function Display({ value, empty, muted }: { value: NarrativeDisplay; empty: string; muted?: boolean }) {
  switch (value.kind) {
    case "empty":
      return <p className="text-sm text-muted-foreground italic">{empty}</p>;
    case "text":
      return (
        <p className={cn("text-sm leading-relaxed break-words whitespace-pre-wrap", muted && "text-muted-foreground")}>{value.text}</p>
      );
    case "tags":
      return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {value.tags.map((tag) => (
            <li key={tag}>
              <Badge variant={muted ? "outline" : "secondary"}>{tag}</Badge>
            </li>
          ))}
        </ul>
      );
    case "rating":
      return (
        <p className={cn("flex flex-wrap items-center gap-2 text-sm", muted && "text-muted-foreground")}>
          <span className="font-medium tabular-nums">
            {formatNumberTrimmed(value.value, 2)} / {formatNumberTrimmed(value.max, 2)}
          </span>
          <RatingScale value={value.value} min={value.min} max={value.max} />
          {value.label ? <span className="text-muted-foreground">{value.label}</span> : null}
        </p>
      );
    case "boolean":
      return <p className={cn("text-sm", muted && "text-muted-foreground")}>{value.value ? "Yes" : "No"}</p>;
    default:
      return <p className={cn("text-sm tabular-nums", muted && "text-muted-foreground")}>{formatNumberTrimmed(value.value, 4)}</p>;
  }
}

/** The field's comment button (threads, counts and — for reviewers who may — a new thread). */
function FieldComments({ field, comments }: { field: NarrativeField; comments: CommentsInfo }) {
  const counts = comments.counts[field.target];
  return (
    <FieldCommentButton
      submissionId={comments.submissionId}
      target={field.target}
      mode="scaleup"
      canStartThreads={comments.canStartThreads}
      count={counts?.total ?? 0}
      unresolved={counts?.unresolved ?? 0}
      targetLabel={field.label}
      threads={comments.threadsByTarget[field.target] ?? []}
    />
  );
}

/**
 * The sections with no entry in either month, named in one line, with their fields (and comment buttons) in a
 * collapsible list. The list starts open when any of those fields has comment threads.
 */
function BlankSections({
  sections,
  threads,
  title,
  note,
  comments,
}: {
  sections: NarrativeSection[];
  threads: { total: number; unresolved: number };
  title: string;
  note: string;
  comments: CommentsInfo;
}) {
  const fieldCount = sections.reduce((total, section) => total + section.fields.length, 0);
  const threadsText = `${threads.total} comment ${threads.total === 1 ? "thread" : "threads"} on these fields${
    threads.unresolved > 0 ? `, ${threads.unresolved} unresolved` : ", all resolved"
  }`;
  return (
    <Collapsible defaultOpen={threads.total > 0} className="rounded-lg border border-dashed text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">
            {sections.map((section) => section.title).join(" · ")}
            {note}
          </p>
          {threads.total > 0 ? (
            <p
              className={cn(
                "mt-1 flex items-center gap-1.5 text-xs tabular-nums",
                threads.unresolved > 0 ? "text-warning" : "text-muted-foreground",
              )}
            >
              <MessageSquareIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {threadsText}
            </p>
          ) : null}
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="group/blank -my-1 shrink-0">
            <span className="group-data-[state=open]/blank:hidden">{`Show fields (${fieldCount})`}</span>
            <span className="group-data-[state=closed]/blank:hidden">Hide fields</span>
            <ChevronDownIcon data-icon="inline-end" className="transition-transform group-data-[state=open]/blank:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="grid gap-x-6 gap-y-3 border-t border-dashed p-3 md:grid-cols-2">
          {sections.map((section) => (
            <section key={section.key} aria-label={section.title} className="flex min-w-0 flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted-foreground">{section.title}</h3>
              <ul className="flex flex-col divide-y">
                {section.fields.map((field) => (
                  <li key={field.key} className="flex min-h-8 items-center justify-between gap-2 py-1">
                    <span className="min-w-0 break-words">{field.label}</span>
                    <FieldComments field={field} comments={comments} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Each narrative (C4 category) and founder-pulse field of this month next to last month's entry, with a
 * comment button per field. Sections left blank in both months are listed together at the end, their fields
 * (with comment buttons) in a collapsible list that starts open when one of them has comment threads.
 */
export function NarrativeComparison({ sections, currentLabel, previousLabel, hasPrevious, comments }: NarrativeComparisonProps) {
  const { filled, blank, blankThreads } = splitNarrativeSections(sections, comments.counts);
  const previousEmpty = hasPrevious ? "No entry" : `No update for ${previousLabel}`;

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground">This template has no narrative sections.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {filled.length > 0 ? (
        <div className="hidden grid-cols-2 gap-6 border-b pb-2 text-xs font-medium text-muted-foreground md:grid">
          <span>This month · {currentLabel}</span>
          <span className="pl-6">Last month · {previousLabel}</span>
        </div>
      ) : null}

      {filled.map((section) => (
        <section key={section.key} aria-label={section.title} className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            {section.currentFilled === 0 ? (
              <span className="text-xs text-muted-foreground italic">
                {section.kind === "pulse" ? "Not answered this month" : "No narrative this month"}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col divide-y">
            {section.fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
                  <FieldComments field={field} comments={comments} />
                </div>
                <div className="grid gap-3 md:grid-cols-2 md:gap-6">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">{currentLabel}</p>
                    <Display
                      value={field.current}
                      empty={section.kind === "pulse" ? "Not answered this month" : "No narrative this month"}
                    />
                  </div>
                  <div className="min-w-0 rounded-md bg-muted/40 p-2 md:rounded-none md:border-l md:bg-transparent md:p-0 md:pl-6">
                    <p className="mb-1 text-xs text-muted-foreground md:hidden">{previousLabel}</p>
                    <Display value={field.previous} empty={previousEmpty} muted />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {blank.length > 0 ? (
        <BlankSections
          sections={blank}
          threads={blankThreads}
          title={filled.length === 0 ? "No narrative this month" : "No narrative in either month"}
          note={filled.length === 0 && hasPrevious ? ` (also blank in ${previousLabel})` : ""}
          comments={comments}
        />
      ) : null}
    </div>
  );
}
