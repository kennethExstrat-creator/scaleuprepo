import { describe, expect, it } from "vitest";

import {
  allowanceText,
  buildTeam,
  contributorAllowance,
  idsToName,
  type TeamMemberInput,
} from "@/app/portal/[companyId]/team/_components/team-model";
import type { PendingAccessLink } from "@/lib/auth-admin/links";
import { contributorLimitMessage } from "@/lib/types/domain";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CO_OWNER = "00000000-0000-4000-8000-000000000002";
const JOINED = "00000000-0000-4000-8000-000000000003";
const INVITED = "00000000-0000-4000-8000-000000000004";
const SCALEUP_INVITED = "00000000-0000-4000-8000-000000000005";
const REMOVED = "00000000-0000-4000-8000-000000000006";
const HIDDEN = "00000000-0000-4000-8000-000000000007";
const SCRIPT_INVITED = "00000000-0000-4000-8000-000000000008";
const ELSEWHERE_INVITED = "00000000-0000-4000-8000-000000000009";
const FORMER_OWNER = "00000000-0000-4000-8000-00000000000a";
const FORMER_OWNER_INVITED = "00000000-0000-4000-8000-00000000000b";
const STAFF = "00000000-0000-4000-8000-0000000000aa";
const OTHER_COMPANY_OWNER = "00000000-0000-4000-8000-0000000000cc";

const member = (
  userId: string,
  role: "owner" | "contributor",
  profile: Partial<NonNullable<TeamMemberInput["profile"]>> | null,
  isActive = true,
): TeamMemberInput => ({
  user_id: userId,
  role,
  is_active: isActive,
  profile:
    profile === null
      ? null
      : { email: `${userId.slice(-2)}@batik.my`, full_name: null, job_title: null, is_active: true, terms_accepted_at: null, ...profile },
});

const members: TeamMemberInput[] = [
  member(JOINED, "contributor", { full_name: "Farah", terms_accepted_at: "2026-09-02T00:00:00Z" }),
  member(OWNER, "owner", { full_name: "Siti", terms_accepted_at: "2026-09-01T00:00:00Z" }),
  member(INVITED, "contributor", { full_name: "Lee" }),
  member(SCALEUP_INVITED, "contributor", { full_name: "Ahmad" }),
  member(REMOVED, "contributor", { full_name: "Bala", terms_accepted_at: "2026-09-03T00:00:00Z" }, false),
  member(CO_OWNER, "owner", { full_name: "Chong", terms_accepted_at: "2026-09-01T00:00:00Z" }),
  member(HIDDEN, "contributor", null),
  member(SCRIPT_INVITED, "contributor", { full_name: "Devi" }),
  member(ELSEWHERE_INVITED, "contributor", { full_name: "Ezra" }),
  member(FORMER_OWNER, "owner", { full_name: "Gopal", terms_accepted_at: "2026-08-01T00:00:00Z" }, false),
  member(FORMER_OWNER_INVITED, "contributor", { full_name: "Hana" }),
];

const link = (id: string, userId: string, createdBy: string | null, purpose: "invite" | "signin" = "invite"): PendingAccessLink => ({
  id,
  userId,
  purpose,
  createdBy,
  createdAt: "2026-09-30T00:00:00Z",
  expiresAt: "2026-10-07T00:00:00Z",
});

const pendingLinks = [
  link("by-me", INVITED, OWNER),
  link("by-scaleup", SCALEUP_INVITED, STAFF),
  link("by-co-owner-signin", JOINED, CO_OWNER, "signin"),
  link("by-script", SCRIPT_INVITED, null),
  link("by-other-company-owner", ELSEWHERE_INVITED, OTHER_COMPANY_OWNER),
  link("by-former-owner", FORMER_OWNER_INVITED, FORMER_OWNER),
];

/** What getStaffDisplayNames returns: ScaleUp staff only (nothing for the other company's owner). */
const staffNames = {
  [STAFF]: "Renuka Sena (ScaleUp)",
  [HIDDEN]: "Rahim Ali (ScaleUp)",
};

