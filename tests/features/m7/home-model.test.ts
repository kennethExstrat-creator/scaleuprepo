import { describe, expect, it } from "vitest";

import {
  changeEventActorIds,
  changeRequests,
  draftsBeforeStart,
  dueStatus,
  focusMonth,
  latestFigures,
  latestMonth,
  latestSubmittedMonth,
  monthListText,
  monthsNeedingAction,
  nextMonthTiming,
  nextMonthToOpen,
  openThreadMonths,
  overdueMonths,
  scaleUpAuthor,
  summariseCloses,
  upcomingCloses,
  updateHref,
  type ChangeEvent,
  type HomeClose,
  type HomeSubmission,
} from "@/app/portal/[companyId]/_components/home-model";
import type { FinancialSeriesPoint } from "@/lib/types/domain";

const COMPANY = "c0000000-0000-4000-8000-000000000001";

function month(monthDate: string, overrides: Partial<HomeSubmission> = {}): HomeSubmission {
  return {
    id: `s-${monthDate}`,
    month: monthDate,
    status: "draft",
    due_date: "2026-10-15",
    original_due_date: null,
    submitted_at: null,
    approved_at: null,
    revision: 0,
    last_saved_at: null,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: false,
    open_threads: 0,
    ...overrides,
  };
}

// Newest first, as listCompanySubmissions returns them.
const SUBMISSIONS: HomeSubmission[] = [
  month("2026-09-01", { due_date: "2026-10-15" }),
  month("2026-08-01", { status: "changes_requested", due_date: "2026-10-05", revision: 1, open_threads: 2 }),
  month("2026-07-01", { status: "draft", due_date: "2026-08-15", is_overdue: true, days_overdue: 46, open_threads: 1 }),
  month("2026-06-01", { status: "approved", approved_at: "2026-07-18T02:00:00Z", revision: 1 }),
];

const months = (rows: readonly HomeSubmission[]) => rows.map((s) => s.month);

describe("months to work on", () => {
  it("lists months still to submit, oldest first, and focuses on the earliest", () => {
    expect(months(monthsNeedingAction(SUBMISSIONS, "2026-06-01"))).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(focusMonth(SUBMISSIONS, "2026-06-01")?.month).toBe("2026-07-01");
    expect(focusMonth([month("2026-06-01", { status: "approved" })], "2026-06-01")).toBeNull();
    expect(focusMonth([], "2026-06-01")).toBeNull();
  });

  // Today is 1 Oct 2026. The admin first set July as the start month (July and August opened), then
  // corrected it to September: July and August stay as drafts, but they are not required any more.
  const moved = [
    month("2026-09-01", { due_date: "2026-10-15" }),
    month("2026-08-01", { due_date: "2026-09-15" }),
    month("2026-07-01", { due_date: "2026-08-15" }),
  ];

  it("skips drafts left from before a start month that was moved later", () => {
    expect(months(monthsNeedingAction(moved, "2026-09-01"))).toEqual(["2026-09-01"]);
    expect(focusMonth(moved, "2026-09-01")?.month).toBe("2026-09-01");
    // September submitted: nothing left to do (the company is up to date).
    const septemberSent = [month("2026-09-01", { status: "submitted" }), ...moved.slice(1)];
    expect(monthsNeedingAction(septemberSent, "2026-09-01")).toEqual([]);
    expect(focusMonth(septemberSent, "2026-09-01")).toBeNull();
    // Moved past every open month: nothing to do until the start month opens.
    expect(focusMonth(moved, "2026-11-01")).toBeNull();
    // The start month accepts either format.
    expect(months(monthsNeedingAction(moved, "2026-08"))).toEqual(["2026-08-01", "2026-09-01"]);
  });

  it("keeps months sent back, even from before the start month", () => {
    const sentBack = [moved[0], moved[1], month("2026-07-01", { status: "changes_requested" })];
    expect(months(monthsNeedingAction(sentBack, "2026-09-01"))).toEqual(["2026-07-01", "2026-09-01"]);
  });

  it("without a start month (cleared): no drafts, except those that must go before a month sent back", () => {
    expect(monthsNeedingAction(moved, null)).toEqual([]);
    expect(focusMonth(moved, null)).toBeNull();
    // Rule 6 counts every earlier draft when there is no start month, so July must be submitted before
    // August can go back to ScaleUp; September (after it) is not required.
    const sentBack = [moved[0], month("2026-08-01", { status: "changes_requested" }), moved[2]];
    expect(months(monthsNeedingAction(sentBack, null))).toEqual(["2026-07-01", "2026-08-01"]);
    expect(focusMonth(sentBack, null)?.month).toBe("2026-07-01");
  });

  it("lists the drafts left from before the start month", () => {
    expect(months(draftsBeforeStart(moved, "2026-09-01"))).toEqual(["2026-07-01", "2026-08-01"]);
    expect(draftsBeforeStart([moved[0], month("2026-08-01", { status: "approved" })], "2026-09-01")).toEqual([]);
    expect(draftsBeforeStart(moved, "2026-07-01")).toEqual([]);
    expect(draftsBeforeStart(moved, null)).toEqual([]);
  });

  it("lists overdue months and finds the latest month, and the latest submitted one", () => {
    expect(months(overdueMonths(SUBMISSIONS))).toEqual(["2026-07-01"]);
    expect(latestMonth(SUBMISSIONS)?.month).toBe("2026-09-01");
    expect(latestMonth([])).toBeNull();
    expect(latestSubmittedMonth(SUBMISSIONS)?.month).toBe("2026-06-01");
    expect(latestSubmittedMonth([...SUBMISSIONS, month("2026-10-01", { status: "submitted" })])?.month).toBe("2026-10-01");
    expect(latestSubmittedMonth(moved)).toBeNull();
  });

  it("joins month names for sentences", () => {
    expect(monthListText([])).toBe("");
    expect(monthListText([month("2026-07-01")])).toBe("Jul 2026");
    expect(monthListText([month("2026-07-01"), month("2026-08-01")])).toBe("Jul 2026 and Aug 2026");
    expect(monthListText(moved.slice().reverse())).toBe("Jul 2026, Aug 2026 and Sep 2026");
  });

  it("builds the form link from a stored month", () => {
    expect(updateHref(COMPANY, "2026-08-01")).toBe(`/portal/${COMPANY}/updates/2026-08`);
    expect(updateHref(COMPANY, "2026-08")).toBe(`/portal/${COMPANY}/updates/2026-08`);
  });
});

