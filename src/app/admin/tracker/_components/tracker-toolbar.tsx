"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  SEARCH_MAX_LENGTH,
  STATUS_FILTERS,
  STATUS_FILTER_META,
  TRACKER_WINDOWS,
  isStatusFilter,
  type FilterOption,
  type StatusFilter,
  type TrackerWindow,
} from "../_lib/tracker-model";

/** Select value for "no filter" (Radix Select items cannot have an empty value). */
const ALL = "all";

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: FilterOption[];
  onChange: (value: string | null) => void;
  className?: string;
}) {
  const id = useId();
  // The label is passed explicitly so the trigger shows it in the server render too (Radix would
  // otherwise only fill it in after hydration).
  const selected = options.find((option) => option.value === value);
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
        <SelectTrigger id={id} className="w-full min-w-0 bg-background">
          <SelectValue placeholder={allLabel}>
            <span className="truncate">{selected ? selected.label : allLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-h-80">
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.length > 0 ? <SelectSeparator /> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} title={option.description}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const STATUS_OPTIONS: FilterOption[] = STATUS_FILTERS.map((filter) => ({
  value: filter,
  label: STATUS_FILTER_META[filter].label,
  description: STATUS_FILTER_META[filter].description,
}));

export type TrackerToolbarProps = {
  search: string;
  fund: string | null;
  partner: string | null;
  status: StatusFilter | null;
  months: TrackerWindow;
  fundOptions: FilterOption[];
  partnerOptions: FilterOption[];
  canClear: boolean;
  onSearch: (search: string) => void;
  onFund: (fund: string | null) => void;
  onPartner: (partner: string | null) => void;
  onStatus: (status: StatusFilter | null) => void;
  onMonths: (months: TrackerWindow) => void;
  onClear: () => void;
};

/** Search, fund, partner and status filters, the 6/12-month toggle and "Clear filters". */
export function TrackerToolbar(props: TrackerToolbarProps) {
  const searchId = useId();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
      <div className="min-w-0 sm:col-span-2 lg:w-64">
        <Label htmlFor={searchId} className="sr-only">
          Search companies
        </Label>
        <InputGroup className="bg-background">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            id={searchId}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search companies"
            maxLength={SEARCH_MAX_LENGTH}
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && props.search) {
                event.preventDefault();
                props.onSearch("");
              }
            }}
            className="[&::-webkit-search-cancel-button]:hidden"
          />
          {props.search ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => props.onSearch("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <FilterSelect
        label="Fund"
        allLabel="All funds"
        value={props.fund}
        options={props.fundOptions}
        onChange={props.onFund}
        className="lg:w-36"
      />
      <FilterSelect
        label="Partner-in-charge"
        allLabel="All partners"
        value={props.partner}
        options={props.partnerOptions}
        onChange={props.onPartner}
        className="lg:w-52"
      />
      <FilterSelect
        label="Status"
        allLabel="All statuses"
        value={props.status}
        options={STATUS_OPTIONS}
        onChange={(value) => props.onStatus(isStatusFilter(value) ? value : null)}
        className="lg:w-48"
      />
      <div className="flex items-center gap-2 sm:col-span-2 lg:ml-auto">
        {props.canClear ? (
          <Button variant="ghost" size="sm" onClick={props.onClear}>
            <XIcon data-icon="inline-start" />
            Clear filters
          </Button>
        ) : null}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={String(props.months)}
          onValueChange={(value) => {
            if (value === "6" || value === "12") props.onMonths(value === "12" ? 12 : 6);
          }}
          aria-label="Months shown"
          className="ml-auto lg:ml-0"
        >
          {TRACKER_WINDOWS.map((size) => (
            <ToggleGroupItem key={size} value={String(size)} className="bg-background px-3">
              {size} months
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
