// An owner's amendment request on an approved month (BRD B8): pending while its "Amendment requested: …"
// thread is open and was raised after the latest approval (src/components/review/amendment.ts), shown on
// the review page next to "Reopen" and on the tracker.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { amendmentReason, isPendingAmendment, pendingAmendment } from "@/components/review/amendment";
import { reviewStatusSummary } from "@/components/review/review-state";
import { withAmendmentRequests } from "@/app/admin/tracker/_lib/load-tracker";

const APPROVED = { status: "approved", approvedAt: "2026-08-20T02:00:00Z" };
const thread = (overrides: Partial<{ id: string; resolved: boolean; visibility: string; body: string; createdAt: string }> = {}) => {
  const { body = "Amendment requested: GP was overstated by RM 2,000.", createdAt = "2026-09-02T03:00:00Z", ...rest } = overrides;
  return { id: "t1", resolved: false, visibility: "shared", ...rest, root: { body, createdAt } };
};

describe("pending amendment requests", () => {
  it("is pending while the request thread is open and newer than the approval", () => {
    expect(pendingAmendment(APPROVED, [thread()])).toEqual({
      threadId: "t1",
      requestedAt: "2026-09-02T03:00:00Z",
      reason: "GP was overstated by RM 2,000.",
    });
    expect(pendingAmendment(APPROVED, [thread({ resolved: true })])).toBeNull(); // answered in the thread
    expect(pendingAmendment(APPROVED, [thread({ createdAt: "2026-08-01T00:00:00Z" })])).toBeNull(); // before re-approval
    expect(pendingAmendment({ ...APPROVED, status: "changes_requested" }, [thread()])).toBeNull(); // reopened
    expect(pendingAmendment(APPROVED, [thread({ body: "Please check the GP figure." })])).toBeNull();
    expect(pendingAmendment(APPROVED, [thread({ visibility: "internal" })])).toBeNull();
    expect(isPendingAmendment({ status: "approved", approvedAt: null }, { body: "Amendment requested: x", createdAt: "2026-09-02", resolved: false, shared: true })).toBe(true);
    expect(amendmentReason("Amendment requested:  Typo in cash ")).toBe("Typo in cash");
  });

  it("says so in the review panel, next to Reopen", () => {
    const amendment = pendingAmendment(APPROVED, [thread()]);
    const summary = reviewStatusSummary("approved", { companyName: "Kiddocare", monthLabel: "August 2026", companyActive: true, amendment });
    expect(summary.title).toBe("Amendment requested");
    expect(summary.description).toContain("Kiddocare's owner asked on 2 Sep 2026 to amend August 2026: “GP was overstated by RM 2,000.”");
    expect(summary.description).toContain("Reopen the month");
    const exited = reviewStatusSummary("approved", { companyName: "OldCo", monthLabel: "August 2026", companyActive: false, amendment });
    expect(exited.description).toContain("cannot be reopened");
    expect(reviewStatusSummary("approved", { companyName: "Kiddocare", monthLabel: "August 2026", companyActive: true }).title).toBe(
      "Approved and locked",
    );
  });

  it("marks the tracker's approved months that have a pending request", () => {
    const month = (id: string, status: "approved" | "submitted") => ({
      id,
      companyId: "c1",
      month: "2026-08",
      status,
      dueDate: "2026-09-15",
      originalDueDate: null,
      submittedAt: null,
      approvedAt: status === "approved" ? "2026-08-20T02:00:00Z" : null,
      revision: 1,
      isOverdue: false,
      daysOverdue: 0,
      hasNarrative: false,
      openThreads: 1,
    });
    const rows = [month("s1", "approved"), month("s2", "submitted"), month("s3", "approved")];
    const marked = withAmendmentRequests(rows, [
      { submission_id: "s1", body: "Amendment requested: wrong cash", created_at: "2026-09-02T03:00:00Z" },
      { submission_id: "s2", body: "Amendment requested: old", created_at: "2026-09-02T03:00:00Z" },
      { submission_id: "s3", body: "Amendment requested: before", created_at: "2026-08-01T00:00:00Z" },
    ]);
    expect(marked.map((row) => row.amendmentRequested ?? false)).toEqual([true, false, false]);
    expect(withAmendmentRequests(rows, [])).toBe(rows);
  });
});
