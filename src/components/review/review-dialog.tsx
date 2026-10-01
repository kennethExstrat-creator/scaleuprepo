"use client";

import type { ComponentProps, FormEvent, KeyboardEvent, ReactNode } from "react";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submitLabel: string;
  submitVariant?: ComponentProps<typeof Button>["variant"];
  /** Disables the submit button (e.g. a required field is empty). */
  canSubmit: boolean;
  pending: boolean;
  /** Form-level error (field errors are shown by the fields). */
  error: string | null;
  onSubmit: () => void;
  className?: string;
};

/**
 * Dialog with a form for a review action. While `pending` it cannot be dismissed. Submits with the button or
 * Ctrl/⌘ + Enter in a text area (see MessageField).
 */
export function ReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  submitLabel,
  submitVariant = "default",
  canSubmit,
  pending,
  error,
  onSubmit,
  className,
}: ReviewDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation(); // React events bubble through the portal to the page
    if (canSubmit && !pending) onSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent
        className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg", className)}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onInteractOutside={(event) => pending && event.preventDefault()}
        showCloseButton={!pending}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={submitVariant} disabled={!canSubmit || pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type MessageFieldProps = {
  id: string;
  label: string;
  description?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  required?: boolean;
  error?: string | null;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Ctrl/⌘ + Enter. */
  onSubmitShortcut?: () => void;
};

/** Labelled text area with a character counter near the limit and an accessible error. */
export function MessageField({
  id,
  label,
  description,
  value,
  onChange,
  maxLength,
  required,
  error,
  placeholder,
  rows = 4,
  disabled,
  autoFocus,
  onSubmitShortcut,
}: MessageFieldProps) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const tooLong = value.length > maxLength;
  const showCounter = value.length > maxLength * 0.8;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (onSubmitShortcut && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      onSubmitShortcut();
    }
  }

  return (
    <Field data-invalid={error || tooLong ? true : undefined} className="gap-1.5">
      <FieldLabel htmlFor={id}>
        {label}
        {required ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
      </FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength + 500}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error || tooLong ? true : undefined}
        aria-describedby={[error ? errorId : null, description ? descriptionId : null].filter(Boolean).join(" ") || undefined}
        className="max-h-72 min-h-24"
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {description || showCounter ? (
        <div className="flex items-start justify-between gap-3">
          {description ? (
            <FieldDescription id={descriptionId} className="text-xs">
              {description}
            </FieldDescription>
          ) : (
            <span />
          )}
          {showCounter ? (
            <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", tooLong && "text-destructive")}>
              {formatNumber(value.length)} / {formatNumber(maxLength)}
            </span>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}
