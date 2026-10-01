"use client";

import { CheckIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumberInput } from "@/lib/format";
import { cn } from "@/lib/utils";

import { isNegativeText, normaliseTags, parseNumberField, toggleSignText } from "./draft";

/** ARIA wiring shared by every control. */
export type ControlAria = {
  id: string;
  /** Space-separated ids of the help text and error message. */
  describedBy?: string;
  invalid?: boolean;
  /** Accessible name when there is no visible <label for> (table cells, groups). */
  ariaLabel?: string;
  ariaLabelledBy?: string;
};

const SELECTED_TOGGLE =
  "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90";

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export type NumberInputProps = ControlAria & {
  value: number | null;
  /** Called with the parsed (and rounded) number, or null when the box is cleared. */
  onValueChange: (value: number | null) => void;
  /** Called with a message while the text cannot be read as a number (null once it can). */
  onInvalidChange: (message: string | null) => void;
  onBlur?: () => void;
  /** Refuse decimals (whole-number KPIs, which the database refuses to store otherwise). */
  integer?: boolean;
  /** Decimals kept (4 for values and KPIs, 2 for revenue segments). */
  scale?: number;
  /** Accept a trailing '%'. */
  percent?: boolean;
  /** Shown before the number, e.g. 'RM'. */
  prefix?: string;
  /** Shown after the number, e.g. '%' or 'cameras'. */
  suffix?: string;
  /**
   * The value may be negative (gross and net profit, KPIs, …): adds a ± button that switches the sign,
   * because the decimal keypad of iPhones has no minus key. On a keyboard '-' or '(1,000)' work as well.
   */
  allowNegative?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * A text box for numbers (inputMode decimal, the phone keypad for numbers): accepts '1,234.50',
 * 'RM 1,234' or '(1,000)'; shows the number with thousands separators when not being edited
 * (formatNumberInput); keeps unreadable text on screen with a message instead of saving it. With
 * `allowNegative`, a ± button switches the sign.
 */
export function NumberInput({
  id,
  describedBy,
  invalid,
  ariaLabel,
  ariaLabelledBy,
  value,
  onValueChange,
  onInvalidChange,
  onBlur,
  integer,
  scale,
  percent,
  prefix,
  suffix,
  allowNegative,
  placeholder,
  className,
}: NumberInputProps) {
  // The raw text while the box is being edited (or while it holds text that cannot be read).
  const [text, setText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = { integer, scale, percent };
  const shown = text ?? formatNumberInput(value);

  /** New text in the box: kept as typed, and saved once it reads as a number (else reported). */
  const change = (raw: string) => {
    setText(raw);
    const parsed = parseNumberField(raw, options);
    if (parsed.ok) {
      onInvalidChange(null);
      if (parsed.value !== value) onValueChange(parsed.value);
    } else {
      onInvalidChange(parsed.message);
    }
  };

  const toggleSign = () => {
    change(toggleSignText(shown));
    // Carry on typing in the box (the phone keypad stays open).
    inputRef.current?.focus();
  };

  return (
    <InputGroup className={cn("bg-background", className)}>
      {prefix ? (
        <InputGroupAddon>
          <InputGroupText className="text-xs">{prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      <InputGroupInput
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={shown}
        onFocus={() => setText((current) => current ?? formatNumberInput(value))}
        onChange={(event) => change(event.target.value)}
        onBlur={() => {
          if (text !== null && parseNumberField(text, options).ok) setText(null);
          onBlur?.();
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="text-right tabular-nums"
      />
      {suffix ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {allowNegative ? (
        <InputGroupAddon align="inline-end">
          {/* Out of the tab order: keyboards have a minus key. */}
          <InputGroupButton
            size="icon-xs"
            tabIndex={-1}
            aria-label="Negative number"
            aria-pressed={isNegativeText(shown)}
            title="Switch between positive and negative"
            className="text-sm aria-pressed:bg-muted aria-pressed:text-foreground"
            // Keeps the focus, and the phone keypad, in the box.
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggleSign}
          >
            ±
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

// ---------------------------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------------------------

function range(min: number, max: number): number[] {
  const from = Math.ceil(Math.min(min, max));
  const to = Math.floor(Math.max(min, max));
  const values: number[] = [];
  for (let n = from; n <= to && values.length < 11; n++) values.push(n);
  return values;
}

export type RatingInputProps = ControlAria & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min: number;
  max: number;
  /** Labels by value from the field options, e.g. { '1': 'Very low', '5': 'Very high' }. */
  labels: Record<string, string>;
  onBlur?: () => void;
};

/** Segmented 1–5 (min–max) buttons; choosing the selected value again clears it. */
export function RatingInput({
  id,
  describedBy,
  ariaLabelledBy,
  value,
  onValueChange,
  min,
  max,
  labels,
  onBlur,
}: RatingInputProps) {
  const values = range(min, max);
  const low = labels[String(values[0])];
  const high = labels[String(values[values.length - 1])];
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5" onBlur={onBlur}>
      <ToggleGroup
        id={id}
        type="single"
        variant="outline"
        spacing={0}
        value={value === null ? "" : String(value)}
        onValueChange={(next) => onValueChange(next === "" ? null : Number(next))}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={describedBy || undefined}
        className="w-full"
      >
        {values.map((n) => {
          const label = labels[String(n)];
          return (
            <ToggleGroupItem
              key={n}
              value={String(n)}
              aria-label={label ? `${n}: ${label}` : String(n)}
              title={label}
              className={cn("h-9 flex-1 tabular-nums", SELECTED_TOGGLE)}
            >
              {n}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {low || high ? (
        <div className="flex justify-between gap-2 text-xs text-muted-foreground" aria-hidden="true">
          <span>{low ? `${values[0]} = ${low}` : ""}</span>
          <span className="text-right">{high ? `${values[values.length - 1]} = ${high}` : ""}</span>
        </div>
      ) : null}
    </div>
  );
}

export type YesNoInputProps = ControlAria & {
  value: boolean | null;
  onValueChange: (value: boolean | null) => void;
  onBlur?: () => void;
  size?: "sm" | "default";
};

/** Yes / No buttons; choosing the selected answer again clears it. */
export function YesNoInput({
  id,
  describedBy,
  ariaLabel,
  ariaLabelledBy,
  value,
  onValueChange,
  onBlur,
  size = "default",
}: YesNoInputProps) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      variant="outline"
      spacing={0}
      size={size}
      value={value === null ? "" : value ? "yes" : "no"}
      onValueChange={(next) => onValueChange(next === "" ? null : next === "yes")}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={describedBy || undefined}
      onBlur={onBlur}
    >
      <ToggleGroupItem value="yes" className={cn("min-w-14", SELECTED_TOGGLE)}>
        Yes
      </ToggleGroupItem>
      <ToggleGroupItem value="no" className={cn("min-w-14", SELECTED_TOGGLE)}>
        No
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export type TagsInputProps = ControlAria & {
  value: string[];
  options: string[];
  onValueChange: (value: string[]) => void;
  onBlur?: () => void;
};

/** Toggle chips for a tags field (any number of the listed options). */
export function TagsInput({ id, describedBy, ariaLabelledBy, value, options, onValueChange, onBlur }: TagsInputProps) {
  // Tags saved earlier that are no longer listed stay visible (and can be removed).
  const choices = [...options, ...value.filter((tag) => !options.includes(tag))];
  return (
    <ToggleGroup
      id={id}
      type="multiple"
      variant="outline"
      size="sm"
      spacing={2}
      value={value}
      onValueChange={(next) => onValueChange(normaliseTags(next, options))}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={describedBy || undefined}
      className="flex-wrap"
      onBlur={onBlur}
    >
      {choices.map((choice) => (
        <ToggleGroupItem
          key={choice}
          value={choice}
          className="rounded-full data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
        >
          {value.includes(choice) ? <CheckIcon data-icon="inline-start" className="text-primary" /> : null}
          {choice}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const NOT_SET = "__not_set__";

export type PicklistInputProps = ControlAria & {
  value: string | null;
  options: string[];
  onValueChange: (value: string | null) => void;
  onBlur?: () => void;
};

/** A picklist (one of the listed options, or not set). */
export function PicklistInput({
  id,
  describedBy,
  invalid,
  ariaLabelledBy,
  value,
  options,
  onValueChange,
  onBlur,
}: PicklistInputProps) {
  const choices = value && !options.includes(value) ? [...options, value] : options;
  return (
    <Select value={value ?? NOT_SET} onValueChange={(next) => onValueChange(next === NOT_SET ? null : next)}>
      <SelectTrigger
        id={id}
        className="w-full max-w-sm bg-background"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        aria-labelledby={ariaLabelledBy}
        onBlur={onBlur}
      >
        <SelectValue placeholder="Choose an option" />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={NOT_SET}>
          <span className="text-muted-foreground">Not set</span>
        </SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice} value={choice}>
            {choice}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
