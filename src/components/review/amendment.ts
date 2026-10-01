// A company owner's amendment request on an approved (locked) month (BRD §6.1 "Changing a locked month", B8):
// `request_amendment` adds a shared comment thread starting "Amendment requested: " and an
// `amendment_requested` event; the month stays approved until ScaleUp reopens it. The request is pending
// while that thread is open and was raised after the month's latest approval: ScaleUp answers it by
// reopening the month (it is then no longer approved) or by replying and resolving the thread. The tracker
// counts pending requests as needing attention and the review page shows them next to "Reopen". Pure and
// client-safe.

/** The start of the thread `request_amendment` creates (the database writes it; never translate it). */
export const AMENDMENT_PREFIX = "Amendment requested: ";

/** A thread an owner's amendment request created (by its first comment). */
export function isAmendmentThread(body: string | null | undefined): boolean {
  return typeof body === "string" && body.startsWith(AMENDMENT_PREFIX);
}

/** The reason the owner gave (the thread's first comment without the prefix). */
export function amendmentReason(body: string): string {
  return isAmendmentThread(body) ? body.slice(AMENDMENT_PREFIX.length).trim() : body.trim();
}

type MonthState = { status: string; approvedAt: string | null };
type ThreadState = { body: string; createdAt: string; resolved: boolean; shared: boolean };

function instant(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Whether this thread is a pending amendment request of this month: the month is approved, and the thread
 * is an open, shared amendment thread raised after the month was (last) approved — an older request was
 * already answered when the month was reopened and approved again.
 */
export function isPendingAmendment(month: MonthState, thread: ThreadState): boolean {
  if (month.status !== "approved" || thread.resolved || !thread.shared || !isAmendmentThread(thread.body)) return false;
  const approved = instant(month.approvedAt);
  const raised = instant(thread.createdAt);
  return approved === null || raised === null || raised >= approved;
}

export type PendingAmendment = { threadId: string; requestedAt: string; reason: string };

/** The latest pending amendment request of a month among its comment threads, or null. */
export function pendingAmendment(
  month: MonthState,
  threads: ReadonlyArray<{ id: string; resolved: boolean; visibility: string; root: { body: string; createdAt: string } }>,
): PendingAmendment | null {
  const pending = threads
    .filter((thread) =>
      isPendingAmendment(month, {
        body: thread.root.body,
        createdAt: thread.root.createdAt,
        resolved: thread.resolved,
        shared: thread.visibility === "shared",
      }),
    )
    .sort((a, b) => (instant(b.root.createdAt) ?? 0) - (instant(a.root.createdAt) ?? 0));
  const latest = pending[0];
  return latest ? { threadId: latest.id, requestedAt: latest.root.createdAt, reason: amendmentReason(latest.root.body) } : null;
}
