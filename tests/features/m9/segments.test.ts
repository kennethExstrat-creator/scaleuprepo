// The revenue segment rules the exports share (src/lib/exports/segments.ts, BRD B30): which segment
// figures a month shows and the total revenue it shows, as the monthly form does.
import { describe, expect, it } from "vitest";

import {
  ENTERED_EARLIER_TOTAL_NOTE,
  isOpenForChanges,
  shownRevenueTotal,
  shownSegmentAmounts,
} from "@/lib/exports/segments";

const RETAIL = "a1000000-0000-4000-8000-000000000001";
const ONLINE = "a1000000-0000-4000-8000-000000000002";
const WHOLESALE = "a1000000-0000-4000-8000-000000000003";
const GIFTING = "a1000000-0000-4000-8000-000000000004";

/** The company's own segments in use (Wholesale was removed; Corporate gifting is a ScaleUp line). */
const COMPANY_SEGMENTS = [RETAIL, ONLINE];

describe("isOpenForChanges", () => {
  it("is true for months still open for changes only", () => {
    expect(isOpenForChanges("draft")).toBe(true);
    expect(isOpenForChanges("changes_requested")).toBe(true);
    expect(isOpenForChanges("submitted")).toBe(false);
    expect(isOpenForChanges("approved")).toBe(false);
  });
});

describe("shownSegmentAmounts", () => {
  it("keeps every figure of a submitted month but only the current segments' figures of an open one", () => {
    const active = new Set([RETAIL]);
    const segments = { [RETAIL]: 10, [WHOLESALE]: 5, [ONLINE]: null };
    expect(shownSegmentAmounts({ status: "approved", segments }, active)).toEqual({ [RETAIL]: 10, [WHOLESALE]: 5 });
    expect(shownSegmentAmounts({ status: "submitted", segments }, active)).toEqual({ [RETAIL]: 10, [WHOLESALE]: 5 });
    expect(shownSegmentAmounts({ status: "draft", segments }, active)).toEqual({ [RETAIL]: 10 });
    expect(shownSegmentAmounts({ status: "changes_requested", segments }, active)).toEqual({ [RETAIL]: 10 });
  });
});

describe("shownRevenueTotal (BRD B30)", () => {
  it("calculates an open month's total from the company's own segments, as the monthly form does", () => {
    // The owner removed Wholesale (RM 300) while the month was a draft with a stored total of RM 1,000.
    const segments = { [RETAIL]: 700, [WHOLESALE]: 300, [GIFTING]: 5_000 };
    expect(shownRevenueTotal({ status: "draft", segments }, 1_000, COMPANY_SEGMENTS)).toEqual({
      total: 700,
      enteredEarlier: false,
    });
    expect(shownRevenueTotal({ status: "changes_requested", segments }, 1_000, COMPANY_SEGMENTS).total).toBe(700);
    // Exact to the cent (0.1 + 0.2 is 0.30000000000000004 in floating point).
    expect(shownRevenueTotal({ status: "draft", segments: { [RETAIL]: 0.1, [ONLINE]: 0.2 } }, null, COMPANY_SEGMENTS).total).toBe(0.3);
  });

  it("keeps a total entered before any of the segments was filled in, and says so", () => {
    expect(shownRevenueTotal({ status: "draft", segments: { [GIFTING]: 5_000 } }, 1_000, COMPANY_SEGMENTS)).toEqual({
      total: 1_000,
      enteredEarlier: true,
    });
    expect(shownRevenueTotal({ status: "draft", segments: { [RETAIL]: null } }, null, COMPANY_SEGMENTS)).toEqual({
      total: null,
      enteredEarlier: false,
    });
    expect(ENTERED_EARLIER_TOTAL_NOTE).toBe(
      "Entered before the revenue segments were filled in. Once they are, total revenue is their sum.",
    );
  });

  it("keeps the stored total of submitted months and of companies without segments of their own", () => {
    const segments = { [RETAIL]: 700, [WHOLESALE]: 300 };
    expect(shownRevenueTotal({ status: "submitted", segments }, 1_000, COMPANY_SEGMENTS)).toEqual({
      total: 1_000,
      enteredEarlier: false,
    });
    expect(shownRevenueTotal({ status: "approved", segments }, 1_000, COMPANY_SEGMENTS).total).toBe(1_000);
    // ScaleUp revenue lines never make up total revenue.
    expect(shownRevenueTotal({ status: "draft", segments: { [GIFTING]: 5_000 } }, 1_000, [])).toEqual({
      total: 1_000,
      enteredEarlier: false,
    });
  });
});
