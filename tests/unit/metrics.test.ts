import { describe, expect, it } from "vitest";
import {
  computeFlags,
  deriveMetrics,
  financialsFromValues,
  gpPct,
  growthPct,
  isCashflowPositive,
  npPct,
  periodTotals,
  runwayMonths,
  type MonthlyFinancials,
  type PeriodTotals,
} from "@/lib/metrics";

function month(overrides: Partial<MonthlyFinancials> = {}): MonthlyFinancials {
  return {
    month: "2026-09-01",
    revenue_total: 100_000,
    gross_profit: 40_000,
    net_profit: -10_000,
    cash_in_bank: 600_000,
    burn_rate: 50_000,
    headcount_ft: 10,
    headcount_pt: 2,
    ...overrides,
  };
}

const EMPTY: Omit<MonthlyFinancials, "month"> = {
  revenue_total: null,
  gross_profit: null,
  net_profit: null,
  cash_in_bank: null,
  burn_rate: null,
  headcount_ft: null,
  headcount_pt: null,
};

describe("margins", () => {
  it("computes GP% and NP% from revenue", () => {
    expect(gpPct(month())).toBe(40);
    expect(npPct(month())).toBe(-10);
    expect(gpPct(month({ revenue_total: 100, gross_profit: 30 }))).toBe(30);
    expect(gpPct(month({ revenue_total: 3, gross_profit: 1 }))).toBeCloseTo(33.3333, 4);
    expect(gpPct(month({ gross_profit: -5_000 }))).toBe(-5);
  });

  it("returns null when revenue is zero or a figure is missing", () => {
    expect(gpPct(month({ revenue_total: 0 }))).toBeNull();
    expect(npPct(month({ revenue_total: 0 }))).toBeNull();
    expect(gpPct(month({ revenue_total: null }))).toBeNull();
    expect(gpPct(month({ gross_profit: null }))).toBeNull();
    expect(npPct(month({ net_profit: null }))).toBeNull();
    expect(gpPct(null)).toBeNull();
    expect(npPct(undefined)).toBeNull();
  });
});

describe("runway", () => {
  it("is cash divided by monthly burn", () => {
    expect(runwayMonths(month())).toBe(12);
    expect(runwayMonths(month({ cash_in_bank: 25_000 }))).toBe(0.5);
    expect(runwayMonths(month({ cash_in_bank: 0 }))).toBe(0);
  });

  it("is null for cash-flow positive companies (burn 0)", () => {
    const positive = month({ burn_rate: 0, cash_in_bank: 1_000 });
    expect(runwayMonths(positive)).toBeNull();
    expect(isCashflowPositive(positive)).toBe(true);
    expect(isCashflowPositive(month({ burn_rate: -500 }))).toBe(true);
    expect(runwayMonths(month({ burn_rate: -500 }))).toBeNull();
    expect(isCashflowPositive(month())).toBe(false);
  });

  it("is null when data is missing and never NaN or Infinity", () => {
    expect(runwayMonths(month({ burn_rate: null }))).toBeNull();
    expect(isCashflowPositive(month({ burn_rate: null }))).toBe(false);
    expect(runwayMonths(month({ cash_in_bank: null }))).toBeNull();
    expect(runwayMonths(month({ cash_in_bank: Number.POSITIVE_INFINITY, burn_rate: 1 }))).toBeNull();
    expect(runwayMonths(month({ cash_in_bank: Number.NaN }))).toBeNull();
    expect(runwayMonths(null)).toBeNull();
    expect(isCashflowPositive(null)).toBe(false);
  });

  it("gives 0 months (not a negative runway) when cash is negative", () => {
    expect(runwayMonths(month({ cash_in_bank: -1_000 }))).toBe(0);
  });
});

