"use client";

import type { ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Accessible form fields for the access-management dialogs (Users and Team pages): a label, the
// control, an optional hint and the field's error, wired together with aria-describedby.

function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list === "" ? undefined : list;
}

function OptionalMark() {
  return <span className="font-normal text-muted-foreground">(optional)</span>;
}

export function TextField({
  id,
  name,
  label,
  type = "text",
  defaultValue,
  error,
  description,
  optional = false,
  autoComplete,
  inputMode,
  maxLength = 200,
  placeholder,
  autoFocus,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  type?: "text" | "email";
  defaultValue?: string;
  error?: string;
  description?: ReactNode;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "email";
  maxLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <OptionalMark /> : null}
      </FieldLabel>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={!optional}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={type === "email" ? false : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(description ? descriptionId : null, error ? errorId : null)}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** A select that also submits with the form (`name`), controlled by `value` / `onValueChange`. */
export function SelectField({
  id,
  name,
  label,
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  error,
  description,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  error?: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select name={name} value={value} onValueChange={onValueChange} disabled={disabled} required>
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(description ? descriptionId : null, error ? errorId : null)}
        >
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
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

/** Reads a text field from a submitted form (missing → ""). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
