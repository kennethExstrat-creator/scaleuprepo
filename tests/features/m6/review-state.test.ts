import { describe, expect, it } from "vitest";

import {
  approverNote,
  approverState,
  extensionChoices,
  extensionDateError,
  extensionSummary,
  reviewActions,
  reviewStatusSummary,
  sendBackDueDate,
  type ApproverState,
  type ReviewPermissions,
} from "@/components/review/review-state";
import {
  canApprove,
  canEnterData,
  canExtendDueDate,
  canReopen,
  canRequestChanges,
  type PartnerAssignment,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import type { CompanyStatus, ScaleupRole } from "@/lib/types/enums";

import { IDS } from "./fixtures";

const ALL: ReviewPermissions = {
  canRequestChanges: true,
  canApprove: true,
  canReopen: true,
  canExtendDueDate: true,
  canEditOnBehalf: true,
};
const NONE: ReviewPermissions = {
  canRequestChanges: false,
  canApprove: false,
  canReopen: false,
  canExtendDueDate: false,
  canEditOnBehalf: false,
};

const RENUKA: ApproverState = { kind: "partner", name: "Renuka Sena" };
const NOBODY: ApproverState = { kind: "none" };

const keys = (status: Parameters<typeof reviewActions>[0], permissions: ReviewPermissions) =>
  reviewActions(status, permissions, RENUKA).map((a) => `${a.action}${a.enabled ? "" : " (disabled)"}`);

describe("reviewActions", () => {
  it("offers the actions that fit the month's status", () => {
    expect(keys("submitted", ALL)).toEqual(["approve", "request_changes", "extend"]);
    expect(keys("approved", ALL)).toEqual(["reopen"]);
    expect(keys("draft", ALL)).toEqual(["extend", "edit_on_behalf"]);
    expect(keys("changes_requested", ALL)).toEqual(["extend", "edit_on_behalf"]);
  });

  it("shows Approve disabled with who can approve, and hides what the caller cannot do", () => {
    expect(keys("submitted", NONE)).toEqual(["approve (disabled)"]);
    const [approve] = reviewActions("submitted", NONE, RENUKA);
    expect(approve.reason).toBe("Only Renuka Sena (partner-in-charge) or a Super Admin can approve this update.");
    expect(reviewActions("submitted", NONE, NOBODY)[0].reason).toBe(
      "No partner-in-charge is assigned, so only a Super Admin can approve this update.",
    );
    expect(reviewActions("submitted", NONE, { kind: "inactive", name: "Renuka Sena" })[0].reason).toBe(
      "Renuka Sena, the partner-in-charge, is no longer active, so only a Super Admin can approve this update.",
    );
    expect(keys("approved", NONE)).toEqual([]);
    expect(keys("draft", NONE)).toEqual([]);
  });

  // The page feeds the permission helpers in; check the combinations per role and company state.
  function permissionsFor(role: ScaleupRole, userId: string, internal: PartnerAssignment, status: CompanyStatus): ReviewPermissions {
    const ctx: PermissionSubject = { userId, scaleupRole: role, memberships: [] };
    return {
      canRequestChanges: canRequestChanges(ctx, status),
      canApprove: canApprove(ctx, internal),
      canReopen: canReopen(ctx, internal, status),
      canExtendDueDate: canExtendDueDate(ctx, status),
      canEditOnBehalf: canEnterData(ctx, IDS.company, status),
    };
  }
  const internal: PartnerAssignment = { partner_in_charge_id: IDS.partner };

  it("matches the permission matrix for each ScaleUp role (BRD B9)", () => {
    expect(keys("submitted", permissionsFor("super_admin", "sa", internal, "active"))).toEqual(["approve", "request_changes", "extend"]);
    expect(keys("submitted", permissionsFor("partner", IDS.partner, internal, "active"))).toEqual(["approve", "request_changes"]);
    expect(keys("submitted", permissionsFor("partner", "other-partner", internal, "active"))).toEqual(["approve (disabled)", "request_changes"]);
    expect(keys("submitted", permissionsFor("fund_admin", IDS.fundAdmin, internal, "active"))).toEqual([
      "approve (disabled)",
      "request_changes",
      "extend",
    ]);
    expect(keys("submitted", permissionsFor("viewer", "viewer", internal, "active"))).toEqual(["approve (disabled)"]);
    expect(keys("approved", permissionsFor("fund_admin", IDS.fundAdmin, internal, "active"))).toEqual(["reopen"]);
    expect(keys("approved", permissionsFor("partner", "other-partner", internal, "active"))).toEqual([]);
    expect(keys("draft", permissionsFor("fund_admin", IDS.fundAdmin, internal, "active"))).toEqual(["extend", "edit_on_behalf"]);
    expect(keys("draft", permissionsFor("super_admin", "sa", internal, "active"))).toEqual(["extend"]);
  });

  it("lets ScaleUp approve but not send back months of exited companies (BRD B21)", () => {
    expect(keys("submitted", permissionsFor("super_admin", "sa", internal, "exited"))).toEqual(["approve"]);
    expect(keys("submitted", permissionsFor("partner", IDS.partner, internal, "written_off"))).toEqual(["approve"]);
    expect(keys("approved", permissionsFor("super_admin", "sa", internal, "exited"))).toEqual([]);
    expect(keys("draft", permissionsFor("fund_admin", IDS.fundAdmin, internal, "exited"))).toEqual([]);
  });
});

describe("approverState, approverNote and reviewStatusSummary", () => {
  const partner = { full_name: " Renuka Sena ", email: "renuka@scaleup.test", is_active: true, scaleup_role: "partner" };

  it("approves through the partner-in-charge only while they are an active Partner", () => {
    expect(approverState(partner)).toEqual({ kind: "partner", name: "Renuka Sena" });
    expect(approverState({ ...partner, full_name: null })).toEqual({ kind: "partner", name: "renuka@scaleup.test" });
    expect(approverState({ ...partner, is_active: false })).toEqual({ kind: "inactive", name: "Renuka Sena" });
    // Deactivated takes precedence over the role.
    expect(approverState({ ...partner, is_active: false, scaleup_role: "fund_admin" })).toEqual({ kind: "inactive", name: "Renuka Sena" });
    expect(approverState({ ...partner, scaleup_role: "fund_admin" })).toEqual({ kind: "not_partner", name: "Renuka Sena" });
    expect(approverState({ ...partner, scaleup_role: null })).toEqual({ kind: "not_partner", name: "Renuka Sena" });
    expect(approverState(null)).toEqual({ kind: "none" });
  });

  it("explains who approves, also when the assigned partner-in-charge cannot (BRD B9)", () => {
    expect(approverNote(RENUKA)).toBe("Only Renuka Sena (partner-in-charge) or a Super Admin can approve this update.");
    expect(approverNote(NOBODY)).toBe("No partner-in-charge is assigned, so only a Super Admin can approve this update.");
    // Assigned but unable to approve: named, and never "No partner-in-charge is assigned".
    expect(approverNote(approverState({ ...partner, is_active: false }))).toBe(
      "Renuka Sena, the partner-in-charge, is no longer active, so only a Super Admin can approve this update.",
    );
    expect(approverNote(approverState({ ...partner, scaleup_role: "fund_admin" }))).toBe(
      "Renuka Sena, the partner-in-charge, is not a Partner, so only a Super Admin can approve this update.",
    );
  });

  it("summarises where the month stands", () => {
    const info = { companyName: "Batik Boutique", monthLabel: "September 2026", companyActive: true };
    expect(reviewStatusSummary("draft", info)).toEqual({
      title: "Not submitted yet",
      description: "Batik Boutique has not submitted September 2026 yet.",
    });
    expect(reviewStatusSummary("submitted", info).title).toBe("Awaiting review");
    expect(reviewStatusSummary("submitted", { ...info, companyActive: false }).description).toContain("not sent back");
    expect(reviewStatusSummary("changes_requested", info).description).toBe(
      "Waiting for Batik Boutique to correct and resubmit September 2026.",
    );
    expect(reviewStatusSummary("approved", info).title).toBe("Approved and locked");
    expect(reviewStatusSummary("approved", { ...info, companyActive: false }).description).toContain("cannot be reopened");
  });
});

describe("sendBackDueDate", () => {
  it("gives at least the grace period from today (BRD B19)", () => {
    expect(sendBackDueDate("2026-10-15", "2026-09-30", 14)).toBe("2026-10-15");
    expect(sendBackDueDate("2026-10-15", "2026-10-10", 14)).toBe("2026-10-24");
    expect(sendBackDueDate("2026-12-20", "2026-12-25", 14)).toBe("2027-01-08");
    expect(sendBackDueDate("2026-10-15", "2026-10-01", 14)).toBe("2026-10-15");
    expect(sendBackDueDate("2026-10-15", "2026-10-02", 14)).toBe("2026-10-16");
  });
});

describe("extending a deadline", () => {
  const TODAY = "2026-10-01";

  it("counts from the current due date while it is still ahead", () => {
    expect(extensionChoices("2026-10-15", TODAY)).toEqual({
      earliest: "2026-10-16",
      latest: "2027-10-15",
      pastDue: false,
      quick: [
        { days: 7, date: "2026-10-22", label: "+7 days" },
        { days: 14, date: "2026-10-29", label: "+14 days" },
        { days: 30, date: "2026-11-14", label: "+30 days" },
      ],
    });
    // Due today: not past due yet, so the earliest new date is tomorrow.
    expect(extensionChoices(TODAY, TODAY)).toMatchObject({ earliest: "2026-10-02", pastDue: false });
    expect(extensionChoices(TODAY, TODAY).quick[0]).toEqual({ days: 7, date: "2026-10-08", label: "+7 days" });
  });

  it("starts at today once the due date has passed, so an overdue month is never moved to a past date", () => {
    // August, due 15 Sep and overdue on 1 Oct: "+7 days" from the old date (22 Sep) would still be overdue.
    const choices = extensionChoices("2026-09-15", TODAY);
    expect(choices).toEqual({
      earliest: TODAY,
      latest: "2027-10-01",
      pastDue: true,
      quick: [
        { days: 7, date: "2026-10-08", label: "In 7 days" },
        { days: 14, date: "2026-10-15", label: "In 14 days" },
        { days: 30, date: "2026-10-31", label: "In 30 days" },
      ],
    });
    expect(choices.quick.every((choice) => choice.date > TODAY)).toBe(true);
    // Due yesterday.
    expect(extensionChoices("2026-09-30", TODAY)).toMatchObject({ earliest: TODAY, pastDue: true });
  });

  it("refuses dates that are not after the current due date or are in the past", () => {
    expect(extensionDateError("2026-10-15", "2026-10-15", TODAY)).toBe(
      "The new due date must be after the current due date (15 Oct 2026).",
    );
    expect(extensionDateError("2026-10-10", "2026-10-15", TODAY)).toBe(
      "The new due date must be after the current due date (15 Oct 2026).",
    );
    expect(extensionDateError("2026-10-16", "2026-10-15", TODAY)).toBeNull();
    expect(extensionDateError("2026-09-22", "2026-09-15", TODAY)).toBe(
      "The new due date cannot be in the past. Choose today (1 Oct 2026) or a later date.",
    );
    expect(extensionDateError("2026-09-30", "2026-09-15", TODAY)).not.toBeNull();
    expect(extensionDateError(TODAY, "2026-09-15", TODAY)).toBeNull();
    expect(extensionDateError("2026-10-08", "2026-09-15", TODAY)).toBeNull();
    // At most a year ahead (the same typo guard as /admin/cycles).
    expect(extensionDateError("2027-10-15", "2026-10-15", TODAY)).toBeNull();
    expect(extensionDateError("2027-10-16", "2026-10-15", TODAY)).toBe("Choose a date up to 15 Oct 2027.");
    expect(extensionDateError("2027-10-02", "2026-09-15", TODAY)).toBe("Choose a date up to 1 Oct 2027.");
  });

  it("describes how far the new date moves the deadline", () => {
    expect(extensionSummary("2026-10-29", "2026-10-15", TODAY)).toBe("14 days later than the current due date.");
    expect(extensionSummary("2026-10-16", "2026-10-15", TODAY)).toBe("1 day later than the current due date.");
    // Past due: from today.
    expect(extensionSummary(TODAY, "2026-09-15", TODAY)).toBe("Due today.");
    expect(extensionSummary("2026-10-02", "2026-09-15", TODAY)).toBe("Due tomorrow.");
    expect(extensionSummary("2026-10-08", "2026-09-15", TODAY)).toBe("Due in 7 days.");
  });
});
