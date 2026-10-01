"use client";

// The fields of one fund mapping (fund, investment date, instrument, ownership %, notes), recorded per
// fund because a company can sit in both SV1 and SFF (BRD B2). Used by "Add company" (one row per fund)
// and the Funds & investment tab (one mapping per dialog).

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

import { describedBy, SelectField, TextAreaField, TextField } from "./form-controls";
import { LIMITS } from "./schemas";
import { INSTRUMENT_SUGGESTIONS } from "./suggestions";
import type { FundOption } from "./types";

export type FundMappingInput = {
  fundId: string;
  investmentDate: string;
  instrument: string;
  ownershipPct: string;
  notes: string;
};

export const EMPTY_FUND_MAPPING: FundMappingInput = {
  fundId: "",
  investmentDate: "",
  instrument: "",
  ownershipPct: "",
  notes: "",
};

/** Datalist of instrument suggestions; render once per page. */
export function InstrumentSuggestions() {
  return (
    <datalist id="instrument-suggestions">
      {INSTRUMENT_SUGGESTIONS.map((instrument) => (
        <option key={instrument} value={instrument} />
      ))}
    </datalist>
  );
}

/** "SV1 · ScaleUp Ventures 1 Sdn Bhd" (and "(inactive)"). */
export function fundOptionLabel(fund: FundOption): string {
  return `${fund.code} · ${fund.name}${fund.isActive ? "" : " (inactive)"}`;
}

export function FundMappingFields({
  idPrefix,
  value,
  onChange,
  errors,
  funds,
  unavailableFundIds = [],
  fundLocked = false,
  showNotes = false,
  compact = false,
}: {
  /** Prefix of the element ids, e.g. "company-funds-0". */
  idPrefix: string;
  value: FundMappingInput;
  onChange: (field: keyof FundMappingInput, value: string) => void;
  /** Field errors keyed by field name (fundId, investmentDate, …). */
  errors: Partial<Record<keyof FundMappingInput, string>>;
  funds: readonly FundOption[];
  /** Funds already mapped (they cannot be chosen again). */
  unavailableFundIds?: readonly string[];
  /** Editing an existing mapping: the fund is fixed. */
  fundLocked?: boolean;
  showNotes?: boolean;
  /** Row layout for the "Add company" form: the fund takes one column and no hints are shown. */
  compact?: boolean;
}) {
  const options = funds
    .filter((fund) => fund.id === value.fundId || (fund.isActive && !unavailableFundIds.includes(fund.id)))
    .map((fund) => ({ value: fund.id, label: fundOptionLabel(fund) }));
  const ownershipId = `${idPrefix}-ownershipPct`;
  const ownershipError = errors.ownershipPct;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id={`${idPrefix}-fundId`}
        label="Fund"
        className={compact ? undefined : "sm:col-span-2"}
        value={value.fundId}
        onValueChange={(next) => onChange("fundId", next)}
        options={options}
        placeholder={options.length > 0 ? "Choose a fund" : "No funds available"}
        error={errors.fundId}
        disabled={fundLocked || options.length === 0}
        description={fundLocked ? "To move the company to another fund, remove this mapping and add a new one." : undefined}
      />
      <TextField
        id={`${idPrefix}-investmentDate`}
        label="Investment date"
        optional
        type="date"
        value={value.investmentDate}
        onValueChange={(next) => onChange("investmentDate", next)}
        error={errors.investmentDate}
        min="1990-01-01"
      />
      <TextField
        id={`${idPrefix}-instrument`}
        label="Instrument"
        optional
        value={value.instrument}
        onValueChange={(next) => onChange("instrument", next)}
        error={errors.instrument}
        maxLength={LIMITS.instrument}
        list="instrument-suggestions"
        placeholder="e.g. Preference shares"
        autoComplete="off"
      />
      <Field data-invalid={ownershipError ? true : undefined}>
        <FieldLabel htmlFor={ownershipId}>
          Ownership
          <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={ownershipId}
            inputMode="decimal"
            value={value.ownershipPct}
            onChange={(event) => onChange("ownershipPct", event.target.value)}
            placeholder="0.00"
            className="text-right tabular-nums"
            maxLength={12}
            autoComplete="off"
            aria-invalid={ownershipError ? true : undefined}
            aria-describedby={describedBy(ownershipError && `${ownershipId}-error`, !compact && `${ownershipId}-description`)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>%</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        {compact ? null : (
          <FieldDescription id={`${ownershipId}-description`}>The fund&apos;s stake, up to 4 decimals.</FieldDescription>
        )}
        {ownershipError ? <FieldError id={`${ownershipId}-error`}>{ownershipError}</FieldError> : null}
      </Field>
      {showNotes ? (
        <TextAreaField
          id={`${idPrefix}-notes`}
          label="Notes"
          optional
          className="sm:col-span-2"
          value={value.notes}
          onValueChange={(next) => onChange("notes", next)}
          error={errors.notes}
          maxLength={LIMITS.investmentNotes}
          rows={2}
        />
      ) : null}
    </div>
  );
}
