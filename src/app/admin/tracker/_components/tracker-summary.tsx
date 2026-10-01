import { TONE_DOT_CLASSES, TONE_TEXT_CLASSES } from "@/components/app/tone";
import type { Tone } from "@/lib/constants";
import { EMPTY_DISPLAY, formatDate } from "@/lib/format";
import { monthLabelLong } from "@/lib/periods";
import { cn } from "@/lib/utils";

import {
  APPROVAL_TARGET_DAYS,
  STATUS_FILTER_META,
  plural,
  type StatusFilter,
  type TrackerSummary,
} from "../_lib/tracker-model";

type CardProps = {
  label: string;
  value: string;
  caption: string;
  tone: Tone;
  /** Emphasise the value in the tone colour (e.g. overdue > 0). */
  emphasise?: boolean;
  /** Clicking toggles this status filter; omitted for cards that are not filters. */
  filter?: StatusFilter;
  activeFilter: StatusFilter | null;
  onFilter: (filter: StatusFilter | null) => void;
};

function SummaryCard({ label, value, caption, tone, emphasise, filter, activeFilter, onFilter }: CardProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT_CLASSES[tone])} />
        {label}
      </span>
      <span className={cn("text-2xl font-semibold tracking-tight", emphasise && TONE_TEXT_CLASSES[tone])}>
        {value}
      </span>
      <span className="text-xs text-pretty text-muted-foreground">{caption}</span>
    </>
  );
  const classes =
    "flex min-w-0 flex-col items-start gap-1 rounded-xl bg-card p-3 text-left ring-1 ring-foreground/10 transition-shadow";
  if (!filter) return <div className={classes}>{body}</div>;
  const active = activeFilter === filter;
  return (
    <button
      type="button"
      aria-pressed={active}
      title={active ? "Show every status" : `Show only: ${STATUS_FILTER_META[filter].label}`}
      onClick={() => onFilter(active ? null : filter)}
      className={cn(
        classes,
        "outline-none hover:shadow-sm hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "bg-accent ring-2 ring-primary hover:ring-primary",
      )}
    >
      {body}
    </button>
  );
}

/**
 * Summary cards for the latest open month (BRD A6): not submitted, overdue, awaiting review, changes
 * requested, approved (with the O3 20-day target) and narrative coverage. The status cards toggle the
 * status filter.
 */
export function TrackerSummaryCards({
  summary,
  escalationDays,
  activeFilter,
  onFilter,
}: {
  summary: TrackerSummary;
  escalationDays: number;
  activeFilter: StatusFilter | null;
  onFilter: (filter: StatusFilter | null) => void;
}) {
  if (!summary.month) return null;
  const common = { activeFilter, onFilter };
  return (
    <section aria-labelledby="tracker-summary-heading" className="flex flex-col gap-3">
      <h2 id="tracker-summary-heading" className="text-sm font-medium">
        {monthLabelLong(summary.month)}
        <span className="font-normal text-muted-foreground">
          {" "}
          · latest open month
          {summary.dueDate ? ` · due ${formatDate(summary.dueDate)}` : ""} · {plural(summary.total, "company", "companies")}
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryCard
          {...common}
          filter="not_submitted"
          label={STATUS_FILTER_META.not_submitted.label}
          value={String(summary.notSubmitted)}
          tone="neutral"
          caption={summary.notYetDue ? "Not yet due" : "Not overdue"}
        />
        <SummaryCard
          {...common}
          filter="overdue"
          label={STATUS_FILTER_META.overdue.label}
          value={String(summary.overdue)}
          tone="danger"
          emphasise={summary.overdue > 0}
          caption={
            summary.escalated > 0
              ? `${summary.escalated} escalated (over ${plural(escalationDays, "day")})`
              : "Past the due date"
          }
        />
        <SummaryCard
          {...common}
          filter="submitted"
          label={STATUS_FILTER_META.submitted.label}
          value={String(summary.awaitingReview)}
          tone="info"
          caption="Submitted, not yet reviewed"
        />
        <SummaryCard
          {...common}
          filter="changes_requested"
          label={STATUS_FILTER_META.changes_requested.label}
          value={String(summary.changesRequested)}
          tone="warning"
          caption="Sent back, not yet overdue"
        />
        <SummaryCard
          {...common}
          filter="approved"
          label={STATUS_FILTER_META.approved.label}
          value={String(summary.approved)}
          tone="success"
          caption={
            summary.approved > 0
              ? `${summary.approvedWithinTarget} of ${summary.approved} within ${APPROVAL_TARGET_DAYS} days of month end`
              : `Target: within ${APPROVAL_TARGET_DAYS} days of month end`
          }
        />
        <SummaryCard
          {...common}
          label="Narrative coverage"
          value={summary.narrativeCoveragePct === null ? EMPTY_DISPLAY : `${summary.narrativeCoveragePct}%`}
          tone="neutral"
          caption={
            summary.received > 0
              ? `${summary.withNarrative} of ${plural(summary.received, "update")} received`
              : "No updates received yet"
          }
        />
      </div>
    </section>
  );
}
