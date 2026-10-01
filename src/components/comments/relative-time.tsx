"use client";

import { useSyncExternalStore } from "react";

import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}

/** The current time rounded to the tick, so repeated reads between ticks return the same value. */
function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

function getServerSnapshot(): null {
  return null;
}

/**
 * The current time, updated every 30 seconds — null while server rendering and hydrating, so clock-dependent
 * text is only rendered on the client (no hydration mismatch).
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * "5 minutes ago", "yesterday", "12 Aug 2026" (formatRelative, Malaysia time), with the exact date and time
 * in the tooltip. Server-rendered as the exact date and time, then switches to relative text on the client.
 */
export function RelativeTime({ value, className }: { value: string; className?: string }) {
  const now = useNow();
  const exact = formatDateTime(value);
  return (
    <time dateTime={value} title={exact} className={cn("tabular-nums", className)}>
      {now === null ? exact : formatRelative(value, now)}
    </time>
  );
}