describe("buildTeam", () => {
  const team = buildTeam({ currentUserId: OWNER, canManage: true, companyActive: true, members, pendingLinks, staffNames });
  const byId = new Map(team.map((row) => [row.userId, row]));

  it("sorts active members first, owners before contributors, then by name", () => {
    expect(team.map((row) => row.name)).toEqual([
      "Chong",
      "Siti",
      "Ahmad",
      "Devi",
      "Ezra",
      "Farah",
      "Hana",
      "Lee",
      "Rahim Ali (ScaleUp)",
      "Gopal",
      "Bala",
    ]);
  });

  it("works out each member's status", () => {
    expect(byId.get(OWNER)).toMatchObject({ isSelf: true, status: { key: "active" } });
    expect(byId.get(JOINED)?.status.key).toBe("active");
    expect(byId.get(INVITED)?.status.key).toBe("invited");
    expect(byId.get(REMOVED)?.status.key).toBe("removed");
  });

  it("names who sent a pending link, ScaleUp people as '<full name> (ScaleUp)' (BRD B28)", () => {
    expect(byId.get(INVITED)?.pendingLink).toMatchObject({ id: "by-me", sentBy: "you", revocable: true });
    expect(byId.get(SCALEUP_INVITED)?.pendingLink).toMatchObject({
      id: "by-scaleup",
      sentBy: "Renuka Sena (ScaleUp)",
      revocable: false,
    });
    expect(byId.get(JOINED)?.pendingLink).toMatchObject({ purpose: "signin", sentBy: "Chong", revocable: true });
    // Nobody to name: a link from scripts/create-user.ts reads plain "ScaleUp".
    expect(byId.get(SCRIPT_INVITED)?.pendingLink).toMatchObject({ id: "by-script", sentBy: "ScaleUp", revocable: false });
    expect(byId.get(SCRIPT_INVITED)?.status.key).toBe("invited");
    // A member whose profile is hidden is a ScaleUp person: named, never with an email.
    expect(byId.get(HIDDEN)).toMatchObject({ name: "Rahim Ali (ScaleUp)", email: "", manageable: false });
  });

  it("drops links that can no longer be used instead of calling them ScaleUp's", () => {
    // Issued by the owner of another company (the person has since joined this one): unusable.
    expect(byId.get(ELSEWHERE_INVITED)).toMatchObject({ pendingLink: null, status: { key: "not_joined" } });
    // Issued by an owner who no longer owns this company.
    expect(byId.get(FORMER_OWNER_INVITED)).toMatchObject({ pendingLink: null, status: { key: "not_joined" } });
  });

  it("owners' links stop counting once the company is no longer active (BRD B15)", () => {
    const exited = buildTeam({ currentUserId: OWNER, canManage: false, companyActive: false, members, pendingLinks, staffNames });
    const find = (id: string) => exited.find((row) => row.userId === id);
    expect(find(INVITED)?.pendingLink).toBeNull();
    expect(find(JOINED)?.pendingLink).toBeNull();
    // ScaleUp's links still work (a Super Admin may hold a link for anyone).
    expect(find(SCALEUP_INVITED)?.pendingLink?.sentBy).toBe("Renuka Sena (ScaleUp)");
  });

  it("falls back to 'ScaleUp' for a hidden member when no name is known", () => {
    const anonymous = buildTeam({ currentUserId: OWNER, canManage: true, companyActive: true, members, pendingLinks: [] });
    expect(anonymous.find((row) => row.userId === HIDDEN)?.name).toBe("ScaleUp");
  });

  it("lets owners manage contributors only (never themselves or co-owners)", () => {
    expect(team.filter((row) => row.manageable).map((row) => row.name)).toEqual([
      "Ahmad",
      "Devi",
      "Ezra",
      "Farah",
      "Hana",
      "Lee",
      "Bala",
    ]);
  });

  it("is read-only for contributors", () => {
    const readOnly = buildTeam({ currentUserId: JOINED, canManage: false, companyActive: true, members, pendingLinks, staffNames });
    expect(readOnly.some((row) => row.manageable)).toBe(false);
    expect(readOnly.some((row) => row.pendingLink?.revocable)).toBe(false);
    expect(readOnly.find((row) => row.userId === INVITED)?.pendingLink?.sentBy).toBe("Siti");
  });

  it("prefers a pending invitation over a sign-in link for the same person", () => {
    const both = buildTeam({
      currentUserId: OWNER,
      canManage: true,
      companyActive: true,
      members,
      pendingLinks: [link("signin", INVITED, OWNER, "signin"), link("invite", INVITED, OWNER, "invite")],
    });
    expect(both.find((row) => row.userId === INVITED)?.pendingLink?.id).toBe("invite");
  });

  it("uses the next usable link when the newest one can no longer be used", () => {
    const mixed = buildTeam({
      currentUserId: OWNER,
      canManage: true,
      companyActive: true,
      members,
      pendingLinks: [
        { ...link("stale", INVITED, OTHER_COMPANY_OWNER), createdAt: "2026-09-30T10:00:00Z" },
        { ...link("usable", INVITED, STAFF), createdAt: "2026-09-29T10:00:00Z" },
      ],
      staffNames,
    });
    expect(mixed.find((row) => row.userId === INVITED)?.pendingLink).toMatchObject({ id: "usable", sentBy: "Renuka Sena (ScaleUp)" });
  });
});

