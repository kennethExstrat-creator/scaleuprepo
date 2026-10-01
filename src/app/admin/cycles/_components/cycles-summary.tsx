import { TONE_DOT_CLASSES, TONE_TEXT_CLASSES } from "@/components/app/tone";
import type { Tone } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { monthLabelLong } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { effectiveDue, plural, type CycleMonth, type CyclesData } from "../_lib/cycles-model";

/**
 * "due 15 Oct 2026", "due 15 Oct 2026 (1 company later)" when some companies are due later, or the date
 * every company is due when they all share a later one (e.g. a month that opened late).
 */
function dueText(month: CycleMonth, word: "Due" | "due" = "due"): string {
  const due = effectiveDue(month);
  const later = due.later > 0 ? ` (${plural(due.later, "company", "companies")} later)` : "";
  return `${word} ${formatDate(due.date)}${later}`;
}

function Tile({
  label,
  value,
  caption,
  tone,
  emphasise,
}: {
  label: string;
  value: string;
  caption: string;
  tone: Tone;
  emphasise?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT_CLASSES[tone])} />
        {label}
      </span>
      <span className={cn("text-xl font-semibold tracking-tight", emphasise && TONE_TEXT_CLASSES[tone])}>{value}</span>
      <span className="text-xs text-pretty text-muted-foreground">{caption}</span>
    </div>
  );
}

/**
 * The cycle at a glance: the latest open month, what is overdue, the current month (opens on the 1st of
 * the next month, or already opened early) and the next quarter / half close.
 */
export function CyclesSummary({ data }: { data: CyclesData }) {
  const latest = data.months[0] ?? null;
  const current = data.months.find((month) => month.month === data.currentMonth) ?? null;
  const upcomingLabels = data.upcoming.map((close) => close.period.label);
  const upcomingFirst = data.upcoming[0] ?? null;

  return (
    <section aria-label="Cycle summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Latest open month"
        value={latest ? monthLabelLong(latest.month) : "None yet"}
        tone="info"
        caption={
          latest
            ? `${dueText(latest, "Due")} · ${latest.progress.submitted} of ${plural(latest.progress.total, "company", "companies")} submitted`
            : "Months open once companies have a reporting start month."
        }
      />
      <Tile
        label="Overdue"
        value={String(data.overdue.overdue)}
        tone="danger"
        emphasise={data.overdue.overdue > 0}
        caption={
          data.overdue.overdue === 0
            ? "Nothing is past its due date."
            : `${plural(data.overdue.companies, "company", "companies")}` +
              (data.overdue.escalated > 0
                ? ` · ${data.overdue.escalated} escalated (over ${plural(data.escalationDays, "day")})`
                : "")
        }
      />
      <Tile
        label="This month"
        value={monthLabelLong(data.currentMonth)}
        tone={current ? "success" : "neutral"}
        caption={
          current
            ? `Open${current.openedEarly ? " early" : ""} since ${formatDate(current.openedAt)} · ${dueText(current)}`
            : data.openEarly
              ? `Opens automatically on ${formatDate(data.openEarly.opensOn)} · due ${formatDate(data.openEarly.dueDate)}`
              : "Opens automatically on the 1st of next month."
        }
      />
      <Tile
        label="Next close"
        value={upcomingLabels.length > 0 ? upcomingLabels.join(" · ") : "—"}
        tone="neutral"
        caption={
          upcomingFirst
            ? `With ${monthLabelLong(upcomingFirst.lastMonth)} · opens ${formatDate(upcomingFirst.opensOn)}`
            : "Quarters and halves follow the calendar year."
        }
      />
    </section>
  );
}
