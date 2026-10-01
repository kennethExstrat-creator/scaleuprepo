import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, pgError, wantsObject } from "./fake-supabase";
import {
  classifyAccessLink,
  claimLink,
  getLink,
  isOwnerLinkRefusal,
  issueAccessLink,
  ISSUER_REFUSAL_MESSAGE,
  listPendingLinks,
  OWNER_LINK_REFUSAL_MESSAGE,
  previewLink,
  revokeEarlierLinks,
  revokeLink,
  revokePendingLinks,
} from "@/lib/auth-admin/links";
import { hashAccessToken } from "@/lib/auth-admin/tokens";

const USER = "11111111-1111-4111-8111-111111111111";
const ISSUER = "22222222-2222-4222-8222-222222222222";
const LINK = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-09-30T06:00:00Z");

afterEach(() => {
  vi.restoreAllMocks();
});

function tokenFromUrl(url: string): string {
  const match = /\/access\/([A-Za-z0-9_-]{43})$/.exec(url);
  if (!match) throw new Error(`not an access link: ${url}`);
  return match[1];
}

describe("issueAccessLink", () => {
  it("stores only the token hash, with the issuer and the capped expiry, then revokes the person's earlier pending links", async () => {
    const { client, requests } = fakeSupabase((request) => {
      if (request.method === "POST" && request.path === "/rest/v1/access_links") {
        expect(wantsObject(request)).toBe(true);
        const body = request.body as Record<string, unknown>;
        return { status: 201, body: { id: LINK, expires_at: body.expires_at } };
      }
      if (request.method === "PATCH" && request.path === "/rest/v1/access_links") return { body: [{ id: "old" }] };
      return undefined;
    });

    const link = await issueAccessLink(client, {
      userId: USER,
      purpose: "invite",
      createdBy: ISSUER,
      siteUrl: "https://reporting.scaleup.my/",
      now: NOW,
    });

    expect(link.id).toBe(LINK);
    expect(link.purpose).toBe("invite");
    expect(link.userId).toBe(USER);
    expect(link.expiresAt).toBe("2026-10-07T05:59:00.000Z");
    const token = tokenFromUrl(link.url);
    expect(link.url.startsWith("https://reporting.scaleup.my/access/")).toBe(true);

    const [insert, revoke] = requests;
    expect(insert.body).toEqual({
      user_id: USER,
      purpose: "invite",
      token_hash: hashAccessToken(token),
      expires_at: "2026-10-07T05:59:00.000Z",
      created_by: ISSUER,
    });
    expect(JSON.stringify(insert.body)).not.toContain(token);
    // Earlier links: same person and purpose, unused, unrevoked, unexpired, not the new one.
    expect(revoke.method).toBe("PATCH");
    expect(Object.keys(revoke.body as object)).toEqual(["revoked_at"]);
    expect(revoke.params.get("user_id")).toBe(`eq.${USER}`);
    expect(revoke.params.get("purpose")).toBe("eq.invite");
    expect(revoke.params.get("used_at")).toBe("is.null");
    expect(revoke.params.get("revoked_at")).toBe("is.null");
    expect(revoke.params.get("expires_at")).toBe(`gt.${new Date(NOW).toISOString()}`);
    expect(revoke.params.get("id")).toBe(`neq.${LINK}`);
  });

  it("sign-in links expire after 24 hours; a trusted script issues them with created_by null", async () => {
    const { client, requests } = fakeSupabase((request) => {
      if (request.method === "POST") return { status: 201, body: { id: LINK, expires_at: (request.body as { expires_at: string }).expires_at } };
      if (request.method === "PATCH") return { body: [] };
      return undefined;
    });
    const link = await issueAccessLink(client, { userId: USER, purpose: "signin", createdBy: null, siteUrl: "http://localhost:3000", now: NOW });
    expect(link.expiresAt).toBe("2026-10-01T05:59:00.000Z");
    expect((requests[0].body as { created_by: unknown }).created_by).toBeNull();
    expect(requests[1].params.get("purpose")).toBe("eq.signin");
  });

  it("throws the database's refusal unchanged and revokes nothing (earlier links keep working)", async () => {
    const { client, requests } = fakeSupabase((request) =>
      request.method === "POST" ? { status: 403, body: pgError("42501", OWNER_LINK_REFUSAL_MESSAGE) } : undefined,
    );
    const error = await issueAccessLink(client, { userId: USER, purpose: "invite", createdBy: ISSUER, siteUrl: "https://x.my", now: NOW }).catch(
      (e: unknown) => e,
    );
    expect(isOwnerLinkRefusal(error)).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("refuses a site URL that is not absolute before storing anything", async () => {
    const { client, requests } = fakeSupabase(() => undefined);
    await expect(issueAccessLink(client, { userId: USER, purpose: "invite", createdBy: ISSUER, siteUrl: "/" })).rejects.toThrow(
      /absolute http/,
    );
    expect(requests).toHaveLength(0);
  });

  it("still returns the new link when revoking the older ones fails (logged without the token)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeSupabase((request) => {
      if (request.method === "POST") return { status: 201, body: { id: LINK, expires_at: "2026-10-07T05:59:00.000Z" } };
      if (request.method === "PATCH") return { status: 500, body: pgError("XX000", "boom") };
      return undefined;
    });
    const link = await issueAccessLink(client, { userId: USER, purpose: "invite", createdBy: ISSUER, siteUrl: "https://x.my", now: NOW });
    expect(link.id).toBe(LINK);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(tokenFromUrl(link.url));
  });

  it("with revokeEarlier: false leaves the earlier links alone, for the caller to revoke once the link is recorded", async () => {
    const { client, requests } = fakeSupabase((request) =>
      request.method === "POST" ? { status: 201, body: { id: LINK, expires_at: "2026-10-07T05:59:00.000Z" } } : undefined,
    );
    const link = await issueAccessLink(client, {
      userId: USER,
      purpose: "invite",
      createdBy: ISSUER,
      siteUrl: "https://x.my",
      now: NOW,
      revokeEarlier: false,
    });
    expect(link.id).toBe(LINK);
    expect(requests.map((request) => request.method)).toEqual(["POST"]);
  });
});

