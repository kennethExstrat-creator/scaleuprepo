"use client";

import { FileSpreadsheetIcon } from "lucide-react";
import * as React from "react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { COMPANY_STATUS_LABELS, NOT_YET_REPORTING_META } from "@/lib/constants";

import { DownloadLink } from "./download-link";
import type { ExportCompanyOption } from "./types";

function CompanyItemText({ company }: { company: ExportCompanyOption }) {
  const note = !company.hasMonths
    ? company.notYetReporting
      ? NOT_YET_REPORTING_META.label
      : "No months yet"
    : company.status !== "active"
      ? COMPANY_STATUS_LABELS[company.status]
      : null;
  return (
    <>
      {company.name}
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </>
  );
}

/** C4 workbook for one company (BRD A13): company, include toggle, download. */
export function C4ExportCard({ companies }: { companies: ExportCompanyOption[] }) {
  const [companyId, setCompanyId] = React.useState("");
  const [includeAll, setIncludeAll] = React.useState(false);
  const companyFieldId = React.useId();
  const includeFieldId = React.useId();

  const reporting = companies.filter((company) => company.hasMonths);
  const waiting = companies.filter((company) => !company.hasMonths);
  const company = reporting.find((option) => option.id === companyId) ?? null;
  const href = company ? `/api/exports/c4/${company.id}?include=${includeAll ? "all" : "approved"}` : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheetIcon className="size-4 text-primary" aria-hidden="true" />
          C4 workbook
        </CardTitle>
        <CardDescription>
          One company in the C4 layout: narrative by half-year, Revenue Lines (revenue segments, ScaleUp revenue
          lines and key figures) with half-year totals, KPIs and the monthly grid.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={companyFieldId}>Company</FieldLabel>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger id={companyFieldId} className="w-full">
                <SelectValue placeholder="Choose a company" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectLabel>Reporting</SelectLabel>
                  {reporting.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No company has monthly updates yet
                    </SelectItem>
                  ) : (
                    reporting.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <CompanyItemText company={option} />
                      </SelectItem>
                    ))
                  )}
                </SelectGroup>
                {waiting.length > 0 ? (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Nothing to export yet</SelectLabel>
                      {waiting.map((option) => (
                        <SelectItem key={option.id} value={option.id} disabled>
                          <CompanyItemText company={option} />
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                ) : null}
              </SelectContent>
            </Select>
            <FieldDescription>Companies that have not started monthly reporting have nothing to export yet.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch id={includeFieldId} checked={includeAll} onCheckedChange={setIncludeAll} />
            <FieldContent>
              <FieldLabel htmlFor={includeFieldId}>Include months not yet approved</FieldLabel>
              <FieldDescription>
                Off: only approved months feed the figures and narrative (LP-facing). On: submitted and draft months
                are included and marked “not yet approved”.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <DownloadLink
          href={href}
          fallbackFilename="C4 workbook.xlsx"
          successMessage="C4 workbook downloaded"
          className="w-full sm:w-auto"
          wrapperClassName="w-full sm:w-auto"
        >
          Download workbook
        </DownloadLink>
      </CardFooter>
    </Card>
  );
}
