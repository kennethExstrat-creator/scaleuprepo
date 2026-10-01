"use client";

// A month picker for the cycles and settings forms: one Select listing the months of a range grouped by
// year, newest first ("September 2026"). Typing the first letters of a month jumps to it. Value = 'YYYY-MM'.

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compareMonths, monthLabelLong, monthsBetween, type MonthKey } from "@/lib/periods";

/** The months of `from`..`to`, newest first, grouped by year (the value is kept even when outside the range). */
export function monthGroups(from: MonthKey, to: MonthKey, value?: string | null): { year: string; months: MonthKey[] }[] {
  const months = monthsBetween(from, to);
  if (value && /^\d{4}-\d{2}$/.test(value) && !months.includes(value)) months.push(value);
  months.sort((a, b) => compareMonths(b, a));
  const groups: { year: string; months: MonthKey[] }[] = [];
  for (const month of months) {
    const year = month.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.months.push(month);
    else groups.push({ year, months: [month] });
  }
  return groups;
}

export function MonthSelect({
  id,
  value,
  onValueChange,
  from,
  to,
  placeholder = "Choose a month",
  disabled,
  invalid,
  describedBy,
  className,
  labelFor,
}: {
  id: string;
  /** 'YYYY-MM' or "" (nothing chosen). */
  value: string;
  onValueChange: (value: MonthKey) => void;
  from: MonthKey;
  to: MonthKey;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  /** Optional suffix shown after a month's name, e.g. "(this month)". */
  labelFor?: (month: MonthKey) => string | null;
}) {
  const groups = monthGroups(from, to, value || null);
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next)} disabled={disabled}>
      <SelectTrigger
        id={id}
        className={className ?? "w-full"}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {groups.map((group) => (
          <SelectGroup key={group.year}>
            <SelectLabel>{group.year}</SelectLabel>
            {group.months.map((month) => {
              const suffix = labelFor?.(month);
              return (
                <SelectItem key={month} value={month}>
                  {monthLabelLong(month)}
                  {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
