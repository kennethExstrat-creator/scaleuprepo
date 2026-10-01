import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  addMonths,
  closePeriodOf,
  compareMonths,
  currentMonthMYT,
  dateToMonthKey,
  daysBetween,
  daysInMonth,
  daysOverdue,
  dueDateFor,
  effectiveDueDate,
  halfOf,
  isDateKey,
  isHalfEnd,
  isLeapYear,
  isMonthKey,
  isQuarterEnd,
  lastCompletedMonth,
  lastDayOfMonth,
  monthDiff,
  monthKeyToDate,
  monthLabel,
  monthLabelLong,
  monthsBetween,
  mytParts,
  parseInstant,
  parseMonthKey,
  parseMonthParts,
  parsePeriodLabel,
  quarterOf,
  todayMYT,
  toMYTDate,
} from "@/lib/periods";

afterEach(() => {
  vi.useRealTimers();
});

describe("month keys", () => {
  it("converts between month keys and first-of-month dates", () => {
    expect(monthKeyToDate("2026-09")).toBe("2026-09-01");
    expect(monthKeyToDate("2026-09-17")).toBe("2026-09-01");
    expect(dateToMonthKey("2026-09-01")).toBe("2026-09");
    expect(dateToMonthKey("2026-12")).toBe("2026-12");
    expect(parseMonthParts("2028-02-29")).toEqual({ year: 2028, month: 2 });
  });

  it("recognises well-formed month keys only", () => {
    expect(isMonthKey("2026-09")).toBe(true);
    expect(isMonthKey("2026-12")).toBe(true);
    expect(isMonthKey("2026-9")).toBe(false);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-09-01")).toBe(false);
    expect(isMonthKey(" 2026-09")).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(202609)).toBe(false);
  });

  it("recognises real calendar dates, including leap days", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2000-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2100-02-29")).toBe(false);
    expect(isDateKey("2026-04-31")).toBe(false);
    expect(isDateKey("2026-09")).toBe(false);
    expect(isDateKey("2026-09-30T00:00:00Z")).toBe(false);
  });

  it("parseMonthKey normalises untrusted input without throwing", () => {
    expect(parseMonthKey("2026-09")).toBe("2026-09");
    expect(parseMonthKey("2026-09-30")).toBe("2026-09");
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("sept")).toBeNull();
    expect(parseMonthKey(undefined)).toBeNull();
  });

  it.each([
    "",
    "2026",
    "2026-9",
    "2026-13",
    "26-09",
    "2026/09",
    "2026-09-31",
    "2026-02-30",
    "September 2026",
    "2026-09-01T00:00:00Z",
    " 2026-09",
  ])("throws a RangeError for malformed input %j", (bad) => {
    expect(() => monthKeyToDate(bad)).toThrow(RangeError);
    expect(() => monthLabel(bad)).toThrow(/expected YYYY-MM or YYYY-MM-DD/);
  });

  it("rejects non-integer offsets", () => {
    expect(() => addMonths("2026-09", 1.5)).toThrow(RangeError);
    expect(() => addDays("2026-09-01", 0.5)).toThrow(RangeError);
  });
});

describe("labels", () => {
  it("formats short and long month labels", () => {
    expect(monthLabel("2026-09")).toBe("Sep 2026");
    expect(monthLabel("2026-09-01")).toBe("Sep 2026");
    expect(monthLabel("2027-01")).toBe("Jan 2027");
    expect(monthLabelLong("2026-09")).toBe("September 2026");
    expect(monthLabelLong("2028-02-29")).toBe("February 2028");
  });
});

