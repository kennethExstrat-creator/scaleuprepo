"use client";

import { useId, useState, useTransition } from "react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";

import { updateCycleSettingsAction } from "../actions";
import { ordinal, plural } from "../_lib/cycles-model";
import { CYCLE_SETTINGS_LIMITS, cycleSettingsSchema } from "../_lib/schemas";

type FieldKey = "dueDay" | "graceDays" | "escalationDays";
type Errors = Partial<Record<FieldKey | "form", string | null>>;

/** A whole number typed into a box (NaN when it is not one, so the schema explains). */
function wholeNumber(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * "Change cycle settings" on /admin/cycles (BRD A5 "set the due day", B10): Super Admins and Fund Admins set
 * the day months are due, the grace period of months that open late or are sent back, and when overdue
 * months escalate (set_cycle_settings). Months already open keep their due dates. Mount with a new `key`
 * per opening.
 */
export function CycleSettingsDialog({
  open,
  onOpenChange,
  dueDay,
  graceDays,
  escalationDays,
  updatedAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dueDay: number;
  graceDays: number;
  escalationDays: number;
  /** platform_settings.updated_at when the page loaded (lost-update guard). */
  updatedAt: string | null;
}) {
  const id = useId();
  const [text, setText] = useState<Record<FieldKey, string>>({
    dueDay: String(dueDay),
    graceDays: String(graceDays),
    escalationDays: String(escalationDays),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const L = CYCLE_SETTINGS_LIMITS;

  const fieldId = (key: FieldKey) => `${id}-${key}`;
  const helpId = (key: FieldKey) => `${id}-${key}-help`;
  const errorId = (key: FieldKey) => `${id}-${key}-error`;
  const describedBy = (key: FieldKey) => (errors[key] ? `${helpId(key)} ${errorId(key)}` : helpId(key));

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function update(key: FieldKey, value: string) {
    setText((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: null, form: null }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = cycleSettingsSchema.safeParse({
      dueDay: wholeNumber(text.dueDay),
      graceDays: wholeNumber(text.graceDays),
      escalationDays: wholeNumber(text.escalationDays),
      expectedUpdatedAt: updatedAt,
    });
    if (!checked.success) {
      const next: Errors = {};
      for (const issue of checked.error.issues) {
        const field = issue.path[0];
        if (field === "dueDay" || field === "graceDays" || field === "escalationDays") {
          if (!next[field]) next[field] = issue.message;
        } else if (!next.form) {
          next.form = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    const values = checked.data;
    if (values.dueDay === dueDay && values.graceDays === graceDays && values.escalationDays === escalationDays) {
      onOpenChange(false);
      return;
    }
    setErrors({});
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updateCycleSettingsAction>>;
      try {
        result = await updateCycleSettingsAction(values);
      } catch {
        setErrors({ form: MESSAGES.network });
        return;
      }
      if (!result.ok) {
        setErrors({ form: result.error });
        return;
      }
      toast.success("Cycle settings saved", {
        description: `Months opened from now on are due on the ${ordinal(values.dueDay)} of the following month.`,
      });
      onOpenChange(false);
    });
  }

  const fields: { key: FieldKey; label: string; unit: string; help: string; min: number; max: number }[] = [
    {
      key: "dueDay",
      label: "Due day",
      unit: "of the next month",
      help: `Each month's numbers are due on this day of the following month (now the ${ordinal(dueDay)}). Applies to months that open after you save; months already open keep their due dates.`,
      min: L.dueDay.min,
      max: L.dueDay.max,
    },
    {
      key: "graceDays",
      label: "Grace period",
      unit: "days",
      help: `A month that opens after its normal due date, or is sent back for changes, gets at least this long (now ${plural(graceDays, "day")}).`,
      min: L.graceDays.min,
      max: L.graceDays.max,
    },
    {
      key: "escalationDays",
      label: "Escalate after",
      unit: "days overdue",
      help: `Overdue months escalate to the partner-in-charge after this many days (now ${plural(escalationDays, "day")}).`,
      min: L.escalationDays.min,
      max: L.escalationDays.max,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cycle settings</DialogTitle>
          <DialogDescription>
            When monthly updates are due and when late ones escalate. The change is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError id={`${id}-form-error`} message={errors.form} />
          {fields.map((field) => (
            <Field key={field.key} data-invalid={errors[field.key] ? true : undefined}>
              <FieldLabel htmlFor={fieldId(field.key)}>{field.label}</FieldLabel>
              <InputGroup className="max-w-56">
                <InputGroupInput
                  id={fieldId(field.key)}
                  inputMode="numeric"
                  autoComplete="off"
                  value={text[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                  aria-invalid={errors[field.key] ? true : undefined}
                  aria-describedby={describedBy(field.key)}
                  disabled={pending}
                  className="tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{field.unit}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription id={helpId(field.key)}>
                {field.help} From {field.min} to {field.max}.
              </FieldDescription>
              {errors[field.key] ? <FieldError id={errorId(field.key)}>{errors[field.key]}</FieldError> : null}
            </Field>
          ))}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save settings
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
