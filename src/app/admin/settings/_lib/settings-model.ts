// Platform settings (module M4; BRD A5, A7, B4, B11, B12, B19, B25, B27, B29): the form's values, limits,
// defaults and validation, the update sent to `platform_settings`, and the review of what a change does.
// Pure and client-safe; unit-tested in tests/features/m4/settings-model.test.ts.
import { z } from "zod";

import { decimalPlaces } from "@/app/admin/cycles/_lib/schemas";
import { ordinal, plural } from "@/app/admin/cycles/_lib/cycles-model";
import {
  CRITICAL_RUNWAY_MONTHS,
  DEFAULT_BACKFILL_GRACE_DAYS,
  DEFAULT_DUE_DAY,
  DEFAULT_ESCALATION_DAYS,
  DEFAULT_MIN_RUNWAY_MONTHS,
  DEFAULT_OWNER_CONTRIBUTOR_LIMIT,
  DEFAULT_REVENUE_SWING_PCT,
  OWNER_CONTRIBUTOR_LIMIT_MAX,
} from "@/lib/constants";
import { formatDate, formatNumberTrimmed, toFiniteNumber } from "@/lib/format";
import {
  addMonths,
  compareMonths,
  dueDateFor,
  isMonthKey,
  monthKeyToDate,
  monthLabel,
  monthLabelLong,
  parseMonthKey,
  type MonthKey,
} from "@/lib/periods";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import type { PlatformSettingsRow } from "@/lib/types/domain";

/** The database defaults (supabase/migrations: platform_settings). */
export const DEFAULT_DECLARATION_TEXT = "I confirm that the figures submitted are accurate to the best of my knowledge.";
export const DEFAULT_REPORTING_START: MonthKey = "2026-07";

/** The first month the "Earliest reporting month" picker offers (historical data starts in H2 2024). */
export const REPORTING_START_FIRST_MONTH: MonthKey = "2024-01";

export const SETTINGS_LIMITS = {
  dueDay: { min: 1, max: 28 },
  backfillGraceDays: { min: 1, max: 365 },
  escalationDays: { min: 0, max: 365 },
  revenueSwingPct: { min: 1, max: 1000 },
  minRunwayMonths: { min: 0, max: 60 },
  ownerContributorLimit: { min: 0, max: OWNER_CONTRIBUTOR_LIMIT_MAX },
  declarationText: { max: 1000 },
  termsVersion: { max: 40 },
} as const;

export type SettingsValues = {
  dueDay: number;
  backfillGraceDays: number;
  escalationDays: number;
  /** 'YYYY-MM'. */
  defaultReportingStart: MonthKey;
  revenueSwingPct: number;
  minRunwayMonths: number;
  ownerContributorLimit: number;
  declarationText: string;
  requireMfa: boolean;
  termsVersion: string;
};

export type SettingsKey = keyof SettingsValues;

/** Defaults shown next to each field (the terms version has none: it names the terms in force). */
export const SETTINGS_DEFAULTS: Omit<SettingsValues, "termsVersion"> = {
  dueDay: DEFAULT_DUE_DAY,
  backfillGraceDays: DEFAULT_BACKFILL_GRACE_DAYS,
  escalationDays: DEFAULT_ESCALATION_DAYS,
  defaultReportingStart: DEFAULT_REPORTING_START,
  revenueSwingPct: DEFAULT_REVENUE_SWING_PCT,
  minRunwayMonths: DEFAULT_MIN_RUNWAY_MONTHS,
  ownerContributorLimit: DEFAULT_OWNER_CONTRIBUTOR_LIMIT,
  declarationText: DEFAULT_DECLARATION_TEXT,
  requireMfa: true,
};

/** Field labels (the form and the change review use the same wording). */
export const SETTINGS_LABELS: Record<SettingsKey, string> = {
  dueDay: "Due day",
  backfillGraceDays: "Grace period for late-opened months",
  escalationDays: "Escalate overdue months after",
  defaultReportingStart: "Earliest reporting month",
  revenueSwingPct: "Revenue swing flag",
  minRunwayMonths: "Minimum runway",
  ownerContributorLimit: "Maximum contributors a company owner can invite",
  declarationText: "Submission declaration",
  requireMfa: "Two-factor authentication",
  termsVersion: "Terms of use version",
};

