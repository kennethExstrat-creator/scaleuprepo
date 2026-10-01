// View model of /admin/users (pure; unit-tested in tests/features/m2): joins profiles, memberships and
// companies (RLS client, Super Admin) with the Auth accounts and pending access links (service role).
import type { PendingAccessLink } from "@/lib/auth-admin/links";
import type { AccessLinkPurpose } from "@/lib/auth-admin/purpose";
import { displayName, listNames } from "@/lib/auth-admin/status";
import type { AuthUserSummary } from "@/lib/auth-admin/users";
import { COMPANY_ROLE_LABELS, SCALEUP_ROLE_LABELS } from "@/lib/constants";
import type { CompanyRole, CompanyStatus, ScaleupRole } from "@/lib/types/enums";

export type UsersTab = "scaleup" | "company" | "pending";
export const USERS_TABS: readonly UsersTab[] = ["scaleup", "company", "pending"];

export type CompanyOption = { id: string; name: string; status: CompanyStatus };

export type DirectoryMembership = {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  role: CompanyRole;
  isActive: boolean;
};

export type PendingLinkRef = { id: string; expiresAt: string };

export type DirectoryUser = {
  id: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  scaleupRole: ScaleupRole | null;
  isActive: boolean;
  /** Signed in at least once (Auth last sign-in, or — when Auth could not be read — terms accepted). */
  hasSignedIn: boolean;
  lastSignInAt: string | null;
  /** null = unknown (Auth could not be read). */
  mfaEnrolled: boolean | null;
  /** Active memberships first, then by company name. */
  memberships: DirectoryMembership[];
  pendingInvite: PendingLinkRef | null;
  pendingSignIn: PendingLinkRef | null;
  isSelf: boolean;
};

export type DirectoryLink = {
  id: string;
  purpose: AccessLinkPurpose;
  userId: string;
  name: string;
  email: string;
  kind: "scaleup" | "company";
  /** "Fund Admin" or "Batik Boutique (Company Owner)". */
  access: string;
  createdAt: string;
  expiresAt: string;
  issuedBy: string;
};

export type ProfileInput = {
  id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  scaleup_role: ScaleupRole | null;
  is_active: boolean;
  terms_accepted_at: string | null;
};

export type MembershipInput = { company_id: string; user_id: string; role: CompanyRole; is_active: boolean };

const compareText = (a: string, b: string) => a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });

/** Sorts people: active first, then by display name, then email. */
export function sortPeople<T extends { isActive: boolean; fullName: string | null; email: string }>(people: readonly T[]): T[] {
  return [...people].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      compareText(displayName(a.fullName, a.email), displayName(b.fullName, b.email)) ||
      compareText(a.email, b.email),
  );
}

/** Builds the rows of the three tabs. `authUsers` / `pendingLinks` are null when they could not be read. */
export function buildDirectory(input: {
  currentUserId: string;
  profiles: readonly ProfileInput[];
  memberships: readonly MembershipInput[];
  companies: readonly CompanyOption[];
  authUsers: readonly AuthUserSummary[] | null;
  pendingLinks: readonly PendingAccessLink[] | null;
}): { users: DirectoryUser[]; links: DirectoryLink[] } {
  const companies = new Map(input.companies.map((company) => [company.id, company]));
  const auth = new Map((input.authUsers ?? []).map((user) => [user.id, user]));

  const membershipsByUser = new Map<string, DirectoryMembership[]>();
  for (const row of input.memberships) {
    const company = companies.get(row.company_id);
    if (!company) continue;
    const list = membershipsByUser.get(row.user_id) ?? [];
    list.push({
      companyId: company.id,
      companyName: company.name,
      companyStatus: company.status,
      role: row.role,
      isActive: row.is_active,
    });
    membershipsByUser.set(row.user_id, list);
  }

  // Newest pending link per person and purpose (earlier ones are revoked when a new one is issued).
  const pendingByUser = new Map<string, { invite: PendingLinkRef | null; signin: PendingLinkRef | null }>();
  for (const link of [...(input.pendingLinks ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const entry = pendingByUser.get(link.userId) ?? { invite: null, signin: null };
    if (!entry[link.purpose]) entry[link.purpose] = { id: link.id, expiresAt: link.expiresAt };
    pendingByUser.set(link.userId, entry);
  }

  const users = sortPeople(
    input.profiles.map((profile): DirectoryUser => {
      const account = auth.get(profile.id);
      const memberships = [...(membershipsByUser.get(profile.id) ?? [])].sort(
        (a, b) => Number(b.isActive) - Number(a.isActive) || compareText(a.companyName, b.companyName),
      );
      const pending = pendingByUser.get(profile.id);
      return {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        jobTitle: profile.job_title,
        scaleupRole: profile.scaleup_role,
        isActive: profile.is_active,
        hasSignedIn: account ? account.lastSignInAt !== null : profile.terms_accepted_at !== null,
        lastSignInAt: account?.lastSignInAt ?? null,
        mfaEnrolled: account ? account.mfaEnrolled : null,
        memberships,
        pendingInvite: pending?.invite ?? null,
        pendingSignIn: pending?.signin ?? null,
        isSelf: profile.id === input.currentUserId,
      };
    }),
  );

  const usersById = new Map(users.map((user) => [user.id, user]));
  const links = (input.pendingLinks ?? []).flatMap((link): DirectoryLink[] => {
    const user = usersById.get(link.userId);
    if (!user) return [];
    const issuer = link.createdBy ? usersById.get(link.createdBy) : undefined;
    return [
      {
        id: link.id,
        purpose: link.purpose,
        userId: user.id,
        name: displayName(user.fullName, user.email),
        email: user.email,
        kind: user.scaleupRole ? "scaleup" : "company",
        access: describeAccess(user),
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        issuedBy: link.createdBy === null ? "Setup script" : issuer ? displayName(issuer.fullName, issuer.email) : "Unknown",
      },
    ];
  });

  return { users, links };
}

/** "Fund Admin", "Batik Boutique (Company Owner)", "No company yet". */
export function describeAccess(user: Pick<DirectoryUser, "scaleupRole" | "memberships">): string {
  if (user.scaleupRole) return SCALEUP_ROLE_LABELS[user.scaleupRole];
  const active = user.memberships.filter((m) => m.isActive);
  if (active.length === 0) return "No company yet";
  if (active.length === 1) return `${active[0].companyName} (${COMPANY_ROLE_LABELS[active[0].role]})`;
  return listNames(active.map((m) => m.companyName));
}

/** Case-insensitive match on name, email, job title and company names. */
export function matchesQuery(user: DirectoryUser, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [user.fullName ?? "", user.email, user.jobTitle ?? "", ...user.memberships.map((m) => m.companyName)]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((part) => haystack.includes(part));
}

export function isUsersTab(value: unknown): value is UsersTab {
  return typeof value === "string" && (USERS_TABS as readonly string[]).includes(value);
}

/** The tab to open: `?tab=`, else the Company users tab when `?company=` is set, else ScaleUp team. */
export function initialUsersTab(tab: string | undefined, companyId: string | undefined): UsersTab {
  if (isUsersTab(tab)) return tab;
  return companyId ? "company" : "scaleup";
}
