// The portfolio status changes offered on the company page (status-changes.ts): exited and written-off
// companies switch between each other directly, without going through active (which would open every
// month they missed).
import { describe, expect, it } from "vitest";

import { statusChangeNeedsReason, statusChangesFor } from "@/app/admin/companies/[companyId]/_components/status-changes";
import { COMPANY_STATUSES } from "@/lib/types/enums";

describe("statusChangesFor", () => {
  it("offers exited and written off for an active company", () => {
    const changes = statusChangesFor("Batik Boutique", "active");
    expect(changes.map((change) => change.status)).toEqual(["exited", "written_off"]);
    expect(changes.map((change) => change.title)).toEqual([
      "Mark Batik Boutique as exited?",
      "Mark Batik Boutique as written off?",
    ]);
    for (const change of changes) expect(change.description).toContain("becomes read-only");
  });

  it("lets an exited company be written off directly, or return to active", () => {
    const changes = statusChangesFor("Batik Boutique", "exited");
    expect(changes.map((change) => change.status)).toEqual(["active", "written_off"]);
    const writeOff = changes[1];
    expect(writeOff).toMatchObject({
      title: "Mark Batik Boutique as written off instead?",
      confirmLabel: "Mark as written off",
      destructive: true,
    });
    expect(writeOff.description).toContain("stays read-only and no months are opened");
  });

  it("lets a written-off company be marked exited directly, or return to active", () => {
    const changes = statusChangesFor("StayHere", "written_off");
    expect(changes.map((change) => change.status)).toEqual(["active", "exited"]);
    expect(changes[1]).toMatchObject({
      title: "Mark StayHere as exited instead?",
      confirmLabel: "Mark as exited",
      destructive: false,
    });
    expect(changes[1].description).toContain("stays read-only");
  });

  it("warns that returning to active opens the missed months", () => {
    const [toActive] = statusChangesFor("StayHere", "written_off");
    expect(toActive).toMatchObject({ status: "active", title: "Return StayHere to active?", confirmLabel: "Return to active" });
    expect(toActive.description).toContain("every month it missed while it was not active opens straight away");
  });

  it("never offers the current status, and always offers the other two", () => {
    for (const status of COMPANY_STATUSES) {
      const offered = statusChangesFor("X", status).map((change) => change.status);
      expect(offered).not.toContain(status);
      expect([...offered].sort()).toEqual(COMPANY_STATUSES.filter((other) => other !== status).sort());
    }
  });
});

describe("statusChangeNeedsReason", () => {
  it("asks for a reason to exit or write off, not to return to active", () => {
    expect(statusChangeNeedsReason("exited")).toBe(true);
    expect(statusChangeNeedsReason("written_off")).toBe(true);
    expect(statusChangeNeedsReason("active")).toBe(false);
  });
});
