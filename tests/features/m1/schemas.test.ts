import { describe, expect, it } from "vitest";

import {
  companyStatusSchema,
  createCompanySchema,
  deleteCompanySchema,
  fundInvestmentSchema,
  internalFieldsSchema,
  kpiSchema,
  normaliseWebsite,
  optionalIdSchema,
  parseOwnershipPct,
  reportingStartSchema,
  storedProfileValue,
  updateCompanyProfileSchema,
} from "@/app/admin/companies/_components/schemas";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const SV1 = "a0000000-0000-4000-8000-000000000001";
const SFF = "a0000000-0000-4000-8000-000000000002";

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.map(String).join("."), issue.message]));
}

describe("normaliseWebsite", () => {
  it("adds https:// when the scheme is missing and keeps what was typed", () => {
    expect(normaliseWebsite("batikboutique.com")).toBe("https://batikboutique.com");
    expect(normaliseWebsite(" http://www.example.my/about ")).toBe("http://www.example.my/about");
  });

  it("treats blank as no website", () => {
    expect(normaliseWebsite("")).toBeNull();
    expect(normaliseWebsite("   ")).toBeNull();
    expect(normaliseWebsite(null)).toBeNull();
  });

  it("rejects what is not a usable web address", () => {
    expect(normaliseWebsite("not a website")).toBeUndefined();
    expect(normaliseWebsite("localhost")).toBeUndefined();
    expect(normaliseWebsite("ftp://example.com")).toBeUndefined();
    expect(normaliseWebsite("https://user:secret@example.com")).toBeUndefined();
  });
});

describe("storedProfileValue (the profile form's unsaved-changes check)", () => {
  it("compares websites as stored, so a missing scheme is not a change", () => {
    expect(storedProfileValue("website", "batikboutique.com")).toBe(storedProfileValue("website", "https://batikboutique.com"));
    expect(storedProfileValue("website", "http://batikboutique.com")).not.toBe(
      storedProfileValue("website", "https://batikboutique.com"),
    );
    expect(storedProfileValue("website", "   ")).toBe("");
    // Not a web address: kept as typed (trimmed), so the form still counts it as a change and validates it.
    expect(storedProfileValue("website", " not a website ")).toBe("not a website");
  });

  it("upper-cases the currency and trims everything else", () => {
    expect(storedProfileValue("reportingCurrency", " myr ")).toBe("MYR");
    expect(storedProfileValue("name", "  Batik Boutique ")).toBe("Batik Boutique");
    expect(storedProfileValue("description", "Handmade batik.\n")).toBe("Handmade batik.");
  });

  it("matches what updateCompanyProfileSchema stores", () => {
    const parsed = updateCompanyProfileSchema.parse({
      companyId: COMPANY,
      name: " Batik Boutique ",
      website: "batikboutique.com",
      reportingCurrency: "myr",
    });
    expect(parsed.website).toBe(storedProfileValue("website", "batikboutique.com"));
    expect(parsed.reportingCurrency).toBe(storedProfileValue("reportingCurrency", "myr"));
    expect(parsed.name).toBe(storedProfileValue("name", " Batik Boutique "));
  });
});

describe("parseOwnershipPct", () => {
  it("accepts numbers and percentages, rounded to 4 decimals", () => {
    expect(parseOwnershipPct("12.5")).toBe(12.5);
    expect(parseOwnershipPct("12.5 %")).toBe(12.5);
    expect(parseOwnershipPct(7.123456)).toBe(7.1235);
    expect(parseOwnershipPct("0")).toBe(0);
  });

  it("returns null for blank and undefined for invalid input", () => {
    expect(parseOwnershipPct("")).toBeNull();
    expect(parseOwnershipPct(undefined)).toBeNull();
    expect(parseOwnershipPct("twelve")).toBeUndefined();
    expect(parseOwnershipPct("1e3")).toBeUndefined();
  });
});

