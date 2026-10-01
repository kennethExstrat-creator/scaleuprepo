// Pure, client-safe helpers for the Users (/admin/users) and Team (/portal/[companyId]/team) pages:
// account and team-member statuses, the "one account, one side" rule for invitations, and display
// names. No server-only imports: Client Components may import this module.
import { COMPANY_ROLE_LABELS, SCALEUP_ROLE_LABELS, type Tone } from "@/lib/constants";
import type { CompanyRole, ScaleupRole } from "@/lib/types/enums";

import type { AccessLinkPurpose } from "./purpose";

export type StatusMeta<K extends string> = { key: K; label: string; tone: Tone; description: string };

export type AccountStatusKey = "active" | "invited" | "not_joined" | "deactivated";

/**
 * An account's status on the Users page:
 * - deactivated: `profiles.is_active` false (also banned in Supabase Auth, BRD B22);
 * - active: has signed in at least once;
 * - invited: never signed in, with a pending invitation link;
 * - not_joined: never signed in and no valid invitation (it expired or was revoked).
 */
export function accountStatus(input: {
  isActive: boolean;
  hasSignedIn: boolean;
  pendingInvite: boolean;
}): StatusMeta<AccountStatusKey> {
  if (!input.isActive) {
    return {
      key: "deactivated",
      label: "Deactivated",
      tone: "danger",
      description: "Cannot sign in. Their history is kept.",
    };
  }
  if (input.hasSignedIn) {
    return { key: "active", label: "Active", tone: "success", description: "Has signed in." };
  }
  if (input.pendingInvite) {
    return { key: "invited", label: "Invited", tone: "info", description: "Invitation sent, not accepted yet." };
  }
  return {
    key: "not_joined",
    label: "Not joined yet",
    tone: "warning",
    description: "Has never signed in and has no valid invitation. Send a new invitation link.",
  };
}

export type TeamMemberStatusKey = "active" | "invited" | "not_joined" | "removed" | "account_deactivated";

/**
 * A team member's status on the company Team page. `hasJoined` = has completed their first sign-in
 * (accepted the terms of use); company users never see sign-in times.
 */
export function teamMemberStatus(input: {
  membershipActive: boolean;
  accountActive: boolean;
  hasJoined: boolean;
  pendingInvite: boolean;
}): StatusMeta<TeamMemberStatusKey> {
  if (!input.accountActive) {
    return {
      key: "account_deactivated",
      label: "Account deactivated",
      tone: "danger",
      description: "ScaleUp has deactivated this account.",
    };
  }
  if (!input.membershipActive) {
    return {
      key: "removed",
      label: "Deactivated",
      tone: "neutral",
      description: "No longer has access to this company.",
    };
  }
  if (input.hasJoined) return { key: "active", label: "Active", tone: "success", description: "Has joined." };
  if (input.pendingInvite) {
    return { key: "invited", label: "Invited", tone: "info", description: "Invitation sent, not accepted yet." };
  }
  return {
    key: "not_joined",
    label: "Not joined yet",
    tone: "warning",
    description: "Has not signed in yet and has no valid invitation.",
  };
}

/** What we know about an existing account when someone invites its email address again. */
export type ExistingAccountFacts = {
  scaleupRole: ScaleupRole | null;
  /** Company memberships, active or not. */
  memberships: readonly { companyName: string }[];
};

/** Company names for a message: "A", "A and B", "A, B and 2 more". */
export function listNames(names: readonly string[], max = 2): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length <= max) return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

/**
 * One account is either ScaleUp staff or a company user, never both (ScaleUp roles see the whole
 * portfolio). The message to show when a ScaleUp invitation hits a company user's email, else null.
 */
export function scaleUpInviteConflict(existing: ExistingAccountFacts | null): string | null {
  if (!existing || existing.memberships.length === 0) return null;
  const companies = listNames(existing.memberships.map((m) => m.companyName));
  return `This email address belongs to a company user (${companies}). ScaleUp staff need their own account, so use a different email address.`;
}

/** The message to show when a company invitation hits a ScaleUp staff member's email, else null. */
export function companyInviteConflict(existing: ExistingAccountFacts | null): string | null {
  if (!existing?.scaleupRole) return null;
  return `This email address belongs to a ScaleUp user (${SCALEUP_ROLE_LABELS[existing.scaleupRole]}). Company users need their own account, so use a different email address.`;
}

/** "Ana Tan" or, without a name, the email address. */
export function displayName(fullName: string | null | undefined, email: string): string {
  const name = fullName?.trim();
  return name ? name : email;
}

/** "Ana Tan (ana@scaleup.my)" for audit summaries and confirmations. */
export function nameWithEmail(fullName: string | null | undefined, email: string): string {
  const name = fullName?.trim();
  return name && name.toLowerCase() !== email.toLowerCase() ? `${name} (${email})` : email;
}

export const ACCESS_LINK_PURPOSE_LABELS: Record<AccessLinkPurpose, string> = {
  invite: "Invitation",
  signin: "Sign-in link",
};

/** "Company Owner" / "Contributor". */
export function companyRoleLabel(role: CompanyRole): string {
  return COMPANY_ROLE_LABELS[role];
}