describe("growthPct", () => {
  it("measures change relative to the absolute previous value", () => {
    expect(growthPct(150, 100)).toBe(50);
    expect(growthPct(50, 100)).toBe(-50);
    expect(growthPct(0, 100)).toBe(-100);
    expect(growthPct(-50, -100)).toBe(50); // a smaller loss is an improvement
    expect(growthPct(-150, -100)).toBe(-50);
    expect(growthPct(145_000, 100_000)).toBe(45);
    expect(Object.is(growthPct(100, 100), 0)).toBe(true);
  });

  it("is null when the previous value is zero or either value is missing", () => {
    expect(growthPct(100, 0)).toBeNull();
    expect(growthPct(100, null)).toBeNull();
    expect(growthPct(null, 100)).toBeNull();
    expect(growthPct(undefined, undefined)).toBeNull();
    expect(growthPct(Number.MAX_VALUE, 1)).toBeNull(); // overflow → null, never Infinity
    expect(growthPct(Number.NaN, 1)).toBeNull();
  });
});

describe("periodTotals", () => {
  const jul = month({
    month: "2026-07-01",
    revenue_total: 100_000,
    gross_profit: 40_000,
    net_profit: -10_000,
    cash_in_bank: 700_000,
    burn_rate: 60_000,
    headcount_ft: 10,
    headcount_pt: 2,
  });
  const aug = month({
    month: "2026-08-01",
    revenue_total: 120_000,
    gross_profit: 50_000,
    net_profit: 5_000,
    cash_in_bank: 650_000,
    burn_rate: 50_000,
    headcount_ft: 11,
    headcount_pt: 2,
  });
  const sep = month({
    month: "2026-09-01",
    revenue_total: 80_000,
    gross_profit: 30_000,
    net_profit: -20_000,
    cash_in_bank: 600_000,
    burn_rate: 40_000,
    headcount_ft: 12,
    headcount_pt: 1,
  });

  it("sums flows, takes cash and headcount at period end and averages burn", () => {
    const totals = periodTotals([jul, aug, sep]);
    const { np_pct, ...rest } = totals;
    const expected: Omit<PeriodTotals, "np_pct"> = {
      months_count: 3,
      revenue_total: 300_000,
      gross_profit: 120_000,
      net_profit: -25_000,
      gp_pct: 40,
      cash_in_bank: 600_000,
      avg_burn_rate: 50_000,
      headcount_ft: 12,
      headcount_pt: 1,
    };
    expect(rest).toEqual(expected);
    expect(np_pct).toBe(-8.3333);
    expect(Object.keys(totals).sort()).toEqual(
      [
        "avg_burn_rate",
        "cash_in_bank",
        "gp_pct",
        "gross_profit",
        "headcount_ft",
        "headcount_pt",
        "months_count",
        "net_profit",
        "np_pct",
        "revenue_total",
      ].sort(),
    );
  });

  it("uses the latest month for period-end figures whatever the input order", () => {
    expect(periodTotals([sep, jul, aug])).toEqual(periodTotals([jul, aug, sep]));
  });

  it("reports how many months were present in a partial period", () => {
    const totals = periodTotals([jul, aug]);
    expect(totals.months_count).toBe(2);
    expect(totals.revenue_total).toBe(220_000);
    expect(totals.cash_in_bank).toBe(650_000);
    expect(totals.headcount_ft).toBe(11);
    expect(totals.avg_burn_rate).toBe(55_000);
  });

  it("returns an all-null shape for no months", () => {
    expect(periodTotals([])).toEqual({
      months_count: 0,
      revenue_total: null,
      gross_profit: null,
      net_profit: null,
      gp_pct: null,
      np_pct: null,
      cash_in_bank: null,
      avg_burn_rate: null,
      headcount_ft: null,
      headcount_pt: null,
    });
  });

  it("skips blank figures in sums and averages, but does not back-fill period-end figures", () => {
    const totals = periodTotals([jul, month({ ...aug, revenue_total: null, burn_rate: null }), month({ ...sep, cash_in_bank: null })]);
    expect(totals.months_count).toBe(3);
    expect(totals.revenue_total).toBe(180_000);
    expect(totals.gp_pct).toBe(66.6667); // Σ GP / Σ revenue × 100, rounded to 4 decimals like SQL computed_totals
    expect(totals.avg_burn_rate).toBe(50_000); // (60,000 + 40,000) / 2
    expect(totals.cash_in_bank).toBeNull(); // September's cash is blank
  });

  it("returns null margins when period revenue is zero or missing", () => {
    const noRevenue = periodTotals([month({ ...EMPTY, month: "2026-07" }), month({ ...EMPTY, month: "2026-08" })]);
    expect(noRevenue.revenue_total).toBeNull();
    expect(noRevenue.gp_pct).toBeNull();
    expect(noRevenue.avg_burn_rate).toBeNull();
    const zero = periodTotals([month({ revenue_total: 0, gross_profit: -100 })]);
    expect(zero.revenue_total).toBe(0);
    expect(zero.gp_pct).toBeNull();
  });

  it("avoids floating-point noise in sums", () => {
    const totals = periodTotals([
      month({ month: "2026-07", revenue_total: 0.1, gross_profit: 0.1 }),
      month({ month: "2026-08", revenue_total: 0.2, gross_profit: 0.2 }),
    ]);
    expect(totals.revenue_total).toBe(0.3);
    expect(totals.gp_pct).toBe(100);
  });

  it("counts each month once (the last entry wins) and accepts both month formats", () => {
    const totals = periodTotals([jul, month({ ...jul, month: "2026-07", revenue_total: 1 }), aug]);
    expect(totals.months_count).toBe(2);
    expect(totals.revenue_total).toBe(120_001);
  });

  it("throws on a malformed month", () => {
    expect(() => periodTotals([month({ month: "Sept 2026" })])).toThrow(RangeError);
  });
});

