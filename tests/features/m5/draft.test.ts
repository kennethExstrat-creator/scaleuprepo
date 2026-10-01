import { describe, expect, it } from "vitest";

import {
  applySaved,
  buildSavePayload,
  countChanges,
  diffDraft,
  emptyDraft,
  isEmptyFieldDraft,
  isEmptyJson,
  isNegativeText,
  jsonDraft,
  mergeServerValues,
  normaliseTags,
  numberDraft,
  parseNumberField,
  pickChanged,
  reconcileRevenueTotal,
  roundToScale,
  sameFieldDraft,
  sameKpiDraft,
  segmentTotal,
  textDraft,
  toDraftValues,
  toggleSignText,
  withFieldValue,
  withKpiValue,
  withSegmentAmount,
  type DraftValues,
  type PayloadTypes,
} from "@/components/submission-form/draft";
import { kpiCellKey } from "@/lib/targets";
import type { SubmissionValues } from "@/lib/types/domain";

const KPI = "e0000000-0000-4000-8000-000000000001";
const KPI_BOOL = "e0000000-0000-4000-8000-000000000003";
const KPI_TEXT = "e0000000-0000-4000-8000-000000000004";
const MEMBER = "d1000000-0000-4000-8000-000000000001";
const SEG_A = "f0000000-0000-4000-8000-000000000001";
const SEG_B = "f0000000-0000-4000-8000-000000000002";
const SEG_OLD = "f0000000-0000-4000-8000-000000000003";
const SUB = "90000000-0000-4000-8000-000000000009";

const TYPES: PayloadTypes = {
  fieldTypes: {
    revenue_total: "currency",
    gross_profit: "currency",
    headcount_ft: "integer",
    key_milestones: "long_text",
    fundraising_status: "picklist",
    help_tags: "tags",
    team_morale: "rating",
    has_board: "boolean",
  },
  kpiTypes: { [KPI]: "currency", [KPI_BOOL]: "boolean", [KPI_TEXT]: "text" },
};

function draft(partial: Partial<DraftValues> = {}): DraftValues {
  return { values: {}, segments: {}, kpis: {}, ...partial };
}

const kpiNumber = (value_number: number | null) => ({ value_number, value_text: null, value_bool: null });

describe("toDraftValues", () => {
  it("keeps only the value columns and reads numeric strings", () => {
    const stored: SubmissionValues = {
      values: {
        revenue_total: {
          submission_id: SUB,
          field_key: "revenue_total",
          value_number: 1234.5,
          value_text: null,
          value_json: null,
          created_at: "2026-09-30T00:00:00Z",
          updated_at: "2026-09-30T00:00:00Z",
          updated_by: null,
        },
      },
      segments: { [SEG_A]: 100 },
      kpis: {
        [kpiCellKey(KPI, MEMBER)]: {
          id: "k1",
          submission_id: SUB,
          kpi_id: KPI,
          dimension_member_id: MEMBER,
          value_number: 12,
          value_text: null,
          value_bool: null,
          created_at: "2026-09-30T00:00:00Z",
          updated_at: "2026-09-30T00:00:00Z",
          updated_by: null,
        },
      },
    };
    expect(toDraftValues(stored)).toEqual({
      values: { revenue_total: { value_number: 1234.5, value_text: null, value_json: null } },
      segments: { [SEG_A]: 100 },
      kpis: { [kpiCellKey(KPI, MEMBER)]: { value_number: 12, value_text: null, value_bool: null } },
    });
  });
});

describe("emptiness and equality", () => {
  it("treats null, blank text, [] and {} as empty; 0 and false are values", () => {
    expect(isEmptyFieldDraft(undefined)).toBe(true);
    expect(isEmptyFieldDraft(textDraft("   "))).toBe(true);
    expect(isEmptyFieldDraft(jsonDraft([]))).toBe(true);
    expect(isEmptyFieldDraft(numberDraft(0))).toBe(false);
    expect(isEmptyFieldDraft(jsonDraft(false))).toBe(false);
    expect(isEmptyJson({})).toBe(true);
    expect(isEmptyJson("")).toBe(true);
    expect(isEmptyJson(0)).toBe(false);
  });

  it("compares stored values, not their shape", () => {
    expect(sameFieldDraft(undefined, textDraft(""))).toBe(true);
    expect(sameFieldDraft(numberDraft(1), numberDraft(1))).toBe(true);
    expect(sameFieldDraft(numberDraft(1), numberDraft(2))).toBe(false);
    expect(sameFieldDraft(textDraft("a"), textDraft("a "))).toBe(false);
    // Tags compare as sets.
    expect(sameFieldDraft(jsonDraft(["Hiring", "Finance"]), jsonDraft(["Finance", "Hiring"]))).toBe(true);
    expect(sameFieldDraft(jsonDraft(true), jsonDraft(false))).toBe(false);
    expect(sameKpiDraft(undefined, { value_number: null, value_text: " ", value_bool: null })).toBe(true);
    expect(sameKpiDraft(kpiNumber(0), undefined)).toBe(false);
  });
});

