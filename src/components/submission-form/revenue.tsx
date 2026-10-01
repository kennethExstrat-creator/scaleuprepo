"use client";

// The revenue area of the Financials section (BRD §6.1, B30). Two breakdowns per company:
// - the company's OWN revenue segments (kind 'company', set by its owner on /portal/<id>/segments): one
//   amount per segment, and total revenue is their sum — calculated, shown read-only and saved with them.
//   Without segments of its own, the company enters total revenue directly (owners get a link to set up
//   segments);
// - ScaleUp's revenue lines (kind 'scaleup'): one required amount per line, NOT part of total revenue.
// A month open for changes shows the segments in use; a submitted or approved month shows exactly the
// segments and lines it has figures for, with the names they had (retired ones included) —
// segmentsForMonth (@/lib/types/domain). Inline errors follow the form's rules (after a field was left or
// a submit attempt).

import { ArrowRightIcon, ChartPieIcon } from "lucide-react";
import Link from "next/link";

import { Money } from "@/components/app/money";
import { Label } from "@/components/ui/label";
import { REVENUE_SEGMENT_KIND_META } from "@/lib/constants";
import { currencySymbol, formatMoney, toFiniteNumber } from "@/lib/format";
import { fieldTarget, segmentTarget } from "@/lib/targets";
import {
  segmentsForMonth,
  sumSegmentAmounts,
  type RevenueSegmentRow,
  type TemplateFieldRow,
} from "@/lib/types/domain";
import type { SectionKind } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { SEGMENT_SCALE, withSegmentAmount, withSegmentValue } from "./draft";
import { TemplateFieldControl } from "./fields";
import { CommentSlot, useFormContext } from "./form-context";
import { NumberInput } from "./inputs";
import { isEditableStatus, targetDomId } from "./presentation";

/** The note under the ScaleUp revenue lines (BRD B30). */
export const SCALEUP_LINES_NOTE = "These lines are set by ScaleUp and don't need to add up to total revenue.";

const ROW_GRID = "grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] sm:items-start";

/**
 * The revenue part of the Financials section: the company's own segments with the calculated total (or
 * the total revenue input), then ScaleUp's revenue lines. `revenueField` is the template's `revenue_total`.
 */
export function RevenueArea({
  revenueField,
  sectionKind,
}: {
  revenueField: TemplateFieldRow | undefined;
  sectionKind: SectionKind;
}) {
  const { bundle, draft, editable, segmentsHref } = useFormContext();
  // An open month follows the segments in use; a submitted / approved one keeps those it has figures for.
  const month = segmentsForMonth(bundle.config, draft, isEditableStatus(bundle.submission.status));
  const revenueLabel = revenueField?.label ?? "Total revenue";

  return (
    <div className="flex flex-col gap-4">
      {month.company.length > 0 ? (
        <CompanySegmentsTable segments={month.company} revenueLabel={revenueLabel} />
      ) : revenueField ? (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <TemplateFieldControl field={revenueField} sectionKind={sectionKind} systemRequired />
          {editable && segmentsHref ? <SegmentsSetUpHint href={segmentsHref} /> : null}
        </div>
      ) : null}
      {month.scaleup.length > 0 ? <ScaleUpLinesTable lines={month.scaleup} /> : null}
    </div>
  );
}