describe("dueStatus", () => {
  const due = (dueDate: string, overrides: Partial<HomeSubmission> = {}) =>
    dueStatus({ due_date: dueDate, is_overdue: false, days_overdue: 0, ...overrides }, "2026-09-30");

  it("words the due date relative to today (Malaysia time)", () => {
    expect(due("2026-09-15", { is_overdue: true, days_overdue: 15 })).toEqual({ text: "15 days overdue", tone: "danger" });
    expect(due("2026-09-29", { is_overdue: true, days_overdue: 1 })).toEqual({ text: "1 day overdue", tone: "danger" });
    expect(due("2026-09-30")).toEqual({ text: "Due today", tone: "warning" });
    expect(due("2026-10-01")).toEqual({ text: "Due tomorrow", tone: "warning" });
    expect(due("2026-10-07")).toEqual({ text: "Due in 7 days", tone: "warning" });
    expect(due("2026-10-15")).toEqual({ text: "Due in 15 days", tone: "neutral" });
    // Past the date but not overdue (e.g. the company is not reporting): no alarm.
    expect(due("2026-09-01")).toEqual({ text: "Past its due date", tone: "neutral" });
  });
});

describe("nextMonthToOpen", () => {
  const base = { status: "active" as const, startMonth: "2026-07-01", today: "2026-09-30", dueDay: 15 };

  it("is the month after the latest one, opening on the 1st of the following month", () => {
    expect(nextMonthToOpen({ ...base, latest: "2026-08" })).toEqual({
      month: "2026-09",
      opensOn: "2026-10-01",
      dueOn: "2026-10-15",
      alreadyDue: false,
    });
  });

  it("starts at the reporting start month and flags months that should already be open", () => {
    expect(nextMonthToOpen({ ...base, latest: null })).toMatchObject({
      month: "2026-07",
      opensOn: "2026-08-01",
      dueOn: null,
      alreadyDue: true,
    });
    expect(nextMonthToOpen({ ...base, startMonth: "2026-10-01", latest: null })).toEqual({
      month: "2026-10",
      opensOn: "2026-11-01",
      dueOn: "2026-11-15",
      alreadyDue: false,
    });
    expect(nextMonthToOpen({ ...base, startMonth: "2026-12-01", latest: "2026-08" })?.month).toBe("2026-12");
    // The due day is capped at the month's length (November has 30 days).
    expect(nextMonthToOpen({ ...base, dueDay: 31, latest: "2026-09" })?.dueOn).toBe("2026-11-30");
  });

  it("is null for companies that are not reporting or no longer active", () => {
    expect(nextMonthToOpen({ ...base, startMonth: null, latest: "2026-08" })).toBeNull();
    expect(nextMonthToOpen({ ...base, status: "exited", latest: "2026-08" })).toBeNull();
  });

  it("never gives a due date that has passed: a month opening late gets its grace period from opening (B4)", () => {
    // open_due_periods failed (e.g. no published template): July should have opened on 1 Aug and its usual
    // due date (15 Aug) has passed, so the real one is only known once it opens.
    expect(nextMonthToOpen({ ...base, today: "2026-10-01", latest: null })).toEqual({
      month: "2026-07",
      opensOn: "2026-08-01",
      dueOn: null,
      alreadyDue: true,
    });
    // Should already be open, but its usual due date is still ahead (or today): that date stands.
    expect(nextMonthToOpen({ ...base, today: "2026-10-01", latest: "2026-08" })).toEqual({
      month: "2026-09",
      opensOn: "2026-10-01",
      dueOn: "2026-10-15",
      alreadyDue: true,
    });
    expect(nextMonthToOpen({ ...base, today: "2026-10-15", latest: "2026-08" })?.dueOn).toBe("2026-10-15");
    expect(nextMonthToOpen({ ...base, today: "2026-10-16", latest: "2026-08" })?.dueOn).toBeNull();
  });
});

