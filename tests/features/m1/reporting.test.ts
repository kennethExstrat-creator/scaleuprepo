import { describe, expect, it } from "vitest";

import {
  describeStartMonthPreview,
  startMonthBounds,
  startMonthIssue,
  startMonthOptions,
  startMonthPreview,
} from "@/app/admin/companies/_components/reporting";

// Today in the brief: 30 Sep 2026 (MYT); platform default reporting start July 2026; due day 15; 14 days' grace.
const TODAY = "2026-09-30";
const bounds = startMonthBounds("2026-07-01", TODAY);

describe("startMonthBounds / startMonthIssue", () => {
  it("runs from the platform's default start to 12 months after this month", () => {
    expect(bounds).toEqual({ min: "2026-07", max: "2027-09" });
  });

  it("never ends before it starts", () => {
    expect(startMonthBounds("2028-01-01", TODAY)).toEqual({ min: "2028-01", max: "2028-01" });
  });

  it("explains months out of range", () => {
    expect(startMonthIssue("2026-06", bounds)).toBe(
      "The reporting start month can't be before Jul 2026. Earlier months come from the historical workbooks.",
    );
    expect(startMonthIssue("2027-10", bounds)).toBe("The reporting start month can't be after Sep 2027.");
    expect(startMonthIssue("2026-07", bounds)).toBeNull();
    expect(startMonthIssue("2027-09", bounds)).toBeNull();
  });
});

describe("startMonthOptions", () => {
  it("lists the allowed months oldest first", () => {
    const options = startMonthOptions(bounds, null);
    expect(options[0]).toBe("2026-07");
    expect(options.at(-1)).toBe("2027-09");
    expect(options).toHaveLength(15);
  });

  it("keeps the current value when it is out of range", () => {
    const options = startMonthOptions(bounds, "2026-01-01");
    expect(options[0]).toBe("2026-01");
    expect(options).toHaveLength(16);
    expect(startMonthOptions(bounds, "2026-08-01")).toHaveLength(15);
  });
});

describe("startMonthPreview", () => {
  it("opens the past months at once, with the grace period when their due date has passed", () => {
    const preview = startMonthPreview("2026-07", TODAY, 15, 14);
    expect(preview).toEqual({ kind: "opens_now", months: ["2026-07", "2026-08"], firstDue: "2026-10-14" });
    expect(describeStartMonthPreview(preview)).toBe(
      "Jul 2026 to Aug 2026 (2 months) open straight away; the first is due 14 Oct 2026.",
    );
  });

  it("keeps the normal due date of a month still before it", () => {
    const preview = startMonthPreview("2026-08", "2026-09-10", 15, 14);
    expect(preview).toEqual({ kind: "opens_now", months: ["2026-08"], firstDue: "2026-09-15" });
    expect(describeStartMonthPreview(preview)).toBe("Aug 2026 opens straight away and is due 15 Sep 2026.");
  });

  it("says when a current or future month will open", () => {
    const preview = startMonthPreview("2026-09", TODAY, 15, 14);
    expect(preview).toEqual({ kind: "opens_later", month: "2026-09", opensOn: "2026-10-01", due: "2026-10-15" });
    expect(describeStartMonthPreview(preview)).toBe("Sep 2026 opens on 1 Oct 2026 and is due 15 Oct 2026.");
  });
});
