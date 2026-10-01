// View model of /portal/[companyId]/team (pure; unit-tested in tests/features/m2): the company's
// memberships (RLS: co-members) with their pending access links (service role) and the owners'
// contributor limit (BRD B29). ScaleUp people are named "<full name> (ScaleUp)" on the company side
// (BRD B28, e.g. "Invitation from Renuka Sena (ScaleUp)") — names from getStaffDisplayNames, never an
// email or a role — and plain "ScaleUp" (SCALEUP_LABEL) only when no person can be named (a link
// issued by a script).
import type { PendingAccessLink } from "@/lib/auth-admin/links";
import type { AccessLinkPurpose } from "@/lib/auth-admin/purpose";
import { displayName, teamMemberStatus, type StatusMeta, type TeamMemberStatusKey } from "@/lib/auth-admin/status";
import { SCALEUP_LABEL } from "@/lib/constants";
import { contributorLimitMessage, contributorSlotsLeft } from "@/lib/types/domain";
import type { CompanyRole } from "@/lib/types/enums";

export type TeamMemberInput = {
  user_id: string;
  role: CompanyRole;
  is_active: boolean;
  /**
   * Null when Row Level Security hides the profile: company users read the profiles of every
   * company-side co-member, so only a ScaleUp person's profile is ever hidden here.
   */
  profile: {
    email: string;
    full_name: string | null;
    job_title: string | null;
    is_active: boolean;
    terms_accepted_at: string | null;
  } | null;
};

export type TeamLink = {
  id: string;
  purpose: AccessLinkPurpose;
  expiresAt: string;
  /** "you", a co-owner's name, "<full name> (ScaleUp)", or "ScaleUp" for a link issued by a script. */
  sentBy: string;
  /** The owner may revoke it: a contributor's link sent by one of this company's owners. */
  revocable: boolean;
};

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  role: CompanyRole;
  isSelf: boolean;
  membershipActive: boolean;
  accountActive: boolean;
  /** Completed their first sign-in (accepted the terms of use). */
  hasJoined: boolean;
  status: StatusMeta<TeamMemberStatusKey>;
  /** The newest pending link that can still be used (an invitation before a sign-in link). */
  pendingLink: TeamLink | null;
  /** The signed-in owner may manage this row: an active company's contributor, not themself. */
  manageable: boolean;
};

const compareText = (a: string, b: string) => a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });

export function buildTeam(input: {
  currentUserId: string;
  /** The signed-in user owns this company and it is active (canManageCompanyTeam). */
  canManage: boolean;
  /** The company is active: its owners' links only work while it is (BRD B15). */
  companyActive: boolean;
  members: readonly TeamMemberInput[];
  pendingLinks: readonly PendingAccessLink[];
  /**
   * ScaleUp people's display names by lower-case id ("Renuka Sena (ScaleUp)", BRD B28): the result of
   * getStaffDisplayNames for the link issuers who are not members of this company and for the members
   * whose profile the viewer cannot read.
   */
  staffNames?: Readonly<Record<string, string>>;
}): TeamMember[] {
  const staffNames = input.staffNames ?? {};
  const staffName = (id: string): string | undefined => staffNames[id.toLowerCase()];

  // Owners whose links still work. The database re-checks the issuer when a link is used
  // (private.access_link_issuer_ok): an owner's link only works while they actively own this ACTIVE
  // company with an active account.
  const linkOwners = new Map<string, string>();
  if (input.companyActive) {
    for (const member of input.members) {
      if (member.role === "owner" && member.is_active && member.profile?.is_active) {
        linkOwners.set(member.user_id, displayName(member.profile.full_name, member.profile.email));
      }
    }
  }

  /** Who sent a link that can still be used, or null when it can no longer be used. */
  const sentByOf = (createdBy: string | null): string | null => {
    if (createdBy === null) return SCALEUP_LABEL; // a trusted script run by ScaleUp: nobody to name
    const owner = linkOwners.get(createdBy);
    if (owner !== undefined) return createdBy === input.currentUserId ? "you" : owner;
    // ScaleUp staff by name. Anyone else (e.g. the owner of another company the person has since left,
    // or a former owner) can no longer hand out a working link: not shown.
    return staffName(createdBy) ?? null;
  };

  const linksByUser = new Map<string, { link: PendingAccessLink; sentBy: string }>();
  const newestFirst = [...input.pendingLinks].sort(
    (a, b) => Number(a.purpose !== "invite") - Number(b.purpose !== "invite") || b.createdAt.localeCompare(a.createdAt),
  );
  for (const link of newestFirst) {
    if (linksByUser.has(link.userId)) continue;
    const sentBy = sentByOf(link.createdBy);
    if (sentBy !== null) linksByUser.set(link.userId, { link, sentBy });
  }

  const team = input.members.map((member): TeamMember => {
    const profile = member.profile;
    const isSelf = member.user_id === input.currentUserId;
    const accountActive = profile?.is_active ?? true;
    const hasJoined = profile ? profile.terms_accepted_at !== null : true;
    const pending = linksByUser.get(member.user_id) ?? null;
    const manageable = input.canManage && member.role === "contributor" && !isSelf && profile !== null;
    return {
      userId: member.user_id,
      name: profile ? displayName(profile.full_name, profile.email) : (staffName(member.user_id) ?? SCALEUP_LABEL),
      email: profile?.email ?? "",
      jobTitle: profile?.job_title ?? null,
      role: member.role,
      isSelf,
      membershipActive: member.is_active,
      accountActive,
      hasJoined,
      status: teamMemberStatus({
        membershipActive: member.is_active,
        accountActive,
        hasJoined,
        pendingInvite: pending !== null,
      }),
      pendingLink: pending
        ? {
            id: pending.link.id,
            purpose: pending.link.purpose,
            expiresAt: pending.link.expiresAt,
            sentBy: pending.sentBy,
            revocable: manageable && pending.link.createdBy !== null && linkOwners.has(pending.link.createdBy),
          }
        : null,
      manageable,
    };
  });

  return team.sort(
    (a, b) =>
      Number(b.membershipActive) - Number(a.membershipActive) ||
      Number(a.role !== "owner") - Number(b.role !== "owner") ||
      compareText(a.name, b.name) ||
      compareText(a.email, b.email),
  );
}

