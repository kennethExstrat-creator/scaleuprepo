import { describe, expect, it } from "vitest";

import {
  deriveRestatement,
  EDITABLE_FIGURE_KEYS,
  effectiveTotals,
  emptyPeriodTotals,
  figureIssue,
  hasRestatement,
  parsePeriodTotals,
  parseRestatedTotals,
  PERIOD_FIGURES,
  RESTATABLE_KEYS,
  sameFigure,
} from "@/components/documents/totals";
import type { PeriodTotals } from "@/lib/metrics";

// The computed totals of the Q3 example in tests/db/period-close.test.ts.
const COMPUTED: PeriodTotals = {
  months_count: 3,
  revenue_total: 600,
  gross_profit: 280,
  net_profit: 70,
  gp_pct: 46.6667,
  np_pct: 11.6667,
  cash_in_bank: 800,
  avg_burn_rate: 20,
  headcount_ft: 12,
  headcount_pt: 4,
};

describe("figure definitions", () => {
  it("list every restatable key once, in display order", () => {
    expect(PERIOD_FIGURES.map((figure) => figure.key).sort()).toEqual([...RESTATABLE_KEYS].sort());
    expect(PERIOD_FIGURES.filter((figure) => figure.derived).map((figure) => figure.key)).toEqual(["gp_pct", "np_pct"]);
    expect(EDITABLE_FIGURE_KEYS).not.toContain("gp_pct");
  });

  it("the database's restatable keys are the PeriodTotals keys except months_count", () => {
    expect([...RESTATABLE_KEYS].sort()).toEqual(Object.keys(emptyPeriodTotals()).filter((key) => key !== "months_count").sort());
  });
});

describe("figureIssue", () => {
  it("checks signs, whole numbers and size", () => {
    expect(figureIssue("revenue_total", 610)).toBeNull();
    expect(figureIssue("net_profit", -50)).toBeNull();
    expect(figureIssue("gross_profit", -1.5)).toBeNull();
    expect(figureIssue("revenue_total", -1)).toBe("Revenue cannot be negative.");
    expect(figureIssue("cash_in_bank", -0.01)).toBe("Cash at period end cannot be negative.");
    expect(figureIssue("headcount_ft", 12.5)).toBe("Full-time headcount must be a whole number.");
    expect(figureIssue("headcount_pt", -1)).toBe("Part-time headcount cannot be negative.");
    expect(figureIssue("avg_burn_rate", 1e15)).toBe("Average monthly burn is too large.");
    expect(figureIssue("avg_burn_rate", Number.NaN)).toBe("Average monthly burn is too large.");
  });
});

describe("parsePeriodTotals", () => {
  it("reads the stored snapshot", () => {
    expect(parsePeriodTotals(COMPUTED)).toEqual(COMPUTED);
    expect(parsePeriodTotals({ months_count: "2", revenue_total: "1234.5000", gp_pct: null })).toEqual({
      ...emptyPeriodTotals(),
      months_count: 2,
      revenue_total: 1234.5,
    });
  });

  it("returns null for anything but an object", () => {
    expect(parsePeriodTotals(null)).toBeNull();
    expect(parsePeriodTotals([1, 2])).toBeNull();
    expect(parsePeriodTotals("x")).toBeNull();
  });
});

describe("parseRestatedTotals", () => {
  it("keeps the known keys (JSON null stays null)", () => {
    expect(parseRestatedTotals({ revenue_total: 610, cash_in_bank: 805.5, bogus: 1 })).toEqual({
      revenue_total: 610,
      cash_in_bank: 805.5,
    });
    expect(parseRestatedTotals({ revenue_total: null })).toEqual({ revenue_total: null });
  });

  it("returns null when there is nothing restated", () => {
    expect(parseRestatedTotals({})).toBeNull();
    expect(parseRestatedTotals({ months_count: 3 })).toBeNull();
    expect(parseRestatedTotals(null)).toBeNull();
    expect(hasRestatement(null)).toBe(false);
    expect(hasRestatement({ revenue_total: 1 })).toBe(true);
  });
});

describe("sameFigure", () => {
  it("compares to 4 decimals, null-safe", () => {
    expect(sameFigure(46.66667, 46.6667)).toBe(true);
    expect(sameFigure(46.6667, 46.6668)).toBe(false);
    expect(sameFigure(null, undefined)).toBe(true);
    expect(sameFigure(0, null)).toBe(false);
  });
});

describe("deriveRestatement", () => {
  it("is null when nothing differs", () => {
    expect(deriveRestatement(COMPUTED, null)).toBeNull();
    expect(deriveRestatement(COMPUTED, {})).toBeNull();
    expect(deriveRestatement(COMPUTED, { revenue_total: 600, headcount_ft: 12, cash_in_bank: null })).toBeNull();
  });

  it("keeps changed figures and derives the margins from the restated revenue and profit", () => {
    expect(deriveRestatement(COMPUTED, { revenue_total: 610, cash_in_bank: 805.5 })).toEqual({
      revenue_total: 610,
      cash_in_bank: 805.5,
      gp_pct: 45.9016,
      np_pct: 11.4754,
    });
  });

  it("only includes a margin when it changes", () => {
    // Net profit restated: the gross margin is unchanged.
    expect(deriveRestatement(COMPUTED, { net_profit: 90 })).toEqual({ net_profit: 90, np_pct: 15 });
    // Revenue and gross profit scaled together: the gross margin stays, the net margin moves.
    expect(deriveRestatement(COMPUTED, { revenue_total: 1200, gross_profit: 560 })).toEqual({
      revenue_total: 1200,
      gross_profit: 560,
      np_pct: 5.8333,
    });
  });

  it("does not derive margins for balance-sheet figures", () => {
    expect(deriveRestatement(COMPUTED, { headcount_ft: 13, avg_burn_rate: 25 })).toEqual({ headcount_ft: 13, avg_burn_rate: 25 });
  });

  it("rounds to 4 decimals and handles unknown calculated figures", () => {
    const empty = emptyPeriodTotals();
    expect(deriveRestatement(empty, { revenue_total: 100.123456, gross_profit: 50 })).toEqual({
      revenue_total: 100.1235,
      gross_profit: 50,
      gp_pct: 49.9383, // 50 × 100 / 100.1235 = 49.93833…
    });
    // Revenue restated to 0: margins can no longer be computed.
    expect(deriveRestatement(COMPUTED, { revenue_total: 0 })).toEqual({ revenue_total: 0, gp_pct: null, np_pct: null });
  });
});

describe("effectiveTotals", () => {
  it("lays the restated figures over the calculated ones", () => {
    const restated = deriveRestatement(COMPUTED, { revenue_total: 610 });
    expect(effectiveTotals(COMPUTED, restated)).toEqual({ ...COMPUTED, revenue_total: 610, gp_pct: 45.9016, np_pct: 11.4754 });
    expect(effectiveTotals(COMPUTED, null)).toEqual(COMPUTED);
    expect(effectiveTotals(COMPUTED, { cash_in_bank: null }).cash_in_bank).toBeNull();
  });
});