describe("revokeEarlierLinks", () => {
  const link = { id: LINK, userId: USER, purpose: "signin" as const };

  it("revokes the person's other pending links of the same purpose, never the new one", async () => {
    const { client, requests } = fakeSupabase((request) => (request.method === "PATCH" ? { body: [{ id: "old" }] } : undefined));
    expect(await revokeEarlierLinks(client, link, NOW)).toBe(1);
    const [revoke] = requests;
    expect(Object.keys(revoke.body as object)).toEqual(["revoked_at"]);
    expect(revoke.params.get("user_id")).toBe(`eq.${USER}`);
    expect(revoke.params.get("purpose")).toBe("eq.signin");
    expect(revoke.params.get("id")).toBe(`neq.${LINK}`);
    expect(revoke.params.get("used_at")).toBe("is.null");
    expect(revoke.params.get("revoked_at")).toBe("is.null");
    expect(revoke.params.get("expires_at")).toBe(`gt.${new Date(NOW).toISOString()}`);
  });

  it("never throws: a failure is logged (ids only) and counts as nothing revoked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = fakeSupabase(() => ({ status: 500, body: pgError("XX000", "boom") }));
    expect(await revokeEarlierLinks(client, link, NOW)).toBe(0);
    expect(warn).toHaveBeenCalledWith("[access-links] could not revoke earlier links", { userId: USER, error: "boom" });
  });
});