describe("computeFlags", () => {
  const settings = { revenue_swing_pct: 30, min_runway_months: 6 };
  const previous = month({ month: "2026-08-01", revenue_total: 100_000 });
  const healthy = month({ revenue_total: 110_000, cash_in_bank: 1_200_000, burn_rate: 100_000 });

  it("raises nothing for a healthy month", () => {
    expect(computeFlags({ current: healthy, previous, sameMonthLastYear: null, settings, validationErrors: [] })).toEqual([]);
  });

  it("flags a revenue swing strictly above the threshold, critical above twice it", () => {
    const at = (revenue: number) =>
      computeFlags({ current: { ...healthy, revenue_total: revenue }, previous, settings, validationErrors: [] });
    expect(at(130_000)).toEqual([]); // exactly 30%
    expect(at(130_500)).toEqual([
      {
        code: "revenue_swing",
        severity: "warning",
        message:
          "Revenue rose 30.5% month on month (RM 100,000 in Aug 2026 to RM 130,500 in Sep 2026), above the 30% swing threshold.",
      },
    ]);
    expect(at(160_000)[0].severity).toBe("warning"); // exactly 2× is not critical
    expect(at(160_100)[0]).toMatchObject({ code: "revenue_swing", severity: "critical" });
    expect(at(160_100)[0].message).toContain("more than twice the 30% swing threshold");
    expect(at(45_000)[0]).toMatchObject({ severity: "warning" });
    expect(at(45_000)[0].message).toMatch(/^Revenue fell 55\.0% month on month/);
    expect(at(0)[0]).toMatchObject({ code: "revenue_swing", severity: "critical" });
  });

  it("does not claim 'month on month' when the previous figure is from an earlier month", () => {
    const july = { ...previous, month: "2026-07-01" };
    const [flag] = computeFlags({ current: { ...healthy, revenue_total: 150_000 }, previous: july, settings });
    expect(flag.message).toBe(
      "Revenue rose 50.0% (RM 100,000 in Jul 2026 to RM 150,000 in Sep 2026), above the 30% swing threshold.",
    );
  });

  it("needs a previous month with non-zero revenue for the swing", () => {
    const base = { current: { ...healthy, revenue_total: 500_000 }, settings };
    expect(computeFlags({ ...base, previous: null })).toEqual([]);
    expect(computeFlags({ ...base, previous: { ...previous, revenue_total: 0 } })).toEqual([]);
    expect(computeFlags({ ...base, previous: { ...previous, revenue_total: null } })).toEqual([]);
    expect(computeFlags({ current: { ...healthy, revenue_total: null }, previous, settings })).toEqual([]);
  });

  it("uses the configured swing threshold", () => {
    const current = { ...healthy, revenue_total: 145_000 };
    expect(computeFlags({ current, previous, settings: { revenue_swing_pct: 50, min_runway_months: 6 } })).toEqual([]);
    expect(computeFlags({ current, previous, settings })[0].code).toBe("revenue_swing");
  });

  it("flags low runway below the minimum, critical under 3 months", () => {
    const at = (cash: number) =>
      computeFlags({ current: { ...healthy, cash_in_bank: cash, burn_rate: 100_000 }, previous, settings });
    expect(at(600_000)).toEqual([]); // exactly 6 months
    expect(at(500_000)).toEqual([
      {
        code: "low_runway",
        severity: "warning",
        message: "Runway is 5.0 months (RM 500,000 cash at RM 100,000 monthly burn), below the 6-month minimum.",
      },
    ]);
    expect(at(596_000)[0].message).toContain("Runway is 5.9 months"); // truncated, never shown as 6.0
    expect(at(300_000)[0].severity).toBe("warning"); // exactly 3 months
    expect(at(250_000)[0]).toEqual({
      code: "low_runway",
      severity: "critical",
      message: "Runway is critically low at 2.5 months (RM 250,000 cash at RM 100,000 monthly burn), below the 6-month minimum.",
    });
  });

  it("does not flag runway for cash-flow positive companies or missing figures", () => {
    const current = { ...healthy, cash_in_bank: 10_000, burn_rate: 0 };
    expect(computeFlags({ current, previous, settings })).toEqual([]);
    expect(computeFlags({ current: { ...healthy, burn_rate: null }, previous, settings })).toEqual([]);
    expect(computeFlags({ current: { ...healthy, cash_in_bank: null }, previous, settings })).toEqual([]);
  });

  it("flags negative cash as critical (instead of low runway)", () => {
    const flags = computeFlags({ current: { ...healthy, cash_in_bank: -5_000 }, previous, settings });
    expect(flags).toEqual([{ code: "negative_cash", severity: "critical", message: "Cash in bank is negative (-RM 5,000)." }]);
  });

  it("flags missing required values from validation issues", () => {
    const one = computeFlags({ current: healthy, previous, settings, validationErrors: [{ code: "required" }] });
    expect(one).toEqual([{ code: "missing_required", severity: "critical", message: "1 required value is missing." }]);
    const issues = [
      { target: "field:gross_profit", code: "required", message: "Gross profit is required." },
      { target: "field:cash_in_bank", code: "required", message: "Cash in bank (month end) is required." },
      { target: "field:revenue_total", code: "sum_mismatch", message: "…" },
      { target: "general", code: "prior_months", message: "…" },
    ];
    expect(computeFlags({ current: healthy, previous, settings, validationErrors: issues })[0].message).toBe(
      "2 required values are missing.",
    );
    expect(computeFlags({ current: healthy, previous, settings, validationErrors: [{ code: "prior_months" }] })).toEqual([]);
  });

  it("orders critical flags first", () => {
    const flags = computeFlags({
      current: { ...healthy, revenue_total: 140_000, cash_in_bank: -1 },
      previous,
      settings,
      validationErrors: [{ code: "required" }],
    });
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ["missing_required", "critical"],
      ["negative_cash", "critical"],
      ["revenue_swing", "warning"],
    ]);
  });

  it("falls back to the default thresholds and accepts a full settings row", () => {
    const current = { ...healthy, revenue_total: 135_000, cash_in_bank: 500_000, burn_rate: 100_000 };
    const withDefaults = computeFlags({ current, previous, settings: null });
    expect(withDefaults.map((f) => f.code)).toEqual(["low_runway", "revenue_swing"]);
    expect(computeFlags({ current, previous, settings: { revenue_swing_pct: null, min_runway_months: -1 } })).toEqual(
      withDefaults,
    );
    const row = { id: 1, due_day: 15, escalation_days: 14, revenue_swing_pct: 40, min_runway_months: 13, require_mfa: true };
    expect(computeFlags({ current: healthy, previous, settings: row }).map((f) => f.code)).toEqual(["low_runway"]);
  });

  it("warns when the ScaleUp revenue lines add up to more than total revenue (BRD B30, optional)", () => {
    const base = { current: healthy, previous, settings };
    expect(computeFlags(base)).toEqual([]); // not passed: no flag
    expect(computeFlags({ ...base, scaleupLinesTotal: null })).toEqual([]);
    expect(computeFlags({ ...base, scaleupLinesTotal: 110_000 })).toEqual([]); // equal is fine
    expect(computeFlags({ ...base, scaleupLinesTotal: 90_000 })).toEqual([]); // less is fine (they need not add up)
    expect(computeFlags({ ...base, scaleupLinesTotal: 110_000.01 })).toEqual([
      {
        code: "segments_exceed_total",
        severity: "warning",
        message: "The ScaleUp revenue lines add up to RM 110,000, more than total revenue (RM 110,000).",
      },
    ]);
    // 0.1 + 0.2 is 0.30000000000000004 in floating point: not more than 0.3.
    expect(computeFlags({ ...base, previous: null, scaleupLinesTotal: 0.1 + 0.2, current: { ...healthy, revenue_total: 0.3 } })).toEqual([]);
    expect(computeFlags({ ...base, scaleupLinesTotal: 5, current: { ...healthy, revenue_total: null } })).toEqual([]);
    const usd = computeFlags({ ...base, scaleupLinesTotal: 250_000, currency: "USD" });
    expect(usd[0].message).toBe("The ScaleUp revenue lines add up to USD 250,000, more than total revenue (USD 110,000).");
    // A warning: critical flags still come first.
    const flags = computeFlags({ ...base, scaleupLinesTotal: 250_000, current: { ...healthy, cash_in_bank: -1 } });
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ["negative_cash", "critical"],
      ["segments_exceed_total", "warning"],
    ]);
  });

  it("uses the reporting currency in messages and never produces NaN", () => {
    const flags = computeFlags({
      current: { ...healthy, cash_in_bank: 200_000, burn_rate: 100_000 },
      previous,
      settings,
      currency: "SGD",
    });
    expect(flags[0].message).toContain("SGD 200,000 cash at SGD 100,000 monthly burn");
    const blank = computeFlags({ current: { month: "2026-09", ...EMPTY }, previous: { month: "2026-08", ...EMPTY }, settings });
    expect(blank).toEqual([]);
  });
});

describe("helpers", () => {
  it("builds MonthlyFinancials from stored rows or bare numbers", () => {
    const f = financialsFromValues("2026-09-01", {
      revenue_total: { value_number: 1000, value_text: null, value_json: null },
      gross_profit: 400,
      net_profit: null,
      cash_in_bank: { value_number: "5000.0000" },
      key_milestones: { value_text: "Launched" },
    });
    expect(f).toEqual({
      month: "2026-09-01",
      revenue_total: 1000,
      gross_profit: 400,
      net_profit: null,
      cash_in_bank: 5000,
      burn_rate: null,
      headcount_ft: null,
      headcount_pt: null,
    });
    expect(financialsFromValues("2026-09", null).revenue_total).toBeNull();
  });

  it("derives the headline metrics for one month", () => {
    expect(deriveMetrics(month())).toEqual({ gp_pct: 40, np_pct: -10, runway_months: 12, cashflow_positive: false });
    expect(deriveMetrics(month({ burn_rate: 0 }))).toMatchObject({ runway_months: null, cashflow_positive: true });
    expect(deriveMetrics(null)).toEqual({ gp_pct: null, np_pct: null, runway_months: null, cashflow_positive: false });
  });
});
