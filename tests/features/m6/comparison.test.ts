import { describe, expect, it } from "vitest";

import {
  RETIRED_SEGMENT_NOTE,
  buildComparisonSections,
  changeKindFor,
  companySegmentsChangedSince,
  computeChange,
  fieldValue,
  isOpenStatus,
  kpiCellValue,
  reviewTargetOptions,
  scaleupLinesTotal,
  shownFinancials,
  type ComparisonRow,
  type ComparisonSection,
} from "@/components/review/comparison";
import { reviewFlags } from "@/components/review/flags";
import { buildNarrativeSections } from "@/components/review/narrative";

import { IDS, SEP_VALUES, TS, buildBundle, defaultSegments, segment, values } from "./fixtures";

function rowOf(sections: ComparisonSection[], key: string): ComparisonRow {
  for (const section of sections) {
    const row = section.rows.find((r) => r.key === key);
    if (row) return row;
  }
  throw new Error(`no row ${key}`);
}

describe("buildComparisonSections", () => {
  const sections = buildComparisonSections(buildBundle());

  it("orders the sections and leaves none empty", () => {
    expect(sections.map((s) => s.title)).toEqual([
      "Revenue",
      "ScaleUp revenue lines",
      "Profitability",
      "Cash and burn",
      "Headcount",
      "Company KPIs",
      "Unit economics",
    ]);
  });

  it("lists the company's own segments, matched by id across the months, then total revenue as their total (BRD B30)", () => {
    const revenue = sections[0];
    expect(revenue.description).toBe("Revenue segments defined by the company. They add up to total revenue.");
    // Sep and Aug (submitted / approved) show the segments they have figures for; Wholesale, retired, only
    // in the month that has a figure for it (Sep 2025).
    expect(revenue.rows.map((r) => [r.label, r.note])).toEqual([
      ["Online", null],
      ["Retail", null],
      ["Wholesale", RETIRED_SEGMENT_NOTE],
      ["Total revenue", null],
    ]);
    const online = rowOf(sections, `segment:${IDS.segOnline}`);
    expect(online).toMatchObject({
      kind: "money",
      target: `segment:${IDS.segOnline}`,
      commentLabel: "Revenue: Online",
      current: 100000,
      previous: 70000,
      lastYear: null,
      yoy: null,
    });
    expect(online.change).toBeCloseTo(42.857, 3);
    expect(rowOf(sections, `segment:${IDS.segWholesale}`)).toMatchObject({ current: null, previous: null, lastYear: 80000, change: null });
    const total = rowOf(sections, "field:revenue_total");
    expect(total).toMatchObject({ emphasis: "total", target: "field:revenue_total", current: 150000, change: 50, yoy: 87.5 });
  });

  it("shows ScaleUp's revenue lines as a separate group without a total (BRD B30)", () => {
    const lines = sections[1];
    expect(lines).toMatchObject({
      key: "scaleup_lines",
      description: "Defined by ScaleUp for this company. They need not add up to total revenue.",
    });
    expect(lines.rows.map((r) => [r.label, r.note, r.emphasis])).toEqual([
      ["Corporate gifting", null, "normal"],
      ["Export", RETIRED_SEGMENT_NOTE, "normal"],
    ]);
    const gifting = rowOf(sections, `segment:${IDS.lineGifting}`);
    expect(gifting).toMatchObject({ commentLabel: "ScaleUp revenue line: Corporate gifting", current: 20000, previous: 15000 });
    expect(gifting.change).toBeCloseTo(33.333, 3);
    // Export was retired after August: September (submitted without it) shows a dash.
    expect(rowOf(sections, `segment:${IDS.lineExport}`)).toMatchObject({ current: null, previous: 5000, change: null });
  });

  it("derives margins in percentage points and has no comment target on derived rows", () => {
    const gp = rowOf(sections, "derived:gp_pct");
    expect(gp).toMatchObject({ kind: "percent", changeKind: "points", target: null, emphasis: "derived", current: 40, previous: 45, lastYear: 37.5 });
    expect(gp.change).toBeCloseTo(-5, 6);
    expect(gp.yoy).toBeCloseTo(2.5, 6);
    const np = rowOf(sections, "derived:np_pct");
    expect(np).toMatchObject({ current: -10, previous: -20, lastYear: -12.5 });
    expect(np.change).toBeCloseTo(10, 6);
    // A loss that shrinks is growth: -20,000 → -15,000 is +25 %.
    expect(rowOf(sections, "field:net_profit").change).toBeCloseTo(25, 6);
  });

  it("shows runway as months with cash-flow-positive months flagged, and burn growth from zero as unknown", () => {
    const runway = rowOf(sections, "derived:runway");
    expect(runway).toMatchObject({
      kind: "runway",
      changeKind: "months",
      current: 8,
      previous: null,
      lastYear: 5,
      change: null,
      yoy: 3,
      cashflowPositive: { current: false, previous: true, lastYear: false },
    });
    expect(rowOf(sections, "field:burn_rate")).toMatchObject({ previous: 0, change: null });
    expect(rowOf(sections, "field:headcount_ft")).toMatchObject({ kind: "integer", change: 20 });
    expect(rowOf(sections, "field:headcount_pt")).toMatchObject({ change: 0, yoy: 50 });
  });

  it("lists KPI cells due this month per active member, plus any cell with a value", () => {
    const kpis = sections.find((s) => s.key === "kpis")?.rows ?? [];
    expect(kpis.map((r) => [r.group, r.label, r.note])).toEqual([
      ["Revenue per outlet", "Mont Kiara", null],
      ["Revenue per outlet", "The Row", null],
      ["Revenue per outlet", "Closed Outlet", "Inactive"],
      [null, "Profitable", null],
      [null, "App downloads", null],
      [null, "Old metric", "Inactive KPI"],
    ]);
    expect(rowOf(sections, `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`)).toMatchObject({
      kind: "money",
      unit: null,
      target: `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`,
      current: 30000,
      change: 20,
    });
    expect(rowOf(sections, `kpi:${IDS.kpiProfitable}`)).toMatchObject({ kind: "boolean", changeKind: "none", current: true, previous: false, change: null });
    expect(rowOf(sections, `kpi:${IDS.kpiDownloads}`)).toMatchObject({ kind: "integer", unit: "downloads", change: 20 });
    // The half-yearly KPI is only collected in June and December.
    expect(kpis.some((r) => r.label === "Customer NPS")).toBe(false);
  });

  it("includes half-yearly KPIs in June and December", () => {
    const december = buildComparisonSections(buildBundle({ month: "2026-12-01" }));
    expect(december.find((s) => s.key === "kpis")?.rows.map((r) => r.label)).toContain("Customer NPS");
  });

  it("compares the template's additional numbers by field type", () => {
    const custom = sections.find((s) => s.title === "Unit economics")?.rows ?? [];
    expect(custom.map((r) => [r.label, r.kind, r.changeKind])).toEqual([
      ["Customer acquisition cost", "money", "growth"],
      ["Conversion rate", "percent", "points"],
      ["Orders", "integer", "growth"],
    ]);
    expect(rowOf(sections, "field:conversion").change).toBeCloseTo(0.5, 6);
    expect(rowOf(sections, "field:orders")).toMatchObject({ current: 800, previous: null, change: null });
  });

  it("copes with a month that has no prior month or last year", () => {
    const alone = buildComparisonSections(buildBundle({ previous: false, lastYear: false }));
    const total = rowOf(alone, "field:revenue_total");
    expect(total).toMatchObject({ previous: null, lastYear: null, change: null, yoy: null });
    expect(alone[0].rows.map((r) => r.label)).toEqual(["Online", "Retail", "Total revenue"]);
    expect(alone[1].rows.map((r) => r.label)).toEqual(["Corporate gifting"]);
    expect(alone.find((s) => s.key === "kpis")?.rows.map((r) => r.label)).toEqual([
      "Mont Kiara",
      "The Row",
      "Profitable",
      "App downloads",
    ]);
  });
});

