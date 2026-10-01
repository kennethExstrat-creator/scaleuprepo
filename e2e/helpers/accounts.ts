/** The dedicated E2E accounts and test data names. Nothing here refers to real portfolio data. */

export type Role = "admin" | "partner" | "owner" | "contributor";

export type AccountSpec = {
  role: Role;
  email: string;
  fullName: string;
  /** profiles.scaleup_role (null = company-side account). */
  scaleupRole: "super_admin" | "partner" | null;
  /** company_members.role in the E2E company. */
  companyRole: "owner" | "contributor" | null;
};

export const ACCOUNTS: Record<Role, AccountSpec> = {
  admin: {
    role: "admin",
    email: "e2e.admin@example.com",
    fullName: "E2E Admin",
    scaleupRole: "super_admin",
    companyRole: null,
  },
  partner: {
    role: "partner",
    email: "e2e.partner@example.com",
    fullName: "E2E Partner",
    scaleupRole: "partner",
    companyRole: null,
  },
  owner: {
    role: "owner",
    email: "e2e.owner@example.com",
    fullName: "E2E Owner",
    scaleupRole: null,
    companyRole: "owner",
  },
  contributor: {
    role: "contributor",
    email: "e2e.contributor@example.com",
    fullName: "E2E Contributor",
    scaleupRole: null,
    companyRole: "contributor",
  },
};

export const ROLES: Role[] = ["admin", "partner", "owner", "contributor"];

/** Invited during flow 10 (created by the app's invite flow, banned in teardown). */
export const INVITEE = { email: "e2e.invitee@example.com", fullName: "E2E Invitee" } as const;

/** Every address the suite may create, reset, ban or delete. Anything else is off limits. */
export const E2E_EMAILS = new Set<string>([...ROLES.map((r) => ACCOUNTS[r].email), INVITEE.email]);

/** Never touched (asserted before any write). */
export const PROTECTED_EMAILS = new Set<string>(["kenneth@scaleup.my", "demo.owner@example.com"]);

export const E2E_COMPANY = {
  name: "E2E Test Co (automated)",
  reportingStartMonth: "2026-07-01",
  currency: "MYR",
  scaleupLineName: "ScaleUp line A",
  kpiName: "Customers",
} as const;

/** Read (never modified) for the access-control flow. */
export const OTHER_COMPANY_NAME = "Demo Company (test)";

/** The company's own revenue segments created through the portal in flow 2. */
export const COMPANY_SEGMENTS = ["E2E Online", "E2E Retail"] as const;

export function assertE2EEmail(email: string): void {
  const normalised = email.trim().toLowerCase();
  if (PROTECTED_EMAILS.has(normalised) || !E2E_EMAILS.has(normalised)) {
    throw new Error(`Refusing to modify a non-E2E account (${normalised}).`);
  }
}
