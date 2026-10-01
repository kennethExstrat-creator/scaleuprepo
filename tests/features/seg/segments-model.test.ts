import { describe, expect, it } from "vitest";

import {
  buildSegmentUsage,
  changeCountsText,
  describeChanges,
  describeRetired,
  describeUsage,
  formatMonthList,
  formatMonthSpan,
  keepVerb,
  needsComparabilityWarning,
  newNameIssue,
  NO_USAGE,
  openMonthsText,
  rowIssues,
  sameSegmentList,
  SEGMENTS_CHANGED_MESSAGE,
  segmentsKey,
  toEditorItems,
  toSegmentInputs,
  usageOf,
  type MonthStatus,
  type SegmentFigure,
} from "@/app/portal/[companyId]/segments/_lib/segments-model";
import { REVENUE_SEGMENT_NAME_MAX, REVENUE_SEGMENTS_MAX } from "@/lib/constants";
import { diffCompanySegments } from "@/lib/types/domain";

import { IDS, ONLINE, RETAIL, segmentRow, WHOLESALE } from "./fixtures";

const JUL = "90000000-0000-4000-8000-000000000007";
const AUG = "90000000-0000-4000-8000-000000000008";
const SEP = "90000000-0000-4000-8000-000000000009";
const OCT = "90000000-0000-4000-8000-000000000010";

const MONTHS: MonthStatus[] = [
  { id: JUL, month: "2026-07-01", status: "approved" },
  { id: AUG, month: "2026-08-01", status: "submitted" },
  { id: SEP, month: "2026-09-01", status: "changes_requested" },
  { id: OCT, month: "2026-10-01", status: "draft" },
];

function figure(segment: string, submission: string, amount: number | null): SegmentFigure {
  return { segment_id: segment, submission_id: submission, amount };
}

describe("buildSegmentUsage", () => {
  const usage = buildSegmentUsage(
    [
      figure(IDS.retail, SEP, 10),
      figure(IDS.retail, JUL, 5),
      figure(IDS.retail, AUG, 0),
      figure(IDS.online, OCT, 3),
      figure(IDS.online, AUG, null), // cleared amounts do not count
      figure(IDS.wholesale, "90000000-0000-4000-8000-000000000099", 9), // a month the caller cannot see
    ],
    MONTHS,
  );

  it("lists the months with figures, oldest first, split into submitted and open months", () => {
    expect(usage[IDS.retail]).toEqual({
      months: ["2026-07", "2026-08", "2026-09"],
      lockedMonths: ["2026-07", "2026-08"],
      openMonths: ["2026-09"],
    });
    expect(usage[IDS.online]).toEqual({ months: ["2026-10"], lockedMonths: [], openMonths: ["2026-10"] });
  });

  it("leaves out segments without figures", () => {
    expect(usage[IDS.wholesale]).toBeUndefined();
    expect(usageOf(usage, IDS.wholesale)).toBe(NO_USAGE);
  });
});