describe("nextMonthTiming", () => {
  it("words when the next month opens and is due", () => {
    expect(nextMonthTiming({ opensOn: "2026-11-01", dueOn: "2026-11-15", alreadyDue: false })).toBe(
      "opens on 1 Nov 2026 and is due by 15 Nov 2026",
    );
    expect(nextMonthTiming({ opensOn: "2026-10-01", dueOn: "2026-10-15", alreadyDue: true })).toBe(
      "opens shortly and is due by 15 Oct 2026",
    );
    expect(nextMonthTiming({ opensOn: "2026-08-01", dueOn: null, alreadyDue: true })).toBe(
      "opens shortly; you'll see its due date here once it opens",
    );
  });
});

describe("changeRequests", () => {
  // ScaleUp staff ids as company-visible rows carry them (submission_events.actor_id).
  const RENUKA = "a1000000-0000-4000-8000-000000000005";
  const AARON = "a1000000-0000-4000-8000-000000000006";
  const NAMES = { [RENUKA]: "Renuka Sena (ScaleUp)", [AARON]: "Aaron Sarma (ScaleUp)" };

  const events: ChangeEvent[] = [
    { id: 1, submission_id: "s-2026-08-01", event: "changes_requested", actor_id: AARON, message: "Old message", created_at: "2026-09-10T02:00:00Z" },
    { id: 3, submission_id: "s-2026-08-01", event: "changes_requested", actor_id: RENUKA, message: "  Please split revenue by outlet.  ", created_at: "2026-09-20T02:00:00Z" },
    { id: 4, submission_id: "s-2026-08-01", event: "deadline_extended", actor_id: AARON, message: "Due date extended", created_at: "2026-09-21T02:00:00Z" },
    { id: 5, submission_id: "s-2026-05-01", event: "reopened", actor_id: null, message: "Restated per audited accounts", created_at: "2026-09-22T02:00:00Z" },
  ];

  it("gives each month sent back its latest message", () => {
    const requests = changeRequests(SUBMISSIONS, events, NAMES);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      message: "Please split revenue by outlet.",
      author: "Renuka Sena (ScaleUp)",
      requestedAt: "2026-09-20T02:00:00Z",
      kind: "changes_requested",
    });
    expect(requests[0].submission.month).toBe("2026-08-01");
  });

  it("recognises reopened months and missing messages, oldest month first", () => {
    const subs = [
      month("2026-08-01", { status: "changes_requested" }),
      month("2026-05-01", { status: "changes_requested" }),
      month("2026-04-01", { status: "changes_requested" }),
    ];
    const blank: ChangeEvent = { id: 9, submission_id: "s-2026-04-01", event: "changes_requested", actor_id: AARON, message: "   ", created_at: "2026-09-01T00:00:00Z" };
    const requests = changeRequests(subs, [...events, blank], NAMES);
    expect(requests.map((r) => [r.submission.month, r.kind, r.message, r.author])).toEqual([
      ["2026-04-01", "changes_requested", null, "Aaron Sarma (ScaleUp)"],
      ["2026-05-01", "reopened", "Restated per audited accounts", "ScaleUp"],
      ["2026-08-01", "changes_requested", "Please split revenue by outlet.", "Renuka Sena (ScaleUp)"],
    ]);
    expect(changeRequests([month("2026-03-01", { status: "changes_requested" })], [])[0]).toMatchObject({
      message: null,
      author: "ScaleUp",
      requestedAt: null,
      kind: "changes_requested",
    });
  });

  it("breaks timestamp ties by event id", () => {
    const tie: ChangeEvent[] = [
      { id: 7, submission_id: "s-2026-08-01", event: "changes_requested", actor_id: AARON, message: "first", created_at: "2026-09-20T02:00:00Z" },
      { id: 8, submission_id: "s-2026-08-01", event: "reopened", actor_id: RENUKA, message: "second", created_at: "2026-09-20T02:00:00Z" },
    ];
    expect(changeRequests([month("2026-08-01", { status: "changes_requested" })], tie, NAMES)[0]).toMatchObject({
      message: "second",
      author: "Renuka Sena (ScaleUp)",
      kind: "reopened",
    });
  });

  it("names authors '<full name> (ScaleUp)' (BRD B28), or 'ScaleUp' when they cannot be named", () => {
    // Names not loaded (e.g. the lookup failed): every request is still shown, signed "ScaleUp".
    expect(changeRequests(SUBMISSIONS, events).map((r) => r.author)).toEqual(["ScaleUp"]);
    // Ids are matched case-insensitively (the lookup is keyed by lower-case id).
    expect(scaleUpAuthor(RENUKA.toUpperCase(), NAMES)).toBe("Renuka Sena (ScaleUp)");
    expect(scaleUpAuthor(null, NAMES)).toBe("ScaleUp");
    // An id the lookup did not name (not ScaleUp staff) is never shown as an id or an email.
    expect(scaleUpAuthor("a1000000-0000-4000-8000-0000000000ff", NAMES)).toBe("ScaleUp");
  });

  it("lists the actors to name once each, lower-cased, without system actions", () => {
    expect(changeEventActorIds([...events, { actor_id: RENUKA.toUpperCase() }])).toEqual([AARON, RENUKA]);
    expect(changeEventActorIds([{ actor_id: null }])).toEqual([]);
    expect(changeEventActorIds([])).toEqual([]);
  });
});

