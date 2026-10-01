// Server Actions of /admin/users and /portal/[companyId]/team with the session, the RLS client and the
// service-role helpers replaced: which rows they write as the caller, what they log, the owners'
// contributor limit (BRD B29, checked before any Auth account is created), invitation-only links for
// owners, and how the database's refusals (BRD B29) and the "one account, one side" rule come out.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, pgError, type FakeReply, type FakeRequest } from "./fake-supabase";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000001";
const CO_OWNER = "00000000-0000-4000-8000-000000000002";
const PERSON = "00000000-0000-4000-8000-000000000003";
const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const STAFF = "00000000-0000-4000-8000-0000000000bb";
const LINK = "33333333-3333-4333-8333-333333333333";

const m = vi.hoisted(() => ({
  handler: (() => undefined) as (request: FakeRequest) => FakeReply | undefined,
  ctx: null as unknown,
  ensureAuthUser: vi.fn(),
  getAuthUser: vi.fn(),
  createAccessLink: vi.fn(),
  revokeEarlierAccessLinks: vi.fn(),
  revokeAccessLink: vi.fn(),
  getAccessLink: vi.fn(),
  revokeUserAccessLinks: vi.fn(),
  setUserBanned: vi.fn(),
  resetUserMfa: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase((request) => m.handler(request)).client,
}));
vi.mock("@/lib/auth/session", async () => {
  const { ActionError } = await import("@/lib/actions/result");
  return {
    assertCompanyAccess: async (companyId: string, roles?: string[]) => {
      const ctx = m.ctx as { memberships: { companyId: string; role: string }[] };
      const membership = ctx.memberships.find((x) => x.companyId === companyId);
      if (!membership) throw new ActionError("You don't have access to this company.");
      if (roles && !roles.includes(membership.role)) throw new ActionError("You don't have permission to do that.");
      return { ...ctx, companyRole: membership.role };
    },
    assertScaleUp: async () => m.ctx,
  };
});
vi.mock("@/lib/auth-admin", async () => {
  const links = await import("@/lib/auth-admin/links");
  return {
    ensureAuthUser: m.ensureAuthUser,
    getAuthUser: m.getAuthUser,
    createAccessLink: m.createAccessLink,
    revokeEarlierAccessLinks: m.revokeEarlierAccessLinks,
    revokeAccessLink: m.revokeAccessLink,
    getAccessLink: m.getAccessLink,
    revokeUserAccessLinks: m.revokeUserAccessLinks,
    setUserBanned: m.setUserBanned,
    resetUserMfa: m.resetUserMfa,
    isOwnerLinkRefusal: links.isOwnerLinkRefusal,
  };
});

import {
  inviteContributorAction,
  issueContributorLinkAction,
  revokeTeamLinkAction,
  setContributorActiveAction,
} from "@/app/portal/[companyId]/team/actions";
import { inviteScaleUpUserAction, setUserActiveAction } from "@/app/admin/users/actions";
import { OWNER_LINK_REFUSAL_MESSAGE } from "@/lib/auth-admin/links";

type Recorded = FakeRequest[];
type Route = FakeReply | ((request: FakeRequest) => FakeReply);

/** Routes RLS-client requests: `routes["METHOD /path"]` → reply (array bodies for maybeSingle GETs). */
function useRls(routes: Record<string, Route>): Recorded {
  const recorded: Recorded = [];
  m.handler = (request) => {
    recorded.push(request);
    const route = routes[`${request.method} ${request.path.replace("/rest/v1/", "")}`];
    if (!route) return undefined;
    return typeof route === "function" ? route(request) : route;
  };
  return recorded;
}

const ownerCtx = (companyStatus: "active" | "exited" = "active") => ({
  userId: OWNER,
  email: "siti@batik.my",
  fullName: "Siti",
  scaleupRole: null,
  isActive: true,
  memberships: [{ companyId: COMPANY, companyName: "Batik Boutique", companyStatus, role: "owner" }],
  aal: "aal2",
  mfaRequired: true,
  termsAccepted: true,
});

