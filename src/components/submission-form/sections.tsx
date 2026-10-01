"use client";

import { MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TONE_DOT_CLASSES } from "@/components/app/tone";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SYSTEM_FIELD_KEYS } from "@/lib/constants";
import {
  EMPTY_DISPLAY,
  currencySymbol,
  formatMoney,
  formatNumberTrimmed,
  formatPct,
  formatRunway,
  toFiniteNumber,
} from "@/lib/format";
import { deriveMetrics, financialsFromValues, growthPct } from "@/lib/metrics";
import { fieldTarget } from "@/lib/targets";
import type { TemplateSectionFull } from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import type { KpiCell } from "@/lib/validation";

import { isEmptyFieldDraft, withKpiValue, type FieldDraft } from "./draft";
import { FieldShell, TemplateFieldControl, type ControlWiring } from "./fields";
import { CommentSlot, useFormContext } from "./form-context";
import { NumberInput, YesNoInput } from "./inputs";
import { groupKpiCells, sumCommentCounts, targetDomId, type KpiColumn } from "./presentation";
import { RevenueArea } from "./revenue";

const SYSTEM_KEYS = new Set<string>(SYSTEM_FIELD_KEYS);

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

export function SectionCard({
  id,
  title,
  description,
  aside,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-32", className)}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle id={`${id}-title`} className="text-base">
              <h3>{title}</h3>
            </CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {aside}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------------------------

export function FinancialsSection({ section }: { section: TemplateSectionFull }) {
  const { currency } = useFormContext();
  const revenueField = section.fields.find((field) => field.key === "revenue_total");

  return (
    <SectionCard
      id={`section-${section.key}`}
      title={section.title}
      description={
        section.description ??
        `Every figure is required each month, in ${currencySymbol(currency)}. Gross and net profit can be negative.`
      }
    >
      {/* Total revenue: from the company's own segments, or entered directly; then ScaleUp's revenue lines. */}
      <RevenueArea revenueField={revenueField} sectionKind={section.kind} />
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {section.fields
          .filter((field) => field.key !== "revenue_total")
          .map((field) => (
            <TemplateFieldControl
              key={field.id}
              field={field}
              sectionKind={section.kind}
              systemRequired={SYSTEM_KEYS.has(field.key)}
            />
          ))}
      </div>
      <MetricsPanel />
    </SectionCard>
  );
}

/** Live GP%, NP%, runway and month-on-month revenue from the figures on screen. */
function MetricsPanel() {
  const { bundle, draft, currency, previous } = useFormContext();
  const live = financialsFromValues(bundle.submission.month, draft.values);
  const metrics = deriveMetrics(live);
  const previousRevenue = bundle.previous?.financials.revenue_total ?? null;
  const growth = growthPct(live.revenue_total, previousRevenue);

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Gross margin", value: formatPct(metrics.gp_pct), note: "Gross profit ÷ revenue" },
    { label: "Net margin", value: formatPct(metrics.np_pct), note: "Net profit ÷ revenue" },
    {
      label: "Runway",
      value: formatRunway(metrics.runway_months, { cashflowPositive: metrics.cashflow_positive }),
      note: "Cash in bank ÷ burn rate",
    },
    {
      label: previous ? `Revenue vs ${previous.label}` : "Revenue vs last month",
      value: previous ? formatPct(growth, 1, { signed: true }) : EMPTY_DISPLAY,
      note: previous
        ? previousRevenue === null
          ? "No revenue last month"
          : `${formatMoney(previousRevenue, currency)} last month`
        : "No update for last month",
    },
  ];

  return (
    <section aria-label="Calculated from your figures" className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Calculated</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{tile.value}</dd>
            {tile.note ? <dd className="truncate text-xs text-muted-foreground">{tile.note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Headcount, additional numbers and any other section
// ---------------------------------------------------------------------------------------------

export function FieldsSection({ section }: { section: TemplateSectionFull }) {
  const description =
    section.description ??
    (section.kind === "headcount" ? "Required every month: the number of people in the team at month end." : undefined);
  return (
    <SectionCard id={`section-${section.key}`} title={section.title} description={description}>
      {section.fields.length > 0 ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {section.fields.map((field) => (
            <TemplateFieldControl
              key={field.id}
              field={field}
              sectionKind={section.kind}
              systemRequired={SYSTEM_KEYS.has(field.key)}
              className={field.field_type === "long_text" ? "sm:col-span-2" : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This section has no fields.</p>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------
// Company KPIs
// ---------------------------------------------------------------------------------------------

export function KpiSection({ section, cells }: { section: TemplateSectionFull; cells: KpiCell[] }) {
  const { bundle } = useFormContext();
  const groups = groupKpiCells(cells, bundle.config.kpis);
  const hasActiveKpis = bundle.config.kpis.some((kpi) => kpi.is_active);

  return (
    <SectionCard
      id={`section-${section.key}`}
      title={section.title}
      description={
        section.description ??
        "The operating metrics agreed with ScaleUp. Half-yearly KPIs are collected in June and December."
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasActiveKpis
            ? "No company KPIs are due this month. Half-yearly KPIs are collected in June and December."
            : `ScaleUp hasn't set up any KPIs for ${bundle.company.name} yet.`}
        </p>
      ) : (
        groups.map((group) =>
          group.kind === "single" ? (
            <div key="single" className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {group.cells.map((cell) => (
                <KpiField key={cell.cellKey} cell={cell} />
              ))}
            </div>
          ) : (
            <div key={group.dimensionId} className="flex flex-col gap-2">
              <p className="text-sm font-medium">By {group.dimensionName.toLowerCase()}</p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="min-w-36 pl-3">{group.dimensionName}</TableHead>
                      {group.columns.map((column) => (
                        <TableHead key={column.kpiId} className="min-w-44 text-right whitespace-normal">
                          <KpiHeading column={column} />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((row) => (
                      <TableRow key={row.memberId} className="hover:bg-transparent">
                        <TableCell className="pl-3 font-medium whitespace-normal">{row.memberName}</TableCell>
                        {group.columns.map((column) => {
                          const cell = group.cells[`${column.kpiId}:${row.memberId}`];
                          return (
                            <TableCell key={column.kpiId} className="align-top whitespace-normal">
                              {cell ? (
                                <KpiTableCell cell={cell} />
                              ) : (
                                <span className="text-muted-foreground">{EMPTY_DISPLAY}</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ),
        )
      )}
      {section.fields.length > 0 ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {section.fields.map((field) => (
            <TemplateFieldControl key={field.id} field={field} sectionKind={section.kind} />
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function KpiHeading({ column }: { column: KpiColumn }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5 py-1" title={column.description ?? undefined}>
      <span>
        {column.name}
        {column.required ? null : <span className="font-normal text-muted-foreground"> (optional)</span>}
      </span>
      {column.unit && column.valueType !== "currency" && column.valueType !== "boolean" ? (
        <span className="text-xs font-normal text-muted-foreground">{column.unit}</span>
      ) : null}
    </span>
  );
}

function kpiAffixes(cell: KpiCell, unit: string | null, currency: string): { prefix?: string; suffix?: string } {
  if (cell.valueType === "currency") return { prefix: currencySymbol(currency) };
  if (cell.valueType === "percent") return { suffix: "%" };
  return unit ? { suffix: unit } : {};
}

function formatKpiValue(
  cell: KpiCell,
  value: { value_number: number | null; value_text: string | null; value_bool: boolean | null } | undefined,
  unit: string | null,
  currency: string,
): string {
  if (!value) return EMPTY_DISPLAY;
  if (cell.valueType === "boolean")
    return value.value_bool === true ? "Yes" : value.value_bool === false ? "No" : EMPTY_DISPLAY;
  if (cell.valueType === "text") return value.value_text?.trim() ? value.value_text : EMPTY_DISPLAY;
  const number = toFiniteNumber(value.value_number);
  if (number === null) return EMPTY_DISPLAY;
  if (cell.valueType === "currency")
    return formatMoney(number, currency, { decimals: Number.isInteger(number) ? 0 : 2 });
  if (cell.valueType === "percent") return `${formatNumberTrimmed(number, 2)}%`;
  return unit ? `${formatNumberTrimmed(number, 4)} ${unit}` : formatNumberTrimmed(number, 4);
}

/** The input (or value) of one KPI cell. `compact`: inside the dimension table (label read from the table). */
function KpiControl({ cell, wiring, compact }: { cell: KpiCell; wiring: ControlWiring; compact: boolean }) {
  const { bundle, draft, store, editable, currency, touch } = useFormContext();
  const kpi = bundle.config.kpis.find((item) => item.id === cell.kpiId);
  const unit = kpi?.unit ?? null;
  const value = draft.kpis[cell.cellKey];
  const ariaLabel = compact ? cell.label : undefined;

  if (!editable) {
    return (
      <p className={cn("text-sm font-medium tabular-nums", compact && "text-right")}>
        {formatKpiValue(cell, value, compact ? null : unit, currency)}
      </p>
    );
  }

  const blur = () => touch(cell.target);
  if (cell.valueType === "boolean") {
    return (
      <div className={cn("flex", compact && "justify-end")}>
        <YesNoInput
          id={wiring.id}
          describedBy={wiring.describedBy}
          ariaLabel={ariaLabel}
          ariaLabelledBy={compact ? undefined : wiring.labelId}
          size={compact ? "sm" : "default"}
          value={typeof value?.value_bool === "boolean" ? value.value_bool : null}
          onValueChange={(next) =>
            store.update((current) =>
              withKpiValue(
                current,
                cell.cellKey,
                next === null ? null : { value_number: null, value_text: null, value_bool: next },
              ),
            )
          }
          onBlur={blur}
        />
      </div>
    );
  }
  if (cell.valueType === "text") {
    return (
      <Input
        id={wiring.id}
        value={value?.value_text ?? ""}
        maxLength={2000}
        aria-label={ariaLabel}
        aria-invalid={wiring.invalid || undefined}
        aria-describedby={wiring.describedBy}
        onChange={(event) =>
          store.update((current) =>
            withKpiValue(current, cell.cellKey, {
              value_number: null,
              value_text: event.target.value,
              value_bool: null,
            }),
          )
        }
        onBlur={blur}
        className="bg-background"
      />
    );
  }
  const affixes = kpiAffixes(cell, compact ? null : unit, currency);
  return (
    <NumberInput
      id={wiring.id}
      describedBy={wiring.describedBy}
      invalid={wiring.invalid}
      ariaLabel={ariaLabel}
      value={toFiniteNumber(value?.value_number)}
      integer={cell.valueType === "integer"}
      percent={cell.valueType === "percent"}
      prefix={affixes.prefix}
      suffix={affixes.suffix}
      // KPI values may be negative (the database has no sign rule for them).
      allowNegative
      onValueChange={(next) =>
        store.update((current) =>
          withKpiValue(
            current,
            cell.cellKey,
            next === null ? null : { value_number: next, value_text: null, value_bool: null },
          ),
        )
      }
      onInvalidChange={(message) => store.setInvalid(cell.target, message)}
      onBlur={blur}
      className={compact ? "min-w-40" : "max-w-xs"}
    />
  );
}

/** A KPI without a dimension, as a labelled field. */
function KpiField({ cell }: { cell: KpiCell }) {
  const { bundle, editable } = useFormContext();
  const kpi = bundle.config.kpis.find((item) => item.id === cell.kpiId);
  return (
    <FieldShell
      target={cell.target}
      label={cell.label}
      labelKind={!editable || cell.valueType === "boolean" ? "group" : "label"}
      optional={!cell.required}
      help={kpi?.description}
    >
      {(wiring) => <KpiControl cell={cell} wiring={wiring} compact={false} />}
    </FieldShell>
  );
}

/** A KPI × dimension member cell inside the table (label = column + row). */
function KpiTableCell({ cell }: { cell: KpiCell }) {
  const { errorFor } = useFormContext();
  const id = targetDomId(cell.target);
  const error = errorFor(cell.target);
  const wiring: ControlWiring = {
    id,
    labelId: `${id}-label`,
    describedBy: error ? `${id}-error` : undefined,
    invalid: Boolean(error),
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex w-full items-center justify-end gap-1">
        <KpiControl cell={cell} wiring={wiring} compact />
        <CommentSlot target={cell.target} />
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-right text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Narrative (C4 categories) and founder pulse
// ---------------------------------------------------------------------------------------------

function filledCount(section: TemplateSectionFull, values: Record<string, FieldDraft>): number {
  return section.fields.filter((field) => !isEmptyFieldDraft(values[field.key])).length;
}

/**
 * Consecutive narrative sections (C4 categories) as one card of accordions, each field with last month's
 * entry alongside.
 */
export function NarrativeGroup({
  sections,
  open,
  onOpenChange,
}: {
  sections: TemplateSectionFull[];
  open: string[];
  onOpenChange: (open: string[]) => void;
}) {
  const { draft, comments, editable } = useFormContext();
  const filledSections = sections.filter((section) => filledCount(section, draft.values) > 0).length;

  return (
    <SectionCard
      id={`narrative-${sections[0]?.key ?? "sections"}`}
      title="Narrative"
      description={
        editable
          ? "Optional. Share what happened this month in each category; leave any category blank. Last month's entries are shown for reference."
          : "Optional commentary by category."
      }
      aside={
        <span className="text-xs text-muted-foreground">
          {filledSections} of {sections.length} filled in
        </span>
      }
    >
      <Accordion type="multiple" value={open} onValueChange={onOpenChange} className="-my-2">
        {sections.map((section) => {
          const filled = filledCount(section, draft.values) > 0;
          const threads = sumCommentCounts(
            comments?.counts,
            section.fields.map((field) => fieldTarget(field.key)),
          );
          return (
            <AccordionItem key={section.id} value={section.key} id={`section-${section.key}`} className="scroll-mt-32">
              <AccordionTrigger className="items-center py-3 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      filled ? TONE_DOT_CLASSES.success : "bg-muted-foreground/25",
                    )}
                  />
                  <span className="truncate">{section.title}</span>
                  <span className="sr-only">{filled ? "(filled in)" : "(empty)"}</span>
                  {comments && threads.total > 0 ? (
                    <span className="ml-auto mr-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <MessageSquareIcon className="size-3.5" aria-hidden="true" />
                      {threads.unresolved > 0 ? `${threads.unresolved} open` : threads.total}
                    </span>
                  ) : null}
                </span>
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-5 pt-1 pb-4">
                {section.description ? <p className="text-sm text-muted-foreground">{section.description}</p> : null}
                {section.fields.map((field) => (
                  <TemplateFieldControl key={field.id} field={field} sectionKind={section.kind} showLastMonth />
                ))}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </SectionCard>
  );
}

/** Founder pulse: team morale, next month's goals and the help needed from ScaleUp. */
export function PulseSection({ section }: { section: TemplateSectionFull }) {
  const { editable } = useFormContext();
  return (
    <SectionCard
      id={`section-${section.key}`}
      title={section.title}
      description={
        section.description ?? (editable ? "Optional. How the team is doing and where ScaleUp can help." : undefined)
      }
    >
      <div className="flex flex-col gap-6">
        {section.fields.map((field) => (
          <TemplateFieldControl key={field.id} field={field} sectionKind={section.kind} showLastMonth />
        ))}
      </div>
    </SectionCard>
  );
}