describe("idsToName", () => {
  it("asks for the issuers who are not members and the members with a hidden profile, once each", () => {
    expect(idsToName(members, [...pendingLinks, link("again", INVITED, STAFF.toUpperCase())]).sort()).toEqual(
      [HIDDEN, STAFF, OTHER_COMPANY_OWNER].sort(),
    );
    expect(idsToName(members.filter((row) => row.profile !== null), [link("mine", INVITED, OWNER)])).toEqual([]);
  });
});

describe("contributorAllowance (BRD B29)", () => {
  const team = (active: number, inactive = 0) => [
    { role: "owner" as const, is_active: true },
    ...Array.from({ length: active }, () => ({ role: "contributor" as const, is_active: true })),
    ...Array.from({ length: inactive }, () => ({ role: "contributor" as const, is_active: false })),
  ];

  it("counts active contributors only (pending invitations included, deactivated ones not)", () => {
    expect(contributorAllowance(team(3, 2), 4)).toEqual({ active: 3, limit: 4, slotsLeft: 1, blockedReason: null });
  });

  it("explains a full team with the database's own wording", () => {
    expect(contributorAllowance(team(4), 4)).toEqual({
      active: 4,
      limit: 4,
      slotsLeft: 0,
      blockedReason: "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.",
    });
    expect(contributorAllowance(team(1), 1).blockedReason).toBe(contributorLimitMessage(1));
    // ScaleUp added more than the limit: still no place for the owners.
    expect(contributorAllowance(team(6), 4)).toMatchObject({ slotsLeft: 0, blockedReason: contributorLimitMessage(6) });
  });

  it("with the limit at 0 only ScaleUp adds contributors", () => {
    const message = "Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.";
    expect(contributorAllowance(team(0), 0).blockedReason).toBe(message);
    expect(contributorAllowance(team(2), 0).blockedReason).toBe(message);
  });

  it("reads as 'N of L contributors'", () => {
    expect(allowanceText(contributorAllowance(team(3), 4))).toEqual({
      headline: "3 of 4 contributors",
      detail: "1 place left. Pending invitations count, and deactivating a contributor frees their place.",
    });
    expect(allowanceText(contributorAllowance(team(0), 4)).detail).toMatch(/^4 places left\./);
    expect(allowanceText(contributorAllowance(team(1), 1))).toEqual({
      headline: "1 of 1 contributor",
      detail: "Your team already has 1 contributor. Deactivate one, or ask ScaleUp to add more.",
    });
    expect(allowanceText(contributorAllowance(team(2), 0)).headline).toBe("2 contributors");
  });
});
