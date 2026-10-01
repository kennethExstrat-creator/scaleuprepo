// Tailwind classes for the status tones in `@/lib/constants` (Tone). Use these instead of
// ad-hoc colours so statuses look the same everywhere (tracker cells, badges, flags).
import type { Tone } from "@/lib/constants";

/** Tinted pill: background + text + hairline ring. */
export const TONE_BADGE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-foreground/75 ring-foreground/10",
  info: "bg-info/10 text-info ring-info/20",
  warning: "bg-warning/10 text-warning ring-warning/25",
  success: "bg-success/10 text-success ring-success/20",
  danger: "bg-destructive/10 text-destructive ring-destructive/20",
};

/** Solid dot (e.g. legend markers, narrative indicators). */
export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-destructive",
};

/** Text colour only. */
export const TONE_TEXT_CLASSES: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  warning: "text-warning",
  success: "text-success",
  danger: "text-destructive",
};