const adminCtx = {
  userId: ADMIN,
  email: "kenneth@scaleup.my",
  fullName: "Kenneth",
  scaleupRole: "super_admin",
  isActive: true,
  memberships: [],
  aal: "aal2",
  mfaRequired: true,
  termsAccepted: true,
};

const newAuthUser = { id: PERSON, email: "lee@batik.my", last_sign_in_at: undefined, banned_until: undefined };
const issued = { id: LINK, userId: PERSON, purpose: "invite", url: "https://x.my/access/tok", expiresAt: "2026-10-07T05:59:00.000Z" };

/** get_client_settings() as the owner reads it (BRD B29: owner_contributor_limit). */
const clientSettings = (limit = 4): FakeReply => ({
  body: [
    {
      require_mfa: true,
      terms_version: "2026-09",
      declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
      due_day: 15,
      owner_contributor_limit: limit,
    },
  ],
});

type TeamEntry = { user_id: string; role: "owner" | "contributor"; is_active: boolean; email?: string };
const ownerRow: TeamEntry = { user_id: OWNER, role: "owner", is_active: true, email: "siti@batik.my" };
/** `count` contributors other than PERSON (active, or deactivated with `isActive` false). */
const contributors = (count: number, isActive = true): TeamEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    user_id: `00000000-0000-4000-8000-${isActive ? "1" : "2"}000000000${String(i).padStart(2, "0")}`,
    role: "contributor",
    is_active: isActive,
    email: `c${i}${isActive ? "" : "-off"}@batik.my`,
  }));

/**
 * GET company_members: the whole team (no user filter; RLS shows the emails of company-side
 * co-members), or the membership of one person (user_id filter, maybeSingle).
 */
function companyMembers(team: TeamEntry[], existing: unknown[] = []): Route {
  return (request) =>
    request.params.get("user_id")
      ? { body: existing }
      : { body: team.map(({ email, ...row }) => ({ ...row, profile: email ? { email } : null })) };
}

beforeEach(() => {
  for (const fn of [
    m.ensureAuthUser,
    m.getAuthUser,
    m.createAccessLink,
    m.revokeEarlierAccessLinks,
    m.revokeAccessLink,
    m.getAccessLink,
    m.revokeUserAccessLinks,
    m.setUserBanned,
    m.resetUserMfa,
    m.revalidatePath,
  ]) {
    fn.mockReset();
  }
  m.handler = () => undefined; // every test declares the requests it expects
  m.revokeUserAccessLinks.mockResolvedValue(0);
  m.revokeEarlierAccessLinks.mockResolvedValue(0);
  m.revokeAccessLink.mockResolvedValue({ id: LINK });
});