describe("diffDraft / buildSavePayload", () => {
  const base = draft({
    values: {
      revenue_total: numberDraft(100),
      key_milestones: textDraft("Launched"),
      help_tags: jsonDraft(["Hiring"]),
    },
    segments: { [SEG_A]: 60, [SEG_B]: 40 },
    kpis: { [kpiCellKey(KPI, MEMBER)]: kpiNumber(5) },
  });

  it("lists only the entries that changed (including cleared ones)", () => {
    const next = draft({
      values: {
        revenue_total: numberDraft(100),
        key_milestones: textDraft(""),
        help_tags: jsonDraft(["Hiring"]),
        gross_profit: numberDraft(-20),
      },
      segments: { [SEG_A]: 60, [SEG_B]: 45 },
      kpis: {
        [kpiCellKey(KPI, MEMBER)]: kpiNumber(5),
        [kpiCellKey(KPI_BOOL, null)]: { value_number: null, value_text: null, value_bool: false },
      },
    });
    const changes = diffDraft(base, next);
    expect(changes).toEqual({
      values: ["gross_profit", "key_milestones"],
      segments: [SEG_B],
      kpis: [kpiCellKey(KPI_BOOL, null)],
    });
    expect(countChanges(changes)).toBe(4);
    expect(countChanges(diffDraft(base, base))).toBe(0);
  });

  it("sends each value in its type's column; empty values delete", () => {
    const next = withFieldValue(
      withFieldValue(withFieldValue(base, "key_milestones", textDraft("  ")), "help_tags", jsonDraft([])),
      "gross_profit",
      numberDraft(-20),
    );
    const withKpis = withKpiValue(
      withKpiValue(next, kpiCellKey(KPI_BOOL, null), { value_number: null, value_text: null, value_bool: true }),
      kpiCellKey(KPI_TEXT, null),
      { value_number: null, value_text: "Soft launch", value_bool: null },
    );
    const payload = buildSavePayload(withKpis, diffDraft(base, withKpis), TYPES);
    expect(payload.values).toEqual([
      { key: "gross_profit", value_number: -20 },
      { key: "help_tags", value_json: null },
      { key: "key_milestones", value_text: null },
    ]);
    expect(payload.segments).toEqual([]);
    expect(payload.kpis).toEqual([
      { kpi_id: KPI_BOOL, dimension_member_id: null, value_bool: true },
      { kpi_id: KPI_TEXT, dimension_member_id: null, value_text: "Soft launch" },
    ]);
  });

  it("sends segment deletions as amount null and KPI cells with their member", () => {
    const next = draft({
      ...base,
      segments: { [SEG_A]: 60 },
      kpis: { [kpiCellKey(KPI, MEMBER)]: kpiNumber(7.5) },
    });
    const payload = buildSavePayload(next, diffDraft(base, next), TYPES);
    expect(payload.segments).toEqual([{ segment_id: SEG_B, amount: null }]);
    expect(payload.kpis).toEqual([{ kpi_id: KPI, dimension_member_id: MEMBER, value_number: 7.5 }]);
  });

  it("keeps text as typed (the database only drops blank text)", () => {
    const next = withFieldValue(base, "key_milestones", textDraft("  Two new outlets\n"));
    expect(buildSavePayload(next, diffDraft(base, next), TYPES).values).toEqual([
      { key: "key_milestones", value_text: "  Two new outlets\n" },
    ]);
  });

  it("sends every column for a field of unknown type", () => {
    const next = withFieldValue(base, "mystery", numberDraft(3));
    expect(buildSavePayload(next, diffDraft(base, next), TYPES).values).toEqual([
      { key: "mystery", value_number: 3, value_text: null, value_json: null },
    ]);
  });
});

