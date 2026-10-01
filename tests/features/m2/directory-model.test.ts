import { describe, expect, it } from "vitest";

import {
  buildDirectory,
  describeAccess,
  initialUsersTab,
  matchesQuery,
  type CompanyOption,
  type MembershipInput,
  type ProfileInput,
} from "@/app/admin/users/_components/directory-model";
import type { PendingAccessLink } from "@/lib/auth-admin/links";
import type { AuthUserSummary } from "@/lib/auth-admin/users";

const ME = "00000000-0000-4000-8000-00000000000a";
const PARTNER = "00000000-0000-4000-8000-00000000000b";
const OWNER = "00000000-0000-4000-8000-00000000000c";
const INVITEE = "00000000-0000-4000-8000-00000000000d";
const GONE = "00000000-0000-4000-8000-00000000000e";
const BATIK = "c0000000-0000-4000-8000-000000000001";
const KIDDO = "c0000000-0000-4000-8000-000000000003";
const STAYHERE = "c0000000-0000-4000-8000-000000000013";

const companies: CompanyOption[] = [
  { id: BATIK, name: "Batik Boutique", status: "active" },
  { id: KIDDO, name: "Kiddocare", status: "active" },
  { id: STAYHERE, name: "StayHere", status: "written_off" },
];

const profile = (overrides: Partial<ProfileInput> & { id: string; email: string }): ProfileInput => ({
  full_name: null,
  job_title: null,
  scaleup_role: null,
  is_active: true,
  terms_accepted_at: null,
  ...overrides,
});

const profiles: ProfileInput[] = [
  profile({ id: ME, email: "kenneth@scaleup.my", full_name: "Kenneth Siew", scaleup_role: "super_admin", terms_accepted_at: "2026-09-01T00:00:00Z" }),
  profile({ id: PARTNER, email: "renuka@scaleup.my", full_name: "Renuka Sena", job_title: "Partner", scaleup_role: "partner" }),
  profile({ id: OWNER, email: "siti@batik.my", full_name: "Siti Aminah", terms_accepted_at: "2026-09-02T00:00:00Z" }),
  profile({ id: INVITEE, email: "lee@kiddocare.my" }),
  profile({ id: GONE, email: "zed@stayhere.my", full_name: "Zed", is_active: false }),
];

const memberships: MembershipInput[] = [
  { company_id: KIDDO, user_id: OWNER, role: "contributor", is_active: false },
  { company_id: BATIK, user_id: OWNER, role: "owner", is_active: true },
  { company_id: KIDDO, user_id: INVITEE, role: "contributor", is_active: true },
  { company_id: STAYHERE, user_id: GONE, role: "owner", is_active: true },
  { company_id: "c0000000-0000-4000-8000-0000000000ff", user_id: GONE, role: "owner", is_active: true },
];

const auth: AuthUserSummary[] = [
  { id: ME, email: "kenneth@scaleup.my", lastSignInAt: "2026-09-30T01:00:00Z", mfaEnrolled: true, banned: false, createdAt: "2026-09-01T00:00:00Z" },
  { id: PARTNER, email: "renuka@scaleup.my", lastSignInAt: null, mfaEnrolled: false, banned: false, createdAt: "2026-09-29T00:00:00Z" },
  { id: OWNER, email: "siti@batik.my", lastSignInAt: "2026-09-29T01:00:00Z", mfaEnrolled: true, banned: false, createdAt: "2026-09-02T00:00:00Z" },
  { id: INVITEE, email: "lee@kiddocare.my", lastSignInAt: null, mfaEnrolled: false, banned: false, createdAt: "2026-09-30T00:00:00Z" },
];

const links: PendingAccessLink[] = [
  { id: "l-old", userId: PARTNER, purpose: "invite", createdBy: ME, createdAt: "2026-09-28T00:00:00Z", expiresAt: "2026-10-05T00:00:00Z" },
  { id: "l-new", userId: PARTNER, purpose: "invite", createdBy: ME, createdAt: "2026-09-29T00:00:00Z", expiresAt: "2026-10-06T00:00:00Z" },
  { id: "l-lee", userId: INVITEE, purpose: "invite", createdBy: OWNER, createdAt: "2026-09-30T00:00:00Z", expiresAt: "2026-10-07T00:00:00Z" },
  { id: "l-siti", userId: OWNER, purpose: "signin", createdBy: null, createdAt: "2026-09-30T02:00:00Z", expiresAt: "2026-10-01T02:00:00Z" },
];