describe("inviteContributorAction (company owner)", () => {
  it("adds a new person as a contributor (as the owner), issues an invitation link and logs it for the company", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: true });
    m.createAccessLink.mockResolvedValue(issued);
    let earlierRevokedBeforeAudit = -1;
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(3)]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST company_members": { status: 201 },
      "POST rpc/log_audit_event": () => {
        earlierRevokedBeforeAudit = m.revokeEarlierAccessLinks.mock.calls.length;
        return { status: 204 };
      },
    });

    const result = await inviteContributorAction({ companyId: COMPANY, email: " Lee@Batik.my ", fullName: "Lee Wei" });

    expect(result).toEqual({
      ok: true,
      data: {
        userId: PERSON,
        name: "Lee Wei",
        email: "lee@batik.my",
        link: { url: issued.url, expiresAt: issued.expiresAt, purpose: "invite" },
        notice: null,
      },
    });
    expect(m.ensureAuthUser).toHaveBeenCalledWith({ email: "lee@batik.my", fullName: "Lee Wei" });
    expect(rls.find((r) => r.method === "POST" && r.path.endsWith("company_members"))?.body).toEqual({
      company_id: COMPANY,
      user_id: PERSON,
      role: "contributor",
    });
    expect(m.createAccessLink).toHaveBeenCalledWith({ userId: PERSON, purpose: "invite", createdBy: OWNER, revokeEarlier: false });
    const audit = rls.find((r) => r.path.endsWith("rpc/log_audit_event"))?.body as Record<string, unknown>;
    expect(audit).toMatchObject({ p_action: "invite", p_entity: "profiles", p_entity_id: PERSON, p_company_id: COMPANY });
    expect(String(audit.p_summary)).toContain("Invited Lee Wei (lee@batik.my) to Batik Boutique as Contributor");
    expect(JSON.stringify(audit)).not.toContain(issued.url);
    // Earlier links of the person stop working only once the new one is recorded.
    expect(earlierRevokedBeforeAudit).toBe(0);
    expect(m.revokeEarlierAccessLinks).toHaveBeenCalledWith(issued);
    expect(m.revalidatePath).toHaveBeenCalledWith(`/portal/${COMPANY}/team`);
  });

  it("at the contributor limit a new person is refused BEFORE any Auth account is created (BRD B29)", async () => {
    m.ctx = ownerCtx();
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(4), ...contributors(2, false)]),
      "POST rpc/get_client_settings": clientSettings(4),
    });

    const result = await inviteContributorAction({ companyId: COMPANY, email: "new@batik.my", fullName: "New Person" });

    expect(result).toEqual({
      ok: false,
      error: "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.",
    });
    expect(m.ensureAuthUser).not.toHaveBeenCalled();
    expect(m.createAccessLink).not.toHaveBeenCalled();
    expect(rls.some((r) => r.method !== "GET" && r.path.endsWith("company_members"))).toBe(false);
  });

  it("with the limit at 0 only ScaleUp adds contributors; a former contributor counts as a new place", async () => {
    m.ctx = ownerCtx();
    useRls({ "GET company_members": companyMembers([ownerRow]), "POST rpc/get_client_settings": clientSettings(0) });
    expect(await inviteContributorAction({ companyId: COMPANY, email: "new@batik.my", fullName: "New" })).toEqual({
      ok: false,
      error: "Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.",
    });

    const former: TeamEntry = { user_id: PERSON, role: "contributor", is_active: false, email: "lee@batik.my" };
    useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(4), former]),
      "POST rpc/get_client_settings": clientSettings(4),
    });
    const again = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(!again.ok && again.error).toBe("Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.");
    expect(m.ensureAuthUser).not.toHaveBeenCalled();
  });

  it("a new invitation for someone already on the team who has not joined needs no extra place", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: false });
    m.createAccessLink.mockResolvedValue(issued);
    const pending: TeamEntry = { user_id: PERSON, role: "contributor", is_active: true, email: "lee@batik.my" };
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(3), pending], [{ role: "contributor", is_active: true }]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST rpc/log_audit_event": { status: 204 },
    });

    const result = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });

    expect(result.ok && result.data.link?.url).toBe(issued.url);
    expect(rls.some((r) => r.method !== "GET" && r.path.endsWith("company_members"))).toBe(false);
  });

  it("the database's own refusal (P0001, e.g. two owners taking the last place at once) still reaches the form", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: true });
    const message = "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.";
    useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(3)]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST company_members": { status: 400, body: pgError("P0001", message) },
    });

    expect(await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" })).toEqual({
      ok: false,
      error: message,
    });
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });

  it("someone who also reaches another company is added but gets no link from the owner (BRD B29)", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: false });
    m.createAccessLink.mockRejectedValue(pgError("42501", OWNER_LINK_REFUSAL_MESSAGE));
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST company_members": { status: 201 },
      "POST rpc/log_audit_event": { status: 204 },
    });

    const result = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee Wei" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.link).toBeNull();
    expect(result.data.notice).toContain("ask them to sign in as usual");
    expect(result.data.notice).toContain("ScaleUp can send them a sign-in link");
    const audit = rls.find((r) => r.path.endsWith("rpc/log_audit_event"))?.body as Record<string, unknown>;
    expect(audit).toMatchObject({ p_action: "invite", p_company_id: COMPANY, p_data: { link_issued: false } });
  });

  it("someone who has signed in before is simply added: no link is attempted", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: { ...newAuthUser, last_sign_in_at: "2026-09-01T00:00:00Z" }, created: false });
    useRls({
      "GET company_members": companyMembers([ownerRow]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST company_members": { status: 201 },
      "POST rpc/log_audit_event": { status: 204 },
    });
    const result = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(result.ok && result.data.notice).toContain("They already have an account");
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });

  it("a ScaleUp staff email is refused by the database and explained without detail", async () => {
    m.ctx = ownerCtx();
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: false });
    useRls({
      "GET company_members": companyMembers([ownerRow]),
      "POST rpc/get_client_settings": clientSettings(4),
      "POST company_members": { status: 403, body: pgError("42501", 'new row violates row-level security policy for table "company_members"') },
    });
    const result = await inviteContributorAction({ companyId: COMPANY, email: "staff@scaleup.my", fullName: "Staff" });
    expect(result).toEqual({
      ok: false,
      error: "This email address can't be added to your team. Ask ScaleUp for help.",
      fieldErrors: { email: "This email address can't be added." },
    });
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });

  it("refuses the owner's own email, deactivated accounts, owners and exited companies", async () => {
    m.ctx = ownerCtx();
    expect((await inviteContributorAction({ companyId: COMPANY, email: "SITI@batik.my", fullName: "Siti" })).ok).toBe(false);

    useRls({ "GET company_members": companyMembers([ownerRow]), "POST rpc/get_client_settings": clientSettings(4) });
    m.ensureAuthUser.mockResolvedValue({ user: { ...newAuthUser, banned_until: "2126-01-01T00:00:00Z" }, created: false });
    const banned = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(!banned.ok && banned.error).toContain("deactivated");

    // A co-owner's email is recognised from the team before any Auth lookup …
    m.ensureAuthUser.mockReset();
    const coOwner: TeamEntry = { user_id: CO_OWNER, role: "owner", is_active: true, email: "lee@batik.my" };
    useRls({ "GET company_members": companyMembers([ownerRow, coOwner]), "POST rpc/get_client_settings": clientSettings(4) });
    const owner = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(!owner.ok && owner.error).toBe("Lee is already an owner of Batik Boutique.");
    expect(m.ensureAuthUser).not.toHaveBeenCalled();

    // … and by the account's membership otherwise.
    m.ensureAuthUser.mockResolvedValue({ user: newAuthUser, created: false });
    useRls({
      "GET company_members": companyMembers([ownerRow], [{ role: "owner", is_active: false }]),
      "POST rpc/get_client_settings": clientSettings(4),
    });
    const former = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(!former.ok && former.error).toBe("Lee used to be an owner of Batik Boutique. Ask ScaleUp to restore their access.");

    m.ctx = ownerCtx("exited");
    const exited = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(!exited.ok && exited.error).toBe(
      "Batik Boutique is no longer an active portfolio company, so its team can't be changed.",
    );
  });

  it("contributors cannot invite", async () => {
    m.ctx = { ...ownerCtx(), memberships: [{ companyId: COMPANY, companyName: "Batik Boutique", companyStatus: "active", role: "contributor" }] };
    const result = await inviteContributorAction({ companyId: COMPANY, email: "lee@batik.my", fullName: "Lee" });
    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(m.ensureAuthUser).not.toHaveBeenCalled();
  });
});

