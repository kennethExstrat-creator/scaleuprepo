// Input schema of the fund Server Actions (src/app/admin/funds/actions.ts). Pure and client-safe; unit-tested
// in tests/features/m1/fund-schema.test.ts.
import { z } from "zod";

import { idSchema, LIMITS, optionalText, requiredText } from "@/app/admin/companies/_components/schemas";

/** Fund codes: upper-case letters, digits and hyphens, e.g. "SV1", "SFF", "SV2-A" (unique). */
export const FUND_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
export const FUND_CODE_MAX = 20;

/** " sv 1 " → "SV1": upper case, no spaces. */
export function normaliseFundCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

const fundCodeSchema = z
  .string({ error: "Enter a fund code, for example SV1." })
  .transform(normaliseFundCode)
  .pipe(
    z
      .string()
      .min(1, "Enter a fund code, for example SV1.")
      .max(FUND_CODE_MAX, `The code can be at most ${FUND_CODE_MAX} characters.`)
      .regex(FUND_CODE_RE, "Use letters, numbers and hyphens only, for example SV1."),
  );

export const fundSchema = z.object({
  code: fundCodeSchema,
  name: requiredText(LIMITS.name, "Enter the fund name.", "The name"),
  legalName: optionalText(LIMITS.legalName, "The legal name"),
  description: optionalText(LIMITS.fundDescription, "The description"),
  isActive: z.boolean(),
});
export type FundValues = z.output<typeof fundSchema>;

export const updateFundSchema = fundSchema.extend({ id: idSchema() });
