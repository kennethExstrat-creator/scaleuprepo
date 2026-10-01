// The /admin/cycles view model (src/app/admin/cycles/_lib/cycles-model.ts): month progress, extensions,
// the extension choices and date rules, quarter / half closes and the FX blocks.
import { describe, expect, it } from "vitest";

import {
  buildCycleMonths,
  buildDeadlineChoices,
  buildExtensions,
  buildFxCurrencies,
  closePeriodKey,
  companiesReportingIn,
  currenciesInUse,
  effectiveDue,
  extendBlockOf,
  extendedToDate,
  earliestExtensionDate,
  extensionBase,
  fxMonthRange,
  groupCloses,
  initialExtendSelection,
  joinNames,
  laterDueNote,
  latestExtensionDate,
  newDueDateIssue,
  normaliseCurrency,
  openEarlyPreview,
  openedBeforeMonthEnd,
  ordinal,
  parseCycleTab,
  plural,
  previousRate,
  progressOf,
  rateChangePct,
  summariseOverdue,
  upcomingCloses,
  type CompanyInput,
  type ExtensionEventInput,
  type ExtensionInput,
  type OverviewInput,
  type PeriodInput,
} from "@/app/admin/cycles/_lib/cycles-model";
import { formatDate } from "@/lib/format";
import { quarterOf } from "@/lib/periods";

import {
  ACME,
  ADMIN,
  BATIK,
  CLOSES,
  COMPANIES,
  EXTENSION_EVENTS,
  EXTENSION_ROWS,
  IMOTOR,
  KIDDO,
  NAMES,
  OVERVIEW,
  PERIODS,
  RATES,
  RECQA,
  SEND_BACK_EVENTS,
  STAYHERE,
  TODAY,
  overviewId,
} from "./fixtures";

describe("small helpers", () => {
  it("pluralises, joins names and writes ordinals", () => {
    expect(plural(1, "company", "companies")).toBe("1 company");
    expect(plural(3, "company", "companies")).toBe("3 companies");
    expect(plural(0, "day")).toBe("0 days");
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "28th",
    ]);
  });

  it("parses the tab from the URL", () => {
    expect(parseCycleTab("fx")).toBe("fx");
    expect(parseCycleTab(["deadlines", "fx"])).toBe("deadlines");
    expect(parseCycleTab("closes")).toBe("closes");
    expect(parseCycleTab("bogus")).toBe("months");
    expect(parseCycleTab(undefined)).toBe("months");
  });

  it("lists the companies that report in a month", () => {
    expect(companiesReportingIn(COMPANIES, "2026-07").map((c) => c.name)).toEqual([
      "Batik Boutique",
      "Kiddocare",
      "RECQA",
    ]);
    expect(companiesReportingIn(COMPANIES, "2026-08").map((c) => c.id)).toContain(ACME);
    // Not yet reporting and written-off companies never do.
    expect(companiesReportingIn(COMPANIES, "2026-12").map((c) => c.id)).not.toContain(IMOTOR);
    expect(companiesReportingIn(COMPANIES, "2026-12").map((c) => c.id)).not.toContain(STAYHERE);
  });
});

