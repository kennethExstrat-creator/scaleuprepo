// The platform settings model (src/app/admin/settings/_lib/settings-model.ts): validation, the row ↔ form
// mapping, the update of changed columns only and the change review.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DECLARATION_TEXT,
  SETTINGS_DEFAULTS,
  SETTINGS_KEYS,
  changedKeys,
  describeSettingsChanges,
  displayValue,
  settingsFromRow,
  settingsSchema,
  settingsUpdate,
  updateSettingsSchema,
  type SettingsValues,
} from "@/app/admin/settings/_lib/settings-model";
import { DEFAULT_OWNER_CONTRIBUTOR_LIMIT, OWNER_CONTRIBUTOR_LIMIT_MAX } from "@/lib/constants";

import { SETTINGS } from "./fixtures";

const SAVED: SettingsValues = settingsFromRow(SETTINGS);

function issueFor(values: Partial<Record<keyof SettingsValues, unknown>>, key: keyof SettingsValues): string | undefined {
  const result = settingsSchema.safeParse({ ...SAVED, ...values });
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === key)?.message;
}

describe("settingsFromRow", () => {
  it("maps the row to the form values", () => {
    expect(SAVED).toEqual({
      dueDay: 15,
      backfillGraceDays: 14,
      escalationDays: 14,
      defaultReportingStart: "2026-07",
      revenueSwingPct: 30,
      minRunwayMonths: 6,
      ownerContributorLimit: 4,
      declarationText: DEFAULT_DECLARATION_TEXT,
      requireMfa: true,
      termsVersion: "2026-09",
    });
  });

  it("matches the database defaults", () => {
    expect({ ...SETTINGS_DEFAULTS, termsVersion: "2026-09" }).toEqual(SAVED);
    expect(SETTINGS_DEFAULTS.ownerContributorLimit).toBe(DEFAULT_OWNER_CONTRIBUTOR_LIMIT);
  });
});

describe("settingsSchema", () => {
  it("accepts the saved values and trims text", () => {
    const parsed = settingsSchema.parse({ ...SAVED, termsVersion: " 2026-10 ", declarationText: "  I confirm.  " });
    expect(parsed.termsVersion).toBe("2026-10");
    expect(parsed.declarationText).toBe("I confirm.");
  });

  it("keeps every number in range", () => {
    expect(issueFor({ dueDay: 29 }, "dueDay")).toBe("Enter a day from 1 to 28.");
    expect(issueFor({ dueDay: 0 }, "dueDay")).toBe("Enter a day from 1 to 28.");
    expect(issueFor({ dueDay: 15.5 }, "dueDay")).toBe("Enter a day from 1 to 28.");
    expect(issueFor({ dueDay: Number.NaN }, "dueDay")).toBe("Enter a day from 1 to 28.");
    expect(issueFor({ backfillGraceDays: 0 }, "backfillGraceDays")).toBe("Enter a whole number of days from 1 to 365.");
    expect(issueFor({ escalationDays: 0 }, "escalationDays")).toBeUndefined();
    expect(issueFor({ escalationDays: 366 }, "escalationDays")).toBe("Enter a whole number of days from 0 to 365.");
    expect(issueFor({ revenueSwingPct: 0 }, "revenueSwingPct")).toBe("Enter a percentage from 1 to 1,000.");
    expect(issueFor({ revenueSwingPct: 30.555 }, "revenueSwingPct")).toBe("Use at most 2 decimal places.");
    expect(issueFor({ revenueSwingPct: 27.5 }, "revenueSwingPct")).toBeUndefined();
    expect(issueFor({ minRunwayMonths: 0 }, "minRunwayMonths")).toBeUndefined();
    expect(issueFor({ minRunwayMonths: 61 }, "minRunwayMonths")).toBe("Enter a number of months from 0 to 60.");
    expect(issueFor({ ownerContributorLimit: 0 }, "ownerContributorLimit")).toBeUndefined();
    expect(issueFor({ ownerContributorLimit: OWNER_CONTRIBUTOR_LIMIT_MAX + 1 }, "ownerContributorLimit")).toBe(
      `Enter a whole number from 0 to ${OWNER_CONTRIBUTOR_LIMIT_MAX}.`,
    );
  });

  it("checks the month, the declaration and the terms version", () => {
    expect(issueFor({ defaultReportingStart: "2026-13" }, "defaultReportingStart")).toBe("Choose a month.");
    expect(issueFor({ declarationText: "   " }, "declarationText")).toBe("Enter the declaration.");
    expect(issueFor({ declarationText: "x".repeat(1001) }, "declarationText")).toBe(
      "Please keep the declaration under 1,000 characters.",
    );
    expect(issueFor({ termsVersion: "  " }, "termsVersion")).toBe("Enter the terms version, for example 2026-10.");
    expect(issueFor({ termsVersion: "2026/10" }, "termsVersion")).toBe(
      "Use letters, numbers, dots and hyphens, for example 2026-10.",
    );
    expect(issueFor({ termsVersion: "v2.1 draft" }, "termsVersion")).toBeUndefined();
    expect(issueFor({ requireMfa: "yes" }, "requireMfa")).toBeDefined();
  });

  it("needs the updated_at the form was loaded with", () => {
    expect(updateSettingsSchema.safeParse(SAVED).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ ...SAVED, expectedUpdatedAt: SETTINGS.updated_at }).success).toBe(true);
  });
});

