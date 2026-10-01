import { describe, expect, it } from "vitest";

import {
  COMPANY_TABS,
  companyTabHref,
  companyTabLabel,
  parseCompanyTab,
} from "@/app/admin/companies/[companyId]/_components/tabs";
import { partnerOptionLabel, personName } from "@/app/admin/companies/_components/types";
import { fundSchema, normaliseFundCode, updateFundSchema } from "@/app/admin/funds/_components/fund-schema";

const COMPANY = "c0000000-0000-4000-8000-000000000001";

describe("company tabs", () => {
  it("has the seven tabs of the brief in order", () => {
    expect(COMPANY_TABS.map((tab) => tab.key)).toEqual([
      "overview",
      "funds",
      "revenue",
      "kpis",
      "team",
      "internal",
      "updates",
    ]);
  });

  it("parses ?tab= and falls back to the overview", () => {
    expect(parseCompanyTab("kpis")).toBe("kpis");
    expect(parseCompanyTab(" Updates ")).toBe("updates");
    expect(parseCompanyTab(["internal", "team"])).toBe("internal");
    expect(parseCompanyTab("settings")).toBe("overview");
    expect(parseCompanyTab(undefined)).toBe("overview");
  });

  it("builds links without ?tab= for the overview", () => {
    expect(companyTabHref(COMPANY, "overview")).toBe(`/admin/companies/${COMPANY}`);
    expect(companyTabHref(COMPANY, "funds")).toBe(`/admin/companies/${COMPANY}?tab=funds`);
    expect(companyTabLabel("revenue")).toBe("ScaleUp revenue lines");
  });
});

describe("people labels", () => {
  it("names people by full name, else email", () => {
    expect(personName({ full_name: "  Renuka Sena ", email: "renuka@example.com" })).toBe("Renuka Sena");
    expect(personName({ full_name: " ", email: "aaron@example.com" })).toBe("aaron@example.com");
    expect(personName(null)).toBe("Unknown person");
  });

  it("marks Super Admins and inactive people in the partner picker", () => {
    expect(partnerOptionLabel({ name: "Renuka Sena", role: "partner", isActive: true })).toBe("Renuka Sena");
    expect(partnerOptionLabel({ name: "Kenneth Siew", role: "super_admin", isActive: true })).toBe(
      "Kenneth Siew (Super Admin)",
    );
    expect(partnerOptionLabel({ name: "Tay Shan Li", role: "partner", isActive: false })).toBe("Tay Shan Li (inactive)");
  });
});

describe("fund schema", () => {
  it("upper-cases the code and removes spaces", () => {
    expect(normaliseFundCode(" sv 1 ")).toBe("SV1");
    expect(fundSchema.parse({ code: "sff", name: " ScaleUp Founders Fund LP ", isActive: true })).toEqual({
      code: "SFF",
      name: "ScaleUp Founders Fund LP",
      legalName: null,
      description: null,
      isActive: true,
    });
  });

  it("explains invalid codes and names", () => {
    const result = fundSchema.safeParse({ code: "SV_1!", name: "", isActive: true });
    expect(result.success).toBe(false);
    const messages = Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));
    expect(messages).toEqual({
      code: "Use letters, numbers and hyphens only, for example SV1.",
      name: "Enter the fund name.",
    });
    expect(fundSchema.safeParse({ code: "", name: "X", isActive: true }).error?.issues[0]?.message).toBe(
      "Enter a fund code, for example SV1.",
    );
    expect(fundSchema.safeParse({ code: "A".repeat(21), name: "X", isActive: false }).success).toBe(false);
  });

  it("needs the id to update a fund", () => {
    expect(updateFundSchema.safeParse({ code: "SV1", name: "X", isActive: true }).success).toBe(false);
    expect(updateFundSchema.parse({ id: COMPANY, code: "SV1", name: "X", isActive: true }).id).toBe(COMPANY);
  });
});