describe("month spans and usage text", () => {
  it("formats a single month, a span within a year and across years", () => {
    expect(formatMonthSpan([])).toBe("");
    expect(formatMonthSpan(["2026-09"])).toBe("Sep 2026");
    expect(formatMonthSpan(["2026-09", "2026-07", "2026-08"])).toBe("Jul–Sep 2026");
    expect(formatMonthSpan(["2027-02", "2026-11"])).toBe("Nov 2026 – Feb 2027");
    expect(formatMonthSpan(["2026-09-01", "nonsense"])).toBe("Sep 2026");
  });

  it("describes the figures of a segment", () => {
    expect(describeUsage(NO_USAGE)).toBe("No figures yet");
    expect(describeUsage({ months: ["2026-09"], lockedMonths: [], openMonths: ["2026-09"] })).toBe(
      "Figures in 1 month (Sep 2026)",
    );
    expect(
      describeUsage({ months: ["2026-07", "2026-08", "2026-09"], lockedMonths: [], openMonths: [] }),
    ).toBe("Figures in 3 months (Jul–Sep 2026)");
  });

  it("describes a retired segment with when it was used and retired (Malaysia time)", () => {
    expect(describeRetired(WHOLESALE, { months: ["2026-07", "2026-08"], lockedMonths: [], openMonths: [] })).toEqual({
      used: "Used in Jul–Aug 2026",
      retired: "Retired 20 Sep 2026",
    });
    // A gap is not shown as a span.
    expect(describeRetired(WHOLESALE, { months: ["2026-07", "2026-09"], lockedMonths: [], openMonths: [] }).used).toBe(
      "Used in Jul 2026 and Sep 2026",
    );
    expect(describeRetired({ retired_at: "2026-09-30T17:00:00+00:00" }, NO_USAGE)).toEqual({
      used: "Never used",
      retired: "Retired 1 Oct 2026",
    });
  });

  it("lists months for a sentence without implying the months in a gap", () => {
    expect(formatMonthList([])).toBe("");
    expect(formatMonthList(["2026-09"])).toBe("Sep 2026");
    // Months that follow each other: a span, also across a year end.
    expect(formatMonthList(["2026-09", "2026-07", "2026-08"])).toBe("Jul–Sep 2026");
    expect(formatMonthList(["2026-12", "2027-01"])).toBe("Dec 2026 – Jan 2027");
    // With a gap: each month while there are at most three…
    expect(formatMonthList(["2026-07", "2026-09"])).toBe("Jul 2026 and Sep 2026");
    expect(formatMonthList(["2026-09-01", "2026-05", "2026-07", "2026-07", "nonsense"])).toBe(
      "May 2026, Jul 2026 and Sep 2026",
    );
    // …else the count and the first and last month.
    expect(formatMonthList(["2026-03", "2026-04", "2026-06", "2026-09"])).toBe("4 months between Mar and Sep 2026");
    expect(formatMonthList(["2026-10", "2026-11", "2027-01", "2027-02"])).toBe(
      "4 months between Oct 2026 and Feb 2027",
    );
  });

  it("agrees the verb with the number of months", () => {
    expect(keepVerb(["2026-07"])).toBe("keeps");
    expect(keepVerb(["2026-07", "2026-08"])).toBe("keep");
  });

  it("names the open months, or counts them when there are many", () => {
    expect(openMonthsText([])).toBe("");
    expect(openMonthsText(["2026-08", "2026-09"])).toBe("Aug 2026, Sep 2026");
    expect(openMonthsText(["2026-06", "2026-07", "2026-08", "2026-09"])).toBe("4 months (Jun–Sep 2026)");
  });
});