describe("applySaved / mergeServerValues", () => {
  it("records what was sent as the server state, removing deleted entries", () => {
    const saved = draft({ values: { a: numberDraft(1), b: textDraft("x") }, segments: { [SEG_A]: 1 } });
    const current = draft({ values: { a: numberDraft(2), b: textDraft("") }, segments: {} });
    const changes = diffDraft(saved, current);
    const sent = pickChanged(current, changes);
    // The person keeps typing after the save left: the draft moves on, the sent values are what was stored.
    const after = applySaved(saved, sent, changes);
    expect(after).toEqual(draft({ values: { a: numberDraft(2) }, segments: {} }));
  });

  it("adopts server values for untouched entries and keeps changed or busy ones", () => {
    const saved = draft({ values: { a: numberDraft(1), b: numberDraft(1), c: numberDraft(1) } });
    const current = draft({ values: { a: numberDraft(1), b: numberDraft(9), c: numberDraft(5) } });
    const server = draft({ values: { a: numberDraft(2), b: numberDraft(3), d: textDraft("new") } });
    const busy = { values: ["c"], segments: [], kpis: [] };
    const merged = mergeServerValues(current, saved, server, busy);
    expect(merged.draft.values).toEqual({
      a: numberDraft(2), // untouched: server wins
      b: numberDraft(9), // changed here: kept
      c: numberDraft(5), // being saved: kept
      d: textDraft("new"), // new on the server
    });
    expect(merged.saved).toEqual(server);
    // An untouched entry deleted on the server disappears here too.
    const gone = mergeServerValues(saved, saved, emptyDraft());
    expect(gone.draft.values).toEqual({});
  });
});

describe("revenue segments", () => {
  const segments = [
    { id: SEG_A, is_active: true },
    { id: SEG_B, is_active: true },
    { id: SEG_OLD, is_active: false },
  ];

  it("sums the active segments that are filled in", () => {
    expect(segmentTotal(segments, {})).toBeNull();
    expect(segmentTotal(segments, { [SEG_A]: 0.1, [SEG_B]: 0.2, [SEG_OLD]: 1000 })).toBe(0.3);
    expect(segmentTotal(segments, { [SEG_A]: 100.55 })).toBe(100.55);
  });

  it("keeps total revenue equal to the sum when a segment changes", () => {
    let next = withSegmentAmount(emptyDraft(), segments, SEG_A, 1000);
    expect(next.values.revenue_total).toEqual(numberDraft(1000));
    next = withSegmentAmount(next, segments, SEG_B, 234.5);
    expect(next.values.revenue_total).toEqual(numberDraft(1234.5));
    next = withSegmentAmount(next, segments, SEG_A, null);
    expect(next.segments).toEqual({ [SEG_B]: 234.5 });
    expect(next.values.revenue_total).toEqual(numberDraft(234.5));
    next = withSegmentAmount(next, segments, SEG_B, null);
    expect(next.values.revenue_total).toBeUndefined();
  });

  it("corrects a stale stored total, but never clears one while no segment is filled in", () => {
    const stale = draft({ values: { revenue_total: numberDraft(999) }, segments: { [SEG_A]: 600, [SEG_B]: 400 } });
    expect(reconcileRevenueTotal(stale, segments).values.revenue_total).toEqual(numberDraft(1000));
    const consistent = draft({ values: { revenue_total: numberDraft(1000) }, segments: { [SEG_A]: 1000 } });
    expect(reconcileRevenueTotal(consistent, segments)).toBe(consistent);
    const noSegments = draft({ values: { revenue_total: numberDraft(500) } });
    expect(reconcileRevenueTotal(noSegments, segments)).toBe(noSegments);
    expect(reconcileRevenueTotal(stale, [])).toBe(stale);
  });
});

describe("normaliseTags", () => {
  it("orders tags like the options, keeps unknown ones last and drops duplicates", () => {
    const options = ["Fundraising", "Hiring", "Finance"];
    expect(normaliseTags(["Finance", "Fundraising"], options)).toEqual(["Fundraising", "Finance"]);
    expect(normaliseTags(["Old tag", "Hiring", "Hiring"], options)).toEqual(["Hiring", "Old tag"]);
  });
});

describe("roundToScale", () => {
  it("rounds half away from zero on the decimal digits, like Postgres numeric", () => {
    expect(roundToScale(1.005, 2)).toBe(1.01);
    expect(roundToScale(-1.005, 2)).toBe(-1.01);
    expect(roundToScale(2.5, 0)).toBe(3);
    expect(roundToScale(-2.5, 0)).toBe(-3);
    expect(roundToScale(9.995, 2)).toBe(10);
    expect(roundToScale(0.1 + 0.2, 4)).toBe(0.3);
    expect(roundToScale(1234.56789, 4)).toBe(1234.5679);
    expect(roundToScale(999_999_999_999.999, 2)).toBe(1_000_000_000_000);
  });

  it("leaves short numbers alone and handles tiny values", () => {
    expect(roundToScale(12, 2)).toBe(12);
    expect(roundToScale(0.5, 4)).toBe(0.5);
    expect(roundToScale(1e-7, 4)).toBe(0);
    expect(Object.is(roundToScale(-0.00001, 4), -0)).toBe(false);
  });
});