describe("issueContributorLinkAction (invitations only, BRD B29)", () => {
  const memberRow = (termsAcceptedAt: string | null = null) => ({
    body: [
      {
        user_id: PERSON,
        role: "contributor",
        is_active: true,
        profile: { email: "lee@batik.my", full_name: "Lee", is_active: true, terms_accepted_at: termsAcceptedAt },
      },
    ],
  });
  const authSummary = (lastSignInAt: string | null) => ({
    id: PERSON,
    email: "lee@batik.my",
    lastSignInAt,
    mfaEnrolled: false,
    banned: false,
    createdAt: "2026-09-30T00:00:00Z",
  });

  it("sends a new invitation link to a contributor who has not joined yet, logged for the company", async () => {
    m.ctx = ownerCtx();
    m.getAuthUser.mockResolvedValue(authSummary(null));
    m.createAccessLink.mockResolvedValue(issued);
    const rls = useRls({ "GET company_members": memberRow(), "POST rpc/log_audit_event": { status: 204 } });

    const result = await issueContributorLinkAction({ companyId: COMPANY, userId: PERSON });

    expect(result).toEqual({
      ok: true,
      data: { userId: PERSON, name: "Lee", email: "lee@batik.my", link: { url: issued.url, expiresAt: issued.expiresAt, purpose: "invite" }, notice: null },
    });
    expect(m.createAccessLink).toHaveBeenCalledWith({ userId: PERSON, purpose: "invite", createdBy: OWNER, revokeEarlier: false });
    expect(rls.find((r) => r.path.endsWith("rpc/log_audit_event"))?.body).toMatchObject({
      p_action: "invite",
      p_company_id: COMPANY,
      p_entity_id: PERSON,
    });
  });

  it("refuses someone who has already joined: no link is issued for an account they control", async () => {
    m.ctx = ownerCtx();
    const refusal = "Lee already has an account: ask them to sign in as usual. If they can't, ScaleUp can send them a sign-in link.";

    useRls({ "GET company_members": memberRow("2026-09-02T00:00:00Z") });
    expect(await issueContributorLinkAction({ companyId: COMPANY, userId: PERSON })).toEqual({ ok: false, error: refusal });

    // Signed in but not through the terms of use yet: Supabase Auth knows.
    m.getAuthUser.mockResolvedValue(authSummary("2026-09-30T08:00:00Z"));
    useRls({ "GET company_members": memberRow() });
    expect(await issueContributorLinkAction({ companyId: COMPANY, userId: PERSON })).toEqual({ ok: false, error: refusal });
    expect(m.getAuthUser).toHaveBeenCalledWith(PERSON);
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });

  it("never issues sign-in links (ScaleUp does, BRD B23)", async () => {
    m.ctx = ownerCtx();
    const result = await issueContributorLinkAction({ companyId: COMPANY, userId: PERSON, purpose: "signin" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.purpose).toBe("Only ScaleUp can send sign-in links.");
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });
});

describe("revokeTeamLinkAction", () => {
  const link = (createdBy: string | null) => ({
    id: LINK,
    userId: PERSON,
    purpose: "invite",
    createdBy,
    createdAt: "2026-09-30T00:00:00Z",
    expiresAt: "2026-10-07T00:00:00Z",
    usedAt: null,
    revokedAt: null,
  });
  const team: TeamEntry[] = [
    ownerRow,
    { user_id: CO_OWNER, role: "owner", is_active: true, email: "chong@batik.my" },
    { user_id: PERSON, role: "contributor", is_active: true, email: "lee@batik.my" },
  ];
  const onePerson = [
    { user_id: PERSON, role: "contributor", is_active: true, profile: { email: "lee@batik.my", full_name: "Lee", is_active: true, terms_accepted_at: null } },
  ];

  it("revokes a contributor's link sent by a co-owner and logs it", async () => {
    m.ctx = ownerCtx();
    m.getAccessLink.mockResolvedValue(link(CO_OWNER));
    const rls = useRls({
      "GET company_members": companyMembers(team, onePerson),
      "POST rpc/log_audit_event": { status: 204 },
    });
    expect(await revokeTeamLinkAction({ companyId: COMPANY, linkId: LINK })).toEqual({ ok: true, data: undefined });
    expect(m.revokeAccessLink).toHaveBeenCalledWith(LINK);
    expect(rls.find((r) => r.path.endsWith("rpc/log_audit_event"))?.body).toMatchObject({
      p_action: "invite_revoke",
      p_company_id: COMPANY,
      p_entity_id: PERSON,
    });
  });

  it("leaves links sent by ScaleUp alone", async () => {
    m.ctx = ownerCtx();
    m.getAccessLink.mockResolvedValue(link(STAFF));
    useRls({ "GET company_members": companyMembers(team) });
    expect(await revokeTeamLinkAction({ companyId: COMPANY, linkId: LINK })).toEqual({ ok: false, error: "Only ScaleUp can cancel this link." });
    expect(m.revokeAccessLink).not.toHaveBeenCalled();
  });
});

describe("setContributorActiveAction", () => {
  const former: TeamEntry = { user_id: PERSON, role: "contributor", is_active: false, email: "lee@batik.my" };

  it("switches off a contributor's membership only and revokes the links the owners sent them", async () => {
    m.ctx = ownerCtx();
    const rls = useRls({
      "PATCH company_members": { body: [{ user_id: PERSON }] },
      "GET company_members": { body: [{ user_id: OWNER }, { user_id: CO_OWNER }] },
    });
    expect(await setContributorActiveAction({ companyId: COMPANY, userId: PERSON, active: false })).toEqual({ ok: true, data: undefined });
    const patch = rls.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({ is_active: false });
    expect(patch?.params.get("role")).toBe("eq.contributor");
    expect(m.revokeUserAccessLinks).toHaveBeenCalledWith(PERSON, { createdBy: [OWNER, CO_OWNER] });
  });

  it("reactivating takes a place: refused with no place left, before anything changes (BRD B29)", async () => {
    m.ctx = ownerCtx();
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(4), former]),
      "POST rpc/get_client_settings": clientSettings(4),
    });
    expect(await setContributorActiveAction({ companyId: COMPANY, userId: PERSON, active: true })).toEqual({
      ok: false,
      error: "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.",
    });
    expect(rls.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("reactivates within the limit; the database's refusal (P0001) still reaches the owner", async () => {
    m.ctx = ownerCtx();
    const rls = useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(3), former]),
      "POST rpc/get_client_settings": clientSettings(4),
      "PATCH company_members": { body: [{ user_id: PERSON }] },
    });
    expect(await setContributorActiveAction({ companyId: COMPANY, userId: PERSON, active: true })).toEqual({ ok: true, data: undefined });
    expect(rls.find((r) => r.method === "PATCH")?.body).toEqual({ is_active: true });

    const message = "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more.";
    useRls({
      "GET company_members": companyMembers([ownerRow, ...contributors(3), former]),
      "POST rpc/get_client_settings": clientSettings(4),
      "PATCH company_members": { status: 400, body: pgError("P0001", message) },
    });
    expect(await setContributorActiveAction({ companyId: COMPANY, userId: PERSON, active: true })).toEqual({ ok: false, error: message });
  });

  it("owners cannot change their own access", async () => {
    m.ctx = ownerCtx();
    expect(await setContributorActiveAction({ companyId: COMPANY, userId: OWNER, active: false })).toEqual({
      ok: false,
      error: "You can't change your own access.",
    });
  });
});

