"use client";

import { TableIcon } from "lucide-react";
import * as React from "react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { PortfolioFormat } from "@/lib/exports/portfolio";
import { compareMonths, monthLabel, type MonthKey } from "@/lib/periods";

import { DownloadLink } from "./download-link";
import type { ExportFundOption } from "./types";

const ALL_FUNDS = "all";

/**
 * Portfolio data extract (BRD §10 "Data extract"): fund, month range, Excel or CSV, approved months only.
 * `months` are the open reporting months, newest first.
 */
export function PortfolioExportCard({ funds, months }: { funds: ExportFundOption[]; months: MonthKey[] }) {
  const newest = months[0] ?? "";
  const oldest = months[months.length - 1] ?? "";
  const [fund, setFund] = React.useState(ALL_FUNDS);
  const [from, setFrom] = React.useState(oldest);
  const [to, setTo] = React.useState(newest);
  const [format, setFormat] = React.useState<PortfolioFormat>("xlsx");
  const [approvedOnly, setApprovedOnly] = React.useState(true);
  const ids = {
    fund: React.useId(),
    from: React.useId(),
    to: React.useId(),
    format: React.useId(),
    approved: React.useId(),
    rangeError: React.useId(),
    formatHint: React.useId(),
  };

  const rangeInvalid = Boolean(from && to && compareMonths(from, to) > 0);
  const fundCode = funds.find((option) => option.id === fund)?.code ?? null;
  let href: string | null = null;
  if (months.length > 0 && !rangeInvalid) {
    const params = new URLSearchParams({ format });
    if (fundCode) params.set("fund", fundCode);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("status", approvedOnly ? "approved" : "all");
    href = `/api/exports/portfolio?${params.toString()}`;
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TableIcon className="size-4 text-primary" aria-hidden="true" />
          Portfolio data
        </CardTitle>
        <CardDescription>
          Every company and month with revenue, margins, cash, burn, runway and headcount, plus RM conversions. For
          finance and auditors.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reporting months are open yet, so there are no figures to export.</p>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={ids.fund}>Fund</FieldLabel>
              <Select value={fund} onValueChange={setFund}>
                <SelectTrigger id={ids.fund} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={ALL_FUNDS}>All funds</SelectItem>
                  {funds.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.code} · {option.name}
                      {option.isActive ? null : <span className="text-xs text-muted-foreground">Inactive</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={rangeInvalid || undefined}>
                <FieldLabel htmlFor={ids.from}>From</FieldLabel>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger
                    id={ids.from}
                    className="w-full"
                    aria-invalid={rangeInvalid || undefined}
                    aria-describedby={rangeInvalid ? ids.rangeError : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {months.map((month) => (
                      <SelectItem key={month} value={month}>
                        {monthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field data-invalid={rangeInvalid || undefined}>
                <FieldLabel htmlFor={ids.to}>To</FieldLabel>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger
                    id={ids.to}
                    className="w-full"
                    aria-invalid={rangeInvalid || undefined}
                    aria-describedby={rangeInvalid ? ids.rangeError : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {months.map((month) => (
                      <SelectItem key={month} value={month}>
                        {monthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {rangeInvalid ? (
              <FieldError id={ids.rangeError}>The first month must be on or before the last month.</FieldError>
            ) : null}
            <Field>
              <FieldLabel id={ids.format}>Format</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={format}
                onValueChange={(value) => {
                  if (value === "xlsx" || value === "csv") setFormat(value);
                }}
                aria-labelledby={ids.format}
                aria-describedby={ids.formatHint}
              >
                <ToggleGroupItem value="xlsx" className="px-3">
                  Excel (.xlsx)
                </ToggleGroupItem>
                <ToggleGroupItem value="csv" className="px-3">
                  CSV
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription id={ids.formatHint}>
                {format === "xlsx"
                  ? "Excel adds a Revenue segments sheet: each company's own revenue segments and ScaleUp revenue lines, month by month."
                  : "CSV holds one row per company and month. Choose Excel to include revenue segments as well."}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id={ids.approved} checked={approvedOnly} onCheckedChange={setApprovedOnly} />
              <FieldContent>
                <FieldLabel htmlFor={ids.approved}>Approved months only</FieldLabel>
                <FieldDescription>
                  Turn off to add months that are submitted or in draft; a Status column shows each month&apos;s state.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        )}
      </CardContent>
      <CardFooter>
        <DownloadLink
          href={href}
          fallbackFilename={`Portfolio data.${format}`}
          successMessage="Portfolio data downloaded"
          className="w-full sm:w-auto"
          wrapperClassName="w-full sm:w-auto"
        >
          Download data
        </DownloadLink>
      </CardFooter>
    </Card>
  );
}