describe("revenue segments across months (BRD B30)", () => {
  // Retail was renamed "Stores" after August was approved: a new series (new id) replaced it, and September,
  // still open, moved its Retail figure to Stores. "Marketplace" was added and has no figure yet. Export, a
  // retired ScaleUp line, keeps a figure in the open month that the month no longer shows.
  const STORES = "f0000000-0000-4000-8000-000000000004";
  const MARKETPLACE = "f0000000-0000-4000-8000-000000000005";
  const renamed = [
    segment(IDS.lineGifting, "Corporate gifting", 1, { kind: "scaleup" }),
    segment(IDS.segOnline, "Online", 1),
    segment(STORES, "Stores", 2),
    segment(MARKETPLACE, "Marketplace", 3),
    segment(IDS.segRetail, "Retail", 2, { retiredAt: "2026-09-20T04:00:00.000000+00:00" }),
    segment(IDS.lineExport, "Export", 2, { kind: "scaleup", retiredAt: "2026-09-02T04:00:00.000000+00:00" }),
    segment(IDS.segWholesale, "Wholesale", 3, { retiredAt: "2026-06-30T04:00:00.000000+00:00" }),
  ];
  const openSeptember = values(IDS.sep, {
    values: { revenue_total: { n: 130000 } },
    segments: { [IDS.segOnline]: 90000, [STORES]: 40000, [IDS.lineGifting]: 18000, [IDS.lineExport]: 1000 },
  });
  const bundle = buildBundle({ status: "draft", segments: renamed, current: openSeptember, lastYear: false });
  const sections = buildComparisonSections(bundle);

  it("starts a new row for a renamed segment, with a dash in the months where each name did not exist", () => {
    expect(sections[0].rows.map((r) => [r.label, r.current, r.previous, r.note])).toEqual([
      ["Online", 90000, 70000, null],
      ["Stores", 40000, null, null],
      ["Marketplace", null, null, null],
      ["Retail", null, 30000, RETIRED_SEGMENT_NOTE],
      ["Total revenue", 130000, 100000, null],
    ]);
    expect(rowOf(sections, `segment:${STORES}`)).toMatchObject({ change: null, target: `segment:${STORES}` });
  });

  it("says when this month's segments differ from the prior month's", () => {
    expect(companySegmentsChangedSince(bundle)).toBe("Aug 2026");
    expect(sections[0].description).toBe(
      "Revenue segments defined by the company. They add up to total revenue. This month's segments differ from those of Aug 2026, so some rows do not compare like for like.",
    );
    expect(companySegmentsChangedSince(buildBundle())).toBeNull();
    expect(companySegmentsChangedSince(buildBundle({ previous: false }))).toBeNull();
  });

  it("follows the current lines in an open month, so a retired line's leftover figure is not shown", () => {
    expect(sections[1].rows.map((r) => [r.label, r.current, r.previous])).toEqual([
      ["Corporate gifting", 18000, 15000],
      ["Export", null, 5000],
    ]);
    expect(scaleupLinesTotal(bundle)).toBe(18000);
  });

  it("follows the current segments in an open prior month too", () => {
    const reopenedAugust = buildBundle({
      segments: renamed,
      previousStatus: "changes_requested",
      previousValues: values(IDS.aug, {
        values: { revenue_total: { n: 100000 } },
        segments: { [IDS.segOnline]: 70000, [STORES]: 30000 },
      }),
      lastYear: false,
    });
    expect(buildComparisonSections(reopenedAugust)[0].rows.map((r) => [r.label, r.current, r.previous])).toEqual([
      ["Online", 100000, 70000],
      ["Retail", 50000, null],
      ["Stores", null, 30000],
      ["Marketplace", null, null],
      ["Total revenue", 150000, 100000],
    ]);
  });

  it("enters total revenue directly when the company has no segments of its own", () => {
    const linesOnly = defaultSegments().filter((s) => s.kind === "scaleup");
    const result = buildComparisonSections(buildBundle({ segments: linesOnly }));
    expect(result[0]).toMatchObject({ key: "revenue", description: null });
    expect(result[0].rows.map((r) => [r.label, r.emphasis])).toEqual([["Total revenue", "normal"]]);
    expect(result[1].rows.map((r) => r.label)).toEqual(["Corporate gifting", "Export"]);
    const none = buildComparisonSections(buildBundle({ segments: [] }));
    expect(none.map((s) => s.key)).not.toContain("scaleup_lines");
    expect(scaleupLinesTotal(buildBundle({ segments: [] }))).toBeNull();
  });

  it("shows an open month's total revenue as the sum of its segments when the stored total is out of date", () => {
    // The owner removed "Stores" while September was a draft: its figure was cleared, the stored total
    // (130,000) is recalculated only when the month is next saved, so the review shows the sum (90,000), as
    // the monthly form and the exports do; margins follow it.
    const stale = values(IDS.sep, {
      values: { revenue_total: { n: 130000 }, gross_profit: { n: 45000 } },
      segments: { [IDS.segOnline]: 90000 },
    });
    const draft = buildBundle({ status: "draft", segments: renamed, current: stale, lastYear: false });
    const total = rowOf(buildComparisonSections(draft), "field:revenue_total");
    expect(total.current).toBe(90000);
    expect(rowOf(buildComparisonSections(draft), "derived:gp_pct").current).toBe(50);
    // A submitted month keeps the total it was submitted with.
    const submitted = buildBundle({ status: "submitted", segments: renamed, current: stale, lastYear: false });
    expect(rowOf(buildComparisonSections(submitted), "field:revenue_total").current).toBe(130000);
  });

  it("keeps the stored total while none of the company's segments has an amount, or without own segments", () => {
    const month = { status: "draft" as const, values: { segments: {} } };
    const financials = { ...buildBundle().financials, revenue_total: 1000 };
    expect(shownFinancials(financials, month, { segments: renamed })).toBe(financials);
    const linesOnly = renamed.filter((s) => s.kind === "scaleup");
    const withLine = { status: "draft" as const, values: { segments: { [IDS.lineGifting]: 5000 } } };
    expect(shownFinancials(financials, withLine, { segments: linesOnly }).revenue_total).toBe(1000);
  });

  it("knows which months are open for changes", () => {
    expect(["draft", "changes_requested", "submitted", "approved"].map((s) => isOpenStatus(s as never))).toEqual([true, true, false, false]);
  });
});

