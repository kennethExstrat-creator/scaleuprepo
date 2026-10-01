import { describe, expect, it } from "vitest";

import {
  APPROVAL_TARGET_DAYS,
  DEFAULT_TRACKER_FILTERS,
  buildTracker,
  cellLabel,
  cellStateOf,
  daysToApproval,
  cellDetails,
  cellName,
  emptyCell,
  foldForSearch,
  fundOptions,
  hasActiveFilters,
  initialsOf,
  isAwaited,
  matchesStatusFilter,
  normaliseSearch,
  notAwaitedReason,
  parseTrackerFilters,
  partnerOptions,
  summariseMonth,
  toTrackerCompany,
  toTrackerSubmission,
  trackerHref,
  trackerQueryString,
  windowColumns,
  type TrackerCompany,
} from "@/app/admin/tracker/_lib/tracker-model";

import {
  COMPANIES,
  IDS,
  P1,
  P2,
  SFF,
  SUBMISSIONS,
  SV1,
  company,
  data,
  filters,
  submission,
} from "./fixtures";

const names = (rows: { company: TrackerCompany }[]) => rows.map((row) => row.company.name);

// ---------------------------------------------------------------------------------------------
// Filters and URLs
// ---------------------------------------------------------------------------------------------

describe("parseTrackerFilters", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseTrackerFilters({})).toEqual(DEFAULT_TRACKER_FILTERS);
    expect(DEFAULT_TRACKER_FILTERS).toEqual({ fund: null, partner: null, status: null, search: "", months: 6 });
  });

  it("normalises and validates every filter", () => {
    expect(
      parseTrackerFilters({
        fund: " sv1 ",
        partner: P1.toUpperCase(),
        status: "needs_attention",
        months: "12",
        search: "  Batik   Boutique ",
      }),
    ).toEqual({ fund: "SV1", partner: P1, status: "needs_attention", search: "Batik Boutique", months: 12 });
  });

  it("drops malformed values", () => {
    expect(
      parseTrackerFilters({ fund: "<script>", partner: "not-a-uuid", status: "overdue ", months: "7" }),
    ).toEqual({ ...DEFAULT_TRACKER_FILTERS, status: "overdue" });
    expect(parseTrackerFilters({ status: "draft", months: "6" })).toEqual(DEFAULT_TRACKER_FILTERS);
    expect(parseTrackerFilters({ partner: "none" }).partner).toBe("none");
  });

  it("takes the first value of repeated params and reads URLSearchParams", () => {
    expect(parseTrackerFilters({ fund: ["SFF", "SV1"] }).fund).toBe("SFF");
    expect(parseTrackerFilters(new URLSearchParams("fund=sff&status=approved&search=kid"))).toEqual({
      ...DEFAULT_TRACKER_FILTERS,
      fund: "SFF",
      status: "approved",
      search: "kid",
    });
  });

  it("cuts the search to 100 characters", () => {
    expect(parseTrackerFilters({ search: "x".repeat(150) }).search).toHaveLength(100);
    expect(normaliseSearch(null)).toBe("");
  });
});