describe("openThreadMonths", () => {
  it("totals the open shared threads, newest month first", () => {
    const threads = openThreadMonths(SUBMISSIONS);
    expect(threads.total).toBe(3);
    expect(threads.months.map((s) => s.month)).toEqual(["2026-08-01", "2026-07-01"]);
    expect(openThreadMonths([])).toEqual({ total: 0, months: [] });
  });
});

function point(monthDate: string, overrides: Partial<FinancialSeriesPoint> = {}): FinancialSeriesPoint {
  return {
    month: monthDate,
    submission_id: `s-${monthDate}`,
    status: "approved",
    currency: "MYR",
    fx_rate_to_myr: null,
    revenue_total: 100_000,
    gross_profit: 40_000,
    net_profit: -10_000,
    cash_in_bank: 600_000,
    burn_rate: 50_000,
    headcount_ft: 12,
    headcount_pt: 3,
    ...overrides,
  };
}

describe("latestFigures", () => {
  it("uses the newest submitted or approved month and compares with the month before", () => {
    const figures = latestFigures([
      point("2026-06-01", { revenue_total: 80_000 }),
      point("2026-07-01", { status: "submitted", revenue_total: 100_000 }),
      point("2026-08-01", { status: "draft", revenue_total: 5 }),
    ]);
    expect(figures?.point.month).toBe("2026-07-01");
    expect(figures?.previous?.month).toBe("2026-06-01");
    expect(figures).toMatchObject({
      gpPct: 40,
      npPct: -10,
      runwayMonths: 12,
      cashflowPositive: false,
      revenueGrowth: 25,
      headcount: 15,
    });
  });

  it("does not compare across a gap or with an unsubmitted month", () => {
    expect(latestFigures([point("2026-05-01"), point("2026-07-01")])?.previous).toBeNull();
    expect(latestFigures([point("2026-06-01", { status: "changes_requested" }), point("2026-07-01")])).toMatchObject({
      previous: null,
      revenueGrowth: null,
    });
  });

  it("handles cash-flow positive months and missing headcounts", () => {
    expect(latestFigures([point("2026-07-01", { burn_rate: 0, headcount_ft: null, headcount_pt: null })])).toMatchObject({
      cashflowPositive: true,
      runwayMonths: null,
      headcount: null,
    });
    expect(latestFigures([point("2026-07-01", { headcount_ft: 4, headcount_pt: null })])?.headcount).toBe(4);
  });

  it("is null before anything is submitted", () => {
    expect(latestFigures([point("2026-07-01", { status: "draft" })])).toBeNull();
    expect(latestFigures([])).toBeNull();
  });
});

