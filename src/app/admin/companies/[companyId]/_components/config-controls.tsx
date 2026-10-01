"use client";

// Building blocks of the configuration editors (revenue lines, KPIs, dimensions): running a row action
// with a toast, move up/down buttons, a rename dialog and an inline "add" form.

import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";
import { cn } from "@/lib/utils";

import { describedBy, TextField } from "../../_components/form-controls";
import { configNameSchema, LIMITS } from "../../_components/schemas";

/**
 * Runs one row action at a time (move, activate, delete…) and reports the outcome in a toast.
 * `pendingKey` names the running action, e.g. "move:<id>", to show a spinner on the right button.
 */
export function useRowAction() {
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const run = useCallback(
    (key: string, action: () => Promise<ActionResult<unknown>>, successMessage?: string) => {
      setPendingKey(key);
      startTransition(async () => {
        try {
          const result = await action();
          if (!result.ok) toast.error(result.fieldErrors?.name ?? result.error);
          else if (successMessage) toast.success(successMessage);
        } catch {
          toast.error(MESSAGES.network);
        } finally {
          setPendingKey(null);
        }
      });
    },
    [],
  );

  return { pending, pendingKey, run };
}

/** "Move up" / "Move down" icon buttons for a row. */
export function OrderButtons({
  name,
  canMoveUp,
  canMoveDown,
  disabled,
  onMove,
}: {
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !canMoveUp}
        onClick={() => onMove("up")}
        aria-label={`Move ${name} up`}
        title="Move up"
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || !canMoveDown}
        onClick={() => onMove("down")}
        aria-label={`Move ${name} down`}
        title="Move down"
      >
        <ArrowDownIcon />
      </Button>
    </div>
  );
}

/** A dialog with one name field, to rename an item (open it with a fresh `key` each time). */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Name",
  initialName,
  submitLabel = "Save",
  successMessage,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  initialName: string;
  submitLabel?: string;
  successMessage: (name: string) => string;
  onSubmit: (name: string) => Promise<ActionResult<unknown>>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<{ field: string | null; form: string | null }>({ field: null, form: null });
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = configNameSchema.safeParse(name);
    if (!checked.success) {
      setError({ field: checked.error.issues[0]?.message ?? MESSAGES.invalid, form: null });
      return;
    }
    if (checked.data === initialName.trim()) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      try {
        const result = await onSubmit(checked.data);
        if (!result.ok) {
          const fieldMessage = result.fieldErrors?.name ?? null;
          setError({ field: fieldMessage, form: fieldMessage ? null : result.error });
          return;
        }
        toast.success(successMessage(checked.data));
        onOpenChange(false);
      } catch {
        setError({ field: null, form: MESSAGES.network });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError message={error.form} />
          <TextField
            id="name-dialog-name"
            label={label}
            value={name}
            onValueChange={(value) => {
              setName(value);
              if (error.field) setError({ field: null, form: null });
            }}
            error={error.field}
            maxLength={LIMITS.configName}
            autoComplete="off"
            autoFocus
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** An inline "add" form: one name input and a button; clears itself after a successful add. */
export function AddNameForm({
  id,
  label,
  placeholder,
  buttonLabel,
  successMessage,
  onAdd,
  className,
}: {
  id: string;
  label: string;
  placeholder?: string;
  buttonLabel: string;
  successMessage: (name: string) => string;
  onAdd: (name: string) => Promise<ActionResult<unknown>>;
  className?: string;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = `${id}-error`;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = configNameSchema.safeParse(name);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? MESSAGES.invalid);
      return;
    }
    startTransition(async () => {
      try {
        const result = await onAdd(checked.data);
        if (!result.ok) {
          setError(result.fieldErrors?.name ?? result.error);
          return;
        }
        setName("");
        setError(null);
        toast.success(successMessage(checked.data));
      } catch {
        setError(MESSAGES.network);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-col gap-1.5", className)}>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id} className="sr-only">
          {label}
        </FieldLabel>
        <div className="flex gap-2">
          <Input
            id={id}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            placeholder={placeholder}
            maxLength={LIMITS.configName}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(error && errorId)}
          />
          <Button type="submit" variant="outline" disabled={pending} className="shrink-0">
            {pending ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
            {buttonLabel}
          </Button>
        </div>
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      </Field>
    </form>
  );
}