describe("changes and the update", () => {
  it("writes only the changed columns", () => {
    const next: SettingsValues = { ...SAVED, dueDay: 20, termsVersion: "2026-10", declarationText: ` ${DEFAULT_DECLARATION_TEXT} ` };
    expect(changedKeys(SAVED, next)).toEqual(["dueDay", "termsVersion"]);
    expect(settingsUpdate(SAVED, next)).toEqual({ due_day: 20, terms_version: "2026-10" });
    expect(settingsUpdate(SAVED, SAVED)).toEqual({});
  });

  it("maps every field to its column", () => {
    const next: SettingsValues = {
      dueDay: 10,
      backfillGraceDays: 21,
      escalationDays: 7,
      defaultReportingStart: "2026-08",
      revenueSwingPct: 25.5,
      minRunwayMonths: 9,
      ownerContributorLimit: 2,
      declarationText: "  We confirm.  ",
      requireMfa: false,
      termsVersion: " 2026-10 ",
    };
    expect(changedKeys(SAVED, next)).toEqual(SETTINGS_KEYS);
    expect(settingsUpdate(SAVED, next)).toEqual({
      due_day: 10,
      backfill_grace_days: 21,
      escalation_days: 7,
      default_reporting_start: "2026-08-01",
      revenue_swing_pct: 25.5,
      min_runway_months: 9,
      owner_contributor_limit: 2,
      declaration_text: "We confirm.",
      require_mfa: false,
      terms_version: "2026-10",
    });
  });

  it("shows values the way people read them", () => {
    expect(displayValue("dueDay", SAVED)).toBe("15th of the following month");
    expect(displayValue("backfillGraceDays", { backfillGraceDays: 1 })).toBe("1 day");
    expect(displayValue("escalationDays", SAVED)).toBe("14 days overdue");
    expect(displayValue("defaultReportingStart", SAVED)).toBe("July 2026");
    expect(displayValue("revenueSwingPct", { revenueSwingPct: 27.5 })).toBe("27.5%");
    expect(displayValue("minRunwayMonths", { minRunwayMonths: 1 })).toBe("1 month");
    expect(displayValue("ownerContributorLimit", SAVED)).toBe("4 contributors");
    expect(displayValue("requireMfa", { requireMfa: false })).toBe("Not required");
    expect(displayValue("termsVersion", SAVED)).toBe("2026-09");
    expect(displayValue("declarationText", { declarationText: "x".repeat(120) })).toMatch(/^“x{89}…”$/);
    expect(displayValue("dueDay", {})).toBe("");
  });
});

describe("describeSettingsChanges", () => {
  function only(next: Partial<SettingsValues>) {
    const changes = describeSettingsChanges(SAVED, { ...SAVED, ...next }, "2026-10");
    expect(changes).toHaveLength(1);
    return changes[0];
  }

  it("lists nothing when nothing changed", () => {
    expect(describeSettingsChanges(SAVED, { ...SAVED }, "2026-10")).toEqual([]);
  });

  it("explains a new due day with an example", () => {
    const change = only({ dueDay: 20 });
    expect(change).toMatchObject({ key: "dueDay", label: "Due day", from: "15th of the following month", severity: "info" });
    expect(change.to).toBe("20th of the following month");
    expect(change.effect).toContain("October 2026 would be due on 20 Nov 2026");
    expect(change.effect).toContain("Months already open keep their due dates");
  });

  it("warns about turning two-factor authentication off, and on", () => {
    expect(only({ requireMfa: false })).toMatchObject({ severity: "danger", from: "Required", to: "Not required" });
    const on = describeSettingsChanges({ ...SAVED, requireMfa: false }, SAVED, "2026-10")[0];
    expect(on.severity).toBe("warning");
    expect(on.effect).toContain("including you");
  });

  it("warns that a new terms version makes everyone accept again", () => {
    const change = only({ termsVersion: "2026-10" });
    expect(change.severity).toBe("warning");
    expect(change.effect).toContain("accept the terms of use again");
  });

  it("explains moving the earliest reporting month", () => {
    const earlier = only({ defaultReportingStart: "2026-01" });
    expect(earlier.severity).toBe("warning");
    expect(earlier.effect).toContain("The months from Jan 2026 to Jun 2026 open on the platform");
    const later = only({ defaultReportingStart: "2026-09" });
    expect(later.severity).toBe("info");
    expect(later.effect).toContain("before September 2026");
  });

  it("explains the contributor limit, runway and swing thresholds", () => {
    const lower = only({ ownerContributorLimit: 2 });
    expect(lower.severity).toBe("warning");
    expect(lower.effect).toContain("Teams above the new limit keep their contributors");
    expect(only({ ownerContributorLimit: 0 }).effect).toContain("only ScaleUp can add them");
    expect(only({ ownerContributorLimit: 6 })).toMatchObject({ severity: "info" });
    expect(only({ minRunwayMonths: 0 }).effect).toBe("Reviews no longer flag low runway.");
    expect(only({ minRunwayMonths: 2 }).effect).toContain("always as critical");
    expect(only({ minRunwayMonths: 9 }).effect).toContain("as critical below 3 months");
    expect(only({ revenueSwingPct: 25 }).effect).toContain("as critical above 50%");
    expect(only({ escalationDays: 0 }).effect).toContain("straight away");
    expect(only({ backfillGraceDays: 21 }).effect).toContain("21 days");
    expect(only({ declarationText: "We confirm." }).effect).toContain("keep the wording that was accepted");
  });
});