describe("createCompanySchema", () => {
  const base = {
    name: "  New Co  ",
    legalName: "",
    registrationNo: "",
    sector: " Fintech ",
    country: "Malaysia",
    website: "newco.my",
    description: "",
    reportingCurrency: " usd ",
    reportingStartMonth: "",
    partnerId: "",
    funds: [],
  };

  it("trims, normalises and turns blanks into null", () => {
    const result = createCompanySchema.parse(base);
    expect(result).toEqual({
      name: "New Co",
      legalName: null,
      registrationNo: null,
      sector: "Fintech",
      country: "Malaysia",
      website: "https://newco.my",
      description: null,
      reportingCurrency: "USD",
      reportingStartMonth: null,
      partnerId: null,
      funds: [],
    });
  });

  it("reads the start month and lower-cases ids", () => {
    const result = createCompanySchema.parse({
      ...base,
      reportingStartMonth: "2026-07",
      partnerId: SV1.toUpperCase(),
      funds: [{ fundId: SV1, investmentDate: "2024-03-15", instrument: "RCPS", ownershipPct: "12.5%", notes: "" }],
    });
    expect(result.reportingStartMonth).toBe("2026-07");
    expect(result.partnerId).toBe(SV1);
    expect(result.funds).toEqual([
      { fundId: SV1, investmentDate: "2024-03-15", instrument: "RCPS", ownershipPct: 12.5, notes: null },
    ]);
  });

  it("defaults the funds to none", () => {
    const withoutFunds: Record<string, unknown> = { ...base };
    delete withoutFunds.funds;
    expect(createCompanySchema.parse(withoutFunds).funds).toEqual([]);
  });

  it("explains each invalid field", () => {
    const result = createCompanySchema.safeParse({
      ...base,
      name: "   ",
      website: "not a site",
      reportingCurrency: "RM",
      reportingStartMonth: "July",
      partnerId: "someone",
      funds: [
        { fundId: SV1, ownershipPct: "150" },
        { fundId: SFF, investmentDate: "2026-02-30" },
        { fundId: SV1 },
        { fundId: "" },
      ],
    });
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual({
      name: "Enter the company name.",
      website: "Enter a web address, for example https://example.com.",
      reportingCurrency: "Use a three-letter currency code, for example MYR, SGD or USD.",
      reportingStartMonth: "Choose a valid month.",
      partnerId: "Choose a partner from the list.",
      "funds.0.ownershipPct": "Ownership must be between 0% and 100%.",
      "funds.1.investmentDate": "Enter a valid date.",
      "funds.3.fundId": "Choose a fund.",
    });
  });

  it("refuses the same fund twice", () => {
    const result = createCompanySchema.safeParse({ ...base, funds: [{ fundId: SV1 }, { fundId: SV1.toUpperCase() }] });
    expect(issues(result)).toEqual({ "funds.1.fundId": "This fund is already listed." });
  });

  it("limits the length of texts", () => {
    const result = createCompanySchema.safeParse({ ...base, name: "x".repeat(201) });
    expect(issues(result)).toEqual({ name: "The name can be at most 200 characters." });
  });
});

describe("other company schemas", () => {
  it("updateCompanyProfileSchema needs the company id", () => {
    const result = updateCompanyProfileSchema.safeParse({ name: "X", reportingCurrency: "MYR", companyId: "nope" });
    expect(issues(result)).toEqual({ companyId: "This item was not found. Please reload the page and try again." });
  });

  it("reportingStartSchema accepts a month or nothing", () => {
    expect(reportingStartSchema.parse({ companyId: COMPANY, month: "2026-09-01" }).month).toBe("2026-09");
    expect(reportingStartSchema.parse({ companyId: COMPANY, month: null }).month).toBeNull();
    expect(reportingStartSchema.parse({ companyId: COMPANY, month: "" }).month).toBeNull();
  });

  it("companyStatusSchema needs a reason to exit or write off, not to reactivate", () => {
    expect(issues(companyStatusSchema.safeParse({ companyId: COMPANY, status: "exited", reason: "  " }))).toEqual({
      reason: "Give a reason, for example the sale or the write-off decision.",
    });
    expect(companyStatusSchema.parse({ companyId: COMPANY, status: "written_off", reason: " Impaired " }).reason).toBe(
      "Impaired",
    );
    expect(companyStatusSchema.parse({ companyId: COMPANY, status: "active" }).reason).toBeNull();
    expect(companyStatusSchema.safeParse({ companyId: COMPANY, status: "closed", reason: "x" }).success).toBe(false);
  });

  it("deleteCompanySchema needs a reason and the typed name", () => {
    expect(issues(deleteCompanySchema.safeParse({ companyId: COMPANY, reason: "", confirmName: "" }))).toEqual({
      reason: "Give a reason for deleting this company.",
      confirmName: "Type the company name to confirm.",
    });
    expect(deleteCompanySchema.parse({ companyId: COMPANY, reason: "Duplicate", confirmName: " Batik " }).confirmName).toBe(
      "Batik",
    );
  });

  it("fundInvestmentSchema treats a missing id as a new mapping", () => {
    const result = fundInvestmentSchema.parse({ companyId: COMPANY, fundId: SFF, ownershipPct: 3 });
    expect(result).toMatchObject({ id: null, fundId: SFF, ownershipPct: 3, investmentDate: null, instrument: null });
  });

  it("kpiSchema validates enums and the optional dimension", () => {
    const kpi = kpiSchema.parse({
      companyId: COMPANY,
      name: " Active carers ",
      description: "",
      unit: "carers",
      valueType: "integer",
      frequency: "monthly",
      dimensionId: "",
      isRequired: true,
      isActive: true,
    });
    expect(kpi).toMatchObject({ id: null, name: "Active carers", description: null, dimensionId: null });
    const bad = kpiSchema.safeParse({ ...kpi, valueType: "money", frequency: "weekly", dimensionId: "x" });
    expect(Object.keys(issues(bad)).sort()).toEqual(["dimensionId", "frequency", "valueType"]);
  });

  it("internalFieldsSchema allows clearing the rating", () => {
    expect(internalFieldsSchema.parse({ companyId: COMPANY, internalRating: null }).internalRating).toBeNull();
    expect(internalFieldsSchema.parse({ companyId: COMPANY, internalRating: "watch", notes: " x " })).toMatchObject({
      internalRating: "watch",
      notes: "x",
      exitStrategyNotes: null,
    });
    expect(internalFieldsSchema.safeParse({ companyId: COMPANY, internalRating: "great" }).success).toBe(false);
  });

  it("optionalIdSchema lower-cases and rejects non-UUIDs", () => {
    expect(optionalIdSchema().parse(SV1.toUpperCase())).toBe(SV1);
    expect(optionalIdSchema().parse("")).toBeNull();
    expect(optionalIdSchema().safeParse("123").success).toBe(false);
  });
});
