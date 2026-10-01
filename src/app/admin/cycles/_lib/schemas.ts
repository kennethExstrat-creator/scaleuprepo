// Input schemas of the /admin/cycles Server Actions (actions.ts). Pure and client-safe: the dialogs run the
// same checks for instant feedback. Unit-tested in tests/features/m4/schemas.test.ts.
import { z } from "zod";

import { DEFAULT_CURRENCY } from "@/lib/constants";
import { isMonthKey } from "@/lib/periods";

/** extend_due_date keeps the reason under 2,000 characters. */
export const EXTENSION_REASON_MAX = 2000;

/** fx_rates.rate_to_myr is numeric(18, 8): below 10^10, at most 8 decimal places, more than 0. */
export const FX_RATE_MAX = 10_000_000_000;
export const FX_RATE_DECIMALS = 8;

/** Decimal places of a number as written in plain notation: 4.215 → 3, 1e-8 → 8, 120 → 0. */
export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  const [mantissa, exponent] = value.toString().toLowerCase().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - (exponent ? Number(exponent) : 0));
}

export const monthKeySchema = z
  .string({ error: "Choose a month." })
  .trim()
  .refine((value) => isMonthKey(value), "Choose a month.");

const submissionIdSchema = z.guid({ error: "Choose the month to extend." });

/** "Open <current month> early": the month the page offered (open_period checks it is not in the future). */
export const openMonthSchema = z.object({ month: monthKeySchema });

export const extendDeadlineSchema = z.object({
  submissionId: submissionIdSchema,
  newDueDate: z.iso.date({ error: "Choose the new due date." }),
  reason: z
    .string()
    .trim()
    .max(EXTENSION_REASON_MAX, "Please keep the reason under 2,000 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const currencySchema = z
  .string({ error: "Choose a currency." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Choose a currency.")
  .refine((code) => code !== DEFAULT_CURRENCY, "Amounts in MYR need no FX rate.");

export const rateSchema = z
  .number({ error: "Enter the rate, for example 4.215." })
  .refine((value) => Number.isFinite(value), "Enter the rate, for example 4.215.")
  .refine((value) => value > 0, "The rate must be more than 0.")
  .refine((value) => value < FX_RATE_MAX, "The rate must be below 10,000,000,000.")
  .refine((value) => decimalPlaces(value) <= FX_RATE_DECIMALS, "Use at most 8 decimal places.");

/** Add or change the rate of one currency and month. */
export const fxRateSchema = z.object({
  currency: currencySchema,
  month: monthKeySchema,
  rate: rateSchema,
});
export type FxRateValues = z.output<typeof fxRateSchema>;

/** The key of an existing rate (edit / delete). */
export const fxRateKeySchema = z.object({
  currency: currencySchema,
  month: monthKeySchema,
});