describe("admin actions (Super Admin)", () => {
  it("refuses to make a company user's email ScaleUp staff, before changing anything", async () => {
    m.ctx = adminCtx;
    m.ensureAuthUser.mockResolvedValue({ user: { ...newAuthUser, email: "siti@batik.my" }, created: false });
    const rls = useRls({
      "GET profiles": { body: [{ id: PERSON, email: "siti@batik.my", full_name: "Siti", job_title: null, scaleup_role: null, is_active: true }] },
      "GET company_members": { body: [{ company_id: COMPANY, role: "owner", is_active: true, company: { name: "Batik Boutique" } }] },
    });
    const result = await inviteScaleUpUserAction({ email: "siti@batik.my", fullName: "Siti", role: "viewer" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("belongs to a company user (Batik Boutique)");
    expect(result.fieldErrors?.email).toContain("ScaleUp staff need their own account");
    expect(rls.some((r) => r.path.endsWith("rpc/admin_update_profile"))).toBe(false);
    expect(m.createAccessLink).not.toHaveBeenCalled();
  });

  it("invites a new ScaleUp user: role via admin_update_profile as the caller, then the logged link", async () => {
    m.ctx = adminCtx;
    m.ensureAuthUser.mockResolvedValue({ user: { ...newAuthUser, email: "ana@scaleup.my" }, created: true });
    m.createAccessLink.mockResolvedValue(issued);
    const rls = useRls({ "POST rpc/admin_update_profile": { status: 204 }, "POST rpc/log_audit_event": { status: 204 } });
    const result = await inviteScaleUpUserAction({ email: "ana@scaleup.my", fullName: "Ana Tan", jobTitle: "Analyst", role: "fund_admin" });
    expect(result.ok && result.data.link?.url).toBe(issued.url);
    expect(rls.find((r) => r.path.endsWith("rpc/admin_update_profile"))?.body).toEqual({
      p_user_id: PERSON,
      p_full_name: "Ana Tan",
      p_job_title: "Analyst",
      p_scaleup_role: "fund_admin",
    });
    expect(m.createAccessLink).toHaveBeenCalledWith({ userId: PERSON, purpose: "invite", createdBy: ADMIN, revokeEarlier: false });
    expect(m.revokeEarlierAccessLinks).toHaveBeenCalledWith(issued);
  });

  it("revokes the new link when its audit entry cannot be written, and leaves the earlier links working", async () => {
    m.ctx = adminCtx;
    m.ensureAuthUser.mockResolvedValue({ user: { ...newAuthUser, email: "ana@scaleup.my" }, created: true });
    m.createAccessLink.mockResolvedValue(issued);
    useRls({
      "POST rpc/admin_update_profile": { status: 204 },
      "POST rpc/log_audit_event": { status: 400, body: pgError("P0001", "The audit details are too large (64 KB maximum).") },
    });
    const result = await inviteScaleUpUserAction({ email: "ana@scaleup.my", fullName: "Ana Tan", role: "viewer" });
    expect(result).toEqual({ ok: false, error: "The audit details are too large (64 KB maximum)." });
    expect(m.revokeAccessLink).toHaveBeenCalledWith(LINK);
    // The link the person may already have keeps working: it was never revoked in the first place.
    expect(m.createAccessLink).toHaveBeenCalledWith(expect.objectContaining({ revokeEarlier: false }));
    expect(m.revokeEarlierAccessLinks).not.toHaveBeenCalled();
  });

  it("deactivating keeps the ScaleUp role and job title, then bans and revokes pending links", async () => {
    m.ctx = adminCtx;
    const rls = useRls({
      "GET profiles": { body: [{ id: STAFF, email: "renuka@scaleup.my", full_name: "Renuka", job_title: "Partner", scaleup_role: "partner", is_active: true }] },
      "POST rpc/admin_update_profile": { status: 204 },
    });
    expect(await setUserActiveAction({ userId: STAFF, active: false })).toEqual({ ok: true, data: undefined });
    expect(rls.find((r) => r.path.endsWith("rpc/admin_update_profile"))?.body).toEqual({
      p_user_id: STAFF,
      p_full_name: "Renuka",
      p_job_title: "Partner",
      p_scaleup_role: "partner",
      p_is_active: false,
    });
    expect(m.setUserBanned).toHaveBeenCalledWith(STAFF, true);
    expect(m.revokeUserAccessLinks).toHaveBeenCalledWith(STAFF);
  });

  it("company users are deactivated without a ScaleUp role (never escalated)", async () => {
    m.ctx = adminCtx;
    const rls = useRls({
      "GET profiles": { body: [{ id: PERSON, email: "lee@batik.my", full_name: null, job_title: null, scaleup_role: null, is_active: true }] },
      "POST rpc/admin_update_profile": { status: 204 },
    });
    await setUserActiveAction({ userId: PERSON, active: false });
    const body = rls.find((r) => r.path.endsWith("rpc/admin_update_profile"))?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("p_scaleup_role");
    expect(body).toMatchObject({ p_full_name: "", p_job_title: "", p_is_active: false });
  });

  it("a Super Admin cannot deactivate themselves", async () => {
    m.ctx = adminCtx;
    expect(await setUserActiveAction({ userId: ADMIN, active: false })).toEqual({
      ok: false,
      error: "You can't deactivate or reactivate your own account.",
    });
    expect(m.setUserBanned).not.toHaveBeenCalled();
  });
});
