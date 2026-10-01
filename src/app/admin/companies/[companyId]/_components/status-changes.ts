// The portfolio status changes a Super Admin is offered on the company page (BRD A1, B15, B21). Pure and
// client-safe (status-card.tsx); unit-tested in tests/features/m1/status-changes.test.ts.
import type { CompanyStatus } from "@/lib/types/enums";

export type StatusChange = {
  status: CompanyStatus;
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
};

const BECOMES_READ_ONLY =
  "The company becomes read-only: its users can no longer enter or submit data and no new months are opened. Its history is kept, and ScaleUp can still approve months already submitted.";
const STAYS_READ_ONLY =
  "The company stays read-only and no months are opened. The reason you give replaces the current one; its history is kept.";

/**
 * The changes offered from `status`, in button order. Exited and written-off companies switch between
 * each other directly: going through active would open every month the company missed, for good.
 * Every change to exited or written off needs a reason (companyStatusSchema); back to active does not.
 */
export function statusChangesFor(companyName: string, status: CompanyStatus): StatusChange[] {
  const fromActive = status === "active";
  const toExited: StatusChange = {
    status: "exited",
    title: fromActive ? `Mark ${companyName} as exited?` : `Mark ${companyName} as exited instead?`,
    description: fromActive ? BECOMES_READ_ONLY : STAYS_READ_ONLY,
    confirmLabel: "Mark as exited",
    destructive: false,
  };
  const toWrittenOff: StatusChange = {
    status: "written_off",
    title: fromActive ? `Mark ${companyName} as written off?` : `Mark ${companyName} as written off instead?`,
    description: fromActive ? BECOMES_READ_ONLY : STAYS_READ_ONLY,
    confirmLabel: "Mark as written off",
    destructive: true,
  };
  const toActive: StatusChange = {
    status: "active",
    title: `Return ${companyName} to active?`,
    description:
      "Its users can enter and submit data again. If it has a reporting start month, every month it missed while it was not active opens straight away and has to be reported.",
    confirmLabel: "Return to active",
    destructive: false,
  };
  switch (status) {
    case "active":
      return [toExited, toWrittenOff];
    case "exited":
      return [toActive, toWrittenOff];
    case "written_off":
      return [toActive, toExited];
  }
}

/** Whether a change to `status` needs a reason (the server checks it too). */
export function statusChangeNeedsReason(status: CompanyStatus): boolean {
  return status !== "active";
}
