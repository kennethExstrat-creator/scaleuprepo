// Shapes shared by the company pages (server loaders → Client Components). Type-only and client-safe.
import type { ScaleupRole } from "@/lib/types/enums";

/** A fund as offered in pickers and filters. */
export type FundOption = { id: string; code: string; name: string; isActive: boolean };

/**
 * Someone who can be made partner-in-charge: a ScaleUp partner or Super Admin (BRD §6.3). Inactive people
 * are only listed when they are still assigned somewhere, so the current value can be shown.
 */
export type PartnerOption = {
  id: string;
  name: string;
  email: string;
  role: ScaleupRole;
  isActive: boolean;
};

/** A company's investment by one fund (BRD B2). */
export type CompanyInvestment = {
  id: string;
  fundId: string;
  fundCode: string;
  fundName: string;
  fundActive: boolean;
  /** 'YYYY-MM-DD' or null. */
  investmentDate: string | null;
  instrument: string | null;
  ownershipPct: number | null;
  notes: string | null;
};

/** The label of a partner-in-charge option, e.g. "Renuka Sena" or "Kenneth Siew (Super Admin)". */
export function partnerOptionLabel(option: Pick<PartnerOption, "name" | "role" | "isActive">): string {
  const role = option.role === "super_admin" ? " (Super Admin)" : "";
  const inactive = option.isActive ? "" : " (inactive)";
  return `${option.name}${role}${inactive}`;
}

/** The name shown for a person: full name, else email, else a placeholder. */
export function personName(profile: { full_name: string | null; email: string | null } | null | undefined): string {
  const name = profile?.full_name?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  return email || "Unknown person";
}