describe("editor rows", () => {
  it("builds rows from the current segments and the list the RPC takes", () => {
    const items = toEditorItems([RETAIL, ONLINE]);
    expect(items).toEqual([
      { key: IDS.retail, id: IDS.retail, name: "Retail" },
      { key: IDS.online, id: IDS.online, name: "Online" },
    ]);
    expect(toSegmentInputs([...items, { key: "new-0", id: null, name: "  Web shop \t" }])).toEqual([
      { id: IDS.retail, name: "Retail" },
      { id: IDS.online, name: "Online" },
      { name: "Web shop" },
    ]);
  });

  it("keys the saved list by ids, names and order", () => {
    expect(segmentsKey([RETAIL, ONLINE])).toBe(`${IDS.retail}:Retail|${IDS.online}:Online`);
    expect(segmentsKey([ONLINE, RETAIL])).not.toBe(segmentsKey([RETAIL, ONLINE]));
    expect(segmentsKey([])).toBe("");
  });

  it("tells whether the segments in use are still those the editor was opened with", () => {
    const opened = [
      { id: IDS.retail, name: "Retail" },
      { id: IDS.online, name: "Online" },
    ];
    expect(sameSegmentList(opened, [RETAIL, ONLINE])).toBe(true);
    expect(sameSegmentList([{ id: IDS.retail.toUpperCase(), name: "Retail" }], [RETAIL])).toBe(true);
    expect(sameSegmentList([], [])).toBe(true);
    // Added, removed, renamed or moved elsewhere since: changed.
    const added = segmentRow("f1000000-0000-4000-8000-000000000011", "Wholesale", "company", 3);
    expect(sameSegmentList(opened, [RETAIL, ONLINE, added])).toBe(false);
    expect(sameSegmentList(opened, [RETAIL])).toBe(false);
    expect(sameSegmentList(opened, [RETAIL, { ...ONLINE, name: "Web" }])).toBe(false);
    expect(sameSegmentList(opened, [ONLINE, RETAIL])).toBe(false);
    // A first set-up opened before someone else set segments up.
    expect(sameSegmentList([], [RETAIL])).toBe(false);
  });

  it("refuses with the database's own words for segments changed meanwhile", () => {
    expect(SEGMENTS_CHANGED_MESSAGE).toBe(
      "The revenue segments have changed since this page was opened. Reload the page and try again.",
    );
  });

  it("flags blank, too long and repeated names (ignoring case and spaces)", () => {
    const long = "x".repeat(REVENUE_SEGMENT_NAME_MAX + 1);
    expect(
      rowIssues([
        { name: "Retail" },
        { name: "   " },
        { name: long },
        { name: " retail " },
        { name: "Online\tShop" },
        { name: "Online" },
      ]),
    ).toEqual([
      null,
      "Enter a name for this segment.",
      `Use at most ${REVENUE_SEGMENT_NAME_MAX} characters.`,
      'Another segment is already called "retail".',
      "Names can't contain line breaks or tabs.",
      null,
    ]);
    expect(rowIssues([{ name: "x".repeat(REVENUE_SEGMENT_NAME_MAX) }])).toEqual([null]);
  });

  it("checks a name before adding it", () => {
    const items = [{ name: "Retail" }, { name: "Online" }];
    expect(newNameIssue("Web", items)).toBeNull();
    expect(newNameIssue("  ", items)).toBe("Enter a name for this segment.");
    expect(newNameIssue(" ONLINE ", items)).toBe('There\'s already a segment called "Online".');
    const full = Array.from({ length: REVENUE_SEGMENTS_MAX }, (_, i) => ({ name: `Segment ${i}` }));
    expect(newNameIssue("One more", full)).toBe(`You can have at most ${REVENUE_SEGMENTS_MAX} revenue segments.`);
  });
});

