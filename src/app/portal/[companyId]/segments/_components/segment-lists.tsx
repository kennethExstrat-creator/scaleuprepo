"use client";

// Read-only parts of the revenue segments page (BRD B30): the segments in use for people who cannot
// change them (contributors, exited or written-off companies), the segments no longer used (collapsed,
// with when they were used and retired) and ScaleUp's revenue lines, which are separate and need not add
// up to total revenue.

import { ChartPieIcon, ChevronDownIcon, HistoryIcon, LandmarkIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { REVENUE_SEGMENT_KIND_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { RevenueSegmentRow } from "@/lib/types/domain";

import { describeRetired, describeUsage, usageOf, type SegmentUsage } from "../_lib/segments-model";

/** The segments in use, read-only (contributors; every member of an exited or written-off company). */
export function SegmentsReadOnly({
  companyName,
  segments,
  usage,
  active,
}: {
  companyName: string;
  segments: RevenueSegmentRow[];
  usage: Record<string, SegmentUsage>;
  /** The company is active (a contributor is looking); false for exited or written-off companies. */
  active: boolean;
}) {
  if (segments.length === 0) {
    return (
      <EmptyState
        icon={ChartPieIcon}
        title="No revenue segments"
        description={
          active
            ? "Your company owner hasn't set up revenue segments, so monthly updates ask for total revenue directly."
            : `${companyName} reported total revenue directly.`
        }
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{active ? "Your revenue segments" : "Revenue segments"}</h2>
        </CardTitle>
        <CardDescription>
          {active
            ? "Used in every monthly update, in this order. Total revenue is calculated from them."
            : `The segments ${companyName} used last. Total revenue was calculated from them.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="divide-y rounded-lg border">
          {segments.map((segment, index) => (
            <li key={segment.id} className="flex items-baseline gap-3 px-3 py-2.5">
              <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums" aria-hidden="true">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium break-words">{segment.name}</span>
                <span className="block text-xs text-muted-foreground">{describeUsage(usageOf(usage, segment.id))}</span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** Segments no longer used, most recently retired first, collapsed by default. */
export function RetiredSegments({
  segments,
  usage,
}: {
  segments: RevenueSegmentRow[];
  usage: Record<string, SegmentUsage>;
}) {
  if (segments.length === 0) return null;
  return (
    <Card size="sm">
      <Collapsible>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2>No longer used ({segments.length})</h2>
          </CardTitle>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="group/retired">
              <span className="group-data-[state=open]/retired:hidden">Show</span>
              <span className="hidden group-data-[state=open]/retired:inline">Hide</span>
              <span className="sr-only"> the segments no longer used</span>
              <ChevronDownIcon
                data-icon="inline-end"
                className="transition-transform group-data-[state=open]/retired:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Months submitted while these segments were in use keep their names and figures.
            </p>
            <ul className="divide-y rounded-lg border">
              {segments.map((segment) => {
                const { used, retired } = describeRetired(segment, usageOf(usage, segment.id));
                return (
                  <li
                    key={segment.id}
                    className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                  >
                    <span className="min-w-0 font-medium break-words text-foreground/80">{segment.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {used}
                      {retired ? (
                        <>
                          {" · "}
                          <span title={segment.retired_at ? formatDateTime(segment.retired_at) : undefined}>
                            {retired}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** ScaleUp's revenue lines for the company (read-only here; ScaleUp manages them). */
export function ScaleUpLinesCard({ lines }: { lines: RevenueSegmentRow[] }) {
  if (lines.length === 0) return null;
  const meta = REVENUE_SEGMENT_KIND_META.scaleup;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LandmarkIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2>{meta.plural}</h2>
        </CardTitle>
        <CardDescription>
          ScaleUp also asks for these lines in every monthly update. They are set by ScaleUp and don&apos;t need to add
          up to total revenue. Ask ScaleUp if one of them needs to change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-wrap gap-2">
          {lines.map((line) => (
            <li key={line.id} className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-sm">
              {line.name}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
