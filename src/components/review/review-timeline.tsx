import { TONE_DOT_CLASSES } from "@/components/app/tone";
import { COMPANY_ROLE_LABELS, SCALEUP_LABEL, SCALEUP_ROLE_LABELS, SUBMISSION_EVENT_LABELS, type Tone } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import type { SubmissionEventWithActor } from "@/lib/types/domain";
import { SUBMISSION_EVENTS, type CompanyRole, type SubmissionEvent } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

const EVENT_TONES: Record<SubmissionEvent, Tone> = {
  submitted: "info",
  resubmitted: "info",
  changes_requested: "warning",
  approved: "success",
  reopened: "warning",
  amendment_requested: "warning",
  deadline_extended: "neutral",
};

function isSubmissionEvent(value: string): value is SubmissionEvent {
  return (SUBMISSION_EVENTS as readonly string[]).includes(value);
}

export type ReviewTimelineProps = {
  /** bundle.events (oldest first); shown newest first. */
  events: SubmissionEventWithActor[];
  /** Company role per member (for company actors' role labels). */
  memberRoles: Readonly<Record<string, CompanyRole>>;
  /** When the month was opened (submission created) and its first due date. */
  opened: { at: string; dueDate: string };
};

function actorText(event: SubmissionEventWithActor, memberRoles: Readonly<Record<string, CompanyRole>>): string {
  // ScaleUp pages see every profile; an event without a visible actor was recorded by ScaleUp's system.
  const name = event.actor_name ?? SCALEUP_LABEL;
  const role = event.actor?.scaleup_role
    ? SCALEUP_ROLE_LABELS[event.actor.scaleup_role]
    : event.actor_id && memberRoles[event.actor_id]
      ? COMPANY_ROLE_LABELS[memberRoles[event.actor_id]]
      : null;
  return role ? `${name} · ${role}` : name;
}

/** The month's history (submission_events, SUBMISSION_EVENT_LABELS), newest first, ending with when it opened. */
export function ReviewTimeline({ events, memberRoles, opened }: ReviewTimelineProps) {
  const newestFirst = [...events].reverse();
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {newestFirst.map((event) => {
        const kind = isSubmissionEvent(event.event) ? event.event : null;
        const tone: Tone = kind ? EVENT_TONES[kind] : "neutral";
        const label = kind ? SUBMISSION_EVENT_LABELS[kind] : event.event;
        return (
          <li key={event.id} className="relative flex flex-col gap-1">
            <span
              aria-hidden="true"
              className={cn("absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-card", TONE_DOT_CLASSES[tone])}
            />
            <p className="text-sm">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground"> · {actorText(event, memberRoles)}</span>
            </p>
            <time dateTime={event.created_at} className="text-xs text-muted-foreground tabular-nums">
              {formatDateTime(event.created_at)}
            </time>
            {event.message?.trim() ? (
              <blockquote className="mt-1 rounded-md border-l-2 bg-muted/40 px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground/90">
                {event.message.trim()}
              </blockquote>
            ) : null}
          </li>
        );
      })}
      <li className="relative flex flex-col gap-1">
        <span aria-hidden="true" className={cn("absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-card", TONE_DOT_CLASSES.neutral)} />
        <p className="text-sm">
          <span className="font-medium">Month opened</span>
          <span className="text-muted-foreground"> · due {formatDate(opened.dueDate)}</span>
        </p>
        <time dateTime={opened.at} className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(opened.at)}
        </time>
      </li>
    </ol>
  );
}