/** For owners of a company without segments of its own: where to set them up. */
function SegmentsSetUpHint({ href }: { href: string }) {
  return (
    <div className="flex items-start gap-2.5 self-start rounded-lg border border-dashed bg-muted/30 p-3">
      <ChartPieIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">Report revenue by segment?</p>
        <p className="text-xs text-muted-foreground">
          Set up your revenue segments once and they are reused every month. Total revenue is then calculated from
          them.
        </p>
        <Link
          href={href}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Set up revenue segments
          <ArrowRightIcon className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Header of a block of amounts: title, note and an optional link. */
function BlockHeader({ id, title, note, action }: { id: string; title: string; note: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * One amount: the segment or line name, its comment button, the input (or the stored figure), last month's
 * figure and the inline error. Inactive (retired) segments only appear in read-only months.
 */
function AmountRow({
  segment,
  onValueChange,
}: {
  segment: RevenueSegmentRow;
  onValueChange: (amount: number | null) => void;
}) {
  const { draft, store, editable, currency, touch, errorFor, previous } = useFormContext();
  const target = segmentTarget(segment.id);
  const id = targetDomId(target);
  const error = errorFor(target);
  const amount = toFiniteNumber(draft.segments[segment.id]);
  const previousAmount = toFiniteNumber(previous?.values.segments[segment.id]);

  return (
    <li className={ROW_GRID}>
      <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {editable ? (
          <Label htmlFor={id} className="leading-snug">
            {segment.name}
          </Label>
        ) : (
          <span className="text-sm font-medium">{segment.name}</span>
        )}
        {!segment.is_active ? <span className="text-xs text-muted-foreground">(no longer used)</span> : null}
        <CommentSlot target={target} />
      </div>
      <div className="flex flex-col gap-1">
        {editable ? (
          <NumberInput
            id={id}
            value={amount}
            scale={SEGMENT_SCALE}
            prefix={currencySymbol(currency)}
            invalid={Boolean(error)}
            describedBy={error ? `${id}-error` : undefined}
            onValueChange={onValueChange}
            onInvalidChange={(message) => store.setInvalid(target, message)}
            onBlur={() => touch(target)}
          />
        ) : (
          <p className="text-right text-sm font-medium">
            <Money value={amount} currency={currency} decimals={amount !== null && !Number.isInteger(amount) ? 2 : 0} />
          </p>
        )}
        {previous && previousAmount !== null ? (
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {previous.label}: {formatMoney(previousAmount, currency, { decimals: Number.isInteger(previousAmount) ? 0 : 2 })}
          </p>
        ) : null}
        {error ? (
          <p id={`${id}-error`} className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The company's own segments and total revenue: their sum while the month is open (calculated, saved with
 * the amounts), the submitted figure once it is locked.
 */
function CompanySegmentsTable({ segments, revenueLabel }: { segments: RevenueSegmentRow[]; revenueLabel: string }) {
  const { bundle, draft, store, editable, currency, errorFor, issuesByTarget, segmentsHref } = useFormContext();
  const totalTarget = fieldTarget("revenue_total");
  const totalId = targetDomId(totalTarget);
  // The total cannot be typed in: "required" means no segment has an amount yet, so say that instead.
  const totalError =
    editable && errorFor(totalTarget) !== null && issuesByTarget[totalTarget]?.[0]?.code === "required"
      ? "Fill in the segments above. Total revenue is calculated from them."
      : errorFor(totalTarget);
  const calculated = sumSegmentAmounts(segments, draft.segments);
  const stored = toFiniteNumber(draft.values.revenue_total?.value_number);
  // Editing: the live sum. A month still open for changes seen read-only (ScaleUp viewers, exited
  // companies) shows the sum too once a segment has an amount — the stored total can be out of date after
  // the owner changed the segments, until the month is next saved (as the exports show it,
  // src/lib/exports/segments.ts shownRevenueTotal). A submitted or approved month shows its stored total.
  const total = editable
    ? calculated
    : isEditableStatus(bundle.submission.status)
      ? (calculated ?? stored)
      : stored;
  // A total entered before the segments were set up (or before they changed), kept until one is filled in.
  const earlierTotal = editable && calculated === null && stored !== null ? stored : null;
  const headerId = `${totalId}-segments`;

  return (
    <section aria-labelledby={headerId} className="overflow-hidden rounded-lg border">
      <BlockHeader
        id={headerId}
        title={REVENUE_SEGMENT_KIND_META.company.plural}
        note={
          editable
            ? "Enter the revenue of each segment. Total revenue is their sum."
            : "Total revenue is the sum of the segments."
        }
        action={
          editable && segmentsHref ? (
            <Link
              href={segmentsHref}
              className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Manage segments
              <ArrowRightIcon className="size-3" aria-hidden="true" />
            </Link>
          ) : null
        }
      />
      <ul className="divide-y">
        {segments.map((segment) => (
          <AmountRow
            key={segment.id}
            segment={segment}
            onValueChange={(next) => store.update((current) => withSegmentAmount(current, segments, segment.id, next))}
          />
        ))}
        <li className={cn(ROW_GRID, "bg-muted/30")}>
          <div className="flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span id={`${totalId}-label`} className="text-sm font-semibold">
              {revenueLabel}
            </span>
            {editable ? <span className="text-xs text-muted-foreground">(calculated)</span> : null}
            <CommentSlot target={totalTarget} />
          </div>
          <div className="flex flex-col gap-1">
            {/* Calculated from the segments; focusable for the "Go to field" links of its errors. */}
            <output
              id={totalId}
              tabIndex={-1}
              aria-labelledby={`${totalId}-label`}
              aria-describedby={totalError ? `${totalId}-error` : earlierTotal !== null ? `${totalId}-earlier` : undefined}
              className="flex h-8 items-center justify-end rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Money value={total} currency={currency} decimals={total !== null && !Number.isInteger(total) ? 2 : 0} />
            </output>
            {earlierTotal !== null ? (
              <p id={`${totalId}-earlier`} className="text-right text-xs text-muted-foreground">
                Entered earlier as {formatMoney(earlierTotal, currency)}. It is replaced by the sum once you fill in the
                segments.
              </p>
            ) : null}
            {totalError ? (
              <p id={`${totalId}-error`} className="text-xs font-medium text-destructive">
                {totalError}
              </p>
            ) : null}
          </div>
        </li>
      </ul>
    </section>
  );
}

/** ScaleUp's revenue lines: required every month, not part of total revenue. */
function ScaleUpLinesTable({ lines }: { lines: RevenueSegmentRow[] }) {
  const { store } = useFormContext();
  const headerId = "sf-scaleup-revenue-lines";
  return (
    <section aria-labelledby={headerId} className="overflow-hidden rounded-lg border">
      <BlockHeader id={headerId} title={REVENUE_SEGMENT_KIND_META.scaleup.plural} note={SCALEUP_LINES_NOTE} />
      <ul className="divide-y">
        {lines.map((line) => (
          <AmountRow
            key={line.id}
            segment={line}
            onValueChange={(next) => store.update((current) => withSegmentValue(current, line.id, next))}
          />
        ))}
      </ul>
    </section>
  );
}
