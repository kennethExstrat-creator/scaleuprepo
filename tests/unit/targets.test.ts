import { describe, expect, it } from "vitest";
import {
  GENERAL_TARGET,
  fieldTarget,
  formatTarget,
  kpiCellKey,
  kpiTarget,
  parseKpiCellKey,
  parseTarget,
  segmentTarget,
  type ParsedTarget,
} from "@/lib/targets";

const KPI = "6f1c2d3e-0000-4000-8000-000000000001";
const MEMBER = "6f1c2d3e-0000-4000-8000-000000000002";
const SEGMENT = "6f1c2d3e-0000-4000-8000-000000000003";

describe("target strings", () => {
  it("builds the §2.5 formats", () => {
    expect(GENERAL_TARGET).toBe("general");
    expect(fieldTarget("gross_profit")).toBe("field:gross_profit");
    expect(segmentTarget(SEGMENT)).toBe(`segment:${SEGMENT}`);
    expect(kpiTarget(KPI)).toBe(`kpi:${KPI}`);
    expect(kpiTarget(KPI, null)).toBe(`kpi:${KPI}`);
    expect(kpiTarget(KPI, MEMBER)).toBe(`kpi:${KPI}:${MEMBER}`);
  });

  it("round-trips through parseTarget and formatTarget", () => {
    const cases: [string, ParsedTarget][] = [
      ["general", { kind: "general" }],
      [fieldTarget("cash_in_bank"), { kind: "field", fieldKey: "cash_in_bank" }],
      [segmentTarget(SEGMENT), { kind: "segment", segmentId: SEGMENT }],
      [kpiTarget(KPI), { kind: "kpi", kpiId: KPI, dimensionMemberId: null }],
      [kpiTarget(KPI, MEMBER), { kind: "kpi", kpiId: KPI, dimensionMemberId: MEMBER }],
    ];
    for (const [target, parsed] of cases) {
      expect(parseTarget(target)).toEqual(parsed);
      expect(formatTarget(parsed)).toBe(target);
    }
  });

  it("treats malformed targets as general", () => {
    for (const bad of ["", "field:", "segment:", "kpi:", `kpi:${KPI}:`, "field:a:b", `segment:${SEGMENT}:x`, "unknown:x", "kpi:a:b:c"]) {
      expect(parseTarget(bad)).toEqual({ kind: "general" });
    }
  });
});

describe("KPI cell keys", () => {
  it("uses '-' for KPIs without a dimension member", () => {
    expect(kpiCellKey(KPI)).toBe(`${KPI}:-`);
    expect(kpiCellKey(KPI, null)).toBe(`${KPI}:-`);
    expect(kpiCellKey(KPI, "")).toBe(`${KPI}:-`);
    expect(kpiCellKey(KPI, MEMBER)).toBe(`${KPI}:${MEMBER}`);
  });

  it("round-trips through parseKpiCellKey", () => {
    expect(parseKpiCellKey(kpiCellKey(KPI))).toEqual({ kpiId: KPI, dimensionMemberId: null });
    expect(parseKpiCellKey(kpiCellKey(KPI, MEMBER))).toEqual({ kpiId: KPI, dimensionMemberId: MEMBER });
    expect(parseKpiCellKey("nonsense")).toBeNull();
    expect(parseKpiCellKey(`${KPI}:`)).toBeNull();
    expect(parseKpiCellKey(`a:b:c`)).toBeNull();
  });
});