/** The order fields are listed in (form and review). */
export const SETTINGS_KEYS: SettingsKey[] = [
  "dueDay",
  "backfillGraceDays",
  "escalationDays",
  "defaultReportingStart",
  "revenueSwingPct",
  "minRunwayMonths",
  "ownerContributorLimit",
  "declarationText",
  "requireMfa",
  "termsVersion",
];

function wholeNumber(message: string, min: number, max: number) {
  return z.number({ error: message }).int(message).min(min, message).max(max, message);
}

function decimalNumber(message: string, min: number, max: number) {
  return z
    .number({ error: message })
    .min(min, message)
    .max(max, message)
    .refine((value) => decimalPlaces(value) <= 2, "Use at most 2 decimal places.");
}

const L = SETTINGS_LIMITS;

export const settingsSchema = z.object({
  dueDay: wholeNumber(`Enter a day from ${L.dueDay.min} to ${L.dueDay.max}.`, L.dueDay.min, L.dueDay.max),
  backfillGraceDays: wholeNumber(
    `Enter a whole number of days from ${L.backfillGraceDays.min} to ${L.backfillGraceDays.max}.`,
    L.backfillGraceDays.min,
    L.backfillGraceDays.max,
  ),
  escalationDays: wholeNumber(
    `Enter a whole number of days from ${L.escalationDays.min} to ${L.escalationDays.max}.`,
    L.escalationDays.min,
    L.escalationDays.max,
  ),
  defaultReportingStart: z
    .string({ error: "Choose a month." })
    .refine((value) => isMonthKey(value), "Choose a month."),
  revenueSwingPct: decimalNumber(
    `Enter a percentage from ${L.revenueSwingPct.min} to ${formatNumberTrimmed(L.revenueSwingPct.max)}.`,
    L.revenueSwingPct.min,
    L.revenueSwingPct.max,
  ),
  minRunwayMonths: decimalNumber(
    `Enter a number of months from ${L.minRunwayMonths.min} to ${L.minRunwayMonths.max}.`,
    L.minRunwayMonths.min,
    L.minRunwayMonths.max,
  ),
  ownerContributorLimit: wholeNumber(
    `Enter a whole number from ${L.ownerContributorLimit.min} to ${L.ownerContributorLimit.max}.`,
    L.ownerContributorLimit.min,
    L.ownerContributorLimit.max,
  ),
  declarationText: z
    .string({ error: "Enter the declaration." })
    .trim()
    .min(1, "Enter the declaration.")
    .max(L.declarationText.max, "Please keep the declaration under 1,000 characters."),
  requireMfa: z.boolean({ error: "Choose whether two-factor authentication is required." }),
  termsVersion: z
    .string({ error: "Enter the terms version, for example 2026-10." })
    .trim()
    .min(1, "Enter the terms version, for example 2026-10.")
    .max(L.termsVersion.max, "Please keep the version under 40 characters.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/, "Use letters, numbers, dots and hyphens, for example 2026-10."),
});

/**
 * Two-factor authentication is required for everyone (BRD §11 "2FA for all users", B11): Settings can turn
 * it back on (an older database may have it off) but never off. Someone who lost their authenticator app
 * gets their own 2FA reset on /admin/users instead.
 */
export const MFA_ALWAYS_ON_MESSAGE =
  "Two-factor authentication is required for everyone and can't be turned off. If someone has lost their authenticator app, reset their two-factor authentication on the Users page.";

/** The Server Action's input: the values plus the `updated_at` the form was loaded with (lost-update guard). */
export const updateSettingsSchema = settingsSchema.extend({
  expectedUpdatedAt: z.string({ error: "Reload the page and try again." }).min(1, "Reload the page and try again."),
});

/** The form values of a `platform_settings` row. */
export function settingsFromRow(row: PlatformSettingsRow): SettingsValues {
  return {
    dueDay: row.due_day,
    backfillGraceDays: row.backfill_grace_days,
    escalationDays: row.escalation_days,
    defaultReportingStart: parseMonthKey(row.default_reporting_start) ?? DEFAULT_REPORTING_START,
    revenueSwingPct: toFiniteNumber(row.revenue_swing_pct) ?? DEFAULT_REVENUE_SWING_PCT,
    minRunwayMonths: toFiniteNumber(row.min_runway_months) ?? DEFAULT_MIN_RUNWAY_MONTHS,
    ownerContributorLimit: row.owner_contributor_limit,
    declarationText: row.declaration_text,
    requireMfa: row.require_mfa,
    termsVersion: row.terms_version,
  };
}

function sameValue(key: SettingsKey, a: SettingsValues, b: SettingsValues): boolean {
  const left = a[key];
  const right = b[key];
  if (typeof left === "string" && typeof right === "string") return left.trim() === right.trim();
  return left === right;
}

/** The fields that differ, in form order. */
export function changedKeys(before: SettingsValues, after: SettingsValues): SettingsKey[] {
  return SETTINGS_KEYS.filter((key) => !sameValue(key, before, after));
}

/** The `platform_settings` update for the changed fields only (the audit log then shows just those). */
export function settingsUpdate(before: SettingsValues, after: SettingsValues): TablesUpdate<"platform_settings"> {
  const update: TablesUpdate<"platform_settings"> = {};
  for (const key of changedKeys(before, after)) {
    switch (key) {
      case "dueDay":
        update.due_day = after.dueDay;
        break;
      case "backfillGraceDays":
        update.backfill_grace_days = after.backfillGraceDays;
        break;
      case "escalationDays":
        update.escalation_days = after.escalationDays;
        break;
      case "defaultReportingStart":
        update.default_reporting_start = monthKeyToDate(after.defaultReportingStart);
        break;
      case "revenueSwingPct":
        update.revenue_swing_pct = after.revenueSwingPct;
        break;
      case "minRunwayMonths":
        update.min_runway_months = after.minRunwayMonths;
        break;
      case "ownerContributorLimit":
        update.owner_contributor_limit = after.ownerContributorLimit;
        break;
      case "declarationText":
        update.declaration_text = after.declarationText.trim();
        break;
      case "requireMfa":
        update.require_mfa = after.requireMfa;
        break;
      case "termsVersion":
        update.terms_version = after.termsVersion.trim();
        break;
    }
  }
  return update;
}

/** How a value reads in the change review and next to "Default:". */
export function displayValue(key: SettingsKey, values: Partial<SettingsValues>): string {
  switch (key) {
    case "dueDay":
      return values.dueDay === undefined ? "" : `${ordinal(values.dueDay)} of the following month`;
    case "backfillGraceDays":
      return values.backfillGraceDays === undefined ? "" : plural(values.backfillGraceDays, "day");
    case "escalationDays":
      return values.escalationDays === undefined ? "" : `${plural(values.escalationDays, "day")} overdue`;
    case "defaultReportingStart":
      return values.defaultReportingStart ? monthLabelLong(values.defaultReportingStart) : "";
    case "revenueSwingPct":
      return values.revenueSwingPct === undefined ? "" : `${formatNumberTrimmed(values.revenueSwingPct, 2)}%`;
    case "minRunwayMonths":
      return values.minRunwayMonths === undefined
        ? ""
        : `${formatNumberTrimmed(values.minRunwayMonths, 2)} ${values.minRunwayMonths === 1 ? "month" : "months"}`;
    case "ownerContributorLimit":
      return values.ownerContributorLimit === undefined ? "" : plural(values.ownerContributorLimit, "contributor");
    case "declarationText":
      return values.declarationText === undefined ? "" : truncate(values.declarationText.trim(), 90);
    case "requireMfa":
      return values.requireMfa === undefined ? "" : values.requireMfa ? "Required" : "Not required";
    case "termsVersion":
      return values.termsVersion?.trim() ?? "";
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? `“${text}”` : `“${text.slice(0, max - 1).trimEnd()}…”`;
}

export type ChangeSeverity = "info" | "warning" | "danger";

export type SettingsChange = {
  key: SettingsKey;
  label: string;
  from: string;
  to: string;
  /** What the change does, in a sentence or two. */
  effect: string;
  severity: ChangeSeverity;
};

/**
 * What saving would change, field by field, with its effect (the confirmation before saving). `currentMonth`
 * ('YYYY-MM', Malaysia time) makes the examples concrete.
 */
export function describeSettingsChanges(
  before: SettingsValues,
  after: SettingsValues,
  currentMonth: MonthKey,
): SettingsChange[] {
  return changedKeys(before, after).map((key) => {
    const base = {
      key,
      label: SETTINGS_LABELS[key],
      from: displayValue(key, before),
      to: displayValue(key, after),
    };
    const { effect, severity } = changeEffect(key, before, after, currentMonth);
    return { ...base, effect, severity };
  });
}

function changeEffect(
  key: SettingsKey,
  before: SettingsValues,
  after: SettingsValues,
  currentMonth: MonthKey,
): { effect: string; severity: ChangeSeverity } {
  switch (key) {
    case "dueDay": {
      return {
        severity: "info",
        effect:
          `Months that open from now on are due on the ${ordinal(after.dueDay)} of the following month ` +
          `(${monthLabelLong(currentMonth)} would be due on ${formatDate(dueDateFor(currentMonth, after.dueDay))}). ` +
          "Months already open keep their due dates; extend those per company in Cycles.",
      };
    }
    case "backfillGraceDays":
      return {
        severity: "info",
        effect:
          `A month that opens after its normal due date gets ${plural(after.backfillGraceDays, "day")} from opening, and ` +
          `a month sent back or reopened gets at least ${plural(after.backfillGraceDays, "day")} to be resubmitted. ` +
          "Due dates already set do not change.",
      };
    case "escalationDays":
      return {
        severity: "info",
        effect:
          after.escalationDays === 0
            ? "Every overdue month shows as escalated on the tracker straight away."
            : `Overdue months show as escalated on the tracker once they are more than ${plural(after.escalationDays, "day")} late.`,
      };
    case "defaultReportingStart": {
      if (compareMonths(after.defaultReportingStart, before.defaultReportingStart) < 0) {
        return {
          severity: "warning",
          effect:
            `Companies can be set to report from ${monthLabelLong(after.defaultReportingStart)}. The months from ` +
            `${monthLabel(after.defaultReportingStart)} to ${monthLabel(addMonths(before.defaultReportingStart, -1))} ` +
            "open on the platform (tracker and Cycles) with no updates until a company's start month is set that early.",
        };
      }
      return {
        severity: "info",
        effect:
          `Companies can no longer be given a reporting start month before ${monthLabelLong(after.defaultReportingStart)}. ` +
          "Companies that already report from an earlier month keep their months.",
      };
    }
    case "revenueSwingPct":
      return {
        severity: "info",
        effect:
          `Reviews flag revenue that changes by more than ${formatNumberTrimmed(after.revenueSwingPct, 2)}% from the month ` +
          `before, as critical above ${formatNumberTrimmed(after.revenueSwingPct * 2, 2)}%. Flags are worked out when a month ` +
          "is reviewed, so this applies to every month from now on.",
      };
    case "minRunwayMonths": {
      const months = formatNumberTrimmed(after.minRunwayMonths, 2);
      return {
        severity: "info",
        effect:
          after.minRunwayMonths === 0
            ? "Reviews no longer flag low runway."
            : after.minRunwayMonths <= CRITICAL_RUNWAY_MONTHS
              ? `Reviews flag runway below ${months} ${after.minRunwayMonths === 1 ? "month" : "months"}, always as critical.`
              : `Reviews flag runway below ${months} months, as critical below ${CRITICAL_RUNWAY_MONTHS} months.`,
      };
    }
    case "ownerContributorLimit": {
      const lower = after.ownerContributorLimit < before.ownerContributorLimit;
      const limitText =
        after.ownerContributorLimit === 0
          ? "Company owners can no longer invite contributors; only ScaleUp can add them."
          : `Company owners can have up to ${plural(after.ownerContributorLimit, "active contributor")}, pending invitations included.`;
      return {
        severity: lower ? "warning" : "info",
        effect: lower
          ? `${limitText} Teams above the new limit keep their contributors, but their owners cannot add more until they are below it.`
          : `${limitText} ScaleUp can always add more.`,
      };
    }
    case "declarationText":
      return {
        severity: "info",
        effect:
          "Company owners confirm the new wording from their next submission. Months already submitted keep the wording that was accepted.",
      };
    case "requireMfa":
      return after.requireMfa
        ? {
            severity: "warning",
            effect:
              "Everyone signed in without two-factor authentication, including you, must set it up or enter a code before they can continue.",
          }
        : {
            severity: "danger",
            effect:
              "Everyone can sign in with a password only, including ScaleUp staff who see the whole portfolio. Turn it back on as soon as you can.",
          };
    case "termsVersion":
      return {
        severity: "warning",
        effect:
          "Everyone, including you, must accept the terms of use again before they can see any data. You will be taken to the terms page after saving.",
      };
  }
}
