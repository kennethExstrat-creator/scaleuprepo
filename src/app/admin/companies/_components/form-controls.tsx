"use client";

// Small labelled form controls for the M1 forms (companies, funds): a label, the control, an optional
// description and the field's error, wired together with aria-invalid / aria-describedby.

import * as React from "react";
import type { z } from "zod";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";

/** Joins the ids of the descriptions that apply, for aria-describedby. */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list === "" ? undefined : list;
}

/** Errors of a failed action: the form-level message and one message per field (dotted path). */
export type FormErrors = { form: string | null; fields: Record<string, string> };
export const NO_ERRORS: FormErrors = { form: null, fields: {} };

/** The errors to show for an action result (none when it succeeded). */
export function errorsOf(result: ActionResult<unknown>): FormErrors {
  if (result.ok) return NO_ERRORS;
  return { form: result.error, fields: result.fieldErrors ?? {} };
}

/**
 * The same errors from a failed client-side check with the action's own schema (instant feedback;
 * the action validates again): the first message per field, like toActionError.
 */
export function zodErrors(error: z.ZodError): FormErrors {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return { form: MESSAGES.invalid, fields };
}

/**
 * The form-level message worth showing: the generic "check the highlighted fields" only when no field
 * shows an error itself (e.g. a single-input form shows just the field error).
 */
export function formMessage(errors: FormErrors, visibleFields: readonly string[]): string | null {
  if (!errors.form) return null;
  const shown = visibleFields.some((field) => errors.fields[field]);
  if (errors.form === MESSAGES.invalid && shown) return null;
  if (errors.form === MESSAGES.invalid && Object.keys(errors.fields).length > 0) {
    return Object.values(errors.fields)[0] ?? errors.form;
  }
  return errors.form;
}

/**
 * State of a dialog that edits one item at a time: `show(item)` opens it for that item (null = a new
 * one) with a fresh `key`, so the form inside starts from the item's values every time it opens, and
 * closing keeps it mounted for the exit animation.
 */
export function useDialogState<T>() {
  const [state, setState] = React.useState<{ session: number; item: T | null; open: boolean }>({
    session: 0,
    item: null,
    open: false,
  });
  const show = React.useCallback(
    (item: T | null) => setState((current) => ({ session: current.session + 1, item, open: true })),
    [],
  );
  const setOpen = React.useCallback((open: boolean) => setState((current) => ({ ...current, open })), []);
  return { key: state.session, item: state.item, open: state.open, show, setOpen };
}

type LabelledProps = {
  id: string;
  label: React.ReactNode;
  error?: string | null;
  description?: React.ReactNode;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  className?: string;
};

function FieldLabelText({ id, label, optional }: Pick<LabelledProps, "id" | "label" | "optional">) {
  return (
    <FieldLabel htmlFor={id}>
      {label}
      {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
    </FieldLabel>
  );
}

function FieldFooter({ id, error, description }: Pick<LabelledProps, "id" | "error" | "description">) {
  return (
    <>
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </>
  );
}

function ariaFor({ id, error, description }: Pick<LabelledProps, "id" | "error" | "description">) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(description ? `${id}-description` : null, error ? `${id}-error` : null),
  } as const;
}

export function TextField({
  id,
  label,
  error,
  description,
  optional,
  className,
  value,
  onValueChange,
  ...inputProps
}: LabelledProps & {
  value: string;
  onValueChange: (value: string) => void;
} & Omit<React.ComponentProps<"input">, "id" | "value" | "onChange" | "className">) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabelText id={id} label={label} optional={optional} />
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...ariaFor({ id, error, description })}
        {...inputProps}
      />
      <FieldFooter id={id} error={error} description={description} />
    </Field>
  );
}

export function TextAreaField({
  id,
  label,
  error,
  description,
  optional,
  className,
  value,
  onValueChange,
  ...textareaProps
}: LabelledProps & {
  value: string;
  onValueChange: (value: string) => void;
} & Omit<React.ComponentProps<"textarea">, "id" | "value" | "onChange" | "className">) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabelText id={id} label={label} optional={optional} />
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        {...ariaFor({ id, error, description })}
        {...textareaProps}
      />
      <FieldFooter id={id} error={error} description={description} />
    </Field>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** A Radix Select with a label. Option values must not be "" (use a sentinel such as "none"). */
export function SelectField({
  id,
  label,
  error,
  description,
  optional,
  className,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
}: LabelledProps & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabelText id={id} label={label} optional={optional} />
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" {...ariaFor({ id, error, description })}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldFooter id={id} error={error} description={description} />
    </Field>
  );
}
