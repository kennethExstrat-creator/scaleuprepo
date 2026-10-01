import { describe, expect, it } from "vitest";

import {
  emailSchema,
  inviteCompanyUserSchema,
  inviteContributorSchema,
  inviteScaleUpUserSchema,
  issueUserLinkSchema,
  teamLinkSchema,
  teamMemberActiveSchema,
  teamMemberLinkSchema,
  updateMembershipSchema,
  updateScaleUpUserSchema,
} from "@/lib/auth-admin/schemas";
import { toActionError } from "@/lib/actions/result";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const USER = "11111111-1111-4111-8111-111111111111";

function fieldErrors(run: () => unknown): Record<string, string> | undefined {
  try {
    run();
  } catch (e) {
    const result = toActionError(e);
    return result.ok ? undefined : result.fieldErrors;
  }
  return undefined;
}

describe("email addresses", () => {
  it("are trimmed and lower-cased like Supabase Auth stores them", () => {
    expect(emailSchema.parse("  Ana.Tan@ScaleUp.MY ")).toBe("ana.tan@scaleup.my");
    expect(emailSchema.parse("first_last+tag@batik-boutique.com.my")).toBe("first_last+tag@batik-boutique.com.my");
  });

  it("refuse blanks and malformed addresses with friendly messages", () => {
    expect(emailSchema.safeParse("").error?.issues[0]?.message).toBe("Enter their email address.");
    expect(emailSchema.safeParse("   ").error?.issues[0]?.message).toBe("Enter their email address.");
    expect(emailSchema.safeParse("ana@").error?.issues[0]?.message).toBe("Enter a valid email address, e.g. name@company.com.");
    expect(emailSchema.safeParse(`${"a".repeat(250)}@x.my`).success).toBe(false);
    expect(emailSchema.safeParse(42).success).toBe(false);
  });
});

describe("invitations", () => {
  it("ScaleUp: name, email, optional job title (blank clears), role", () => {
    expect(
      inviteScaleUpUserSchema.parse({ email: "Ana@ScaleUp.my", fullName: " Ana Tan ", role: "fund_admin" }),
    ).toEqual({ email: "ana@scaleup.my", fullName: "Ana Tan", jobTitle: "", role: "fund_admin" });
    expect(
      inviteScaleUpUserSchema.parse({ email: "ana@scaleup.my", fullName: "Ana", jobTitle: " Analyst ", role: "viewer" }).jobTitle,
    ).toBe("Analyst");
    expect(fieldErrors(() => inviteScaleUpUserSchema.parse({ email: "x", fullName: "", role: "owner" }))).toEqual({
      email: "Enter a valid email address, e.g. name@company.com.",
      fullName: "Enter their full name.",
      role: "Choose a role.",
    });
  });

  it("company user: company, owner or contributor, name, email", () => {
    expect(inviteCompanyUserSchema.parse({ companyId: COMPANY, role: "owner", email: "ceo@batik.my", fullName: "Siti" })).toEqual({
      companyId: COMPANY,
      role: "owner",
      email: "ceo@batik.my",
      fullName: "Siti",
    });
    expect(
      fieldErrors(() => inviteCompanyUserSchema.parse({ companyId: "nope", role: "viewer", email: "ceo@batik.my", fullName: "Siti" })),
    ).toEqual({ companyId: "Choose a valid company.", role: "Choose a company role." });
  });

  it("contributor (owners): company, name, email — never a role", () => {
    const parsed = inviteContributorSchema.parse({ companyId: COMPANY, email: "cfo@batik.my", fullName: "Lee", role: "owner" });
    expect(parsed).toEqual({ companyId: COMPANY, email: "cfo@batik.my", fullName: "Lee" });
  });

  it("names are limited to 200 characters", () => {
    expect(inviteContributorSchema.safeParse({ companyId: COMPANY, email: "a@b.my", fullName: "x".repeat(201) }).success).toBe(false);
  });
});

describe("account and membership changes", () => {
  it("edits need a valid user id and role", () => {
    expect(updateScaleUpUserSchema.parse({ userId: USER, fullName: "Ana", role: "partner" })).toEqual({
      userId: USER,
      fullName: "Ana",
      jobTitle: "",
      role: "partner",
    });
    expect(updateScaleUpUserSchema.safeParse({ userId: "1", fullName: "Ana", role: "partner" }).success).toBe(false);
  });

  it("links are invitations or sign-in links", () => {
    expect(issueUserLinkSchema.parse({ userId: USER, purpose: "signin" })).toEqual({ userId: USER, purpose: "signin" });
    expect(issueUserLinkSchema.safeParse({ userId: USER, purpose: "recovery" }).success).toBe(false);
  });

  it("a membership change needs a role or an on/off switch", () => {
    expect(updateMembershipSchema.parse({ companyId: COMPANY, userId: USER, active: false })).toEqual({
      companyId: COMPANY,
      userId: USER,
      active: false,
    });
    expect(updateMembershipSchema.parse({ companyId: COMPANY, userId: USER, role: "contributor" }).role).toBe("contributor");
    expect(updateMembershipSchema.safeParse({ companyId: COMPANY, userId: USER }).success).toBe(false);
  });

  it("team actions are scoped to a company", () => {
    expect(teamMemberActiveSchema.parse({ companyId: COMPANY, userId: USER, active: true })).toEqual({
      companyId: COMPANY,
      userId: USER,
      active: true,
    });
    expect(teamLinkSchema.safeParse({ companyId: COMPANY, linkId: "x" }).success).toBe(false);
    expect(teamMemberActiveSchema.safeParse({ companyId: COMPANY, userId: USER, active: "yes" }).success).toBe(false);
  });

  it("owners only ask for invitation links (BRD B29); sign-in links come from ScaleUp (B23)", () => {
    expect(teamMemberLinkSchema.parse({ companyId: COMPANY, userId: USER })).toEqual({
      companyId: COMPANY,
      userId: USER,
      purpose: "invite",
    });
    expect(teamMemberLinkSchema.parse({ companyId: COMPANY, userId: USER, purpose: "invite" }).purpose).toBe("invite");
    expect(fieldErrors(() => teamMemberLinkSchema.parse({ companyId: COMPANY, userId: USER, purpose: "signin" }))).toEqual({
      purpose: "Only ScaleUp can send sign-in links.",
    });
  });
});
