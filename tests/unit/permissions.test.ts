import { describe, expect, it } from "vitest";

import {
  canApprove,
  canAssignPartner,
  canComment,
  canEditInternal,
  canExtendDueDate,
  canManageCompanySegments,
  canManageCycles,
  canReopen,
  canReopenPeriodClose,
  canRequestChanges,
  type PartnerAssignment,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import type { CompanyStatus, ScaleupRole } from "@/lib/types/enums";

// The database side of every helper is checked by tests/db/permissions-parity.test.ts; these are the
// pure rules for the helpers that take a company's partner assignment (company_internal) or status.

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const PARTNER = "a1000000-0000-4000-8000-000000000005";

function scaleUp(role: ScaleupRole, userId = `user-${role}`): PermissionSubject {
  return { userId, scaleupRole: role, memberships: [] };
}

const owner: PermissionSubject = {
  userId: "owner",
  scaleupRole: null,
  memberships: [{ companyId: COMPANY, companyName: "Batik Boutique", companyStatus: "active", role: "owner" }],
};

const partnerInCharge = scaleUp("partner", PARTNER);
const otherPartner = scaleUp("partner");
const internal: PartnerAssignment = { partner_in_charge_id: PARTNER };

describe("partner-in-charge helpers take the company_internal row", () => {
  it("canApprove: Super Admin or the partner-in-charge", () => {
    expect(canApprove(scaleUp("super_admin"), internal)).toBe(true);
    expect(canApprove(partnerInCharge, internal)).toBe(true);
    expect(canApprove(otherPartner, internal)).toBe(false);
    expect(canApprove(scaleUp("fund_admin"), internal)).toBe(false);
    expect(canApprove(scaleUp("viewer"), internal)).toBe(false);
    expect(canApprove(owner, internal)).toBe(false);
    // No assignment (or a row the caller cannot see): Super Admins only.
    expect(canApprove(partnerInCharge, { partner_in_charge_id: null })).toBe(false);
    expect(canApprove(partnerInCharge, null)).toBe(false);
    expect(canApprove(scaleUp("super_admin"), null)).toBe(true);
    // Only a partner can be partner-in-charge.
    expect(canApprove(scaleUp("viewer", PARTNER), internal)).toBe(false);
  });

  it("canReopen: Super Admin, Fund Admin or the partner-in-charge, while the company is active", () => {
    for (const status of ["active", undefined] as const) {
      expect(canReopen(scaleUp("super_admin"), internal, status)).toBe(true);
      expect(canReopen(scaleUp("fund_admin"), null, status)).toBe(true);
      expect(canReopen(partnerInCharge, internal, status)).toBe(true);
      expect(canReopen(otherPartner, internal, status)).toBe(false);
      expect(canReopen(scaleUp("viewer"), internal, status)).toBe(false);
      expect(canReopen(owner, internal, status)).toBe(false);
    }
    for (const status of ["exited", "written_off"] as CompanyStatus[]) {
      for (const subject of [scaleUp("super_admin"), scaleUp("fund_admin"), partnerInCharge]) {
        expect(canReopen(subject, internal, status)).toBe(false);
      }
    }
  });

  it("canEditInternal: Super Admin, Fund Admin or the partner-in-charge; canAssignPartner: Super Admin only", () => {
    expect(canEditInternal(scaleUp("super_admin"), null)).toBe(true);
    expect(canEditInternal(scaleUp("fund_admin"), internal)).toBe(true);
    expect(canEditInternal(partnerInCharge, internal)).toBe(true);
    expect(canEditInternal(otherPartner, internal)).toBe(false);
    expect(canEditInternal(owner, internal)).toBe(false);
    expect(canAssignPartner(scaleUp("super_admin"))).toBe(true);
    for (const subject of [scaleUp("fund_admin"), partnerInCharge, scaleUp("viewer"), owner]) {
      expect(canAssignPartner(subject)).toBe(false);
    }
  });
});

describe("sending months back needs an active company (BRD B21)", () => {
  it("canRequestChanges: reviewers who can comment, active companies only", () => {
    for (const role of ["super_admin", "fund_admin", "partner"] as const) {
      expect(canRequestChanges(scaleUp(role))).toBe(true);
      expect(canRequestChanges(scaleUp(role), "active")).toBe(true);
      expect(canRequestChanges(scaleUp(role), "exited")).toBe(false);
      expect(canRequestChanges(scaleUp(role), "written_off")).toBe(false);
      // Comments stay open for the company's history.
      expect(canComment(scaleUp(role))).toBe(true);
    }
    expect(canRequestChanges(scaleUp("viewer"))).toBe(false);
    expect(canRequestChanges(owner, "active")).toBe(false);
  });

  it("canExtendDueDate: Super Admin and Fund Admin, active companies only (canManageCycles stays company-independent)", () => {
    for (const role of ["super_admin", "fund_admin"] as const) {
      expect(canExtendDueDate(scaleUp(role))).toBe(true);
      expect(canExtendDueDate(scaleUp(role), "active")).toBe(true);
      expect(canExtendDueDate(scaleUp(role), "exited")).toBe(false);
      expect(canExtendDueDate(scaleUp(role), "written_off")).toBe(false);
      expect(canManageCycles(scaleUp(role))).toBe(true);
    }
    for (const subject of [scaleUp("partner"), scaleUp("viewer"), owner]) {
      expect(canExtendDueDate(subject)).toBe(false);
      expect(canManageCycles(subject)).toBe(false);
    }
  });

  it("canReopenPeriodClose: Super Admin and Fund Admin, active companies only (confirmed closes of exited companies stay confirmed)", () => {
    for (const role of ["super_admin", "fund_admin"] as const) {
      expect(canReopenPeriodClose(scaleUp(role))).toBe(true);
      expect(canReopenPeriodClose(scaleUp(role), "active")).toBe(true);
      expect(canReopenPeriodClose(scaleUp(role), "exited")).toBe(false);
      expect(canReopenPeriodClose(scaleUp(role), "written_off")).toBe(false);
    }
    for (const subject of [partnerInCharge, scaleUp("viewer"), owner]) {
      expect(canReopenPeriodClose(subject)).toBe(false);
      expect(canReopenPeriodClose(subject, "active")).toBe(false);
    }
  });
});

describe("company revenue segments (BRD B30)", () => {
  const contributor: PermissionSubject = {
    userId: "contributor",
    scaleupRole: null,
    memberships: [{ companyId: COMPANY, companyName: "Batik Boutique", companyStatus: "active", role: "contributor" }],
  };
  const exitedOwner: PermissionSubject = {
    userId: "owner",
    scaleupRole: null,
    memberships: [{ companyId: COMPANY, companyName: "Batik Boutique", companyStatus: "exited", role: "owner" }],
  };

  it("canManageCompanySegments: the owner of an active company, or Super Admin / Fund Admin on behalf", () => {
    expect(canManageCompanySegments(owner, COMPANY)).toBe(true);
    expect(canManageCompanySegments(owner, "c0000000-0000-4000-8000-000000000002")).toBe(false);
    expect(canManageCompanySegments(contributor, COMPANY)).toBe(false);
    expect(canManageCompanySegments(exitedOwner, COMPANY)).toBe(false);
    for (const status of ["active", undefined] as const) {
      expect(canManageCompanySegments(scaleUp("super_admin"), COMPANY, status)).toBe(true);
      expect(canManageCompanySegments(scaleUp("fund_admin"), COMPANY, status)).toBe(true);
      expect(canManageCompanySegments(scaleUp("partner"), COMPANY, status)).toBe(false);
      expect(canManageCompanySegments(scaleUp("viewer"), COMPANY, status)).toBe(false);
    }
    for (const status of ["exited", "written_off"] as CompanyStatus[]) {
      expect(canManageCompanySegments(scaleUp("super_admin"), COMPANY, status)).toBe(false);
      expect(canManageCompanySegments(scaleUp("fund_admin"), COMPANY, status)).toBe(false);
    }
  });
});