describe("isOwnerLinkRefusal", () => {
  it("recognises only the owner-specific 42501 of the issuer guard (BRD B29)", () => {
    expect(isOwnerLinkRefusal(pgError("42501", OWNER_LINK_REFUSAL_MESSAGE))).toBe(true);
    expect(isOwnerLinkRefusal(pgError("42501", ISSUER_REFUSAL_MESSAGE))).toBe(false);
    expect(isOwnerLinkRefusal(pgError("P0001", OWNER_LINK_REFUSAL_MESSAGE))).toBe(false);
    expect(isOwnerLinkRefusal(new Error(OWNER_LINK_REFUSAL_MESSAGE))).toBe(false);
    expect(isOwnerLinkRefusal(null)).toBe(false);
  });
});

describe("revoking", () => {
  it("revokeLink only touches an unused, unrevoked link and returns it (or null)", async () => {
    const row = {
      id: LINK,
      user_id: USER,
      purpose: "signin",
      created_by: ISSUER,
      created_at: "2026-09-30T05:00:00Z",
      expires_at: "2026-10-01T04:59:00Z",
      used_at: null,
      revoked_at: "2026-09-30T06:00:00Z",
    };
    let rows: unknown[] = [row];
    const { client, requests } = fakeSupabase((request) => (request.method === "PATCH" ? { body: rows } : undefined));
    expect(await revokeLink(client, LINK)).toEqual({
      id: LINK,
      userId: USER,
      purpose: "signin",
      createdBy: ISSUER,
      createdAt: "2026-09-30T05:00:00Z",
      expiresAt: "2026-10-01T04:59:00Z",
      usedAt: null,
      revokedAt: "2026-09-30T06:00:00Z",
    });
    expect(requests[0].params.get("id")).toBe(`eq.${LINK}`);
    expect(requests[0].params.get("used_at")).toBe("is.null");
    expect(requests[0].params.get("revoked_at")).toBe("is.null");
    rows = [];
    expect(await revokeLink(client, LINK)).toBeNull();
  });

  it("revokePendingLinks can be limited to a purpose and to links sent by given issuers", async () => {
    const { client, requests } = fakeSupabase((request) => (request.method === "PATCH" ? { body: [{ id: "a" }, { id: "b" }] } : undefined));
    expect(await revokePendingLinks(client, { userId: USER, createdBy: [ISSUER], now: NOW })).toBe(2);
    expect(requests[0].params.get("created_by")).toBe(`in.(${ISSUER})`);
    expect(requests[0].params.get("purpose")).toBeNull();
    expect(await revokePendingLinks(client, { userId: USER, createdBy: [] })).toBe(0);
    expect(requests).toHaveLength(1);
  });
});

