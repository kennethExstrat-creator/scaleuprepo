import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeFlags, gpPct } from "@/lib/metrics";
import {
  companySegmentListError,
  contributorLimitMessage,
  contributorSlotsLeft,
  diffCompanySegments,
  emptySubmissionValues,
  isCompanySegment,
  normaliseSegmentName,
  parseFieldOptions,
  parseFieldValidation,
  partitionRevenueSegments,
  segmentKind,
  segmentsForMonth,
  sumSegmentAmounts,
  toMonthlyFinancials,
  type RevenueSegmentRow,
  type SubmissionRow,
  type SubmissionValueRow,
} from "@/lib/types/domain";

const row = (field_key: string, value_number: number | null): SubmissionValueRow => ({
  submission_id: "s",
  field_key,
  value_number,
  value_text: null,
  value_json: null,
  created_at: "",
  updated_at: "",
  updated_by: null,
});

describe("parseFieldValidation", () => {
  it("keeps only well-typed settings", () => {
    expect(parseFieldValidation({ min: 0 })).toEqual({ min: 0 });
    expect(parseFieldValidation({ allow_negative: true })).toEqual({ allow_negative: true });
    expect(parseFieldValidation({ min: "0", max: 10, allow_negative: "no", max_length: 4000 })).toEqual({ max: 10, max_length: 4000 });
    expect(parseFieldValidation({ max_length: " 200 " })).toEqual({ max_length: 200 });
    expect(parseFieldValidation({ max_length: -1 })).toBeNull();
    expect(parseFieldValidation([1, 2])).toBeNull();
    expect(parseFieldValidation(null)).toBeNull();
    expect(parseFieldValidation("x")).toBeNull();
    expect(parseFieldValidation({})).toBeNull();
  });
});

describe("parseFieldOptions", () => {
  it("reads choices and rating scales", () => {
    expect(parseFieldOptions({ field_type: "picklist", options: { options: ["A", 1, "B"] } })).toEqual({ choices: ["A", "B"], rating: null });
    expect(parseFieldOptions({ field_type: "tags", options: { options: ["Hiring"] } })).toEqual({ choices: ["Hiring"], rating: null });
    expect(parseFieldOptions({ field_type: "rating", options: { min: 0, max: 10, labels: { "0": "Low", "10": 10 } } })).toEqual({
      choices: [],
      rating: { min: 0, max: 10, labels: { "0": "Low" } },
    });
    expect(parseFieldOptions({ field_type: "rating", options: null })).toEqual({ choices: [], rating: { min: 1, max: 5, labels: {} } });
    expect(parseFieldOptions({ field_type: "text", options: { options: ["A"] } })).toEqual({ choices: [], rating: null });
  });
});

describe("toMonthlyFinancials", () => {
  it("builds MonthlyFinancials from values, snapshots and view rows", () => {
    const values = emptySubmissionValues();
    values.values.revenue_total = row("revenue_total", 100);
    values.values.gross_profit = row("gross_profit", 40);
    const fromValues = toMonthlyFinancials("2026-09-01", values);
    expect(fromValues).toEqual({
      month: "2026-09-01",
      revenue_total: 100,
      gross_profit: 40,
      net_profit: null,
      cash_in_bank: null,
      burn_rate: null,
      headcount_ft: null,
      headcount_pt: null,
    });
    expect(gpPct(fromValues)).toBe(40);
    const submission = { month: "2026-08-01" } as SubmissionRow;
    expect(toMonthlyFinancials({ submission, values }).month).toBe("2026-08-01");
    expect(
      toMonthlyFinancials({
        month: "2026-07-01",
        revenue_total: 5,
        gross_profit: null,
        net_profit: null,
        cash_in_bank: 60,
        burn_rate: 10,
        headcount_ft: 3,
        headcount_pt: 0,
      }),
    ).toEqual({ month: "2026-07-01", revenue_total: 5, gross_profit: null, net_profit: null, cash_in_bank: 60, burn_rate: 10, headcount_ft: 3, headcount_pt: 0 });
    // feeds computeFlags directly
    const flags = computeFlags({
      current: toMonthlyFinancials("2026-09-01", values),
      previous: toMonthlyFinancials("2026-08-01", { values: { revenue_total: row("revenue_total", 50) } }),
    });
    expect(flags.map((f) => f.code)).toEqual(["revenue_swing"]);
  });
});

