// Input schemas of the /admin/cycles actions (src/app/admin/cycles/_lib/schemas.ts).
import { describe, expect, it } from "vitest";

import {
  decimalPlaces,
  extendDeadlineSchema,
  fxRateKeySchema,
  fxRateSchema,
  openMonthSchema,
} from "@/app/admin/cycles/_lib/schemas";

const SUBMISSION = "b0000000-0000-4000-8000-000000000001";

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

describe("decimalPlaces", () => {
  it("counts decimals in plain notation", () => {
    expect(decimalPlaces(4.215)).toBe(3);
    expect(decimalPlaces(120)).toBe(0);
    expect(decimalPlaces(1e-8)).toBe(8);
    expect(decimalPlaces(1.5e-7)).toBe(8);
    expect(decimalPlaces(0.123456789)).toBe(9);
    expect(decimalPlaces(1e21)).toBe(0);
    expect(decimalPlaces(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("openMonthSchema", () => {
  it("takes a month key", () => {
    expect(openMonthSchema.parse({ month: " 2026-10 " })).toEqual({ month: "2026-10" });
    expect(firstMessage(openMonthSchema.safeParse({ month: "2026-13" }))).toBe("Choose a month.");
    expect(firstMessage(openMonthSchema.safeParse({ month: "2026-10-01" }))).toBe("Choose a month.");
    expect(firstMessage(openMonthSchema.safeParse({}))).toBe("Choose a month.");
  });
});

describe("extendDeadlineSchema", () => {
  it("drops a blank reason and keeps a real one trimmed", () => {
    expect(extendDeadlineSchema.parse({ submissionId: SUBMISSION, newDueDate: "2026-10-30", reason: "   " })).toEqual({
      submissionId: SUBMISSION,
      newDueDate: "2026-10-30",
      reason: undefined,
    });
    expect(
      extendDeadlineSchema.parse({ submissionId: SUBMISSION, newDueDate: "2026-10-30", reason: " Audit delay " }).reason,
    ).toBe("Audit delay");
  });

  it("refuses bad ids, dates and long reasons", () => {
    expect(firstMessage(extendDeadlineSchema.safeParse({ submissionId: "nope", newDueDate: "2026-10-30" }))).toBe(
      "Choose the month to extend.",
    );
    expect(firstMessage(extendDeadlineSchema.safeParse({ submissionId: SUBMISSION, newDueDate: "30/10/2026" }))).toBe(
      "Choose the new due date.",
    );
    expect(
      firstMessage(
        extendDeadlineSchema.safeParse({ submissionId: SUBMISSION, newDueDate: "2026-10-30", reason: "x".repeat(2001) }),
      ),
    ).toBe("Please keep the reason under 2,000 characters.");
  });
});

describe("fxRateSchema", () => {
  it("normalises the currency and accepts a positive rate", () => {
    expect(fxRateSchema.parse({ currency: " usd", month: "2026-09", rate: 4.215 })).toEqual({
      currency: "USD",
      month: "2026-09",
      rate: 4.215,
    });
    expect(fxRateSchema.parse({ currency: "IDR", month: "2026-09", rate: 0.00028123 }).rate).toBe(0.00028123);
  });

  it("refuses MYR, bad codes and bad rates", () => {
    expect(firstMessage(fxRateSchema.safeParse({ currency: "MYR", month: "2026-09", rate: 1 }))).toBe(
      "Amounts in MYR need no FX rate.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "US", month: "2026-09", rate: 1 }))).toBe("Choose a currency.");
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "2026-09", rate: 0 }))).toBe(
      "The rate must be more than 0.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "2026-09", rate: -4 }))).toBe(
      "The rate must be more than 0.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "2026-09", rate: 1e10 }))).toBe(
      "The rate must be below 10,000,000,000.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "2026-09", rate: 0.123456789 }))).toBe(
      "Use at most 8 decimal places.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "2026-09", rate: Number.NaN }))).toBe(
      "Enter the rate, for example 4.215.",
    );
    expect(firstMessage(fxRateSchema.safeParse({ currency: "USD", month: "Sep", rate: 4 }))).toBe("Choose a month.");
  });

  it("identifies a rate by currency and month", () => {
    expect(fxRateKeySchema.parse({ currency: "usd", month: "2026-09" })).toEqual({ currency: "USD", month: "2026-09" });
  });
});
