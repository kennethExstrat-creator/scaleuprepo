import Link from "next/link";

import { TONE_BADGE_CLASSES } from "@/components/app/tone";
import { cn } from "@/lib/utils";

import type { CellState, TrackerCell } from "../_lib/tracker-model";

/** Cell colours: the status tones (SUBMISSION_STATUS_META / OVERDUE_META); escalated is solid red. */
export const CELL_STATE_CLASSES: Record<CellState, string> = {
  not_submitted: TONE_BADGE_CLASSES.neutral,
  submitted: TONE_BADGE_CLASSES.info,
  changes_requested: TONE_BADGE_CLASSES.warning,
  approved: TONE_BADGE_CLASSES.success,
  // Approved, but the owner asked to amend it (BRD B8): amber with a dashed ring, unlike "changes requested".
  amendment_requested: `${TONE_BADGE_CLASSES.warning} outline-1 outline-dashed outline-warning/70 -outline-offset-4`,
  overdue: TONE_BADGE_CLASSES.danger,
  escalated: "bg-destructive text-white ring-destructive",
};

/** Filled = narrative included; hollow = skipped (shape, not only colour, carries the meaning). */
export function NarrativeDot({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        filled ? "bg-current" : "ring-1 ring-current ring-inset",
        className,
      )}
    />
  );
}

/**
 * Open comment threads: a count badge on the chip's corner (takes no width). `inline` renders it in
 * the text flow, e.g. in the legend.
 */
export function ThreadBadge({ count, inline, className }: { count: number; inline?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] leading-none font-semibold text-background tabular-nums ring-2 ring-card",
        inline ? "relative" : "absolute -top-1.5 -right-1.5",
        className,
      )}
    >
      {count}
    </span>
  );
}

/** The chip of a month: status (or overdue days), narrative dot and open threads. */
export function CellChip({
  state,
  label,
  hasNarrative,
  openThreads,
  className,
}: {
  state: CellState;
  label: string;
  hasNarrative: boolean;
  openThreads: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        CELL_STATE_CLASSES[state],
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <NarrativeDot filled={hasNarrative} className="ml-auto" />
      {openThreads > 0 ? <ThreadBadge count={openThreads} /> : null}
    </span>
  );
}

/**
 * One month of one company. Updates link to their review page (every ScaleUp role may open it; the
 * review page decides what each role can do); months the company is no longer expected to send are
 * dimmed (isAwaited; the tooltip says why). Empty months: "–" outside the reporting range, a dashed
 * "Missing" inside it.
 */
export function TrackerCellView({ cell, dimmed }: { cell: TrackerCell; dimmed?: boolean }) {
  if (cell.kind === "outside") {
    return (
      <span
        title={cell.details}
        className={cn("flex h-8 items-center justify-center text-muted-foreground/60", dimmed && "opacity-60")}
      >
        <span aria-hidden="true">–</span>
        <span className="sr-only">{cell.name}</span>
      </span>
    );
  }
  if (cell.kind === "missing") {
    return (
      <span
        title={cell.details}
        className={cn(
          "flex h-8 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-xs text-muted-foreground",
          dimmed && "opacity-60",
        )}
      >
        {cell.name}
      </span>
    );
  }
  return (
    <Link
      href={`/admin/review/${cell.submission.id}`}
      prefetch={false}
      title={cell.details}
      aria-label={cell.name}
      className={cn(
        "block rounded-md outline-none transition-[opacity,filter] hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/60",
        !cell.matches && "opacity-35 hover:opacity-100",
        cell.matches && (dimmed || !cell.awaited) && "opacity-60",
      )}
    >
      <CellChip
        state={cell.state}
        label={cell.label}
        hasNarrative={cell.submission.hasNarrative}
        openThreads={cell.submission.openThreads}
      />
    </Link>
  );
}