describe("reviewFlags", () => {
  it("raises the flags of computeFlags for the month under review", () => {
    const flags = reviewFlags(buildBundle(), [{ target: "field:headcount_pt", code: "required", message: "Part-time headcount is required." }]);
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ["missing_required", "critical"],
      ["revenue_swing", "warning"],
    ]);
  });

  it("warns when ScaleUp's revenue lines add up to more than total revenue (BRD B30)", () => {
    const current = { ...SEP_VALUES, segments: { ...SEP_VALUES.segments, [IDS.lineGifting]: 200000 } };
    const flags = reviewFlags(buildBundle({ current }), []);
    expect(flags.find((f) => f.code === "segments_exceed_total")).toEqual({
      code: "segments_exceed_total",
      severity: "warning",
      message: "The ScaleUp revenue lines add up to RM 200,000, more than total revenue (RM 150,000).",
    });
    expect(reviewFlags(buildBundle(), []).some((f) => f.code === "segments_exceed_total")).toBe(false);
    // In the company's currency.
    const usd = reviewFlags(buildBundle({ current, company: { reporting_currency: "USD" } }), []);
    expect(usd.find((f) => f.code === "segments_exceed_total")?.message).toContain("USD 200,000");
  });
});

describe("reviewTargetOptions", () => {
  it("offers every commentable row of the table and the narrative fields, grouped by section", () => {
    const bundle = buildBundle();
    const options = reviewTargetOptions(buildComparisonSections(bundle), buildNarrativeSections(bundle));
    expect(options.slice(0, 6)).toEqual([
      { value: `segment:${IDS.segOnline}`, label: "Revenue: Online", group: "Revenue" },
      { value: `segment:${IDS.segRetail}`, label: "Revenue: Retail", group: "Revenue" },
      { value: `segment:${IDS.segWholesale}`, label: "Revenue: Wholesale", group: "Revenue" },
      { value: "field:revenue_total", label: "Total revenue", group: "Revenue" },
      { value: `segment:${IDS.lineGifting}`, label: "ScaleUp revenue line: Corporate gifting", group: "ScaleUp revenue lines" },
      { value: `segment:${IDS.lineExport}`, label: "ScaleUp revenue line: Export", group: "ScaleUp revenue lines" },
    ]);
    expect(options.find((o) => o.value === `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`)).toEqual({
      value: `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`,
      label: "Revenue per outlet (Mont Kiara)",
      group: "Company KPIs",
    });
    expect(options.find((o) => o.value === "field:key_milestones")).toEqual({
      value: "field:key_milestones",
      label: "Key milestones",
      group: "Company Summary",
    });
    // Derived rows (margins, runway) have no comment target.
    expect(options.some((o) => o.label === "GP %" || o.label === "Runway")).toBe(false);
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });
});

