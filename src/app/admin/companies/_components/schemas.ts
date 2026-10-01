// Input schemas of the company Server Actions (src/app/admin/companies/actions.ts) and the fund actions.
// Pure and client-safe: the forms use the same limits, and every action re-validates its input with these
// schemas (zod v4). Messages are shown next to the fields (ActionResult.fieldErrors, keyed by the dotted
// path, e.g. "funds.1.fundId"). Unit-tested in tests/features/m1/schemas.test.ts.
import { z } from "zod";

import { formatNumber, parseNumberInput } from "@/lib/format";
import { isDateKey, parseMonthKey } from "@/lib/periods";
import {
  COMPANY_STATUSES,
  INTERNAL_RATINGS,
  KPI_FREQUENCIES,
  KPI_VALUE_TYPES,
} from "@/lib/types/enums";

/** Maximum lengths (characters) used by the forms and the schemas. */
export const LIMITS = {
  name: 200,
  legalName: 200,
  registrationNo: 100,
  sector: 100,
  country: 100,
  website: 300,
  description: 4000,
  instrument: 100,
  investmentNotes: 2000,
  configName: 120,
  kpiDescription: 500,
  unit: 30,
  reason: 2000,
  exitStrategyStatus: 200,
  internalNotes: 20000,
  fundDescription: 2000,
} as const;

/** Most fund mappings a new company can be created with (SV1 and SFF today). */
export const MAX_FUND_MAPPINGS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "This item was not found. Please reload the page and try again.";

function tooLong(label: string, max: number): string {
  return `${label} can be at most ${formatNumber(max)} characters.`;
}

/** A required, trimmed text. */
export function requiredText(max: number, emptyMessage: string, label: string) {
  return z
    .string({ error: emptyMessage })
    .trim()
    .min(1, emptyMessage)
    .max(max, tooLong(label, max));
}

/** An optional, trimmed text: blank, null or missing → null. */
export function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong(label, max))
    .nullish()
    .transform((value) => (value ? value : null));
}

/** A required id (lower-cased UUID). */
export function idSchema(message = NOT_FOUND) {
  return z
    .string({ error: message })
    .trim()
    .regex(UUID_RE, message)
    .transform((value) => value.toLowerCase());
}

/** An optional id: blank, null or missing → null. */
export function optionalIdSchema(message = NOT_FOUND) {
  return z
    .string()
    .trim()
    .nullish()
    .transform((value, ctx) => {
      if (!value) return null;
      if (!UUID_RE.test(value)) {
        ctx.issues.push({ code: "custom", message, input: value });
        return z.NEVER;
      }
      return value.toLowerCase();
    });
}

// ---------------------------------------------------------------------------------------------
// Normalisers (also used by the forms)
// ---------------------------------------------------------------------------------------------

/**
 * A website as typed ("batikboutique.com", "https://www.example.my/about") → the stored form with a
 * scheme ("https://batikboutique.com"); blank → null. Returns undefined when it is not a usable web
 * address (only http/https, a host with a dot, no spaces or credentials).
 */
export function normaliseWebsite(raw: string | null | undefined): string | null | undefined {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  if (/\s/.test(value)) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  if (!/^[^.]+(\.[^.]+)+$/.test(url.hostname)) return undefined;
  return withScheme;
}

/**
 * A company profile form value as companyProfileSchema stores it (trimmed; the website with its scheme;
 * the currency upper-cased), so a form can tell a real change from a different spelling of the saved
 * value ("example.com" is not a change from "https://example.com"). Invalid websites stay as typed.
 */
export function storedProfileValue(field: string, value: string): string {
  if (field === "website") return normaliseWebsite(value) ?? value.trim();
  if (field === "reportingCurrency") return value.trim().toUpperCase();
  return value.trim();
}

/** "12.5", "12.5%", 12.5 → 12.5 (rounded to 4 decimals, as stored); blank → null; undefined when invalid. */
export function parseOwnershipPct(raw: string | number | null | undefined): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === "number" ? raw : raw.trim().replace(/\s*%$/, "");
  if (text === "") return null;
  const value = parseNumberInput(text);
  if (value === null || !Number.isFinite(value)) return undefined;
  return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------------------------
// Company profile
// ---------------------------------------------------------------------------------------------

const websiteSchema = z
  .string()
  .max(LIMITS.website, tooLong("The website", LIMITS.website))
  .nullish()
  .transform((value, ctx) => {
    const normalised = normaliseWebsite(value);
    if (normalised === undefined) {
      ctx.issues.push({
        code: "custom",
        message: "Enter a web address, for example https://example.com.",
        input: value,
      });
      return z.NEVER;
    }
    return normalised;
  });

export const currencySchema = z
  .string({ error: "Enter the reporting currency, for example MYR." })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, for example MYR, SGD or USD.");

/** 'YYYY-MM' (or 'YYYY-MM-DD') → 'YYYY-MM'; blank → null ("Not yet reporting"). */
export const startMonthSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const month = parseMonthKey(value);
    if (!month) {
      ctx.issues.push({ code: "custom", message: "Choose a valid month.", input: value });
      return z.NEVER;
    }
    return month;
  });

export const companyProfileSchema = z.object({
  name: requiredText(LIMITS.name, "Enter the company name.", "The name"),
  legalName: optionalText(LIMITS.legalName, "The legal name"),
  registrationNo: optionalText(LIMITS.registrationNo, "The registration number"),
  sector: optionalText(LIMITS.sector, "The sector"),
  country: optionalText(LIMITS.country, "The country"),
  website: websiteSchema,
  description: optionalText(LIMITS.description, "The description"),
  reportingCurrency: currencySchema,
});
export type CompanyProfileValues = z.output<typeof companyProfileSchema>;