describe("month progress", () => {
  it("partitions the updates of a month into status buckets", () => {
    const august = OVERVIEW.filter((row) => row.month === "2026-08-01");
    expect(progressOf(august)).toEqual({
      total: 4,
      approved: 0,
      awaitingReview: 1,
      changesRequested: 0,
      notSubmitted: 0,
      overdue: 3,
      submitted: 1,
    });
    const july = OVERVIEW.filter((row) => row.month === "2026-07-01");
    const progress = progressOf(july);
    expect(progress).toMatchObject({ total: 4, approved: 2, awaitingReview: 1, notSubmitted: 1, submitted: 3 });
    expect(
      progress.approved + progress.awaitingReview + progress.changesRequested + progress.notSubmitted + progress.overdue,
    ).toBe(progress.total);
  });

  it("builds the months newest first with who opened them", () => {
    const months = buildCycleMonths(PERIODS, OVERVIEW, NAMES);
    expect(months.map((month) => month.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    const [september, august, july] = months;
    expect(september).toMatchObject({
      dueDate: "2026-10-15",
      openedBy: null,
      openedManually: false,
      openedEarly: false,
      templateLabel: "Portfolio Update v2",
      templateSuperseded: false,
    });
    expect(september.progress).toMatchObject({ total: 4, notSubmitted: 4, submitted: 0 });
    expect(september.laterDue.count).toBe(0);
    expect(laterDueNote(september.laterDue, september.progress.total, formatDate)).toBeNull();
    expect(august).toMatchObject({ openedBy: "Kenneth Lim", openedManually: true, openedEarly: true, templateLabel: null });
    expect(july).toMatchObject({ templateLabel: "Portfolio Update v1", templateSuperseded: true });
    // Kiddocare's July was extended to 29 Aug.
    expect(july.laterDue).toEqual({ count: 1, openedLate: 0, moved: 1, latest: "2026-08-29", shared: "2026-08-29" });
    expect(laterDueNote(july.laterDue, july.progress.total, formatDate)).toBe("1 due 29 Aug 2026 (extended or sent back)");
    expect(effectiveDue(july)).toEqual({ date: "2026-08-15", later: 1 });
  });

  it("notes the companies due after the usual date when a month opened late (BRD B4)", () => {
    // The pilot: July opened on 30 Sep, long after its usual due date, so every company got 14 days.
    const period: PeriodInput = {
      month: "2026-07-01",
      due_date: "2026-08-15",
      opened_at: "2026-09-30T08:00:00Z",
      opened_by: null,
      template: null,
    };
    const late: OverviewInput[] = [BATIK, RECQA, KIDDO].map((company, index) => ({
      id: `late-${index}`,
      company_id: company,
      month: "2026-07-01",
      status: "draft",
      due_date: "2026-10-14",
      original_due_date: null,
      is_overdue: false,
      days_overdue: 0,
    }));
    const [july] = buildCycleMonths([period], late, {});
    expect(july.dueDate).toBe("2026-08-15");
    expect(july.progress).toMatchObject({ total: 3, overdue: 0 });
    expect(july.laterDue).toEqual({ count: 3, openedLate: 3, moved: 0, latest: "2026-10-14", shared: "2026-10-14" });
    expect(laterDueNote(july.laterDue, july.progress.total, formatDate)).toBe("All 3 due 14 Oct 2026 (opened late)");
    expect(effectiveDue(july)).toEqual({ date: "2026-10-14", later: 0 });

    // One of them then extended to 20 Oct, and a fourth company due on the usual date.
    const mixed: OverviewInput[] = [
      { ...late[0], due_date: "2026-10-20", original_due_date: "2026-10-14" },
      late[1],
      late[2],
      { ...late[0], id: "on-time", company_id: ACME, due_date: "2026-08-15" },
    ];
    const [mixedJuly] = buildCycleMonths([period], mixed, {});
    expect(mixedJuly.laterDue).toEqual({ count: 3, openedLate: 2, moved: 1, latest: "2026-10-20", shared: null });
    expect(laterDueNote(mixedJuly.laterDue, mixedJuly.progress.total, formatDate)).toBe(
      "3 due later, up to 20 Oct 2026",
    );
    expect(effectiveDue(mixedJuly)).toEqual({ date: "2026-08-15", later: 3 });

    // Some, not all, on one later date.
    const [partly] = buildCycleMonths([period], [late[0], { ...late[1], due_date: "2026-08-15" }], {});
    expect(laterDueNote(partly.laterDue, partly.progress.total, formatDate)).toBe("1 due 14 Oct 2026 (opened late)");
  });

  it("names a former opener when the profile is gone", () => {
    const [month] = buildCycleMonths([{ ...PERIODS[2], opened_by: "a1000000-0000-4000-8000-0000000000ff" }], [], {});
    expect(month.openedBy).toBe("A former user");
    expect(month.progress.total).toBe(0);
  });

  it("knows whether a month opened before it ended (Malaysia time)", () => {
    expect(openedBeforeMonthEnd("2026-09-30T16:05:00Z", "2026-09")).toBe(false); // 1 Oct, 00:05
    expect(openedBeforeMonthEnd("2026-09-30T15:59:00Z", "2026-09")).toBe(true); // 30 Sep, 23:59
    expect(openedBeforeMonthEnd("not a date", "2026-09")).toBe(false);
  });

  it("summarises what is overdue and escalated", () => {
    expect(summariseOverdue(OVERVIEW, 14)).toEqual({ overdue: 3, escalated: 2, companies: 3 });
    expect(summariseOverdue(OVERVIEW, 30)).toEqual({ overdue: 3, escalated: 0, companies: 3 });
  });

  it("previews opening the current month early", () => {
    const preview = openEarlyPreview("2026-10", ["2026-07", "2026-08", "2026-09"], 15, COMPANIES);
    expect(preview).toEqual({
      month: "2026-10",
      dueDate: "2026-11-15",
      opensOn: "2026-11-01",
      companies: ["Acme Pte Ltd", "Batik Boutique", "Kiddocare", "RECQA"],
    });
    expect(openEarlyPreview("2026-10", ["2026-09", "2026-10"], 15, COMPANIES)).toBeNull();
  });
});

describe("deadline extensions", () => {
  const overdue = new Map(OVERVIEW.map((row) => [row.id, row.is_overdue] as const));
  const RENUKA = "a1000000-0000-4000-8000-000000000003";
  const names = { ...NAMES, [RENUKA]: "Renuka Sena" };

  function build(input: Partial<Parameters<typeof buildExtensions>[0]> = {}) {
    return buildExtensions({
      rows: EXTENSION_ROWS,
      events: [...EXTENSION_EVENTS, ...SEND_BACK_EVENTS],
      companies: COMPANIES,
      overdueById: overdue,
      names,
      graceDays: 14,
      ...input,
    });
  }

  it("lists moved deadlines, newest month first, with the latest extension", () => {
    const rows = build();
    expect(rows.map((row) => `${row.companyName} ${row.month}`)).toEqual([
      "RECQA 2026-08",
      "Kiddocare 2026-07",
      "StayHere 2026-07",
    ]);
    const [recqa, kiddo, stayhere] = rows;
    expect(recqa).toMatchObject({
      cause: "sent_back",
      reason: null,
      extendedAt: null,
      extendedBy: null,
      extendedTo: null,
      extensionCount: 0,
      sentBack: { kind: "changes_requested", at: "2026-09-15T03:00:00Z", by: "Kenneth Lim" },
      daysAdded: 14,
      isOverdue: true,
      canExtendAgain: true,
      extendBlock: null,
    });
    // Reopened before its two extensions: the latest extension set the due date.
    expect(kiddo).toMatchObject({
      cause: "extended",
      reason: "Auditors finalising the accounts.",
      extendedAt: "2026-08-20T02:00:00Z",
      extendedBy: "Kenneth Lim",
      extendedTo: "2026-08-29",
      extensionCount: 2,
      sentBack: null,
      originalDueDate: "2026-08-15",
      dueDate: "2026-08-29",
      daysAdded: 14,
      canExtendAgain: true,
    });
    // Written off: listed for the record, but cannot be extended again; a system extension says "ScaleUp".
    expect(stayhere).toMatchObject({
      companyStatus: "written_off",
      canExtendAgain: false,
      extendBlock: "inactive",
      extendedBy: "ScaleUp",
    });
  });

  it("offers Extend on a row only for the months the dialog offers", () => {
    const offered = new Set(
      buildDeadlineChoices(OVERVIEW, COMPANIES).flatMap((choice) => choice.months.map((month) => month.submissionId)),
    );
    for (const row of build()) expect(offered.has(row.submissionId)).toBe(row.canExtendAgain);

    // Alpha is active but no longer reporting (start month cleared, B16) and its August was sent back;
    // Beta has one draft month.
    const ALPHA = "c0000000-0000-4000-8000-0000000000a1";
    const BETA = "c0000000-0000-4000-8000-0000000000b1";
    const companies: CompanyInput[] = [
      { id: ALPHA, name: "Alpha", status: "active", reporting_start_month: null, reporting_currency: "MYR" },
      { id: BETA, name: "Beta", status: "active", reporting_start_month: "2026-09-01", reporting_currency: "MYR" },
    ];
    const alphaAugust: ExtensionInput = {
      id: "alpha-aug",
      company_id: ALPHA,
      month: "2026-08-01",
      status: "changes_requested",
      due_date: "2026-09-29",
      original_due_date: "2026-09-15",
      extension_reason: null,
    };
    const overview: OverviewInput[] = [
      { ...alphaAugust, is_overdue: false, days_overdue: 0 },
      {
        id: "beta-sep",
        company_id: BETA,
        month: "2026-09-01",
        status: "draft",
        due_date: "2026-10-15",
        original_due_date: null,
        is_overdue: false,
        days_overdue: 0,
      },
    ];
    const input = { rows: [alphaAugust], events: [], companies, overdueById: new Map<string, boolean>() };
    const [alpha] = build(input);
    expect(alpha).toMatchObject({ canExtendAgain: false, extendBlock: "not_reporting", reportingStartMonth: null });
    const choices = buildDeadlineChoices(overview, companies);
    expect(choices.map((choice) => choice.companyName)).toEqual(["Beta"]);
    // Even when asked for Alpha's August, the dialog opens on nothing rather than on Beta's month.
    expect(initialExtendSelection(choices, { companyId: ALPHA, submissionId: "alpha-aug" })).toEqual({
      companyId: "",
      submissionId: "",
      targetMissing: true,
    });

    // Start month moved later than August: August is history, not offered either.
    const moved = companies.map((company) =>
      company.id === ALPHA ? { ...company, reporting_start_month: "2026-09-01" } : company,
    );
    expect(build({ ...input, companies: moved })[0]).toMatchObject({
      canExtendAgain: false,
      extendBlock: "before_start",
      reportingStartMonth: "2026-09",
    });
    expect(buildDeadlineChoices(overview, moved).map((choice) => choice.companyName)).toEqual(["Beta"]);
  });

  it("knows which months can be extended", () => {
    const active = { status: "active" as const, reporting_start_month: "2026-07-01" };
    expect(extendBlockOf(active, "2026-08", "draft")).toBeNull();
    expect(extendBlockOf(active, "2026-07", "submitted")).toBeNull();
    expect(extendBlockOf(active, "2026-08", "changes_requested")).toBeNull();
    expect(extendBlockOf(active, "2026-08", "approved")).toBe("approved");
    expect(extendBlockOf(active, "2026-06", "draft")).toBe("before_start");
    expect(extendBlockOf({ ...active, reporting_start_month: null }, "2026-08", "draft")).toBe("not_reporting");
    expect(extendBlockOf({ ...active, status: "exited" }, "2026-08", "draft")).toBe("inactive");
  });

  describe("what set the current due date", () => {
    // Batik's September: due 15 Oct, extended to 20 Oct on 14 Oct by Renuka Sena, then sent back on 25 Oct
    // (Malaysia time), which moves it to 8 Nov (25 Oct + 14 days).
    const SID = "b0000000-0000-4000-8000-0000000000aa";
    const row: ExtensionInput = {
      id: SID,
      company_id: BATIK,
      month: "2026-09-01",
      status: "changes_requested",
      due_date: "2026-11-08",
      original_due_date: "2026-10-15",
      extension_reason: "Auditors finalising the accounts",
    };
    const extension: ExtensionEventInput = {
      id: 101,
      submission_id: SID,
      event: "deadline_extended",
      actor_id: RENUKA,
      created_at: "2026-10-14T02:00:00Z",
      message: "Due date extended to 20 Oct 2026. Reason: Auditors finalising the accounts",
    };
    const sendBack: ExtensionEventInput = {
      id: 102,
      submission_id: SID,
      event: "changes_requested",
      actor_id: ADMIN,
      created_at: "2026-10-25T02:00:00Z",
    };
    const one = (rows: ExtensionInput[], events: ExtensionEventInput[]) => build({ rows, events })[0];

    it("credits a later send-back, not the earlier extension", () => {
      expect(one([row], [sendBack, extension])).toMatchObject({
        cause: "sent_back",
        originalDueDate: "2026-10-15",
        dueDate: "2026-11-08",
        daysAdded: 24,
        sentBack: { kind: "changes_requested", at: "2026-10-25T02:00:00Z", by: "Kenneth Lim" },
        // The earlier extension stays on record.
        reason: "Auditors finalising the accounts",
        extendedAt: "2026-10-14T02:00:00Z",
        extendedBy: "Renuka Sena",
        extendedTo: "2026-10-20",
        extensionCount: 1,
      });
      expect(one([row], [extension, { ...sendBack, event: "reopened" }]).sentBack?.kind).toBe("reopened");
    });

    it("keeps the extension when the send-back did not move the date", () => {
      // Extended to 20 Nov: a send-back on 25 Oct (due no earlier than 8 Nov) leaves it.
      const later = { ...row, due_date: "2026-11-20" };
      const extendedTo20Nov = { ...extension, message: "Due date extended to 20 Nov 2026." };
      expect(one([later], [extendedTo20Nov, sendBack])).toMatchObject({
        cause: "extended",
        extendedTo: "2026-11-20",
        extendedBy: "Renuka Sena",
        sentBack: null,
      });
      // An extension after the send-back set the date, whatever the send-back did.
      const extendedAfter = { ...extension, created_at: "2026-10-26T02:00:00Z", message: "Due date extended to 8 Nov 2026." };
      expect(one([row], [sendBack, extendedAfter])).toMatchObject({ cause: "extended", sentBack: null });
    });

    it("orders events written in the same instant by id", () => {
      const sameTime = { ...sendBack, created_at: extension.created_at };
      // Written after the extension: the send-back moved the date to 8 Nov.
      expect(one([row], [{ ...sameTime, id: 103 }, extension]).cause).toBe("sent_back");
      // Written before it: the extension (to 20 Oct) is the latest event and set the date.
      const due20Oct = { ...row, due_date: "2026-10-20" };
      expect(one([due20Oct], [{ ...sameTime, id: 100 }, extension])).toMatchObject({ cause: "extended", sentBack: null });
    });

    it("falls back to the send-back's grace period when the extension's message cannot be read", () => {
      const unreadable = { ...extension, message: null };
      // 25 Oct + 14 days = 8 Nov: the send-back moved it.
      expect(one([row], [unreadable, sendBack])).toMatchObject({ cause: "sent_back", extendedTo: null });
      // Due 20 Nov, later than the send-back gives: the extension set it.
      expect(one([{ ...row, due_date: "2026-11-20" }], [unreadable, sendBack]).cause).toBe("extended");
    });

    it("handles months without events", () => {
      // An extension recorded without its event (e.g. imported history).
      expect(one([row], [])).toMatchObject({ cause: "extended", extendedAt: null, sentBack: null });
      expect(one([{ ...row, extension_reason: null }], [])).toMatchObject({ cause: "sent_back", sentBack: null });
    });
  });

  it("reads the new due date from an extension's message", () => {
    expect(extendedToDate("Due date extended to 20 Oct 2026. Reason: Auditors finalising the accounts")).toBe(
      "2026-10-20",
    );
    expect(extendedToDate("Due date extended to 1 Nov 2026.")).toBe("2026-11-01");
    expect(extendedToDate("Due date extended to 31 Feb 2026.")).toBeNull();
    expect(extendedToDate("Due date extended to 20 Foo 2026.")).toBeNull();
    expect(extendedToDate("Reason: Due date extended to 20 Oct 2026")).toBeNull();
    expect(extendedToDate(null)).toBeNull();
    expect(extendedToDate(undefined)).toBeNull();
  });

  it("preselects exactly the target month in the dialog, or nothing", () => {
    const choices = buildDeadlineChoices(OVERVIEW, COMPANIES);
    const kiddoAugust = overviewId(KIDDO, "2026-08-01");
    expect(initialExtendSelection(choices, { companyId: KIDDO, submissionId: kiddoAugust })).toEqual({
      companyId: KIDDO,
      submissionId: kiddoAugust,
      targetMissing: false,
    });
    // The month is no longer offered (approved meanwhile): not the company's other months either.
    expect(initialExtendSelection(choices, { companyId: KIDDO, submissionId: "gone" })).toEqual({
      companyId: "",
      submissionId: "",
      targetMissing: true,
    });
    // A month offered under another company does not match.
    expect(initialExtendSelection(choices, { companyId: BATIK, submissionId: kiddoAugust }).targetMissing).toBe(true);
    // Without a target, nothing unless there is a single choice.
    expect(initialExtendSelection(choices, null)).toEqual({ companyId: "", submissionId: "", targetMissing: false });
    const acme = choices.filter((choice) => choice.companyId === ACME);
    expect(initialExtendSelection(acme, null)).toEqual({ companyId: ACME, submissionId: "", targetMissing: false });
    const single = [{ ...acme[0], months: acme[0].months.slice(0, 1) }];
    expect(initialExtendSelection(single, null)).toEqual({
      companyId: ACME,
      submissionId: single[0].months[0].submissionId,
      targetMissing: false,
    });
    expect(initialExtendSelection([], { companyId: KIDDO, submissionId: kiddoAugust }).targetMissing).toBe(true);
  });

  it("offers reporting companies and their months that are not approved", () => {
    const choices = buildDeadlineChoices(OVERVIEW, COMPANIES);
    expect(choices.map((choice) => choice.companyName)).toEqual(["Acme Pte Ltd", "Batik Boutique", "Kiddocare", "RECQA"]);
    const batik = choices.find((choice) => choice.companyId === BATIK);
    expect(batik?.months.map((month) => month.month)).toEqual(["2026-09", "2026-08"]);
    const kiddo = choices.find((choice) => choice.companyId === KIDDO);
    expect(kiddo?.months[1]).toMatchObject({
      month: "2026-08",
      status: "draft",
      isOverdue: true,
      daysOverdue: 16,
      submissionId: overviewId(KIDDO, "2026-08-01"),
    });
    expect(kiddo?.months[2]).toMatchObject({ month: "2026-07", originalDueDate: "2026-08-15" });
    // Not reporting (i-Motorbike), written off (StayHere): nothing to extend.
    expect(choices.some((choice) => choice.companyId === IMOTOR || choice.companyId === STAYHERE)).toBe(false);
  });

  it("ignores months before a company's start month", () => {
    const early = { ...OVERVIEW[0], id: "x", company_id: ACME, month: "2026-07-01", status: "draft" as const };
    const acme = buildDeadlineChoices([early, ...OVERVIEW], COMPANIES).find((choice) => choice.companyId === ACME);
    expect(acme?.months.map((month) => month.month)).toEqual(["2026-09", "2026-08"]);
  });

  it("counts quick extensions from today once a month is overdue", () => {
    expect(extensionBase("2026-10-15", TODAY)).toBe("2026-10-15");
    expect(extensionBase("2026-10-01", TODAY)).toBe("2026-10-01");
    expect(extensionBase("2026-09-15", TODAY)).toBe(TODAY);
    expect(latestExtensionDate("2026-10-15", TODAY)).toBe("2027-10-15");
    expect(latestExtensionDate("2026-09-15", TODAY)).toBe("2027-10-01");
  });

  it("checks the new due date like extend_due_date, plus a one-year limit", () => {
    expect(newDueDateIssue(null, "2026-10-15", TODAY, formatDate)).toBe("Choose the new due date.");
    expect(newDueDateIssue("2026-02-30", "2026-10-15", TODAY, formatDate)).toBe("Choose the new due date.");
    expect(newDueDateIssue("2026-10-15", "2026-10-15", TODAY, formatDate)).toBe(
      "The new due date must be after the current due date (15 Oct 2026).",
    );
    expect(newDueDateIssue("2027-10-16", "2026-10-15", TODAY, formatDate)).toBe("Choose a date up to 15 Oct 2027.");
    expect(newDueDateIssue("2026-10-16", "2026-10-15", TODAY, formatDate)).toBeNull();
    // An overdue month cannot move to a date that has passed (it would still be overdue), as on the review
    // page; today or later is fine.
    expect(newDueDateIssue("2026-09-20", "2026-09-15", TODAY, formatDate)).toBe(
      "The new due date cannot be in the past. Choose today (1 Oct 2026) or a later date.",
    );
    expect(newDueDateIssue(TODAY, "2026-09-15", TODAY, formatDate)).toBeNull();
    expect(earliestExtensionDate("2026-09-15", TODAY)).toBe(TODAY);
    expect(earliestExtensionDate("2026-10-15", TODAY)).toBe("2026-10-16");
    expect(earliestExtensionDate("2026-09-30", TODAY)).toBe(TODAY);
  });
});

describe("quarter and half closes", () => {
  it("keys periods like the Documents page", () => {
    expect(closePeriodKey(quarterOf("2026-08"))).toBe("Q3-2026");
    expect(closePeriodKey({ type: "half", index: 2, year: 2026 })).toBe("H2-2026");
  });

  it("groups the opened closes, latest first, quarters before halves", () => {
    const groups = groupCloses(CLOSES);
    expect(groups.map((group) => group.key)).toEqual(["Q3-2026", "Q2-2026", "H1-2026"]);
    expect(groups[0]).toMatchObject({
      label: "Q3 2026",
      rangeLabel: "Jul–Sep 2026",
      endDate: "2026-09-30",
      companies: 3,
      confirmed: 1,
      open: 2,
    });
  });

  it("finds the next quarter and half after the latest open month", () => {
    const upcoming = upcomingCloses("2026-09", "2026-10", 15, COMPANIES);
    expect(upcoming.map((close) => close.key)).toEqual(["Q4-2026", "H2-2026"]);
    expect(upcoming[0]).toMatchObject({ lastMonth: "2026-12", opensOn: "2027-01-01", dueDate: "2027-01-15", companies: 4 });
    expect(upcomingCloses(null, "2026-10", 15, COMPANIES).map((close) => close.key)).toEqual(["Q4-2026", "H2-2026"]);
    expect(upcomingCloses("2026-12", "2026-12", 28, []).map((close) => [close.key, close.dueDate])).toEqual([
      ["Q1-2027", "2027-04-28"],
      ["H1-2027", "2027-07-28"],
    ]);
  });
});

describe("FX rates", () => {
  const groups = buildFxCurrencies({
    companies: COMPANIES,
    rates: RATES,
    overview: OVERVIEW,
    openMonths: ["2026-09", "2026-08", "2026-07"],
    names: NAMES,
  });

  it("finds the currencies companies report in", () => {
    expect(currenciesInUse([...COMPANIES, { reporting_currency: " sgd" }])).toEqual(["SGD", "USD"]);
    expect(normaliseCurrency(" usd ")).toBe("USD");
    expect(normaliseCurrency(null)).toBe("");
  });

  it("builds one block per currency in use or on record", () => {
    expect(groups.map((group) => group.currency)).toEqual(["SGD", "USD"]);
    const usd = groups[1];
    expect(usd.companies.map((company) => company.name)).toEqual(["Acme Pte Ltd", "i-Motorbike"]);
    expect(usd.companies[1].reportingStartMonth).toBeNull();
    expect(usd.rows.map((row) => row.month)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(usd.missing).toEqual(["2026-08"]);

    const [september, august, july] = usd.rows;
    expect(september).toMatchObject({
      rate: 4.75,
      needed: true,
      reportingCompanies: ["Acme Pte Ltd"],
      comparedWith: "2026-07",
      unusual: true,
      updatedBy: "Kenneth Lim",
    });
    expect(september.changePct).toBeCloseTo(13.095, 2);
    expect(august).toMatchObject({ rate: null, needed: true, changePct: null, updatedBy: null });
    // i-Motorbike is not reporting yet, so July needs no rate (it has one anyway).
    expect(july).toMatchObject({ rate: 4.2, needed: false, reportingCompanies: [], changePct: null, updatedBy: "Aisha Rahman" });
  });

  it("keeps old rates of a currency nobody reports in any more", () => {
    const sgd = groups[0];
    expect(sgd.companies).toEqual([]);
    expect(sgd.missing).toEqual([]);
    expect(sgd.rows.map((row) => row.month)).toEqual(["2026-09", "2026-08", "2026-07", "2025-12"]);
    expect(sgd.rows[3]).toMatchObject({ rate: 3.3, updatedBy: null });
  });

  it("finds the previous rate and the change", () => {
    const usd = groups[1];
    expect(previousRate(usd.rows, "2026-10")).toEqual({ month: "2026-09", rate: 4.75 });
    expect(previousRate(usd.rows, "2026-09")).toEqual({ month: "2026-07", rate: 4.2 });
    expect(previousRate(usd.rows, "2026-07")).toBeNull();
    expect(rateChangePct(4, 5)).toBe(25);
    expect(rateChangePct(0, 5)).toBeNull();
    expect(rateChangePct(4, Number.NaN)).toBeNull();
  });

  it("offers months from January 2024, or the earliest on record, to the current month", () => {
    expect(fxMonthRange([], "2026-10")).toEqual({ from: "2024-01", to: "2026-10" });
    expect(fxMonthRange(["2023-11", "2026-07"], "2026-10")).toEqual({ from: "2023-11", to: "2026-10" });
  });

  it("needs no block when every company reports in MYR", () => {
    expect(
      buildFxCurrencies({
        companies: COMPANIES.filter((company) => company.reporting_currency === "MYR"),
        rates: [],
        overview: OVERVIEW,
        openMonths: ["2026-09"],
        names: {},
      }),
    ).toEqual([]);
  });

  it("does not depend on the order of the companies", () => {
    const reversed = buildFxCurrencies({
      companies: [...COMPANIES].reverse(),
      rates: [...RATES].reverse(),
      overview: [...OVERVIEW].reverse(),
      openMonths: ["2026-07", "2026-08", "2026-09"],
      names: NAMES,
    });
    expect(reversed).toEqual(groups);
  });
});
