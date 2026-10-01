"use client";

// Comment threads UI (module M6, BRD A7 / C7). Cross-module contract: docs/ARCHITECTURE.md §5.7 — the
// exported names and the original props stay as they are; the optional props below were added.
//
// Data: a page can pass the threads it loaded on the server (`threads`, e.g. from listComments); after a
// change the server action re-renders the page, so fresh props arrive in the same response. Without
// `threads`, the panel loads them itself (listComments) and a field button loads them when opened.

import { MessageSquareIcon, MessageSquarePlusIcon, MessagesSquareIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useId, useMemo, useState, type JSX } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { CommentComposer } from "./comment-composer";
import { partitionThreads, summariseThreads, threadsForTarget } from "./model";
import { targetLabelFor, targetOptionsFrom, type TargetOption } from "./target-labels";
import { ThreadCard } from "./thread-card";
import type { CommentMode, CommentThread } from "./types";
import { useCommentThreads } from "./use-comment-threads";

export type { CommentMode } from "./types";

export type CommentThreadsPanelProps = {
  submissionId: string;
  mode: CommentMode;
  /** May start new threads: ScaleUp non-viewers (`canComment(ctx)`); company users only reply. */
  canStartThreads: boolean;
  /** Only show threads on this target (docs/ARCHITECTURE.md §2.5), e.g. 'field:gross_profit'. */
  target?: string;
  className?: string;
  /**
   * Labels per target (e.g. `buildTargetLabels(bundle)` from '@/components/comments/target-labels'); also
   * the choices of the new-thread target select unless `targetOptions` is given. Unknown targets fall back
   * to a generic label.
   */
  targetLabels?: Record<string, string>;
  /**
   * The targets offered when starting a thread, grouped in the select in order of appearance (e.g. the rows
   * of the review page's comparison table); 'General' is always offered. Default: every target of
   * `targetLabels` (targetOptionsFrom).
   */
  targetOptions?: TargetOption[];
  /** Threads loaded by the page (listComments). Omit to let the panel load them. */
  threads?: CommentThread[];
  /** Heading (default "Comments"); null hides the heading row. */
  title?: string | null;
};

function noop() {}

function ThreadsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** All comment threads of a submission (optionally one target): Open / Resolved, replies, resolve, new threads. */
export function CommentThreadsPanel({
  submissionId,
  mode,
  canStartThreads,
  target,
  className,
  targetLabels,
  targetOptions,
  threads: provided,
  title = "Comments",
}: CommentThreadsPanelProps): JSX.Element {
  const { threads, error, loading, reload } = useCommentThreads(submissionId, { provided, enabled: true });
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [composing, setComposing] = useState(false);

  const scoped = useMemo(() => {
    if (!threads) return null;
    return target ? threadsForTarget(threads, target) : threads;
  }, [threads, target]);
  const { open, resolved } = useMemo(() => partitionThreads(scoped ?? []), [scoped]);
  const options = useMemo(() => targetOptions ?? targetOptionsFrom(targetLabels), [targetOptions, targetLabels]);

  const startAllowed = canStartThreads && mode === "scaleup";
  const onChanged = provided ? noop : reload;
  const headingId = useId();

  return (
    <section aria-labelledby={title ? headingId : undefined} aria-label={title ? undefined : "Comments"} className={cn("flex flex-col gap-3", className)}>
      {title !== null ? (
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="flex items-center gap-2 font-heading text-base font-medium">
            <MessagesSquareIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {title}
            {loading ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
          </h2>
          {startAllowed && !composing ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setComposing(true)}>
              <PlusIcon data-icon="inline-start" />
              New thread
            </Button>
          ) : null}
        </div>
      ) : null}

      {startAllowed && (composing || title === null) ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <CommentComposer
            submissionId={submissionId}
            fixedTarget={target}
            targetOptions={options}
            allowVisibility
            placeholder={target ? `Comment on ${targetLabelFor(target, targetLabels)}…` : "Ask the company a question, or leave an internal note…"}
            submitLabel="Post comment"
            autoFocus={composing}
            onPosted={() => {
              setComposing(false);
              setTab("open");
              onChanged();
            }}
            onCancel={title === null ? undefined : () => setComposing(false)}
          />
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-2">
          <FormError message={error} />
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={reload}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </div>
      ) : scoped === null ? (
        <ThreadsSkeleton />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value === "resolved" ? "resolved" : "open")}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="open">
              Open <span className="tabular-nums text-muted-foreground">{open.length}</span>
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Resolved <span className="tabular-nums text-muted-foreground">{resolved.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="open" className="flex flex-col gap-3">
            {open.length === 0 ? (
              <EmptyState
                icon={MessageSquareIcon}
                title="No open threads"
                description={
                  startAllowed
                    ? "Start a thread to ask the company about a figure, or leave an internal note for ScaleUp."
                    : mode === "company"
                      ? "Questions from ScaleUp about this month appear here."
                      : "Nobody has raised anything on this month."
                }
                className="py-6"
              />
            ) : (
              open.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  mode={mode}
                  targetLabel={target ? undefined : targetLabelFor(thread.target, targetLabels)}
                  onChanged={onChanged}
                />
              ))
            )}
          </TabsContent>
          <TabsContent value="resolved" className="flex flex-col gap-3">
            {resolved.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No resolved threads yet.</p>
            ) : (
              resolved.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  mode={mode}
                  targetLabel={target ? undefined : targetLabelFor(thread.target, targetLabels)}
                  onChanged={onChanged}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

export type FieldCommentButtonProps = {
  submissionId: string;
  /** The field, segment or KPI cell the button belongs to (docs/ARCHITECTURE.md §2.5). */
  target: string;
  mode: CommentMode;
  canStartThreads: boolean;
  /** Threads on this target. */
  count?: number;
  /** Unresolved threads on this target. */
  unresolved?: number;
  /** Heading of the popover, e.g. "Gross profit" (default: a generic label for the target). */
  targetLabel?: string;
  /** This target's threads, loaded by the page. Omit to load them when the popover opens. */
  threads?: CommentThread[];
  className?: string;
};

/**
 * Small button next to a field, with the number of threads (highlighted while any is unresolved). It opens
 * a popover with the target's threads, replies, resolve and — for ScaleUp reviewers — a new-thread composer
 * (Shared by default, or ScaleUp only). Renders nothing for company users when the target has no threads.
 */
export function FieldCommentButton({
  submissionId,
  target,
  mode,
  canStartThreads,
  count = 0,
  unresolved = 0,
  targetLabel,
  threads: provided,
  className,
}: FieldCommentButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { threads, error, loading, reload, reset } = useCommentThreads(submissionId, { provided, enabled: open });

  const scoped = useMemo(() => (threads ? threadsForTarget(threads, target) : null), [threads, target]);
  const { open: openThreads, resolved } = useMemo(() => partitionThreads(scoped ?? []), [scoped]);
  const counts = scoped ? summariseThreads(scoped) : { total: count, unresolved };

  const startAllowed = canStartThreads && mode === "scaleup";
  const label = targetLabel ?? targetLabelFor(target);
  const onChanged = provided ? noop : reload;

  if (!startAllowed && counts.total === 0 && !open) return <></>;

  const summary =
    counts.total === 0
      ? `Comment on ${label}`
      : `${label}: ${counts.total} comment ${counts.total === 1 ? "thread" : "threads"}${
          counts.unresolved > 0 ? `, ${counts.unresolved} unresolved` : ", all resolved"
        }`;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && !provided) reset();
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={counts.total > 0 ? "xs" : "icon-xs"}
          aria-label={summary}
          title={summary}
          data-target={target}
          className={cn(
            "shrink-0 tabular-nums",
            counts.total === 0 && "text-muted-foreground/70 hover:text-foreground",
            counts.total > 0 && counts.unresolved === 0 && "text-muted-foreground",
            counts.unresolved > 0 && "bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning",
            className,
          )}
        >
          {counts.total === 0 ? <MessageSquarePlusIcon /> : <MessageSquareIcon data-icon="inline-start" />}
          {counts.total > 0 ? (counts.unresolved > 0 ? counts.unresolved : counts.total) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="min-w-0 truncate text-sm font-medium">{label}</p>
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {loading ? <Spinner className="size-3.5" /> : counts.total > 0 ? `${counts.unresolved} open · ${counts.total - counts.unresolved} resolved` : null}
          </p>
        </div>
        <div className="flex max-h-[min(30rem,60vh)] flex-col gap-3 overflow-y-auto p-3">
          {error ? (
            <div className="flex flex-col gap-2">
              <FormError message={error} />
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={reload}>
                <RefreshCwIcon data-icon="inline-start" />
                Try again
              </Button>
            </div>
          ) : scoped === null ? (
            <ThreadsSkeleton />
          ) : (
            <>
              {openThreads.length === 0 && resolved.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {startAllowed ? "No comments yet. Start a thread below." : "No comments on this field."}
                </p>
              ) : null}
              {openThreads.map((thread) => (
                <ThreadCard key={thread.id} thread={thread} mode={mode} onChanged={onChanged} />
              ))}
              {resolved.length > 0 ? (
                <Collapsible defaultOpen={openThreads.length === 0}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="xs" className="-ml-1.5 text-muted-foreground">
                      {resolved.length} resolved {resolved.length === 1 ? "thread" : "threads"}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 flex flex-col gap-3">
                    {resolved.map((thread) => (
                      <ThreadCard key={thread.id} thread={thread} mode={mode} onChanged={onChanged} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </>
          )}
          {startAllowed ? (
            <div className={cn(scoped && scoped.length > 0 && "border-t pt-3")}>
              <CommentComposer
                submissionId={submissionId}
                fixedTarget={target}
                allowVisibility
                placeholder={`Comment on ${label}…`}
                submitLabel="Post comment"
                autoFocus={counts.total === 0}
                onPosted={onChanged}
              />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