describe("change helpers", () => {
  it("maps kinds to change kinds", () => {
    expect(["money", "number", "integer", "percent", "runway", "boolean", "text"].map((k) => changeKindFor(k as ComparisonRow["kind"]))).toEqual([
      "growth",
      "growth",
      "growth",
      "points",
      "months",
      "none",
      "none",
    ]);
  });

  it("computes growth, differences and nothing for non-numbers", () => {
    expect(computeChange("growth", 150, 100)).toBe(50);
    expect(computeChange("growth", 150, 0)).toBeNull();
    expect(computeChange("points", 45.1, 40.05)).toBe(5.05);
    expect(computeChange("months", 3, 5)).toBe(-2);
    expect(computeChange("none", 1, 2)).toBeNull();
    expect(computeChange("growth", null, 100)).toBeNull();
    expect(computeChange("points", true, false)).toBeNull();
  });

  it("reads stored values from the column of their type", () => {
    const base = { submission_id: IDS.sep, created_at: TS, updated_at: TS, updated_by: null };
    const valueRow = (value_number: number | null, value_text: string | null, value_json: unknown) => ({
      ...base,
      field_key: "x",
      value_number,
      value_text,
      value_json: value_json as never,
    });
    expect(fieldValue("currency", valueRow(12.5, null, null))).toBe(12.5);
    expect(fieldValue("text", valueRow(null, "  hello ", null))).toBe("hello");
    expect(fieldValue("long_text", valueRow(null, "   ", null))).toBeNull();
    expect(fieldValue("tags", valueRow(null, null, ["A", 1, "B"]))).toBe("A, B");
    expect(fieldValue("tags", valueRow(null, null, []))).toBeNull();
    expect(fieldValue("boolean", valueRow(null, null, false))).toBe(false);
    expect(fieldValue("rating", undefined)).toBeNull();

    const kpiRow = (value_number: number | null, value_text: string | null, value_bool: boolean | null) => ({
      ...base,
      id: "k",
      kpi_id: IDS.kpiDownloads,
      dimension_member_id: null,
      value_number,
      value_text,
      value_bool,
    });
    expect(kpiCellValue("integer", kpiRow(5, null, null))).toBe(5);
    expect(kpiCellValue("boolean", kpiRow(null, null, false))).toBe(false);
    expect(kpiCellValue("text", kpiRow(null, " ok ", null))).toBe("ok");
    expect(kpiCellValue("currency", undefined)).toBeNull();
  });
});