describe("buildDirectory", () => {
  const { users, links: rows } = buildDirectory({ currentUserId: ME, profiles, memberships, companies, authUsers: auth, pendingLinks: links });
  const byId = new Map(users.map((user) => [user.id, user]));

  it("sorts active people first, then by name", () => {
    expect(users.map((user) => user.email)).toEqual([
      "kenneth@scaleup.my",
      "lee@kiddocare.my",
      "renuka@scaleup.my",
      "siti@batik.my",
      "zed@stayhere.my",
    ]);
  });

  it("joins the Auth account (last sign-in, 2FA) and marks the signed-in user", () => {
    expect(byId.get(ME)).toMatchObject({ isSelf: true, hasSignedIn: true, mfaEnrolled: true, lastSignInAt: "2026-09-30T01:00:00Z" });
    expect(byId.get(PARTNER)).toMatchObject({ isSelf: false, hasSignedIn: false, mfaEnrolled: false, jobTitle: "Partner" });
    // No Auth account in the list (e.g. Auth could not be read for them): unknown 2FA.
    expect(byId.get(GONE)).toMatchObject({ mfaEnrolled: null, lastSignInAt: null, hasSignedIn: false, isActive: false });
  });

  it("keeps the newest pending link per person and purpose", () => {
    expect(byId.get(PARTNER)?.pendingInvite).toEqual({ id: "l-new", expiresAt: "2026-10-06T00:00:00Z" });
    expect(byId.get(OWNER)?.pendingSignIn).toEqual({ id: "l-siti", expiresAt: "2026-10-01T02:00:00Z" });
    expect(byId.get(OWNER)?.pendingInvite).toBeNull();
  });

  it("lists memberships active first, then by company, and skips unknown companies", () => {
    expect(byId.get(OWNER)?.memberships).toEqual([
      { companyId: BATIK, companyName: "Batik Boutique", companyStatus: "active", role: "owner", isActive: true },
      { companyId: KIDDO, companyName: "Kiddocare", companyStatus: "active", role: "contributor", isActive: false },
    ]);
    expect(byId.get(GONE)?.memberships).toEqual([
      { companyId: STAYHERE, companyName: "StayHere", companyStatus: "written_off", role: "owner", isActive: true },
    ]);
  });

  it("describes each pending link with the person, their access and who issued it", () => {
    expect(rows.map((row) => [row.id, row.name, row.kind, row.access, row.issuedBy])).toEqual([
      ["l-old", "Renuka Sena", "scaleup", "Partner", "Kenneth Siew"],
      ["l-new", "Renuka Sena", "scaleup", "Partner", "Kenneth Siew"],
      ["l-lee", "lee@kiddocare.my", "company", "Kiddocare (Contributor)", "Siti Aminah"],
      ["l-siti", "Siti Aminah", "company", "Batik Boutique (Company Owner)", "Setup script"],
    ]);
  });

  it("falls back to the terms of use when Auth could not be read", () => {
    const fallback = buildDirectory({ currentUserId: ME, profiles, memberships, companies, authUsers: null, pendingLinks: null });
    const siti = fallback.users.find((user) => user.id === OWNER);
    expect(siti).toMatchObject({ hasSignedIn: true, mfaEnrolled: null, pendingInvite: null });
    expect(fallback.users.find((user) => user.id === INVITEE)?.hasSignedIn).toBe(false);
    expect(fallback.links).toEqual([]);
  });
});

describe("helpers", () => {
  it("describeAccess", () => {
    expect(describeAccess({ scaleupRole: "fund_admin", memberships: [] })).toBe("Fund Admin");
    expect(describeAccess({ scaleupRole: null, memberships: [] })).toBe("No company yet");
    const m = (companyName: string, isActive = true) => ({
      companyId: companyName,
      companyName,
      companyStatus: "active" as const,
      role: "owner" as const,
      isActive,
    });
    expect(describeAccess({ scaleupRole: null, memberships: [m("A", false)] })).toBe("No company yet");
    expect(describeAccess({ scaleupRole: null, memberships: [m("A"), m("B"), m("C")] })).toBe("A, B and 1 more");
  });

  it("matchesQuery looks at names, emails, job titles and companies", () => {
    const { users } = buildDirectory({ currentUserId: ME, profiles, memberships, companies, authUsers: auth, pendingLinks: links });
    const siti = users.find((user) => user.id === OWNER);
    if (!siti) throw new Error("missing");
    expect(matchesQuery(siti, "")).toBe(true);
    expect(matchesQuery(siti, "siti")).toBe(true);
    expect(matchesQuery(siti, "BATIK.my")).toBe(true);
    expect(matchesQuery(siti, "kiddo")).toBe(true);
    expect(matchesQuery(siti, "siti batik")).toBe(true);
    expect(matchesQuery(siti, "siti recqa")).toBe(false);
  });

  it("initialUsersTab opens ?tab=, else the company tab for ?company=, else the ScaleUp team", () => {
    expect(initialUsersTab("pending", BATIK)).toBe("pending");
    expect(initialUsersTab(undefined, BATIK)).toBe("company");
    expect(initialUsersTab("bogus", undefined)).toBe("scaleup");
    expect(initialUsersTab(undefined, undefined)).toBe("scaleup");
  });
});