describe("contributor limit (BRD B29)", () => {
  it("counts the places an owner has left, never below zero", () => {
    expect(contributorSlotsLeft(0, 4)).toBe(4);
    expect(contributorSlotsLeft(3, 4)).toBe(1);
    expect(contributorSlotsLeft(4, 4)).toBe(0);
    expect(contributorSlotsLeft(7, 4)).toBe(0); // ScaleUp added more
    expect(contributorSlotsLeft(0, 0)).toBe(0);
    expect(contributorSlotsLeft(-1, 2)).toBe(2);
  });

  it("words the refusal like the database (tests/db/decisions-2026-10-01.test.ts compares them)", () => {
    expect(contributorLimitMessage(4)).toBe("Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.");
    expect(contributorLimitMessage(1)).toBe("Your team already has 1 contributor. Deactivate one, or ask ScaleUp to add more.");
    expect(contributorLimitMessage(0)).toBe("Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.");
  });
});

// ---------------------------------------------------------------------------------------------
// Revenue segments (BRD B30)
// ---------------------------------------------------------------------------------------------
function segment(id: string, kind: "company" | "scaleup", name: string, sort_order: number, retired_at: string | null = null): RevenueSegmentRow {
  return { id, company_id: "c", kind, name, sort_order, is_active: retired_at === null, retired_at, created_at: "" };
}

const online = segment("s1", "company", "Online", 1);
const retail = segment("s2", "company", "Retail", 2);
const ecommerce = segment("s0", "company", "E-commerce", 1, "2026-10-01T00:00:00+00:00"); // retired
const wholesale = segment("s9", "company", "Wholesale", 3, "2026-08-01T00:00:00+00:00"); // retired earlier
const fees = segment("l1", "scaleup", "Marketplace fees", 1);
const oldLine = segment("l2", "scaleup", "Old line", 0, "2026-07-01T00:00:00+00:00");
const ALL = [wholesale, fees, retail, oldLine, ecommerce, online];

describe("segment kinds", () => {
  it("reads the kind, anything but 'company' being a ScaleUp line", () => {
    expect(segmentKind(online)).toBe("company");
    expect(segmentKind(fees)).toBe("scaleup");
    expect(segmentKind({ kind: "other" })).toBe("scaleup");
    expect(segmentKind({})).toBe("scaleup");
    expect([isCompanySegment(online), isCompanySegment(fees), isCompanySegment({ kind: null })]).toEqual([true, false, false]);
  });

  it("splits a company's segments for CompanyConfig", () => {
    const parts = partitionRevenueSegments(ALL);
    expect(parts.companySegments.map((s) => s.name)).toEqual(["Online", "Retail"]);
    expect(parts.scaleupSegments.map((s) => s.name)).toEqual(["Marketplace fees"]);
    expect(parts.retiredCompanySegments.map((s) => s.name)).toEqual(["E-commerce", "Wholesale"]); // newest first
    expect(partitionRevenueSegments([])).toEqual({ companySegments: [], scaleupSegments: [], retiredCompanySegments: [] });
  });
});

describe("segmentsForMonth", () => {
  const config = { segments: ALL };

  it("shows the current (active) segments in a month open for changes, whatever it holds", () => {
    const shown = segmentsForMonth(config, { segments: { s0: 5, l2: 7 } }, true);
    expect(shown.company.map((s) => s.name)).toEqual(["Online", "Retail"]);
    expect(shown.scaleup.map((s) => s.name)).toEqual(["Marketplace fees"]);
  });

  it("shows exactly the segments a read-only month has figures for, retired ones included, by sort order then name", () => {
    const shown = segmentsForMonth(config, { segments: { s2: 1, s0: 2, s1: 0, l2: 3, s9: null } }, false);
    expect(shown.company.map((s) => s.name)).toEqual(["E-commerce", "Online", "Retail"]); // 0 counts, null does not
    expect(shown.scaleup.map((s) => s.name)).toEqual(["Old line"]);
    expect(segmentsForMonth(config, emptySubmissionValues(), false)).toEqual({ company: [], scaleup: [] });
  });
});