describe("summariseCloses", () => {
  const q2: HomeClose = {
    id: "q2",
    period_type: "quarter",
    period_start: "2026-04-01",
    period_end: "2026-06-30",
    label: "Q2 2026",
    status: "confirmed",
    confirmed_at: "2026-07-20T02:00:00Z",
  };
  const h1: HomeClose = { ...q2, id: "h1", period_type: "half", period_start: "2026-01-01", label: "H1 2026", status: "open", confirmed_at: null };
  const q3: HomeClose = {
    id: "q3",
    period_type: "quarter",
    period_start: "2026-07-01",
    period_end: "2026-09-30",
    label: "Q3 2026",
    status: "open",
    confirmed_at: null,
  };
  const subs = [
    month("2026-04-01", { status: "approved" }),
    month("2026-05-01", { status: "submitted" }),
    month("2026-06-01", { status: "approved" }),
    month("2026-07-01", { status: "approved" }),
    month("2026-08-01", { status: "changes_requested" }),
    month("2026-09-01", { status: "draft" }),
  ];
  const docs = [
    { id: "d1", period_close_id: "q3", version: 1, uploaded_at: "2026-10-02T02:00:00Z" },
    { id: "d2", period_close_id: "q3", version: 2, uploaded_at: "2026-10-05T02:00:00Z" },
    { id: "d3", period_close_id: "q2", version: 1, uploaded_at: "2026-07-10T02:00:00Z" },
  ];

  it("counts the months from the reporting start and the latest management accounts", () => {
    const { open, lastConfirmed } = summariseCloses({ closes: [q3, q2, h1], documents: docs, submissions: subs, startMonth: "2026-04-01" });
    // H1 and Q2 end together: the quarter comes first; Q3 ends later.
    expect(open.map((c) => c.id)).toEqual(["h1", "q3"]);
    expect(open[0]).toMatchObject({ months: ["2026-04", "2026-05", "2026-06"], monthsSubmitted: 3, managementAccounts: null, rangeLabel: "Jan–Jun 2026" });
    expect(open[1]).toMatchObject({
      label: "Q3 2026",
      rangeLabel: "Jul–Sep 2026",
      periodEnd: "2026-09-30",
      months: ["2026-07", "2026-08", "2026-09"],
      monthsSubmitted: 1,
      managementAccounts: { count: 2, version: 2, uploadedAt: "2026-10-05T02:00:00Z" },
    });
    expect(lastConfirmed).toMatchObject({ id: "q2", confirmedAt: "2026-07-20T02:00:00Z" });
  });

  it("without a start month, counts from the first month with an update", () => {
    const { open } = summariseCloses({ closes: [h1], documents: [], submissions: subs, startMonth: null });
    expect(open[0].months).toEqual(["2026-04", "2026-05", "2026-06"]);
    const none = summariseCloses({ closes: [h1], documents: [], submissions: [], startMonth: null });
    expect(none.open[0]).toMatchObject({ months: [], monthsSubmitted: 0 });
    expect(none.lastConfirmed).toBeNull();
  });
});

describe("upcomingCloses", () => {
  const base = { status: "active" as const, startMonth: "2026-07-01", today: "2026-09-30" };

  it("is the current quarter while it has no close yet", () => {
    expect(upcomingCloses({ ...base, closes: [] }).map((p) => p.label)).toEqual(["Q3 2026"]);
  });

  it("adds the half when it ends with the quarter, and skips periods that already have a close", () => {
    expect(upcomingCloses({ ...base, today: "2026-11-10", closes: [] }).map((p) => p.label)).toEqual(["Q4 2026", "H2 2026"]);
    expect(
      upcomingCloses({ ...base, closes: [{ period_type: "quarter", period_start: "2026-07-01" }] }).map((p) => p.label),
    ).toEqual(["Q4 2026", "H2 2026"]);
    expect(
      upcomingCloses({
        ...base,
        today: "2026-12-05",
        closes: [{ period_type: "half", period_start: "2026-07-01" }],
      }).map((p) => p.label),
    ).toEqual(["Q4 2026"]);
  });

  it("starts at the reporting start month and needs an active, reporting company", () => {
    expect(upcomingCloses({ ...base, startMonth: "2027-02-01", closes: [] }).map((p) => p.label)).toEqual(["Q1 2027"]);
    expect(upcomingCloses({ ...base, startMonth: null, closes: [] })).toEqual([]);
    expect(upcomingCloses({ ...base, status: "written_off", closes: [] })).toEqual([]);
  });
});
