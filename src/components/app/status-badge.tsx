import { cn } from "@/lib/utils";

import { TONE_BADGE_CLASSES } from "@/components/app/tone";
import { OVERDUE_META, SUBMISSION_STATUS_META, type Tone } from "@/lib/constants";
import type { SubmissionStatus } from "@/lib/types/enums";

/**
 * Pill for a generic tone, e.g. internal ratings:
 * `<ToneBadge tone={INTERNAL_RATING_META[r].tone}>{INTERNAL_RATING_META[r].label}</ToneBadge>`.
 */
export function ToneBadge({
  tone,
  children,
  title,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE_BADGE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Submission status pill (labels and tones from SUBMISSION_STATUS_META). Pass `overdue`
 * (e.g. `v_submission_overview.is_overdue`) to show the red "Overdue" variant instead.
 */
export function StatusBadge({
  status,
  overdue = false,
  className,
}: {
  status: SubmissionStatus;
  overdue?: boolean;
  className?: string;
}) {
  const meta = overdue ? OVERDUE_META : SUBMISSION_STATUS_META[status];
  return (
    <ToneBadge tone={meta.tone} title={meta.description} className={className}>
      {meta.label}
    </ToneBadge>
  );
}
