import { describe, expect, it } from "vitest";

import { changeDirection, describeChange, formatChange, formatComparisonValue } from "@/components/review/review-format";

describe("formatComparisonValue", () => {
  it("formats money in the company's currency and marks missing values", () => {
    expect(formatComparisonValue({ kind: "money", unit: null }, 1234567, "MYR")).toBe("RM 1,234,567");
    expect(formatComparisonValue({ kind: "money", unit: null }, -500, "MYR")).toBe("-RM 500");
    expect(formatComparisonValue({ kind: "money", unit: null }, 2500, "USD")).toBe("USD 2,500");
    expect(formatComparisonValue({ kind: "money", unit: null }, null, "MYR")).toBe("—");
    expect(formatComparisonValue({ kind: "text", unit: null }, "", "MYR")).toBe("—");
  });

  it("formats percentages, numbers with units, yes/no and text", () => {
    expect(formatComparisonValue({ kind: "percent", unit: null }, 46.6667, "MYR")).toBe("46.7%");
    expect(formatComparisonValue({ kind: "integer", unit: "downloads" }, 1200, "MYR")).toBe("1,200 downloads");
    expect(formatComparisonValue({ kind: "number", unit: null }, 3.14159, "MYR")).toBe("3.14");
    expect(formatComparisonValue({ kind: "boolean", unit: null }, true, "MYR")).toBe("Yes");
    expect(formatComparisonValue({ kind: "boolean", unit: null }, false, "MYR")).toBe("No");
    expect(formatComparisonValue({ kind: "text", unit: null }, "Actively raising", "MYR")).toBe("Actively raising");
  });

  it("formats runway, including cash-flow positive months", () => {
    expect(formatComparisonValue({ kind: "runway", unit: null }, 8, "MYR")).toBe("8.0 months");
    expect(formatComparisonValue({ kind: "runway", unit: null }, 5.96, "MYR")).toBe("5.9 months");
    expect(formatComparisonValue({ kind: "runway", unit: null }, null, "MYR", { cashflowPositive: true })).toBe("Cash-flow positive");
    expect(formatComparisonValue({ kind: "runway", unit: null }, null, "MYR")).toBe("—");
  });
});

describe("formatChange", () => {
  it("shows growth in %, margins in percentage points and runway in months", () => {
    expect(formatChange("growth", 12.345)).toBe("+12.3%");
    expect(formatChange("growth", -4.04)).toBe("-4.0%");
    expect(formatChange("points", 5.06)).toBe("+5.1 pp");
    expect(formatChange("points", -2.5)).toBe("-2.5 pp");
    expect(formatChange("points", 0.01)).toBe("0.0 pp");
    expect(formatChange("months", 3)).toBe("+3.0 months");
    expect(formatChange("none", 3)).toBe("—");
    expect(formatChange("growth", null)).toBe("—");
    expect(formatChange("growth", Number.NaN)).toBe("—");
  });

  it("gives a direction and an accessible description", () => {
    expect(changeDirection(12)).toBe("up");
    expect(changeDirection(-0.5)).toBe("down");
    expect(changeDirection(0.01)).toBeNull();
    expect(changeDirection(null)).toBeNull();
    expect(describeChange("growth", 12.5, "Aug 2026")).toBe("Up 12.5% on Aug 2026");
    expect(describeChange("points", -2.5, "Sep 2025")).toBe("Down 2.5 pp on Sep 2025");
    expect(describeChange("growth", 0, "Aug 2026")).toBe("No change on Aug 2026");
    expect(describeChange("growth", null, "Aug 2026")).toBe("No comparison with Aug 2026");
  });
});
