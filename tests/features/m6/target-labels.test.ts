import { describe, expect, it } from "vitest";

import {
  GENERAL_TARGET_LABEL,
  buildTargetLabels,
  fallbackTargetLabel,
  groupTargetOptions,
  humaniseKey,
  segmentTargetLabel,
  targetLabelFor,
  targetOptionsFrom,
} from "@/components/comments/target-labels";

import { IDS, buildBundle, segment } from "./fixtures";

describe("buildTargetLabels", () => {
  const labels = buildTargetLabels(buildBundle());

  it("labels general, template fields, segments and KPI cells in form order", () => {
    const keys = Object.keys(labels);
    expect(keys[0]).toBe("general");
    expect(labels.general).toBe(GENERAL_TARGET_LABEL);
    expect(labels["field:revenue_total"]).toBe("Total revenue");
    expect(labels["field:cash_in_bank"]).toBe("Cash in bank (month end)");
    expect(labels["field:cac"]).toBe("Customer acquisition cost");
    expect(labels["field:key_milestones"]).toBe("Key milestones");
    expect(labels["field:team_morale"]).toBe("Team morale");
    expect(keys.indexOf("field:revenue_total")).toBeLessThan(keys.indexOf("field:team_morale"));
    expect(keys.indexOf("field:team_morale")).toBeLessThan(keys.indexOf(`segment:${IDS.segOnline}`));
    expect(keys.indexOf(`segment:${IDS.segOnline}`)).toBeLessThan(keys.indexOf(`kpi:${IDS.kpiDownloads}`));
  });

  it("names the company's own segments and ScaleUp's revenue lines apart, own segments first (BRD B30)", () => {
    expect(labels[`segment:${IDS.segOnline}`]).toBe("Revenue: Online");
    expect(labels[`segment:${IDS.lineGifting}`]).toBe("ScaleUp revenue line: Corporate gifting");
    const keys = Object.keys(labels);
    expect(keys.indexOf(`segment:${IDS.segWholesale}`)).toBeLessThan(keys.indexOf(`segment:${IDS.lineGifting}`));
    expect(segmentTargetLabel(segment(IDS.segOnline, "Online", 1, { kind: "scaleup" }))).toBe("ScaleUp revenue line: Online");
    expect(segmentTargetLabel({ name: "Legacy", kind: "anything else" })).toBe("ScaleUp revenue line: Legacy");
  });

  it("includes retired segments, inactive KPIs and dimension members so older threads keep a label", () => {
    expect(labels[`segment:${IDS.segWholesale}`]).toBe("Revenue: Wholesale");
    expect(labels[`segment:${IDS.lineExport}`]).toBe("ScaleUp revenue line: Export");
    expect(labels[`kpi:${IDS.kpiRevenuePerOutlet}`]).toBe("Revenue per outlet");
    expect(labels[`kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`]).toBe("Revenue per outlet (Mont Kiara)");
    expect(labels[`kpi:${IDS.kpiRevenuePerOutlet}:${IDS.closedOutlet}`]).toBe("Revenue per outlet (Closed Outlet)");
    expect(labels[`kpi:${IDS.kpiOld}`]).toBe("Old metric");
    expect(labels[`kpi:${IDS.kpiDownloads}:${IDS.montKiara}`]).toBeUndefined();
  });

  it("falls back to generic labels for unknown targets", () => {
    expect(targetLabelFor("field:gross_profit", labels)).toBe("Gross profit");
    expect(targetLabelFor("field:gross_profit")).toBe("Gross profit");
    expect(targetLabelFor("field:burn_rate", {})).toBe("Burn rate (per month)");
    expect(targetLabelFor("field:new_custom_field", {})).toBe("New custom field");
    expect(targetLabelFor(`segment:${IDS.segOnline.toUpperCase()}`, labels)).toBe("Revenue: Online");
    expect(targetLabelFor("segment:f0000000-0000-4000-8000-00000000abcd", labels)).toBe("Revenue segment");
    expect(targetLabelFor(`kpi:${IDS.kpiNps}:${IDS.theRow}`, {})).toBe("Company KPI");
    expect(targetLabelFor("nonsense", labels)).toBe("General");
    expect(fallbackTargetLabel({ kind: "general" })).toBe("General");
    expect(humaniseKey("fundraising_status")).toBe("Fundraising status");
    expect(humaniseKey("__")).toBe("__");
  });
});

describe("targetOptionsFrom", () => {
  it("offers General first, then fields, revenue and KPIs", () => {
    const options = targetOptionsFrom(buildTargetLabels(buildBundle()));
    expect(options[0]).toEqual({ value: "general", label: "General", group: "General" });
    expect(options.filter((o) => o.value === "general")).toHaveLength(1);
    expect(options.find((o) => o.value === "field:gross_profit")?.group).toBe("Fields");
    expect(options.find((o) => o.value === `segment:${IDS.segRetail}`)?.group).toBe("Revenue");
    expect(options.find((o) => o.value === `segment:${IDS.lineGifting}`)).toEqual({
      value: `segment:${IDS.lineGifting}`,
      label: "ScaleUp revenue line: Corporate gifting",
      group: "Revenue",
    });
    expect(options.find((o) => o.value === `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`)).toEqual({
      value: `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`,
      label: "Revenue per outlet (The Row)",
      group: "Company KPIs",
    });
    expect(targetOptionsFrom(undefined)).toEqual([{ value: "general", label: "General", group: "General" }]);
  });
});

describe("groupTargetOptions", () => {
  it("groups options in order of first appearance with General first, each target once", () => {
    const groups = groupTargetOptions([
      { value: "field:gross_profit", label: "Gross profit", group: "Profitability" },
      { value: `segment:${IDS.segOnline}`, label: "Revenue: Online", group: "Revenue" },
      { value: "field:net_profit", label: "Net profit", group: "Profitability" },
      { value: "field:gross_profit", label: "Gross profit again", group: "Other" },
      { value: "general", label: "Anything", group: "Elsewhere" },
    ]);
    expect(groups.map((g) => [g.group, g.options.map((o) => o.label)])).toEqual([
      ["General", ["General"]],
      ["Profitability", ["Gross profit", "Net profit"]],
      ["Revenue", ["Revenue: Online"]],
    ]);
    expect(groupTargetOptions([])).toEqual([{ group: "General", options: [{ value: "general", label: "General", group: "General" }] }]);
  });
});