describe("parseNumberField", () => {
  it("reads grouped numbers, currency prefixes and brackets; empty clears", () => {
    expect(parseNumberField("1,234.50")).toEqual({ ok: true, value: 1234.5 });
    expect(parseNumberField("RM 1,000")).toEqual({ ok: true, value: 1000 });
    expect(parseNumberField("(2,500)")).toEqual({ ok: true, value: -2500 });
    expect(parseNumberField("  ")).toEqual({ ok: true, value: null });
  });

  it("rounds to the stored decimals", () => {
    expect(parseNumberField("100.555", { scale: 2 })).toEqual({ ok: true, value: 100.56 });
    expect(parseNumberField("0.123456")).toEqual({ ok: true, value: 0.1235 });
  });

  it("refuses unreadable, too large and (for whole numbers) decimal input", () => {
    expect(parseNumberField("12abc")).toMatchObject({ ok: false });
    expect(parseNumberField("1,23")).toMatchObject({ ok: false });
    expect(parseNumberField("1e3")).toMatchObject({ ok: false });
    expect(parseNumberField("1,000,000,000,000,000")).toEqual({ ok: false, message: "That number is too large." });
    expect(parseNumberField("12.5", { integer: true })).toMatchObject({ ok: false });
    expect(parseNumberField("12", { integer: true })).toEqual({ ok: true, value: 12 });
    expect(parseNumberField("abc", { integer: true })).toEqual({
      ok: false,
      message: "Enter a whole number, for example 12.",
    });
  });

  it("accepts a trailing % for percentages", () => {
    expect(parseNumberField("12.5 %", { percent: true })).toEqual({ ok: true, value: 12.5 });
    expect(parseNumberField("12.5%")).toMatchObject({ ok: false });
  });
});

describe("the ± button (toggleSignText, isNegativeText)", () => {
  it("negates numbers and shows them plainly", () => {
    expect(toggleSignText("1,234.5")).toBe("-1,234.5");
    expect(toggleSignText("-1,234.5")).toBe("1,234.5");
    expect(toggleSignText("45000")).toBe("-45,000");
    expect(toggleSignText("(1,000)")).toBe("1,000");
    expect(toggleSignText("RM -500")).toBe("500");
    expect(toggleSignText("+7")).toBe("-7");
    expect(toggleSignText("−250")).toBe("250");
  });

  it("keeps a trailing %", () => {
    expect(toggleSignText("12.5%")).toBe("-12.5%");
    expect(toggleSignText("-12.5 %")).toBe("12.5%");
  });

  it("starts a negative number in an empty box, and empties it again", () => {
    expect(toggleSignText("")).toBe("-");
    expect(toggleSignText("  ")).toBe("-");
    expect(toggleSignText("-")).toBe("");
    expect(toggleSignText("0")).toBe("-0");
    expect(toggleSignText("-0")).toBe("0");
  });

  it("adds or removes a leading minus on text that is not a number yet", () => {
    expect(toggleSignText("12a")).toBe("-12a");
    expect(toggleSignText("-12a")).toBe("12a");
  });

  it("always gives text the box reads back as the negated number", () => {
    for (const text of ["1,234.5", "-1,234.5", "(2,500)", "RM 1,000", "0.1235", "12%"]) {
      const before = parseNumberField(text, { percent: true });
      const once = parseNumberField(toggleSignText(text), { percent: true });
      const twice = parseNumberField(toggleSignText(toggleSignText(text)), { percent: true });
      expect([before.ok, once.ok, twice.ok]).toEqual([true, true, true]);
      if (before.ok && once.ok && twice.ok && before.value !== null) {
        expect(once.value).toBe(-before.value);
        expect(twice.value).toBe(before.value);
      }
    }
  });

  it("tells whether the box shows a negative number", () => {
    expect(isNegativeText("-1,200")).toBe(true);
    expect(isNegativeText("(1,200)")).toBe(true);
    expect(isNegativeText("RM -5")).toBe(true);
    expect(isNegativeText("-12%")).toBe(true);
    expect(isNegativeText("-")).toBe(true);
    expect(isNegativeText("-0")).toBe(true);
    expect(isNegativeText("1,200")).toBe(false);
    expect(isNegativeText("0")).toBe(false);
    expect(isNegativeText("")).toBe(false);
  });
});
