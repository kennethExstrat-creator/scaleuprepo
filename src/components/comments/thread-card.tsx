"use client";

import { CheckCircle2Icon, CornerDownRightIcon, LockIcon, ReplyIcon, RotateCcwIcon, UsersIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { setCommentResolved } from "@/lib/actions/comments";
import { COMMENT_VISIBILITY_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

import { CommentComposer } from "./comment-composer";
import { authorInitials } from "./model";
import { RelativeTime } from "./relative-time";
import type { CommentAuthor, CommentMessage, CommentMode, CommentThread } from "./types";

/** "ScaleUp only" (internal) or "Shared" (visible to the company) — ScaleUp staff only need to see it. */
export function VisibilityBadge({ visibility }: { visibility: CommentThread["visibility"] }) {
  if (visibility === "internal") {
    return (
      <ToneBadge tone="warning" title={COMMENT_VISIBILITY_META.internal.description}>
        <LockIcon className="size-3" aria-hidden="true" />
        ScaleUp only
      </ToneBadge>
    );
  }
  return (
    <ToneBadge tone="neutral" title={COMMENT_VISIBILITY_META.shared.description}>
      <UsersIcon className="size-3" aria-hidden="true" />
      Shared
    </ToneBadge>
  );
}

function AuthorAvatar({ author }: { author: CommentAuthor }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold",
        author.side === "scaleup" ? "bg-primary/10 text-primary" : "bg-muted text-foreground/70",
      )}
    >
      {authorInitials(author.name)}
    </span>
  );
}

function Message({ message, reply = false }: { message: CommentMessage; reply?: boolean }) {
  const { author } = message;
  return (
    <div className={cn("flex gap-2", reply && "pl-1")}>
      {reply ? <CornerDownRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" /> : null}
      <AuthorAvatar author={author} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs leading-5">
          <span className="font-medium text-foreground">
            {author.name}
            {author.isViewer ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
          </span>
          {author.roleLabel ? <span className="text-muted-foreground">{author.roleLabel}</span> : null}
          <span aria-hidden="true" className="text-muted-foreground/60">
            ·
          </span>
          <RelativeTime value={message.createdAt} className="text-muted-foreground" />
        </p>
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{message.body}</p>
      </div>
    </div>
  );
}

export type ThreadCardProps = {
  thread: CommentThread;
  mode: CommentMode;
  /** Shown as the thread's heading (e.g. "Gross profit"); omit inside a field's own popover. */
  targetLabel?: string;
  /** Called after a reply or a resolve/reopen succeeded (reload threads that the page did not provide). */
  onChanged?: () => void;
  className?: string;
};

/** One thread: target and visibility, the messages, reply and resolve / reopen. */
export function ThreadCard({ thread, mode, targetLabel, onChanged, className }: ThreadCardProps) {
  const [replying, setReplying] = useState(false);
  const [pending, startTransition] = useTransition();
  const replyCount = thread.replies.length;

  function toggleResolved() {
    startTransition(async () => {
      const result = await setCommentResolved(thread.id, !thread.resolved);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(thread.resolved ? "Thread reopened" : "Thread resolved");
      onChanged?.();
    });
  }

  const resolveButton = thread.canResolve ? (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={toggleResolved}
      disabled={pending}
      className={cn("shrink-0", !thread.resolved && "text-success hover:text-success")}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : thread.resolved ? (
        <RotateCcwIcon data-icon="inline-start" />
      ) : (
        <CheckCircle2Icon data-icon="inline-start" />
      )}
      {thread.resolved ? "Reopen" : "Resolve"}
    </Button>
  ) : null;

  return (
    <article
      aria-label={`${targetLabel ? `${targetLabel}: ` : ""}comment thread${thread.resolved ? " (resolved)" : ""}`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3",
        thread.resolved && "bg-muted/30",
        thread.visibility === "internal" && mode === "scaleup" && "border-warning/30",
        className,
      )}
    >
      {targetLabel || mode === "scaleup" ? (
        <header className="flex min-w-0 flex-wrap items-center gap-1.5">
          {targetLabel ? <span className="min-w-0 truncate text-xs font-medium text-foreground/80">{targetLabel}</span> : null}
          {mode === "scaleup" ? <VisibilityBadge visibility={thread.visibility} /> : null}
        </header>
      ) : null}

      <div className="flex flex-col gap-3">
        <Message message={thread.root} />
        {replyCount > 0 ? (
          <ol aria-label={`${replyCount} ${replyCount === 1 ? "reply" : "replies"}`} className="ml-3 flex flex-col gap-3 border-l pl-3">
            {thread.replies.map((reply) => (
              <li key={reply.id}>
                <Message message={reply} reply />
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {thread.resolved ? (
        <footer className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex flex-wrap items-center gap-1 text-xs text-success">
            <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
            Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy.isViewer ? "you" : thread.resolvedBy.name}` : ""}
            {thread.resolvedAt ? (
              <>
                <span aria-hidden="true">·</span>
                <RelativeTime value={thread.resolvedAt} />
              </>
            ) : null}
          </p>
          {resolveButton}
        </footer>
      ) : replying ? (
        <CommentComposer
          submissionId={thread.submissionId}
          parentId={thread.id}
          submitLabel="Reply"
          autoFocus
          onPosted={() => {
            setReplying(false);
            onChanged?.();
          }}
          onCancel={() => setReplying(false)}
        />
      ) : thread.canReply || resolveButton ? (
        <footer className="flex items-center justify-between gap-2">
          {thread.canReply ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => setReplying(true)} className="-ml-1.5 text-muted-foreground">
              <ReplyIcon data-icon="inline-start" />
              Reply
            </Button>
          ) : (
            <span />
          )}
          {resolveButton}
        </footer>
      ) : null}
    </article>
  );
}
