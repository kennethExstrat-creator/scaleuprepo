import { describe, expect, it } from "vitest";

import {
  accountStatus,
  companyInviteConflict,
  displayName,
  listNames,
  nameWithEmail,
  scaleUpInviteConflict,
  teamMemberStatus,
} from "@/lib/auth-admin/status";

describe("accountStatus (Users page)", () => {
  it("deactivated wins, then signed in, then a pending invitation", () => {
    expect(accountStatus({ isActive: false, hasSignedIn: true, pendingInvite: true })).toMatchObject({
      key: "deactivated",
      label: "Deactivated",
      tone: "danger",
    });
    expect(accountStatus({ isActive: true, hasSignedIn: true, pendingInvite: true })).toMatchObject({
      key: "active",
      label: "Active",
      tone: "success",
    });
    expect(accountStatus({ isActive: true, hasSignedIn: false, pendingInvite: true })).toMatchObject({
      key: "invited",
      label: "Invited",
      tone: "info",
    });
    expect(accountStatus({ isActive: true, hasSignedIn: false, pendingInvite: false })).toMatchObject({
      key: "not_joined",
      label: "Not joined yet",
      tone: "warning",
    });
  });
});

describe("teamMemberStatus (Team page)", () => {
  const base = { membershipActive: true, accountActive: true, hasJoined: true, pendingInvite: false };
  it("a deactivated account, then a deactivated membership, then joined / invited / not joined", () => {
    expect(teamMemberStatus({ ...base, accountActive: false, membershipActive: false }).key).toBe("account_deactivated");
    expect(teamMemberStatus({ ...base, membershipActive: false })).toMatchObject({ key: "removed", label: "Deactivated" });
    expect(teamMemberStatus(base)).toMatchObject({ key: "active", tone: "success" });
    expect(teamMemberStatus({ ...base, hasJoined: false, pendingInvite: true })).toMatchObject({ key: "invited" });
    expect(teamMemberStatus({ ...base, hasJoined: false })).toMatchObject({ key: "not_joined", tone: "warning" });
  });

  it("never mentions ScaleUp staff by name (BRD B28)", () => {
    const account = teamMemberStatus({ ...base, accountActive: false });
    expect(account.description).toBe("ScaleUp has deactivated this account.");
  });
});

describe("one account is either ScaleUp staff or a company user", () => {
  it("refuses a ScaleUp invitation for a company user's email address", () => {
    expect(scaleUpInviteConflict(null)).toBeNull();
    expect(scaleUpInviteConflict({ scaleupRole: null, memberships: [] })).toBeNull();
    expect(scaleUpInviteConflict({ scaleupRole: "partner", memberships: [] })).toBeNull();
    expect(scaleUpInviteConflict({ scaleupRole: null, memberships: [{ companyName: "Batik Boutique" }] })).toBe(
      "This email address belongs to a company user (Batik Boutique). ScaleUp staff need their own account, so use a different email address.",
    );
  });

  it("refuses a company invitation for a ScaleUp staff member's email address", () => {
    expect(companyInviteConflict(null)).toBeNull();
    expect(companyInviteConflict({ scaleupRole: null, memberships: [{ companyName: "RECQA" }] })).toBeNull();
    expect(companyInviteConflict({ scaleupRole: "fund_admin", memberships: [] })).toBe(
      "This email address belongs to a ScaleUp user (Fund Admin). Company users need their own account, so use a different email address.",
    );
  });

  it("lists company names briefly", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C", "D"])).toBe("A, B and 2 more");
    expect(listNames(["A", "B", "C"], 3)).toBe("A, B and C");
  });
});

describe("names", () => {
  it("falls back to the email address", () => {
    expect(displayName("  Ana Tan ", "ana@scaleup.my")).toBe("Ana Tan");
    expect(displayName(null, "ana@scaleup.my")).toBe("ana@scaleup.my");
    expect(displayName("  ", "ana@scaleup.my")).toBe("ana@scaleup.my");
    expect(nameWithEmail("Ana Tan", "ana@scaleup.my")).toBe("Ana Tan (ana@scaleup.my)");
    expect(nameWithEmail(null, "ana@scaleup.my")).toBe("ana@scaleup.my");
    expect(nameWithEmail("ANA@scaleup.my", "ana@scaleup.my")).toBe("ana@scaleup.my");
  });
});