// ---------------------------------------------------------------------------------------------
// Fund investments (per fund, BRD B2)
// ---------------------------------------------------------------------------------------------

const investmentDateSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    if (!isDateKey(value) || Number(value.slice(0, 4)) < 1990) {
      ctx.issues.push({ code: "custom", message: "Enter a valid date.", input: value });
      return z.NEVER;
    }
    return value;
  });

const ownershipSchema = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, ctx) => {
    const pct = parseOwnershipPct(value);
    if (pct === undefined) {
      ctx.issues.push({ code: "custom", message: "Enter a percentage, for example 12.5.", input: value });
      return z.NEVER;
    }
    if (pct !== null && (pct < 0 || pct > 100)) {
      ctx.issues.push({ code: "custom", message: "Ownership must be between 0% and 100%.", input: value });
      return z.NEVER;
    }
    return pct;
  });

export const fundMappingSchema = z.object({
  fundId: idSchema("Choose a fund."),
  investmentDate: investmentDateSchema,
  instrument: optionalText(LIMITS.instrument, "The instrument"),
  ownershipPct: ownershipSchema,
  notes: optionalText(LIMITS.investmentNotes, "The notes"),
});
export type FundMappingValues = z.output<typeof fundMappingSchema>;

export const createCompanySchema = companyProfileSchema.extend({
  reportingStartMonth: startMonthSchema,
  partnerId: optionalIdSchema("Choose a partner from the list."),
  funds: z
    .array(fundMappingSchema)
    .max(MAX_FUND_MAPPINGS, `Add at most ${MAX_FUND_MAPPINGS} funds.`)
    .default([])
    .superRefine((funds, ctx) => {
      const seen = new Set<string>();
      funds.forEach((fund, index) => {
        if (seen.has(fund.fundId)) {
          ctx.addIssue({ code: "custom", path: [index, "fundId"], message: "This fund is already listed." });
        }
        seen.add(fund.fundId);
      });
    }),
});
export type CreateCompanyValues = z.output<typeof createCompanySchema>;

export const updateCompanyProfileSchema = companyProfileSchema.extend({ companyId: idSchema() });

export const fundInvestmentSchema = fundMappingSchema.extend({
  companyId: idSchema(),
  /** Omitted for a new mapping. */
  id: optionalIdSchema(),
});

export const companyItemSchema = z.object({ companyId: idSchema(), id: idSchema() });

// ---------------------------------------------------------------------------------------------
// Reporting, status, deletion
// ---------------------------------------------------------------------------------------------

export const reportingStartSchema = z.object({ companyId: idSchema(), month: startMonthSchema });

export const companyStatusSchema = z
  .object({
    companyId: idSchema(),
    status: z.enum(COMPANY_STATUSES, { error: "Choose a status." }),
    reason: optionalText(LIMITS.reason, "The reason"),
  })
  .superRefine((values, ctx) => {
    if (values.status !== "active" && !values.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason, for example the sale or the write-off decision." });
    }
  });

export const deleteCompanySchema = z.object({
  companyId: idSchema(),
  reason: requiredText(LIMITS.reason, "Give a reason for deleting this company.", "The reason"),
  confirmName: z.string({ error: "Type the company name to confirm." }).trim().min(1, "Type the company name to confirm."),
});

// ---------------------------------------------------------------------------------------------
// Revenue lines, KPI dimensions and members, KPIs (A4)
// ---------------------------------------------------------------------------------------------

export const configNameSchema = requiredText(LIMITS.configName, "Enter a name.", "The name");

export const addCompanyItemSchema = z.object({ companyId: idSchema(), name: configNameSchema });
export const renameItemSchema = z.object({ companyId: idSchema(), id: idSchema(), name: configNameSchema });
export const moveItemSchema = z.object({
  companyId: idSchema(),
  id: idSchema(),
  direction: z.enum(["up", "down"]),
});
export const setItemActiveSchema = z.object({ companyId: idSchema(), id: idSchema(), active: z.boolean() });
export const addMemberSchema = z.object({
  companyId: idSchema(),
  dimensionId: idSchema(),
  name: configNameSchema,
});

export const kpiSchema = z.object({
  companyId: idSchema(),
  /** Omitted for a new KPI. */
  id: optionalIdSchema(),
  name: configNameSchema,
  description: optionalText(LIMITS.kpiDescription, "The description"),
  unit: optionalText(LIMITS.unit, "The unit"),
  valueType: z.enum(KPI_VALUE_TYPES, { error: "Choose a value type." }),
  frequency: z.enum(KPI_FREQUENCIES, { error: "Choose how often it is reported." }),
  dimensionId: optionalIdSchema("Choose a dimension from the list."),
  isRequired: z.boolean(),
  isActive: z.boolean(),
});
export type KpiValues = z.output<typeof kpiSchema>;

// ---------------------------------------------------------------------------------------------
// ScaleUp-internal fields (BRD §6.3)
// ---------------------------------------------------------------------------------------------

export const assignPartnerSchema = z.object({
  companyId: idSchema(),
  partnerId: optionalIdSchema("Choose a partner from the list."),
});

export const internalFieldsSchema = z.object({
  companyId: idSchema(),
  internalRating: z
    .enum(INTERNAL_RATINGS, { error: "Choose a rating." })
    .nullish()
    .transform((value) => value ?? null),
  exitStrategyStatus: optionalText(LIMITS.exitStrategyStatus, "The exit strategy status"),
  exitStrategyNotes: optionalText(LIMITS.internalNotes, "The exit strategy notes"),
  notes: optionalText(LIMITS.internalNotes, "The notes"),
});