describe("sumSegmentAmounts", () => {
  it("adds up the amounts present, exactly, each segment once; null when none", () => {
    expect(sumSegmentAmounts([online, retail], { s1: 0.1, s2: 0.2 })).toBe(0.3);
    expect(sumSegmentAmounts([online, retail, online], { s1: 100, s2: 50.25, l1: 9 })).toBe(150.25);
    expect(sumSegmentAmounts([online, retail], { s1: null })).toBeNull();
    expect(sumSegmentAmounts([], { s1: 1 })).toBeNull();
    expect(sumSegmentAmounts([online], null)).toBeNull();
    expect(sumSegmentAmounts([online, retail], { s1: -5, s2: 5 })).toBe(0);
    expect(sumSegmentAmounts([online, retail], { s1: 123_456_789_012.34, s2: 0.01 })).toBe(123_456_789_012.35);
  });
});

describe("company segment lists (set_company_revenue_segments mirrors)", () => {
  it("normalises names like the database: spaces, tabs and line breaks trimmed at both ends", () => {
    expect(normaliseSegmentName("  Online\t\n")).toBe("Online");
    expect(normaliseSegmentName("On line")).toBe("On line");
    expect(normaliseSegmentName("\u00a0Online")).toBe("\u00a0Online"); // only ASCII whitespace, as in SQL
  });

  it("reports the first problem the database would refuse, word for word", () => {
    expect(companySegmentListError([])).toBeNull();
    expect(companySegmentListError([{ name: "Online" }, { id: "s2", name: " Retail " }])).toBeNull();
    expect(companySegmentListError(Array.from({ length: 51 }, (_, i) => ({ name: `S${i}` })))).toBe(
      "A company can have at most 50 revenue segments.",
    );
    expect(companySegmentListError([{ name: " \t " }])).toBe("Each revenue segment needs a name.");
    expect(companySegmentListError([{ name: "x".repeat(81) }])).toBe("Revenue segment names can be at most 80 characters.");
    expect(companySegmentListError([{ name: "😀".repeat(80) }])).toBeNull(); // characters, not UTF-16 units
    expect(companySegmentListError([{ name: "On\nline" }])).toBe("Revenue segment names cannot contain line breaks or tabs.");
    expect(companySegmentListError([{ name: "Online" }, { name: "ONLINE " }])).toBe(
      'There are two revenue segments called "ONLINE". Give each segment a different name.',
    );
    expect(companySegmentListError([{ id: "S1", name: "A" }, { id: "s1", name: "B" }])).toBe(
      "Each revenue segment can only be listed once.",
    );
  });
});

describe("diffCompanySegments", () => {
  const current = [online, retail];

  it("finds nothing to warn about when only the order or surrounding spaces change", () => {
    expect(diffCompanySegments(current, [{ id: "s1", name: " Online" }, { id: "s2", name: "Retail" }])).toEqual({
      added: [],
      removed: [],
      renamed: [],
      reordered: false,
      affectsComparability: false,
      changed: false,
    });
    expect(diffCompanySegments(current, [{ id: "s2", name: "Retail" }, { id: "s1", name: "Online" }])).toMatchObject({
      reordered: true,
      affectsComparability: false,
      changed: true,
    });
  });

  it("reports added, removed and renamed segments (a case change is a rename)", () => {
    const diff = diffCompanySegments(current, [{ id: "s1", name: "online" }, { name: "Wholesale" }]);
    expect(diff).toEqual({
      added: ["Wholesale"],
      removed: [retail],
      renamed: [{ segment: online, name: "online" }],
      reordered: false,
      affectsComparability: true,
      changed: true,
    });
  });

  it("matches an item without id to the unlisted segment of that name, like the database", () => {
    // Taken out and put back: the same segment.
    expect(diffCompanySegments(current, [{ name: "Retail" }, { name: "ONLINE" }])).toMatchObject({
      added: [],
      removed: [],
      renamed: [{ segment: online, name: "ONLINE" }],
      reordered: true,
    });
    // Listed by id under a new name: a new segment with the old name is a new one.
    expect(diffCompanySegments(current, [{ id: "s1", name: "Web" }, { name: "Online" }, { id: "s2", name: "Retail" }])).toMatchObject({
      added: ["Online"],
      removed: [],
      renamed: [{ segment: online, name: "Web" }],
    });
    // An id that is no longer current counts as new (the database refuses it: reload the page).
    expect(diffCompanySegments(current, [{ id: "gone", name: "Gone" }]).added).toEqual(["Gone"]);
  });
});
