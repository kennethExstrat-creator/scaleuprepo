"use client";

import * as React from "react";

import { FormError } from "@/components/app/form-error";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Label of the confirm button (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions. */
  destructive?: boolean;
  /** Show a reason textarea; confirm stays disabled until it has text. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /**
   * Called with the trimmed reason (when `requireReason`). While the returned promise is
   * pending both buttons are disabled and the dialog cannot be dismissed. Resolve to close
   * the dialog; throw an Error to keep it open and show `error.message` inline.
   */
  onConfirm: (reason?: string) => Promise<void> | void;
};

/**
 * Controlled confirmation dialog with an optional required reason, e.g.
 * `<ConfirmDialog open={open} onOpenChange={setOpen} title="Reopen September 2026?" requireReason
 *   reasonLabel="Reason" confirmLabel="Reopen" onConfirm={async (reason) => { … }} />`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reasonId = React.useId();

  const trimmedReason = reason.trim();
  const canConfirm = !pending && (!requireReason || trimmedReason.length > 0);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(requireReason ? trimmedReason : undefined);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="sm:max-w-md" onEscapeKeyDown={(event) => pending && event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {requireReason ? (
          <Field>
            <FieldLabel htmlFor={reasonId}>{reasonLabel}</FieldLabel>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              maxLength={2000}
              rows={3}
              disabled={pending}
              required
            />
          </Field>
        ) : null}

        <FormError message={error} />

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-busy={pending || undefined}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