describe("trackerQueryString / trackerHref", () => {
  it("leaves the defaults out", () => {
    expect(trackerQueryString(DEFAULT_TRACKER_FILTERS)).toBe("");
    expect(trackerHref(DEFAULT_TRACKER_FILTERS)).toBe("/admin/tracker");
  });

  it("writes the filters in a fixed order and round-trips", () => {
    const all = filters({ fund: "SV1", partner: P1, status: "overdue", months: 12, search: " batik  b " });
    expect(trackerHref(all)).toBe(`/admin/tracker?fund=SV1&partner=${P1}&status=overdue&months=12&search=batik+b`);
    expect(parseTrackerFilters(new URLSearchParams(trackerQueryString(all)))).toEqual({ ...all, search: "batik b" });
  });

  it("hasActiveFilters ignores the month window and blank searches", () => {
    expect(hasActiveFilters(filters({ months: 12, search: "   " }))).toBe(false);
    expect(hasActiveFilters(filters({ search: "a" }))).toBe(true);
    expect(hasActiveFilters(filters({ partner: "none" }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------------------------

describe("toTrackerCompany", () => {
  it("sorts and de-duplicates funds and reads the partner-in-charge", () => {
    expect(
      toTrackerCompany({
        id: IDS.kiddocare,
        name: "Kiddocare",
        status: "active",
        reporting_start_month: "2026-07-01",
        fund_investments: [{ fund: SV1 }, { fund: SFF }, { fund: SV1 }, { fund: null }],
        company_internal: { partner_in_charge_id: P1, partner: { id: P1, full_name: " Renuka Sena ", email: "r@x.my" } },
      }),
    ).toEqual({
      id: IDS.kiddocare,
      name: "Kiddocare",
      status: "active",
      startMonth: "2026-07",
      funds: [SFF, SV1],
      partner: { id: P1, name: "Renuka Sena" },
    });
  });

  it("handles missing internal rows, arrays and profiles", () => {
    const base = { id: IDS.huddle, name: "Huddle", status: "active" as const, reporting_start_month: null, fund_investments: null };
    expect(toTrackerCompany({ ...base, company_internal: null })).toMatchObject({ startMonth: null, funds: [], partner: null });
    expect(
      toTrackerCompany({ ...base, company_internal: [{ partner_in_charge_id: P2, partner: null }] }).partner,
    ).toEqual({ id: P2, name: "Unknown partner" });
    expect(
      toTrackerCompany({
        ...base,
        company_internal: { partner_in_charge_id: P2, partner: { id: P2, full_name: null, email: "aaron@scaleup.my" } },
      }).partner,
    ).toEqual({ id: P2, name: "aaron@scaleup.my" });
  });
});

describe("toTrackerSubmission", () => {
  const row = {
    id: "s1",
    company_id: IDS.batik,
    month: "2026-08-01",
    status: "submitted" as const,
    due_date: "2026-09-15",
    original_due_date: null,
    submitted_at: "2026-09-12T02:00:00+00:00",
    approved_at: null,
    revision: 1,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: true,
    open_threads: 3,
  };

  it("maps a view row", () => {
    expect(toTrackerSubmission(row)).toEqual({
      id: "s1",
      companyId: IDS.batik,
      month: "2026-08",
      status: "submitted",
      dueDate: "2026-09-15",
      originalDueDate: null,
      submittedAt: "2026-09-12T02:00:00+00:00",
      approvedAt: null,
      revision: 1,
      isOverdue: false,
      daysOverdue: 0,
      hasNarrative: true,
      openThreads: 3,
    });
  });

  it("defaults nullable flags and rejects rows without identity", () => {
    const sparse = { ...row, revision: null, is_overdue: null, days_overdue: null, has_narrative: null, open_threads: null };
    expect(toTrackerSubmission(sparse)).toMatchObject({ revision: 0, isOverdue: false, daysOverdue: 0, hasNarrative: false, openThreads: 0 });
    expect(toTrackerSubmission({ ...row, id: null })).toBeNull();
    expect(toTrackerSubmission({ ...row, month: "August" })).toBeNull();
    expect(toTrackerSubmission({ ...row, due_date: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

describe("cellStateOf / cellLabel / matchesStatusFilter", () => {
  it("escalates only after more than escalation_days overdue", () => {
    expect(cellStateOf({ status: "draft", isOverdue: true, daysOverdue: 14 }, 14)).toBe("overdue");
    expect(cellStateOf({ status: "draft", isOverdue: true, daysOverdue: 15 }, 14)).toBe("escalated");
    expect(cellStateOf({ status: "changes_requested", isOverdue: true, daysOverdue: 1 }, 14)).toBe("overdue");
    expect(cellStateOf({ status: "draft", isOverdue: false, daysOverdue: 0 }, 14)).toBe("not_submitted");
    expect(cellStateOf({ status: "submitted", isOverdue: false, daysOverdue: 0 }, 14)).toBe("submitted");
    expect(cellStateOf({ status: "changes_requested", isOverdue: false, daysOverdue: 0 }, 14)).toBe("changes_requested");
    expect(cellStateOf({ status: "approved", isOverdue: false, daysOverdue: 0 }, 14)).toBe("approved");
  });

  it("labels with the shared wording", () => {
    expect(cellLabel("overdue", 5, "draft")).toBe("Overdue · 5d");
    expect(cellLabel("escalated", 20, "changes_requested")).toBe("Escalated · 20d");
    expect(cellLabel("not_submitted", 0, "draft")).toBe("Not submitted");
    expect(cellLabel("submitted", 0, "submitted")).toBe("Submitted");
    expect(cellLabel("changes_requested", 0, "changes_requested")).toBe("Changes requested");
    expect(cellLabel("approved", 0, "approved")).toBe("Approved");
    expect(cellLabel("amendment_requested", 0, "approved")).toBe("Amendment requested");
  });

  it("matches the status filters", () => {
    const draft = { status: "draft" as const };
    const changes = { status: "changes_requested" as const };
    const submitted = { status: "submitted" as const };
    const approved = { status: "approved" as const };
    expect(matchesStatusFilter(draft, "not_submitted", null)).toBe(true);
    expect(matchesStatusFilter(draft, "not_submitted", "needs_attention")).toBe(false);
    expect(matchesStatusFilter(draft, "overdue", "needs_attention")).toBe(true);
    expect(matchesStatusFilter(submitted, "submitted", "needs_attention")).toBe(true);
    expect(matchesStatusFilter(changes, "changes_requested", "needs_attention")).toBe(true);
    expect(matchesStatusFilter(approved, "approved", "needs_attention")).toBe(false);
    expect(matchesStatusFilter(draft, "escalated", "overdue")).toBe(true);
    expect(matchesStatusFilter(draft, "overdue", "escalated")).toBe(false);
    expect(matchesStatusFilter(draft, "overdue", "not_submitted")).toBe(true);
    expect(matchesStatusFilter(changes, "overdue", "not_submitted")).toBe(false);
    expect(matchesStatusFilter(changes, "overdue", "changes_requested")).toBe(true);
    expect(matchesStatusFilter(submitted, "submitted", "submitted")).toBe(true);
    expect(matchesStatusFilter(approved, "approved", "approved")).toBe(true);
    expect(matchesStatusFilter(approved, "approved", "submitted")).toBe(false);
    expect(matchesStatusFilter(approved, "amendment_requested", "needs_attention")).toBe(true);
    expect(matchesStatusFilter(approved, "amendment_requested", "amendment_requested")).toBe(true);
    expect(matchesStatusFilter(approved, "amendment_requested", "approved")).toBe(true);
    expect(matchesStatusFilter(approved, "approved", "amendment_requested")).toBe(false);
  });

  it("names a cell for screen readers and details it in the tooltip", () => {
    const recqaJul = SUBMISSIONS[2];
    expect(cellName("RECQA", recqaJul, "overdue")).toBe("RECQA, July 2026: Overdue, 3 days");
    expect(cellName("RECQA", SUBMISSIONS[3], "escalated")).toBe("RECQA, August 2026: Escalated, 15 days overdue");
    expect(cellName("Batik Boutique", SUBMISSIONS[1], "submitted")).toBe("Batik Boutique, August 2026: Submitted");
    expect(cellDetails(recqaJul, "overdue")).toBe(
      "Changes requested, 3 days overdue. Due 27 Sep 2026 (originally 15 Aug 2026). No narrative.",
    );
    expect(cellDetails(SUBMISSIONS[1], "submitted")).toBe(
      "Submitted on 12 Sep 2026, awaiting review. Due 15 Sep 2026. Revision 2. No narrative. 2 open comment threads.",
    );
    expect(cellDetails(SUBMISSIONS[5], "approved")).toBe(
      "Approved on 18 Sep 2026. Due 15 Sep 2026. Narrative included. 1 open comment thread.",
    );
    expect(cellDetails(SUBMISSIONS[3], "escalated")).toContain("15 days overdue (escalated)");
  });

  it("explains empty months", () => {
    expect(emptyCell({ status: "active", startMonth: "2026-07" }, "2026-08")).toEqual({
      kind: "missing",
      month: "2026-08",
      name: "Missing",
      details: "No update for this month.",
    });
    expect(emptyCell({ status: "active", startMonth: "2026-07" }, "2026-06")).toEqual({
      kind: "outside",
      month: "2026-06",
      name: "Not requested",
      details: "Before the reporting start month (Jul 2026).",
    });
    expect(emptyCell({ status: "active", startMonth: null }, "2026-06").details).toBe(
      "No update requested: the company is not reporting yet.",
    );
    expect(emptyCell({ status: "exited", startMonth: "2026-01" }, "2026-06").details).toBe(
      "No update requested: the company is no longer active.",
    );
  });

  it("counts days from the month end to approval (BRD O3)", () => {
    expect(daysToApproval({ month: "2026-07", approvedAt: "2026-08-15T03:00:00Z" })).toBe(15);
    // 2026-08-20 23:30 UTC is already 21 Aug in Malaysia.
    expect(daysToApproval({ month: "2026-07", approvedAt: "2026-08-20T23:30:00Z" })).toBe(21);
    expect(daysToApproval({ month: "2026-07", approvedAt: null })).toBeNull();
    expect(daysToApproval({ month: "2026-07", approvedAt: "garbage" })).toBeNull();
  });
});

describe("initialsOf", () => {
  it("uses the first and last name, skipping titles", () => {
    expect(initialsOf("Renuka Sena")).toBe("RS");
    expect(initialsOf("Dr. Sivapalan Vivekarajah")).toBe("SV");
    expect(initialsOf("Tay Shan Li")).toBe("TL");
    expect(initialsOf("Dato' Seri Ahmad")).toBe("SA");
    expect(initialsOf("Tan Sri Ahmad Ali")).toBe("AA");
    expect(initialsOf("Tan Wei Ming")).toBe("TM");
    expect(initialsOf("Aaron")).toBe("A");
    expect(initialsOf("  élodie  durand ")).toBe("ÉD");
  });

  it("falls back to the email, then '?'", () => {
    expect(initialsOf(null, "renuka.sena@scaleup.my")).toBe("RS");
    expect(initialsOf("  ", "aaron@scaleup.my")).toBe("A");
    expect(initialsOf("", "")).toBe("?");
    expect(initialsOf(undefined)).toBe("?");
  });
});

describe("options and search helpers", () => {
  it("lists partners by name, marks the signed-in user and offers 'No partner assigned'", () => {
    expect(partnerOptions(COMPANIES, P2)).toEqual([
      { value: P2, label: "Aaron Sarma (you)" },
      { value: P1, label: "Renuka Sena" },
      { value: "none", label: "No partner assigned" },
    ]);
    expect(partnerOptions(COMPANIES.filter((c) => c.partner), "x").map((o) => o.value)).toEqual([P2, P1]);
  });

  it("lists funds by code without duplicates", () => {
    expect(fundOptions([SV1, SFF, { ...SV1, id: "dup" }])).toEqual([
      { value: "SFF", label: "SFF", description: SFF.name },
      { value: "SV1", label: "SV1", description: SV1.name },
    ]);
  });

  it("folds accents and case", () => {
    expect(foldForSearch("Café ÉRTH")).toBe("cafe erth");
  });
});

// ---------------------------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------------------------

describe("windowColumns", () => {
  it("keeps the latest months, oldest first, and marks the latest", () => {
    const columns = windowColumns(data().months, 6);
    expect(columns.map((c) => c.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(columns.map((c) => c.isLatest)).toEqual([false, false, false, false, false, true]);
    expect(columns[5]).toMatchObject({ label: "Aug 2026", longLabel: "August 2026", dueDate: "2026-09-15" });
    expect(windowColumns(data().months, 12)).toHaveLength(12);
    expect(windowColumns([{ month: "2026-08-01", dueDate: "2026-09-15" }, { month: "2026-08", dueDate: "x" }], 6)).toHaveLength(1);
    expect(windowColumns([], 6)).toEqual([]);
  });
});

describe("buildTracker", () => {
  it("builds one row per reporting company with a cell per month", () => {
    const model = buildTracker(data(), filters());
    expect(model.columns.map((c) => c.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    // Active companies by name; OldCo (exited) has no month in the window shown, so it is left out.
    expect(names(model.rows)).toEqual(["Batik Boutique", "Kiddocare", "RECQA"]);
    const batik = model.rows[0];
    expect(batik.cells.map((cell) => cell.kind)).toEqual(["outside", "outside", "outside", "outside", "submission", "submission"]);
    expect(batik.cells[0]).toMatchObject({ kind: "outside", details: "Before the reporting start month (Jul 2026)." });
    expect(batik.cells[5]).toMatchObject({
      kind: "submission",
      state: "submitted",
      label: "Submitted",
      tone: "info",
      matches: true,
      name: "Batik Boutique, August 2026: Submitted",
    });
    const recqa = model.rows[2];
    expect(recqa.cells[4]).toMatchObject({ state: "overdue", label: "Overdue · 3d", tone: "danger" });
    expect(recqa.cells[5]).toMatchObject({ state: "escalated", label: "Escalated · 15d", tone: "danger" });
    expect(model.reportingInScope).toBe(3);
  });

  it("groups not-yet-reporting companies (written off last) and hides them under a status filter", () => {
    const model = buildTracker(data(), filters());
    expect(model.notReporting.map((c) => c.name)).toEqual(["Huddle", "StayHere"]);
    expect(model.notReportingHiddenByStatus).toBe(0);
    const overdue = buildTracker(data(), filters({ status: "overdue" }));
    expect(overdue.notReporting).toEqual([]);
    expect(overdue.notReportingHiddenByStatus).toBe(2);
  });

  it("shows exited companies with months in the window, muted and last", () => {
    const model = buildTracker(data(), filters({ months: 12 }));
    expect(names(model.rows)).toEqual(["Batik Boutique", "Kiddocare", "RECQA", "OldCo"]);
    const oldco = model.rows[3];
    expect(oldco.muted).toBe(true);
    expect(oldco.cells[1]).toMatchObject({ kind: "submission", state: "approved", awaited: true });
    // Its leftover draft can never be submitted: dimmed and not chased.
    expect(oldco.cells[2]).toMatchObject({ kind: "submission", state: "not_submitted", awaited: false });
    expect(oldco.cells[3]).toMatchObject({ kind: "outside" });
  });

  it("marks months in the reporting range without an update as missing", () => {
    const withoutBatikJuly = SUBMISSIONS.filter((s) => !(s.companyId === IDS.batik && s.month === "2026-07"));
    const model = buildTracker(data({ submissions: withoutBatikJuly }), filters());
    expect(model.rows[0].cells[4]).toMatchObject({ kind: "missing", name: "Missing", details: "No update for this month." });
  });

  it("keeps a company whose start month is later, with every month outside its range", () => {
    const future = company({ id: IDS.future, name: "Future Co", startMonth: "2026-10" });
    const model = buildTracker(data({ companies: [...COMPANIES, future] }), filters());
    const row = model.rows.find((r) => r.company.id === IDS.future);
    expect(row?.cells.every((cell) => cell.kind === "outside")).toBe(true);
    expect(model.notReporting.map((c) => c.name)).not.toContain("Future Co");
  });

  it("shows a not-yet-reporting company that still has months in the window in the grid", () => {
    const history = submission(IDS.huddle, "2026-06", { status: "approved", approvedAt: "2026-07-10T02:00:00Z" });
    const model = buildTracker(data({ submissions: [...SUBMISSIONS, history] }), filters());
    const huddle = model.rows.find((r) => r.company.id === IDS.huddle);
    expect(huddle?.notYetReporting).toBe(true);
    expect(model.notReporting.map((c) => c.name)).toEqual(["StayHere"]);
  });

  it("summarises the latest open month (fund / partner scope only)", () => {
    const model = buildTracker(data(), filters());
    expect(model.summary).toEqual({
      month: "2026-08",
      dueDate: "2026-09-15",
      notYetDue: false,
      total: 3,
      notSubmitted: 0,
      overdue: 1,
      escalated: 1,
      awaitingReview: 1,
      changesRequested: 0,
      approved: 1,
      approvedWithinTarget: 1,
      received: 2,
      withNarrative: 1,
      narrativeCoveragePct: 50,
    });
    // Search and status filters narrow the rows, never the summary.
    expect(buildTracker(data(), filters({ search: "kiddo", status: "approved" })).summary).toEqual(model.summary);
    expect(buildTracker(data(), filters({ fund: "SFF" })).summary).toMatchObject({ total: 1, approved: 1, overdue: 0 });
  });

  it("counts what needs attention across the months shown", () => {
    expect(buildTracker(data(), filters()).attention).toEqual({
      overdue: 2,
      escalated: 1,
      awaitingReview: 1,
      changesRequested: 0,
      amendmentRequested: 0,
    });
    expect(buildTracker(data(), filters({ partner: P1 })).attention).toEqual({
      overdue: 0,
      escalated: 0,
      awaitingReview: 1,
      changesRequested: 0,
      amendmentRequested: 0,
    });
  });

  it("flags approved months whose owner asked to amend them as needing attention (BRD B8)", () => {
    // Kiddocare's approved month gets an open amendment request.
    const base = data();
    const approved = base.submissions.find((row) => row.status === "approved");
    expect(approved).toBeDefined();
    const submissions = base.submissions.map((row) => (row === approved ? { ...row, amendmentRequested: true } : row));
    const model = buildTracker({ ...base, submissions }, filters());
    expect(model.attention.amendmentRequested).toBe(1);
    const cell = model.rows
      .flatMap((row) => row.cells)
      .find((candidate) => candidate.kind === "submission" && candidate.submission.id === approved?.id);
    expect(cell).toMatchObject({ state: "amendment_requested", label: "Amendment requested", tone: "warning" });
    expect(cell && "details" in cell ? cell.details : "").toContain("the company owner asked to amend it");
    // It is still an approved month for the summary, and it needs attention.
    expect(model.summary).toEqual(buildTracker(base, filters()).summary);
    const attention = buildTracker({ ...base, submissions }, filters({ status: "needs_attention" }));
    expect(attention.rows.map((row) => row.company.id)).toContain(approved?.companyId);
    const only = buildTracker({ ...base, submissions }, filters({ status: "amendment_requested" }));
    expect(only.rows.map((row) => row.company.id)).toEqual([approved?.companyId]);
  });

  it("filters rows by status and dims the months that do not match", () => {
    const approved = buildTracker(data(), filters({ status: "approved" }));
    expect(names(approved.rows)).toEqual(["Batik Boutique", "Kiddocare"]);
    const batik = approved.rows[0].cells;
    expect(batik[4]).toMatchObject({ state: "approved", matches: true });
    expect(batik[5]).toMatchObject({ state: "submitted", matches: false });

    expect(names(buildTracker(data(), filters({ status: "needs_attention" })).rows)).toEqual(["Batik Boutique", "RECQA"]);
    expect(names(buildTracker(data(), filters({ status: "escalated" })).rows)).toEqual(["RECQA"]);
    expect(names(buildTracker(data(), filters({ status: "not_submitted" })).rows)).toEqual(["RECQA"]);
    expect(names(buildTracker(data(), filters({ status: "changes_requested" })).rows)).toEqual(["RECQA"]);
    expect(names(buildTracker(data(), filters({ status: "submitted" })).rows)).toEqual(["Batik Boutique"]);
  });

  it("filters by fund, partner and search", () => {
    const sff = buildTracker(data(), filters({ fund: "SFF" }));
    expect(names(sff.rows)).toEqual(["Kiddocare"]);
    expect(sff.notReporting.map((c) => c.name)).toEqual(["Huddle", "StayHere"]);

    const renuka = buildTracker(data(), filters({ partner: P1 }));
    expect(names(renuka.rows)).toEqual(["Batik Boutique"]);
    expect(renuka.notReporting.map((c) => c.name)).toEqual(["Huddle"]);

    const unassigned = buildTracker(data(), filters({ partner: "none" }));
    expect(names(unassigned.rows)).toEqual(["RECQA"]);
    expect(unassigned.notReporting.map((c) => c.name)).toEqual(["StayHere"]);

    const search = buildTracker(data(), filters({ search: "  BATIK " }));
    expect(names(search.rows)).toEqual(["Batik Boutique"]);
    expect(search.notReporting).toEqual([]);
    expect(search.reportingInScope).toBe(3);
    expect(buildTracker(data(), filters({ search: "hud" })).notReporting.map((c) => c.name)).toEqual(["Huddle"]);
  });

  it("drops unknown funds and partners instead of showing an empty grid", () => {
    const model = buildTracker(data(), filters({ fund: "XYZ", partner: "a1000000-0000-4000-8000-00000000ffff" }));
    expect(model.filters).toMatchObject({ fund: null, partner: null });
    expect(model.rows).toHaveLength(3);
  });

  it("offers the filter options", () => {
    const model = buildTracker(data(), filters());
    expect(model.options.funds.map((o) => o.value)).toEqual(["SFF", "SV1"]);
    expect(model.options.partners.map((o) => o.label)).toEqual(["Aaron Sarma (you)", "Renuka Sena", "No partner assigned"]);
  });

  it("copes with no open months", () => {
    const model = buildTracker(data({ months: [], submissions: [] }), filters());
    expect(model.columns).toEqual([]);
    expect(model.summary.month).toBeNull();
    expect(model.summary.total).toBe(0);
    // Companies with a start month still get (empty) rows; the page shows "No months are open yet".
    expect(names(model.rows)).toEqual(["Batik Boutique", "Kiddocare", "RECQA"]);
  });
});

describe("months no longer awaited (isAwaited)", () => {
  const ACTIVE = company({ id: IDS.batik, name: "Batik Boutique" });
  const EXITED = company({ id: IDS.oldco, name: "OldCo", status: "exited" });
  const WRITTEN_OFF = company({ id: IDS.stayhere, name: "StayHere", status: "written_off", startMonth: null });

  it("awaits drafts of active companies from their start month on, and months sent back while active", () => {
    expect(isAwaited(ACTIVE, { month: "2026-07", status: "draft" })).toBe(true);
    expect(isAwaited(ACTIVE, { month: "2026-06", status: "draft" })).toBe(false); // before the start month
    expect(isAwaited(company({ id: IDS.huddle, name: "Huddle", startMonth: null }), { month: "2026-08", status: "draft" })).toBe(false);
    expect(isAwaited(EXITED, { month: "2026-08", status: "draft" })).toBe(false);
    expect(isAwaited(ACTIVE, { month: "2026-06", status: "changes_requested" })).toBe(true); // ScaleUp asked
    expect(isAwaited(EXITED, { month: "2026-08", status: "changes_requested" })).toBe(false); // read-only
    // What was submitted still counts: ScaleUp can approve it (B21).
    expect(isAwaited(EXITED, { month: "2026-08", status: "submitted" })).toBe(true);
    expect(isAwaited(WRITTEN_OFF, { month: "2026-08", status: "approved" })).toBe(true);
  });

  it("says why a month is not awaited", () => {
    expect(notAwaitedReason(EXITED)).toBe("The company is no longer active and can no longer submit it");
    expect(notAwaitedReason({ status: "active", startMonth: null })).toBe("Not requested: the company is not reporting");
    expect(notAwaitedReason({ status: "active", startMonth: "2026-09" })).toBe(
      "Not requested: before the reporting start month (Sep 2026)",
    );
    expect(cellDetails(submission(IDS.batik, "2026-08"), "not_submitted", notAwaitedReason(EXITED))).toBe(
      "Not submitted. The company is no longer active and can no longer submit it. Due 15 Sep 2026. No narrative.",
    );
  });

  it("leaves an exited company's leftover draft out of the latest month's counts and the status filters", () => {
    // An active and an exited company, both with a draft for the latest open month (not yet overdue).
    const portfolio = data({
      companies: [ACTIVE, EXITED],
      submissions: [submission(IDS.batik, "2026-08"), submission(IDS.oldco, "2026-08")],
    });
    const model = buildTracker(portfolio, filters());
    expect(model.summary).toMatchObject({ total: 1, notSubmitted: 1, overdue: 0, received: 0 });
    // The exited row is still shown (muted), its month dimmed with the reason.
    expect(names(model.rows)).toEqual(["Batik Boutique", "OldCo"]);
    expect(model.rows[0].cells[5]).toMatchObject({ kind: "submission", awaited: true, matches: true });
    expect(model.rows[1]).toMatchObject({ muted: true });
    expect(model.rows[1].cells[5]).toMatchObject({
      kind: "submission",
      state: "not_submitted",
      awaited: false,
      matches: true,
      details: "Not submitted. The company is no longer active and can no longer submit it. Due 15 Sep 2026. No narrative.",
    });
    // "Not submitted" (the summary card's filter) lists only the company that still has to submit.
    const notSubmitted = buildTracker(portfolio, filters({ status: "not_submitted" }));
    expect(names(notSubmitted.rows)).toEqual(["Batik Boutique"]);
    expect(names(buildTracker(portfolio, filters({ status: "needs_attention" })).rows)).toEqual([]);
  });

  it("drops a month sent back to a company that is no longer active from the counts", () => {
    const portfolio = data({
      companies: [ACTIVE, EXITED],
      submissions: [
        submission(IDS.batik, "2026-08", { status: "changes_requested", submittedAt: "2026-09-10T02:00:00Z" }),
        submission(IDS.oldco, "2026-08", { status: "changes_requested", submittedAt: "2026-09-10T02:00:00Z" }),
      ],
    });
    const model = buildTracker(portfolio, filters());
    expect(model.summary).toMatchObject({ total: 1, changesRequested: 1, received: 1 });
    expect(model.attention.changesRequested).toBe(1);
    expect(names(buildTracker(portfolio, filters({ status: "changes_requested" })).rows)).toEqual(["Batik Boutique"]);
  });

  it("still counts an exited company's submitted month as awaiting review (B21)", () => {
    const portfolio = data({
      companies: [ACTIVE, EXITED],
      submissions: [submission(IDS.oldco, "2026-08", { status: "submitted", submittedAt: "2026-09-10T02:00:00Z", hasNarrative: true })],
    });
    const model = buildTracker(portfolio, filters());
    expect(model.summary).toMatchObject({ total: 1, awaitingReview: 1, received: 1, narrativeCoveragePct: 100 });
    expect(model.attention.awaitingReview).toBe(1);
    expect(names(buildTracker(portfolio, filters({ status: "submitted" })).rows)).toEqual(["OldCo"]);
  });

  it("dims drafts left from before a start month that was moved later, and does not chase them", () => {
    // The start month was moved from July to September: the July and August drafts stay.
    const moved = company({ id: IDS.recqa, name: "RECQA", startMonth: "2026-09" });
    const portfolio = data({
      companies: [moved],
      submissions: [submission(IDS.recqa, "2026-07"), submission(IDS.recqa, "2026-08")],
    });
    const model = buildTracker(portfolio, filters());
    expect(names(model.rows)).toEqual(["RECQA"]);
    const [jun, jul, aug] = model.rows[0].cells.slice(3);
    expect(jun).toMatchObject({ kind: "outside" });
    expect(jul).toMatchObject({ kind: "submission", awaited: false });
    expect(aug).toMatchObject({
      kind: "submission",
      awaited: false,
      details: "Not submitted. Not requested: before the reporting start month (Sep 2026). Due 15 Sep 2026. No narrative.",
    });
    expect(model.summary).toMatchObject({ month: "2026-08", total: 0, notSubmitted: 0 });
    expect(buildTracker(portfolio, filters({ status: "not_submitted" })).rows).toEqual([]);
  });

  it("does not chase the drafts of a company whose start month was cleared", () => {
    const cleared = company({ id: IDS.huddle, name: "Huddle", startMonth: null });
    const portfolio = data({ companies: [cleared], submissions: [submission(IDS.huddle, "2026-08")] });
    const model = buildTracker(portfolio, filters());
    expect(model.rows[0]).toMatchObject({ notYetReporting: true });
    expect(model.rows[0].cells[5]).toMatchObject({
      awaited: false,
      details: "Not submitted. Not requested: the company is not reporting. Due 15 Sep 2026. No narrative.",
    });
    expect(model.summary.total).toBe(0);
  });
});

describe("summariseMonth", () => {
  const column = { month: "2026-08", dueDate: "2026-09-15", label: "Aug 2026", longLabel: "August 2026", isLatest: true };

  it("applies the 20-day approval target inclusively", () => {
    const onTarget = submission(IDS.batik, "2026-08", { status: "approved", approvedAt: "2026-09-20T02:00:00Z" });
    const late = submission(IDS.recqa, "2026-08", { status: "approved", approvedAt: "2026-09-21T02:00:00Z" });
    expect(APPROVAL_TARGET_DAYS).toBe(20);
    expect(summariseMonth(column, [onTarget, late], 14, "2026-09-30")).toMatchObject({ approved: 2, approvedWithinTarget: 1 });
  });

  it("has no narrative coverage until an update is received, and knows when the month is not yet due", () => {
    const draft = submission(IDS.batik, "2026-08");
    expect(summariseMonth(column, [draft], 14, "2026-09-15")).toMatchObject({
      total: 1,
      notSubmitted: 1,
      received: 0,
      narrativeCoveragePct: null,
      notYetDue: true,
    });
    expect(summariseMonth(null, [draft], 14, "2026-09-15")).toMatchObject({ month: null, total: 0 });
  });

  it("counts changes requested that are not overdue", () => {
    const changes = submission(IDS.batik, "2026-08", { status: "changes_requested", hasNarrative: true });
    expect(summariseMonth(column, [changes], 14, "2026-09-01")).toMatchObject({
      changesRequested: 1,
      overdue: 0,
      received: 1,
      withNarrative: 1,
      narrativeCoveragePct: 100,
    });
  });
});
