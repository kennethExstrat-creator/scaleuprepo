import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currencySymbol,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatNumber,
  formatNumberInput,
  formatNumberTrimmed,
  formatPct,
  formatRelative,
  formatRunway,
  formatTime,
  parseNumberInput,
  toFiniteNumber,
} from "@/lib/format";
import { MONTH_NAMES_SHORT } from "@/lib/periods";

afterEach(() => {
  vi.useRealTimers();
});

describe("money", () => {
  it("formats ringgit with grouping and no decimals by default", () => {
    expect(formatMoney(1_234_567)).toBe("RM 1,234,567");
    expect(formatMoney(1_234_567.5)).toBe("RM 1,234,568");
    expect(formatMoney(0)).toBe("RM 0");
    expect(formatMoney(999)).toBe("RM 999");
    expect(formatMoney(1_234.5, "MYR", { decimals: 2 })).toBe("RM 1,234.50");
  });

  it("puts the minus sign before the currency and never shows -0", () => {
    expect(formatMoney(-1_234.4)).toBe("-RM 1,234");
    expect(formatMoney(-5_000)).toBe("-RM 5,000");
    expect(formatMoney(-0.4)).toBe("RM 0");
    expect(formatMoney(-0)).toBe("RM 0");
  });

  it("shows other currencies by code", () => {
    expect(formatMoney(1_234, "SGD")).toBe("SGD 1,234");
    expect(formatMoney(1_234, "myr")).toBe("RM 1,234");
    expect(formatMoney(1_234, null)).toBe("RM 1,234");
    expect(currencySymbol("MYR")).toBe("RM");
    expect(currencySymbol("usd")).toBe("USD");
    expect(currencySymbol()).toBe("RM");
  });

  it("formats compact amounts", () => {
    expect(formatMoney(1_234_567, "MYR", { compact: true })).toBe("RM 1.2M");
    expect(formatMoney(-2_500_000, "MYR", { compact: true })).toBe("-RM 2.5M");
    expect(formatMoney(12_345, "MYR", { compact: true })).toBe("RM 12.3K");
    expect(formatMoney(1_000, "MYR", { compact: true })).toBe("RM 1K");
    expect(formatMoney(999, "MYR", { compact: true })).toBe("RM 999");
    expect(formatMoney(999.6, "MYR", { compact: true })).toBe("RM 1K");
    expect(formatMoney(999_960, "MYR", { compact: true })).toBe("RM 1M");
    expect(formatMoney(1_500_000_000, "MYR", { compact: true })).toBe("RM 1.5B");
    expect(formatMoney(2e12, "MYR", { compact: true })).toBe("RM 2T");
    expect(formatMoney(-0.2, "MYR", { compact: true })).toBe("RM 0");
    expect(formatMoney(1_234_567, "MYR", { compact: true, decimals: 2 })).toBe("RM 1.23M");
  });

  it("shows an em dash for missing or non-finite values", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("numbers and percentages", () => {
  it("formats numbers with fixed decimals", () => {
    expect(formatNumber(1_234_567.891)).toBe("1,234,568");
    expect(formatNumber(1_234_567.891, 2)).toBe("1,234,567.89");
    expect(formatNumber(-1_234)).toBe("-1,234");
    expect(formatNumber(-0.4)).toBe("0");
    expect(formatNumber(0.5)).toBe("1");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("accepts Postgres numeric strings", () => {
    expect(formatNumber("1234.5000" as unknown as number)).toBe("1,235");
    expect(toFiniteNumber("-12.50")).toBe(-12.5);
    expect(toFiniteNumber("1e3")).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(Number.NaN)).toBeNull();
  });

  it("formats trimmed numbers and input text", () => {
    expect(formatNumberTrimmed(30)).toBe("30");
    expect(formatNumberTrimmed(27.5)).toBe("27.5");
    expect(formatNumberTrimmed(1_234.5678)).toBe("1,234.57");
    expect(formatNumberTrimmed(-0.001)).toBe("0");
    expect(formatNumberInput(1_234.5)).toBe("1,234.5");
    expect(formatNumberInput(-1_000)).toBe("-1,000");
    expect(formatNumberInput(0.1 + 0.2)).toBe("0.3");
    expect(formatNumberInput(null)).toBe("");
  });

  it("round-trips input text through parseNumberInput", () => {
    for (const value of [0, 1, -1, 1_234.5, 1_234_567.89, 0.0001, -98_765.4321, 1_000_000]) {
      expect(parseNumberInput(formatNumberInput(value))).toBe(value);
    }
  });

  it("formats percentages", () => {
    expect(formatPct(45)).toBe("45.0%");
    expect(formatPct(-4.04)).toBe("-4.0%");
    expect(formatPct(-0.04)).toBe("0.0%");
    expect(formatPct(12.3456, 2)).toBe("12.35%");
    expect(formatPct(12_345.67)).toBe("12,345.7%");
    expect(formatPct(5, 1, { signed: true })).toBe("+5.0%");
    expect(formatPct(-5, 1, { signed: true })).toBe("-5.0%");
    expect(formatPct(0, 1, { signed: true })).toBe("0.0%");
    expect(formatPct(null)).toBe("—");
    expect(formatPct(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats runway and file sizes", () => {
    expect(formatRunway(4.25)).toBe("4.2 months");
    expect(formatRunway(5.96)).toBe("5.9 months");
    expect(formatRunway(0.3)).toBe("0.3 months");
    expect(formatRunway(12)).toBe("12.0 months");
    expect(formatRunway(null)).toBe("—");
    expect(formatRunway(null, { cashflowPositive: true })).toBe("Cash-flow positive");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1_536)).toBe("1.5 KB");
    expect(formatFileSize(2_048)).toBe("2 KB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatFileSize(null)).toBe("—");
  });
});

describe("dates in Malaysia time", () => {
  it("formats date-only values as-is", () => {
    expect(formatDate("2026-09-30")).toBe("30 Sep 2026");
    expect(formatDate("2026-09-01")).toBe("1 Sep 2026");
    expect(formatDate("2026-09")).toBe("1 Sep 2026");
    expect(formatDate("2028-02-29")).toBe("29 Feb 2028");
  });

  it("uses fixed English month abbreviations (Sep, not Sept)", () => {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      expect(formatDate(`2026-${mm}-15`)).toBe(`15 ${MONTH_NAMES_SHORT[m - 1]} 2026`);
    }
    expect(MONTH_NAMES_SHORT[8]).toBe("Sep");
  });

  it("converts timestamps to the Malaysia calendar date", () => {
    expect(formatDate("2026-09-30T16:30:00Z")).toBe("1 Oct 2026");
    expect(formatDate("2026-09-30T15:59:00Z")).toBe("30 Sep 2026");
    expect(formatDate("2026-09-30 06:05:00.123456+00")).toBe("30 Sep 2026");
    expect(formatDate(new Date("2026-12-31T16:00:00Z"))).toBe("1 Jan 2027");
  });

  it("formats date-times on the 24-hour clock", () => {
    expect(formatDateTime("2026-09-30T06:05:00Z")).toBe("30 Sep 2026, 14:05");
    expect(formatDateTime("2026-09-30T06:05:00.123456+00:00")).toBe("30 Sep 2026, 14:05");
    expect(formatDateTime("2026-09-30T14:05:00+08:00")).toBe("30 Sep 2026, 14:05");
    expect(formatDateTime("2026-09-30T16:30:00Z")).toBe("1 Oct 2026, 00:30");
    expect(formatDateTime("2026-09-30")).toBe("30 Sep 2026");
    expect(formatTime("2026-09-30T06:05:00Z")).toBe("14:05");
  });

  it("shows an em dash for missing or invalid dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate("2026-02-30")).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatTime("nope")).toBe("—");
  });

  it("does not depend on the machine timezone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["America/New_York", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        expect(formatDate("2026-09-30")).toBe("30 Sep 2026");
        expect(formatDate("2026-09-30T16:30:00Z")).toBe("1 Oct 2026");
        expect(formatDateTime("2026-09-30T06:05:00Z")).toBe("30 Sep 2026, 14:05");
        expect(formatDateTime("2026-09-30T06:05:00")).toBe("30 Sep 2026, 14:05"); // no offset → UTC, never local
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("formatRelative", () => {
  const now = "2026-09-30T06:00:00Z"; // 14:00 in Kuala Lumpur

  it.each([
    ["2026-09-30T05:59:30Z", "just now"],
    ["2026-09-30T06:00:20Z", "just now"],
    ["2026-09-30T05:59:00Z", "1 minute ago"],
    ["2026-09-30T05:55:00Z", "5 minutes ago"],
    ["2026-09-30T06:10:00Z", "in 10 minutes"],
    ["2026-09-30T04:30:00Z", "1 hour ago"],
    ["2026-09-30T03:00:00Z", "3 hours ago"],
    ["2026-09-29T17:00:00Z", "13 hours ago"],
    ["2026-09-29T15:00:00Z", "yesterday"],
    ["2026-10-01T06:00:00Z", "tomorrow"],
    ["2026-09-27T06:00:00Z", "3 days ago"],
    ["2026-10-02T06:00:00Z", "in 2 days"],
    ["2026-09-20T06:00:00Z", "20 Sep 2026"],
    ["2026-09-30", "today"],
    ["2026-09-29", "yesterday"],
    ["2026-10-03", "in 3 days"],
    ["2026-10-15", "15 Oct 2026"],
  ])("%s → %s", (value, expected) => {
    expect(formatRelative(value, now)).toBe(expected);
  });

  it("uses the current time by default and handles missing values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z")); // 00:30 on 1 Oct in Kuala Lumpur
    expect(formatRelative("2026-09-30T15:30:00Z")).toBe("1 hour ago");
    expect(formatRelative("2026-09-30")).toBe("yesterday");
    expect(formatRelative("2026-10-01")).toBe("today");
    expect(formatRelative(null)).toBe("—");
    expect(formatRelative("garbage")).toBe("—");
  });
});

describe("parseNumberInput", () => {
  it.each<[string, number]>([
    ["1,234.50", 1234.5],
    ["RM 1,234.50", 1234.5],
    ["rm1234", 1234],
    ["MYR 1,000", 1000],
    ["SGD 2,500", 2500],
    ["(1,000)", -1000],
    ["(RM 1,000)", -1000],
    ["RM (1,000)", -1000],
    ["-500", -500],
    ["-RM 500", -500],
    ["RM -500", -500],
    ["\u2212500", -500],
    ["\u2013250", -250],
    ["+500", 500],
    [" 12 ", 12],
    ["0", 0],
    ["-0", 0],
    [".5", 0.5],
    ["5.", 5],
    ["1234567.891", 1234567.891],
    ["12,345,678", 12345678],
  ])("parses %j as %d", (raw, expected) => {
    expect(parseNumberInput(raw)).toBe(expected);
  });

  it.each([
    "1e3",
    "1.2.3",
    "--5",
    "(-5)",
    "-(5)",
    "1,23",
    "1234,50",
    "12 345",
    "abc",
    "RM",
    "()",
    ".",
    "Infinity",
    "0x10",
    "5%",
    "",
    "   ",
  ])("rejects %j", (raw) => {
    expect(parseNumberInput(raw)).toBeNull();
  });

  it("passes finite numbers through and rejects non-finite ones", () => {
    expect(parseNumberInput(42)).toBe(42);
    expect(Object.is(parseNumberInput(-0), 0)).toBe(true);
    expect(parseNumberInput(Number.NaN)).toBeNull();
    expect(parseNumberInput(null)).toBeNull();
    expect(parseNumberInput(undefined)).toBeNull();
  });
});