describe("what saving changes", () => {
  const usage = buildSegmentUsage(
    [figure(IDS.retail, JUL, 1), figure(IDS.retail, SEP, 2), figure(IDS.online, OCT, 3)],
    MONTHS,
  );

  it("needs the comparability warning for additions, removals and renames of segments in use", () => {
    const current = [RETAIL, ONLINE];
    const reorder = diffCompanySegments(current, [
      { id: IDS.online, name: "Online" },
      { id: IDS.retail, name: "Retail" },
    ]);
    expect(needsComparabilityWarning(reorder, true)).toBe(false);
    const added = diffCompanySegments(current, [...current, { name: "Web" }]);
    expect(needsComparabilityWarning(added, true)).toBe(true);
    // The very first set-up saves without the warning.
    expect(needsComparabilityWarning(diffCompanySegments([], [{ name: "Web" }]), false)).toBe(false);
    // Segments used before (now retired) make any change a comparability matter again.
    expect(needsComparabilityWarning(diffCompanySegments([], [{ name: "Web" }]), true)).toBe(true);
  });

  it("explains renames as a new series when submitted months use the segment", () => {
    const changes = diffCompanySegments(
      [RETAIL, ONLINE],
      [
        { id: IDS.retail, name: "Shops" },
        { id: IDS.online, name: "Web" },
      ],
    );
    expect(describeChanges(changes, usage, 2)).toEqual([
      {
        title: 'Rename "Retail" to "Shops"',
        detail:
          'It continues as a new series: Jul 2026 (already submitted) keeps "Retail". ' +
          'Its figures in Sep 2026 (not submitted yet) move to "Shops".',
      },
      { title: 'Rename "Online" to "Web"', detail: "Months not yet submitted show the new name." },
    ]);
  });

  it("names the submitted months exactly when a month between them was sent back", () => {
    // Jul approved, Aug sent back (changes requested), Sep submitted.
    const months: MonthStatus[] = [
      { id: JUL, month: "2026-07-01", status: "approved" },
      { id: AUG, month: "2026-08-01", status: "changes_requested" },
      { id: SEP, month: "2026-09-01", status: "submitted" },
    ];
    const gap = buildSegmentUsage(
      [figure(IDS.online, JUL, 1), figure(IDS.online, AUG, 2), figure(IDS.online, SEP, 3)],
      months,
    );
    expect(gap[IDS.online]).toEqual({
      months: ["2026-07", "2026-08", "2026-09"],
      lockedMonths: ["2026-07", "2026-09"],
      openMonths: ["2026-08"],
    });

    const renamed = diffCompanySegments(
      [RETAIL, ONLINE],
      [
        { id: IDS.retail, name: "Retail" },
        { id: IDS.online, name: "Web" },
      ],
    );
    expect(describeChanges(renamed, gap, 2)).toEqual([
      {
        title: 'Rename "Online" to "Web"',
        detail:
          'It continues as a new series: Jul 2026 and Sep 2026 (already submitted) keep "Online". ' +
          'Its figures in Aug 2026 (not submitted yet) move to "Web".',
      },
    ]);

    const removed = diffCompanySegments([RETAIL, ONLINE], [{ id: IDS.retail, name: "Retail" }]);
    expect(describeChanges(removed, gap, 1)).toEqual([
      {
        title: 'Remove "Online"',
        detail:
          "Jul 2026 and Sep 2026 (already submitted) keep its figures. " +
          "Its figures in Aug 2026 (not submitted yet) will be cleared.",
      },
    ]);
  });

  it("counts the changes for a long confirmation", () => {
    const many = diffCompanySegments(
      [RETAIL, ONLINE, segmentRow("f1000000-0000-4000-8000-000000000009", "Unused", "company", 3)],
      [
        { id: IDS.online, name: "Web" },
        { id: IDS.retail, name: "Shops" },
        { name: "Kiosks" },
        { name: "Wholesale" },
      ],
    );
    expect(changeCountsText(many)).toBe("2 renamed, 1 removed, 2 added and a new order");
    expect(changeCountsText(diffCompanySegments([RETAIL], [{ id: IDS.retail, name: "Shops" }]))).toBe("1 renamed");
    expect(changeCountsText(diffCompanySegments([RETAIL], [{ id: IDS.retail, name: "Retail" }]))).toBe("");
  });

  it("explains removals, additions, the order and an empty list", () => {
    const changes = diffCompanySegments(
      [RETAIL, ONLINE, segmentRow("f1000000-0000-4000-8000-000000000009", "Unused", "company", 3)],
      [{ name: "Web" }],
    );
    expect(describeChanges(changes, usage, 1)).toEqual([
      {
        title: 'Remove "Retail"',
        detail: "Jul 2026 (already submitted) keeps its figures. Its figures in Sep 2026 (not submitted yet) will be cleared.",
      },
      { title: 'Remove "Online"', detail: "Its figures in Oct 2026 (not submitted yet) will be cleared." },
      { title: 'Remove "Unused"', detail: undefined },
      { title: 'Add "Web"', detail: "Months not yet submitted will ask for revenue for the new segments." },
    ]);

    const none = diffCompanySegments([RETAIL], []);
    expect(describeChanges(none, usage, 0).at(-1)).toEqual({
      title: "No segments left",
      detail: "Monthly updates will ask for total revenue directly.",
    });

    const moved = diffCompanySegments(
      [RETAIL, ONLINE],
      [
        { id: IDS.online, name: "Online" },
        { id: IDS.retail, name: "Retail" },
        { name: "Web" },
      ],
    );
    expect(describeChanges(moved, usage, 3).map((item) => item.title)).toEqual([
      'Add "Web"',
      "Change the order of the segments",
    ]);
  });
});
