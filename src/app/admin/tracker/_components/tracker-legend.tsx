import { ESCALATED_META, MISSING_META, OVERDUE_META, SUBMISSION_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

import { plural, type CellState } from "../_lib/tracker-model";
import { CellChip, NarrativeDot, ThreadBadge } from "./tracker-cell";

type LegendChip = { state: CellState; label: string; meaning: string; dimmed?: boolean };

/** What the grid's chips, dots and marks mean. */
export function TrackerLegend({ escalationDays }: { escalationDays: number }) {
  const chips: LegendChip[] = [
    { state: "not_submitted", label: SUBMISSION_STATUS_META.draft.label, meaning: "not yet due" },
    { state: "submitted", label: SUBMISSION_STATUS_META.submitted.label, meaning: "awaiting review" },
    {
      state: "changes_requested",
      label: SUBMISSION_STATUS_META.changes_requested.label,
      meaning: "sent back to the company",
    },
    { state: "approved", label: SUBMISSION_STATUS_META.approved.label, meaning: "approved and locked" },
    { state: "overdue", label: `${OVERDUE_META.label} · 5d`, meaning: "days past the due date" },
    {
      state: "escalated",
      label: `${ESCALATED_META.label} · 20d`,
      meaning: `overdue for more than ${plural(escalationDays, "day")}`,
    },
    // isAwaited: left from before a moved start month, or the company is no longer active.
    { state: "not_submitted", label: SUBMISSION_STATUS_META.draft.label, meaning: "dimmed: no longer requested", dimmed: true },
  ];

  return (
    <section aria-label="Legend" className="flex flex-col gap-2 text-xs text-muted-foreground">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {chips.map((chip) => (
          <li key={`${chip.state}:${chip.meaning}`} className="flex items-center gap-1.5">
            <CellChip
              state={chip.state}
              label={chip.label}
              hasNarrative={false}
              openThreads={0}
              className={cn("h-6 w-auto [&>span:last-child]:hidden", chip.dimmed && "opacity-60")}
            />
            <span>{chip.meaning}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <li className="flex items-center gap-1.5">
          <NarrativeDot filled className="text-foreground/70" />
          Narrative included
        </li>
        <li className="flex items-center gap-1.5">
          <NarrativeDot filled={false} className="text-foreground/70" />
          No narrative
        </li>
        <li className="flex items-center gap-1.5">
          <ThreadBadge count={2} inline />
          Open comment threads
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-flex w-4 justify-center text-foreground/60">
            –
          </span>
          Outside the reporting range
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-flex h-5 items-center rounded-md border border-dashed border-muted-foreground/30 px-1.5"
          >
            {MISSING_META.label}
          </span>
          {MISSING_META.description}
        </li>
      </ul>
    </section>
  );
}