/**
 * The ids the Team page must resolve with getStaffDisplayNames (BRD B28): the issuers of pending links
 * who are not members of this company (ScaleUp staff, or someone whose link no longer works), and the
 * members whose profile the viewer cannot read (ScaleUp people). Lower-case, without duplicates.
 */
export function idsToName(members: readonly TeamMemberInput[], pendingLinks: readonly PendingAccessLink[]): string[] {
  const memberIds = new Set(members.map((member) => member.user_id.toLowerCase()));
  const ids = new Set<string>();
  for (const member of members) {
    if (member.profile === null) ids.add(member.user_id.toLowerCase());
  }
  for (const link of pendingLinks) {
    const issuer = link.createdBy?.toLowerCase();
    if (issuer && !memberIds.has(issuer)) ids.add(issuer);
  }
  return [...ids];
}

/** BRD B29: the owners' contributor limit as the Team page shows it (UX only: the database enforces it). */
export type ContributorAllowance = {
  /** N: the company's active contributor memberships, pending invitations included. */
  active: number;
  /** L: `owner_contributor_limit` from get_client_settings(). */
  limit: number;
  /** Places left for the owners, never below 0. */
  slotsLeft: number;
  /** With no place left: why nobody can be invited or reactivated; null while places are left. */
  blockedReason: string | null;
};

/**
 * How many contributors the owners have and may still add (BRD B29). Deactivated contributors do not
 * count. With no place left, `blockedReason` is the database's own refusal for the team's size
 * (`contributorLimitMessage`); with the limit at 0 it is always "Only ScaleUp can add contributors to
 * your team. …", since deactivating someone would not free a place then.
 */
export function contributorAllowance(
  members: readonly Pick<TeamMemberInput, "role" | "is_active">[],
  limit: number,
): ContributorAllowance {
  const active = members.filter((member) => member.role === "contributor" && member.is_active).length;
  const slotsLeft = contributorSlotsLeft(active, limit);
  const blockedReason = slotsLeft > 0 ? null : contributorLimitMessage(limit <= 0 ? 0 : active);
  return { active, limit, slotsLeft, blockedReason };
}

/** The allowance in words: "3 of 4 contributors" and what that means for the owner. */
export function allowanceText(allowance: ContributorAllowance): { headline: string; detail: string } {
  const { active, limit, slotsLeft, blockedReason } = allowance;
  const noun = (count: number) => (count === 1 ? "contributor" : "contributors");
  const headline = limit <= 0 ? `${active} ${noun(active)}` : `${active} of ${limit} ${noun(limit)}`;
  if (blockedReason !== null) return { headline, detail: blockedReason };
  return {
    headline,
    detail: `${slotsLeft} ${slotsLeft === 1 ? "place" : "places"} left. Pending invitations count, and deactivating a contributor frees their place.`,
  };
}
