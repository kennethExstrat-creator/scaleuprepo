"use client";

import { LockIcon, UsersIcon } from "lucide-react";
import { useId, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addComment } from "@/lib/actions/comments";
import { formatNumber } from "@/lib/format";
import { GENERAL_TARGET } from "@/lib/targets";
import type { CommentVisibility } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { COMMENT_MAX_LENGTH } from "./model";
import { GENERAL_TARGET_LABEL, groupTargetOptions, type TargetOption } from "./target-labels";

type ComposerProps = {
  submissionId: string;
  /** Reply to this thread (root comment id). Without it the composer starts a new thread. */
  parentId?: string;
  /** New thread on a fixed target (a field's popover). */
  fixedTarget?: string;
  /** New thread: the targets to choose from, grouped in order of appearance ('General' is always offered; ignored with `fixedTarget`). */
  targetOptions?: TargetOption[];
  /** New thread: offer Shared / ScaleUp only (ScaleUp staff). */
  allowVisibility?: boolean;
  placeholder?: string;
  submitLabel: string;
  autoFocus?: boolean;
  /** After a successful post (e.g. reload threads, close the composer). */
  onPosted?: () => void;
  onCancel?: () => void;
  className?: string;
};

/** Textarea + post button for a new thread (optional target and visibility) or a reply. Ctrl/⌘ + Enter posts. */
export function CommentComposer({
  submissionId,
  parentId,
  fixedTarget,
  targetOptions,
  allowVisibility = false,
  placeholder,
  submitLabel,
  autoFocus,
  onPosted,
  onCancel,
  className,
}: ComposerProps) {
  const ids = useId();
  const bodyId = `${ids}-body`;
  const errorId = `${ids}-error`;
  const hintId = `${ids}-hint`;
  const isReply = parentId !== undefined;
  const choosesTarget = !isReply && fixedTarget === undefined && (targetOptions?.length ?? 0) > 1;

  const [body, setBody] = useState("");
  const [target, setTarget] = useState<string>(fixedTarget ?? GENERAL_TARGET);
  const [visibility, setVisibility] = useState<CommentVisibility>("shared");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = body.trim();
  const tooLong = body.length > COMMENT_MAX_LENGTH;
  const canPost = trimmed.length > 0 && !tooLong && !pending;

  function post() {
    if (!canPost) {
      if (trimmed.length === 0) setError("Write a comment first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addComment(
        isReply
          ? { submissionId, parentId, body: trimmed }
          : { submissionId, body: trimmed, target: fixedTarget ?? target, visibility: allowVisibility ? visibility : "shared" },
      );
      if (!result.ok) {
        const fieldError = result.fieldErrors ? (result.fieldErrors.body ?? Object.values(result.fieldErrors)[0]) : undefined;
        setError(fieldError ?? result.error);
        return;
      }
      setBody("");
      toast.success(isReply ? "Reply posted" : visibility === "internal" && allowVisibility ? "Internal note added" : "Comment added");
      onPosted?.();
    });
  }

  // The composer often sits in a popover whose React parent is a page form (the monthly form): React events
  // bubble through portals, so the events handled here must not reach that form.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    post();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      post();
    } else if (event.key === "Escape" && onCancel && body === "") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  const groups = choosesTarget ? groupTargetOptions(targetOptions ?? []) : [];

  const describedBy = [error ? errorId : null, hintId].filter(Boolean).join(" ");

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-2", className)} noValidate>
      {choosesTarget ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${ids}-target`} className="text-xs text-muted-foreground">
            About
          </FieldLabel>
          <Select value={target} onValueChange={setTarget} disabled={pending}>
            <SelectTrigger id={`${ids}-target`} size="sm" className="w-full">
              <SelectValue placeholder="Choose what the comment is about" />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              {groups.map(({ group, options }) => (
                <SelectGroup key={group}>
                  {group !== GENERAL_TARGET_LABEL ? <SelectLabel>{group}</SelectLabel> : null}
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <Field data-invalid={error ? true : undefined} className="gap-1.5">
        <FieldLabel htmlFor={bodyId} className="sr-only">
          {isReply ? "Your reply" : "Your comment"}
        </FieldLabel>
        <Textarea
          id={bodyId}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? (isReply ? "Write a reply…" : "Write a comment…")}
          rows={isReply ? 2 : 3}
          maxLength={COMMENT_MAX_LENGTH + 500}
          disabled={pending}
          autoFocus={autoFocus}
          aria-invalid={error || tooLong ? true : undefined}
          aria-describedby={describedBy}
          className="max-h-60 min-h-14 text-sm"
        />
        {error ? (
          <FieldError id={errorId} className="text-xs">
            {error}
          </FieldError>
        ) : null}
      </Field>

      {!isReply && allowVisibility ? (
        <div className="flex flex-col gap-1">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={visibility}
            onValueChange={(value) => {
              if (value === "shared" || value === "internal") setVisibility(value);
            }}
            aria-label="Who can see this thread"
            disabled={pending}
          >
            <ToggleGroupItem value="shared" aria-label="Shared with the company">
              <UsersIcon data-icon="inline-start" />
              Shared
            </ToggleGroupItem>
            <ToggleGroupItem value="internal" aria-label="ScaleUp only">
              <LockIcon data-icon="inline-start" />
              ScaleUp only
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription className="text-xs">
            {visibility === "internal"
              ? "Internal note: only ScaleUp can see this thread."
              : "The company can see this thread and reply to it."}
          </FieldDescription>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} className={cn("text-xs text-muted-foreground", tooLong && "text-destructive")}>
          {body.length > COMMENT_MAX_LENGTH - 500 ? (
            `${formatNumber(body.length)} / ${formatNumber(COMMENT_MAX_LENGTH)} characters`
          ) : (
            <span className="hidden sm:inline">
              <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> to post
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={!canPost} aria-busy={pending || undefined}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
