"use client";

// The reporting start month picker (BRD B3, B16): "Not yet reporting" or a month from the allowed range,
// with a line saying what choosing it does (which months open now and when they are due).

import { NOT_YET_REPORTING_META } from "@/lib/constants";
import { monthLabelLong, type MonthKey } from "@/lib/periods";

import { SelectField } from "./form-controls";
import { describeStartMonthPreview, startMonthPreview } from "./reporting";

/** Select value for "Not yet reporting". */
const NOT_REPORTING = "none";

export function StartMonthField({
  id,
  value,
  onValueChange,
  months,
  today,
  dueDay,
  graceDays,
  error,
  disabled,
  label = "Reporting start month",
}: {
  id: string;
  /** 'YYYY-MM', or "" for not yet reporting. */
  value: string;
  onValueChange: (value: string) => void;
  /** Months that can be chosen, oldest first (startMonthOptions). */
  months: readonly MonthKey[];
  /** Today in Malaysia time, 'YYYY-MM-DD' (from the server, so both renders agree). */
  today: string;
  dueDay: number;
  graceDays: number;
  error?: string | null;
  disabled?: boolean;
  label?: string;
}) {
  const currentMonth = today.slice(0, 7);
  const options = [
    { value: NOT_REPORTING, label: NOT_YET_REPORTING_META.label },
    ...months.map((month) => ({
      value: month,
      label: month === currentMonth ? `${monthLabelLong(month)} (this month)` : monthLabelLong(month),
    })),
  ];
  const description = value
    ? describeStartMonthPreview(startMonthPreview(value, today, dueDay, graceDays))
    : `${NOT_YET_REPORTING_META.description}.`;

  return (
    <SelectField
      id={id}
      label={label}
      value={value || NOT_REPORTING}
      onValueChange={(next) => onValueChange(next === NOT_REPORTING ? "" : next)}
      options={options}
      error={error}
      description={description}
      disabled={disabled}
    />
  );
}
