"use client";

// The company profile fields shared by "Add company" and the Overview tab (Super Admin).

import { TextAreaField, TextField } from "./form-controls";
import { LIMITS } from "./schemas";
import { COUNTRY_SUGGESTIONS } from "./suggestions";

export type ProfileFieldValues = {
  name: string;
  legalName: string;
  registrationNo: string;
  sector: string;
  country: string;
  website: string;
  description: string;
};

export type ProfileField = keyof ProfileFieldValues;

export const PROFILE_FIELDS: ProfileField[] = [
  "name",
  "legalName",
  "registrationNo",
  "sector",
  "country",
  "website",
  "description",
];

/** The element id of a field, e.g. "company-legalName" or "company-funds-0-fundId" (for focusing errors). */
export function companyFieldId(field: string): string {
  return `company-${field.replace(/\./g, "-")}`;
}

export function CompanyProfileFields({
  values,
  onChange,
  errors,
  sectors,
  autoFocus = false,
}: {
  values: ProfileFieldValues;
  onChange: (field: ProfileField, value: string) => void;
  errors: Record<string, string>;
  /** Sectors already used by other companies. */
  sectors: readonly string[];
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TextField
        id={companyFieldId("name")}
        label="Company name"
        className="sm:col-span-2"
        value={values.name}
        onValueChange={(value) => onChange("name", value)}
        error={errors.name}
        description="The name used across the platform, e.g. in lists and exports. It must be unique."
        maxLength={LIMITS.name}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <TextField
        id={companyFieldId("legalName")}
        label="Legal name"
        optional
        value={values.legalName}
        onValueChange={(value) => onChange("legalName", value)}
        error={errors.legalName}
        maxLength={LIMITS.legalName}
        placeholder="e.g. Batik Boutique Sdn Bhd"
        autoComplete="off"
      />
      <TextField
        id={companyFieldId("registrationNo")}
        label="Registration number"
        optional
        value={values.registrationNo}
        onValueChange={(value) => onChange("registrationNo", value)}
        error={errors.registrationNo}
        maxLength={LIMITS.registrationNo}
        autoComplete="off"
      />
      <TextField
        id={companyFieldId("sector")}
        label="Sector"
        optional
        value={values.sector}
        onValueChange={(value) => onChange("sector", value)}
        error={errors.sector}
        maxLength={LIMITS.sector}
        list="company-sector-suggestions"
        autoComplete="off"
      />
      <datalist id="company-sector-suggestions">
        {sectors.map((sector) => (
          <option key={sector} value={sector} />
        ))}
      </datalist>
      <TextField
        id={companyFieldId("country")}
        label="Country"
        optional
        value={values.country}
        onValueChange={(value) => onChange("country", value)}
        error={errors.country}
        maxLength={LIMITS.country}
        list="company-country-suggestions"
        autoComplete="off"
      />
      <datalist id="company-country-suggestions">
        {COUNTRY_SUGGESTIONS.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
      <TextField
        id={companyFieldId("website")}
        label="Website"
        optional
        className="sm:col-span-2"
        type="url"
        inputMode="url"
        value={values.website}
        onValueChange={(value) => onChange("website", value)}
        error={errors.website}
        maxLength={LIMITS.website}
        placeholder="https://"
        autoComplete="off"
      />
      <TextAreaField
        id={companyFieldId("description")}
        label="Description"
        optional
        className="sm:col-span-2"
        value={values.description}
        onValueChange={(value) => onChange("description", value)}
        error={errors.description}
        maxLength={LIMITS.description}
        rows={3}
        description="A short summary of what the company does."
      />
    </div>
  );
}