describe("listing", () => {
  it("lists pending links without token hashes, newest first, optionally for some people only", async () => {
    const { client, requests } = fakeSupabase((request) =>
      request.method === "GET"
        ? {
            body: [
              { id: "l2", user_id: USER, purpose: "signin", created_by: null, created_at: "2026-09-30T05:00:00Z", expires_at: "2026-10-01T04:59:00Z" },
              { id: "l1", user_id: USER, purpose: "bogus", created_by: ISSUER, created_at: "2026-09-29T05:00:00Z", expires_at: "2026-10-06T04:59:00Z" },
            ],
          }
        : undefined,
    );
    const links = await listPendingLinks(client, { userIds: [USER, USER], now: NOW });
    expect(links).toEqual([
      { id: "l2", userId: USER, purpose: "signin", createdBy: null, createdAt: "2026-09-30T05:00:00Z", expiresAt: "2026-10-01T04:59:00Z" },
    ]);
    const params = requests[0].params;
    expect(params.get("select")).toBe("id,user_id,purpose,created_by,created_at,expires_at");
    expect(params.get("select")).not.toContain("token_hash");
    expect(params.get("used_at")).toBe("is.null");
    expect(params.get("revoked_at")).toBe("is.null");
    expect(params.get("expires_at")).toBe(`gt.${new Date(NOW).toISOString()}`);
    expect(params.get("user_id")).toBe(`in.(${USER})`);
    expect(params.get("order")).toBe("created_at.desc");
    expect(await listPendingLinks(client, { userIds: [] })).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("getLink returns a link without its hash, or null", async () => {
    const { client } = fakeSupabase((request) => (request.method === "GET" ? { body: [] } : undefined));
    expect(await getLink(client, LINK)).toBeNull();
  });
});

describe("the accept page", () => {
  const valid = {
    purpose: "invite",
    expires_at: "2026-10-07T05:59:00Z",
    used_at: null,
    revoked_at: null,
    user: { email: "ana@scaleup.my", full_name: "Ana Tan", is_active: true },
  };

  it("classifies a looked-up link and only reveals who a valid link is for", () => {
    expect(classifyAccessLink(valid, NOW)).toEqual({
      status: "valid",
      purpose: "invite",
      email: "ana@scaleup.my",
      fullName: "Ana Tan",
      expiresAt: "2026-10-07T05:59:00Z",
    });
    expect(classifyAccessLink(null, NOW)).toEqual({ status: "not_found" });
    expect(classifyAccessLink({ ...valid, purpose: "reset" }, NOW)).toEqual({ status: "not_found" });
    expect(classifyAccessLink({ ...valid, used_at: "2026-09-30T05:00:00Z" }, NOW)).toEqual({ status: "used" });
    expect(classifyAccessLink({ ...valid, revoked_at: "2026-09-30T05:00:00Z" }, NOW)).toEqual({ status: "revoked" });
    expect(classifyAccessLink({ ...valid, user: { ...valid.user, is_active: false } }, NOW)).toEqual({ status: "revoked" });
    expect(classifyAccessLink({ ...valid, user: null }, NOW)).toEqual({ status: "revoked" });
    expect(classifyAccessLink({ ...valid, expires_at: "2026-09-30T06:00:00Z" }, NOW)).toEqual({ status: "expired" });
    expect(classifyAccessLink({ ...valid, expires_at: "garbage" }, NOW)).toEqual({ status: "expired" });
    // A used link reads "used" even when it has also expired since.
    expect(classifyAccessLink({ ...valid, used_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-02T00:00:00Z" }, NOW)).toEqual({
      status: "used",
    });
  });

  it("previewLink looks the link up by hash with a GET only (it never uses the link)", async () => {
    const token = "a".repeat(43);
    const { client, requests } = fakeSupabase((request) => (request.method === "GET" ? { body: [valid] } : undefined));
    expect((await previewLink(client, token, NOW)).status).toBe("valid");
    expect(requests).toHaveLength(1);
    expect(requests[0].params.get("token_hash")).toBe(`eq.${hashAccessToken(token)}`);
    expect(requests[0].params.get("select")).toContain("user:profiles!access_links_user_id_fkey(email,full_name,is_active)");
  });

  it("claimLink uses claim_access_link with the token's hash and returns the account, or null", async () => {
    const token = "b".repeat(43);
    let reply: unknown[] = [{ user_id: USER, purpose: "signin", email: "ana@scaleup.my" }];
    const { client, requests } = fakeSupabase((request) =>
      request.method === "POST" && request.path === "/rest/v1/rpc/claim_access_link" ? { body: reply } : undefined,
    );
    expect(await claimLink(client, token)).toEqual({ userId: USER, purpose: "signin", email: "ana@scaleup.my" });
    expect(requests[0].body).toEqual({ p_token_hash: hashAccessToken(token) });
    reply = [];
    expect(await claimLink(client, token)).toBeNull();
  });

  it("claimLink throws when the database cannot be reached", async () => {
    const { client } = fakeSupabase(() => ({ status: 503, body: pgError("PGRST000", "unavailable") }));
    await expect(claimLink(client, "c".repeat(43))).rejects.toMatchObject({ code: "PGRST000" });
  });
});