describe("month arithmetic", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-09", 0)).toBe("2026-09");
    expect(addMonths("2026-09-15", 3)).toBe("2026-12");
    expect(addMonths("2026-09", 16)).toBe("2028-01");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(addMonths("2026-09", -120)).toBe("2016-09");
  });

  it("counts and lists months inclusively", () => {
    expect(monthDiff("2026-11", "2027-02")).toBe(3);
    expect(monthDiff("2027-02", "2026-11")).toBe(-3);
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-09-01", "2026-09-30")).toEqual(["2026-09"]);
    expect(monthsBetween("2027-01", "2026-12")).toEqual([]);
    expect(monthsBetween("2026-07-01", "2027-06-01")).toHaveLength(12);
  });

  it("compares months regardless of format", () => {
    expect(compareMonths("2026-09-30", "2026-09")).toBe(0);
    expect(compareMonths("2026-12", "2027-01")).toBe(-1);
    expect(compareMonths("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("finds the last day of the month (leap years)", () => {
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2100-02")).toBe("2100-02-28");
    expect(lastDayOfMonth("2026-09-01")).toBe("2026-09-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe("quarters and halves", () => {
  it("describes the calendar quarter of a month", () => {
    expect(quarterOf("2026-08")).toEqual({
      type: "quarter",
      label: "Q3 2026",
      rangeLabel: "Jul–Sep 2026",
      year: 2026,
      index: 3,
      start: "2026-07-01",
      end: "2026-09-30",
      startMonth: "2026-07",
      endMonth: "2026-09",
      months: ["2026-07", "2026-08", "2026-09"],
    });
    expect(quarterOf("2026-01").label).toBe("Q1 2026");
    expect(quarterOf("2028-02-29").end).toBe("2028-03-31");
    expect(quarterOf("2026-12-31")).toMatchObject({ label: "Q4 2026", start: "2026-10-01", end: "2026-12-31" });
    expect(quarterOf("2026-06-01").months).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("describes the calendar half of a month", () => {
    expect(halfOf("2026-06")).toMatchObject({
      type: "half",
      label: "H1 2026",
      rangeLabel: "Jan–Jun 2026",
      index: 1,
      start: "2026-01-01",
      end: "2026-06-30",
      startMonth: "2026-01",
      endMonth: "2026-06",
    });
    expect(halfOf("2026-06").months).toHaveLength(6);
    expect(halfOf("2026-07")).toMatchObject({ label: "H2 2026", start: "2026-07-01", end: "2026-12-31" });
    expect(halfOf("2026-12-01").months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(closePeriodOf("quarter", "2026-05")).toEqual(quarterOf("2026-05"));
    expect(closePeriodOf("half", "2026-05")).toEqual(halfOf("2026-05"));
  });

  it("flags quarter and half ends", () => {
    expect(["2026-03", "2026-06", "2026-09", "2026-12"].map(isQuarterEnd)).toEqual([true, true, true, true]);
    expect(["2026-01", "2026-02", "2026-08", "2026-11"].map(isQuarterEnd)).toEqual([false, false, false, false]);
    expect(isHalfEnd("2026-06")).toBe(true);
    expect(isHalfEnd("2026-12-01")).toBe(true);
    expect(isHalfEnd("2026-09")).toBe(false);
    expect(isHalfEnd("2026-03")).toBe(false);
  });

  it("parses period labels and round-trips every month", () => {
    expect(parsePeriodLabel("Q3 2026")).toEqual(quarterOf("2026-07"));
    expect(parsePeriodLabel("h2-2026")?.start).toBe("2026-07-01");
    expect(parsePeriodLabel("H3 2026")).toBeNull();
    expect(parsePeriodLabel("Q5 2026")).toBeNull();
    expect(parsePeriodLabel("2026 Q3")).toBeNull();
    for (const month of monthsBetween("2026-01", "2027-12")) {
      const q = quarterOf(month);
      const h = halfOf(month);
      expect(parsePeriodLabel(q.label)).toEqual(q);
      expect(parsePeriodLabel(h.label)).toEqual(h);
      expect(q.months).toContain(month);
      expect(h.months).toContain(month);
    }
  });
});

describe("days", () => {
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-09-30", "2026-10-15")).toBe(15);
    expect(daysBetween("2026-10-15", "2026-09-30")).toBe(-15);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(daysBetween("2026-09", "2026-10")).toBe(30);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-09", 29)).toBe("2026-09-30");
  });

  it("agrees with Date.UTC for every day from Dec 1999 to Jan 2031", () => {
    const origin = Date.UTC(1999, 11, 1);
    let day = "1999-12-01";
    for (let i = 0; i < 11_385; i++) {
      const utc = new Date(origin + i * 86_400_000);
      const expected = utc.toISOString().slice(0, 10);
      if (day !== expected) throw new Error(`addDays drifted at ${expected}: got ${day}`);
      if (daysBetween("1999-12-01", day) !== i) throw new Error(`daysBetween drifted at ${day}`);
      day = addDays(day, 1);
    }
    expect(day).toBe("2031-02-01");
  });
});

describe("dueDateFor", () => {
  it("is day `dueDay` of the following month", () => {
    expect(dueDateFor("2026-09", 15)).toBe("2026-10-15");
    expect(dueDateFor("2026-12", 15)).toBe("2027-01-15");
    expect(dueDateFor("2026-09-01", 1)).toBe("2026-10-01");
  });

  it("clamps to the end of short months", () => {
    expect(dueDateFor("2028-01", 31)).toBe("2028-02-29");
    expect(dueDateFor("2027-01", 30)).toBe("2027-02-28");
    expect(dueDateFor("2026-08", 31)).toBe("2026-09-30");
  });

  it("rejects invalid due days", () => {
    expect(() => dueDateFor("2026-09", 0)).toThrow(RangeError);
    expect(() => dueDateFor("2026-09", 32)).toThrow(RangeError);
    expect(() => dueDateFor("2026-09", 1.5)).toThrow(RangeError);
  });

  it("gives late-opened months a grace period and counts days overdue", () => {
    expect(effectiveDueDate("2026-07", 15, "2026-08-01", 14)).toBe("2026-08-15");
    expect(effectiveDueDate("2026-07", 15, "2026-08-15", 14)).toBe("2026-08-15"); // opened on the due date
    expect(effectiveDueDate("2026-07", 15, "2026-09-30", 14)).toBe("2026-10-14");
    expect(daysOverdue("2026-10-15", "2026-10-20")).toBe(5);
    expect(daysOverdue("2026-10-15", "2026-10-15")).toBe(0);
    expect(daysOverdue("2026-10-15", "2026-10-01")).toBe(0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z")); // 16 Oct in Kuala Lumpur
    expect(daysOverdue("2026-10-15")).toBe(1);
  });
});

describe("today in Malaysia time", () => {
  it("rolls over at 16:00 UTC (midnight MYT)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
    expect(todayMYT()).toBe("2026-10-01");
    expect(currentMonthMYT()).toBe("2026-10");
    expect(lastCompletedMonth()).toBe("2026-09");

    vi.setSystemTime(new Date("2026-09-30T15:59:00Z"));
    expect(todayMYT()).toBe("2026-09-30");
    expect(currentMonthMYT()).toBe("2026-09");
    expect(lastCompletedMonth()).toBe("2026-08");

    vi.setSystemTime(new Date("2026-09-30T16:00:00Z"));
    expect(todayMYT()).toBe("2026-10-01");
  });

  it("handles the new-year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    expect(todayMYT()).toBe("2027-01-01");
    expect(lastCompletedMonth()).toBe("2026-12");
    vi.setSystemTime(new Date("2026-12-31T15:59:59.999Z"));
    expect(todayMYT()).toBe("2026-12-31");
    expect(lastCompletedMonth()).toBe("2026-11");
  });

  it("accepts an explicit `now`", () => {
    expect(todayMYT(Date.UTC(2028, 1, 28, 16, 5))).toBe("2028-02-29");
    expect(todayMYT(new Date("2026-01-01T00:00:00+08:00"))).toBe("2026-01-01");
  });

  it("derives the last completed month from a given day", () => {
    expect(lastCompletedMonth("2026-09-30")).toBe("2026-08");
    expect(lastCompletedMonth("2026-10-01")).toBe("2026-09");
    expect(lastCompletedMonth("2027-01-15")).toBe("2026-12");
    expect(lastCompletedMonth("2026-10")).toBe("2026-09");
    expect(lastCompletedMonth(new Date("2026-09-30T16:30:00Z"))).toBe("2026-09");
    expect(() => lastCompletedMonth("30/09/2026")).toThrow(RangeError);
  });

  it("does not depend on the machine timezone", () => {
    const original = process.env.TZ;
    const instant = Date.parse("2026-09-30T16:30:00Z");
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC", "Asia/Kuala_Lumpur"]) {
        process.env.TZ = tz;
        expect(todayMYT(instant)).toBe("2026-10-01");
        expect(toMYTDate("2026-09-30T15:59:00Z")).toBe("2026-09-30");
        expect(daysBetween("2026-03-01", "2026-11-01")).toBe(245); // spans US/EU DST changes
        expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
        expect(parseInstant("2026-09-30")).toBe(Date.UTC(2026, 8, 29, 16));
      }
      process.env.TZ = "America/Los_Angeles";
      expect(new Date(instant).getDate()).toBe(30); // proves the switch took effect (local date is 30 Sep)
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("instants", () => {
  it("parses ISO and Postgres timestamps", () => {
    expect(parseInstant("2026-09-30T06:05:00.123456+00:00")).toBe(Date.UTC(2026, 8, 30, 6, 5, 0, 123));
    expect(parseInstant("2026-09-30 06:05:00.5+00")).toBe(Date.UTC(2026, 8, 30, 6, 5, 0, 500));
    expect(parseInstant("2026-09-30T14:05:00+08:00")).toBe(Date.UTC(2026, 8, 30, 6, 5));
    expect(parseInstant("2026-09-30T01:05-0500")).toBe(Date.UTC(2026, 8, 30, 6, 5));
    expect(parseInstant("2026-09-30T06:05:00")).toBe(Date.UTC(2026, 8, 30, 6, 5)); // no offset → UTC
    expect(parseInstant("2026-09-30")).toBe(Date.UTC(2026, 8, 29, 16)); // midnight MYT
    expect(parseInstant(0)).toBe(0);
  });

  it("returns null for unparseable instants", () => {
    expect(parseInstant("garbage")).toBeNull();
    expect(parseInstant("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseInstant("2026-09-30T24:00:00Z")).toBeNull();
    expect(parseInstant(new Date(Number.NaN))).toBeNull();
    expect(parseInstant(Number.NaN)).toBeNull();
    expect(parseInstant(null)).toBeNull();
  });

  it("converts instants to Malaysia dates and wall-clock parts", () => {
    expect(toMYTDate("2026-09-30T16:30:00Z")).toBe("2026-10-01");
    expect(toMYTDate("2026-09-30T15:59:59Z")).toBe("2026-09-30");
    expect(toMYTDate("2026-09-30T11:30:00-05:00")).toBe("2026-10-01");
    expect(toMYTDate("2026-09-30")).toBe("2026-09-30");
    expect(toMYTDate("2026-09")).toBe("2026-09-01");
    expect(() => toMYTDate("yesterday")).toThrow(RangeError);
    expect(mytParts(Date.UTC(2026, 8, 30, 6, 5, 9))).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 14,
      minute: 5,
      second: 9,
    });
  });
});
