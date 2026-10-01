import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { authUser, fakeSupabase, type FakeReply } from "./fake-supabase";
import {
  BAN_DURATION_DEACTIVATED,
  BAN_DURATION_NONE,
  ensureAuthUserWith,
  findAuthUserByEmail,
  hasVerifiedTotp,
  isBannedUntil,
  listAllAuthUsers,
  normaliseEmail,
  removeAllFactors,
  setBanned,
  summariseAuthUser,
} from "@/lib/auth-admin/users";

const NOW = Date.parse("2026-09-30T06:00:00Z");
const U1 = "11111111-1111-4111-8111-111111111111";
const FACTOR_IDS: Record<string, string> = {
  verified: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unverified: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function factor(status: "verified" | "unverified", type: "totp" | "phone" = "totp") {
  return { id: FACTOR_IDS[status], factor_type: type, status, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
}

function user(overrides: Partial<User> & { id: string; email: string }): User {
  return { app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-09-01T00:00:00Z", ...overrides };
}

describe("account summaries", () => {
  it("2FA counts only a verified authenticator app", () => {
    expect(hasVerifiedTotp([factor("verified")])).toBe(true);
    expect(hasVerifiedTotp([factor("unverified")])).toBe(false);
    expect(hasVerifiedTotp([factor("verified", "phone")])).toBe(false);
    expect(hasVerifiedTotp([])).toBe(false);
    expect(hasVerifiedTotp(undefined)).toBe(false);
  });

  it("a ban counts while it lasts", () => {
    expect(isBannedUntil("2126-09-30T06:00:00Z", NOW)).toBe(true);
    expect(isBannedUntil("2026-09-29T06:00:00Z", NOW)).toBe(false);
    expect(isBannedUntil("none", NOW)).toBe(false);
    expect(isBannedUntil(null, NOW)).toBe(false);
    expect(isBannedUntil(undefined, NOW)).toBe(false);
  });

  it("summarises last sign-in, 2FA and bans; unknown 2FA only when Supabase did not report factors", () => {
    const signedIn = user({
      id: "u1",
      email: "ana@scaleup.my",
      last_sign_in_at: "2026-09-29T01:00:00Z",
      factors: [factor("verified")] as User["factors"],
    });
    expect(summariseAuthUser(signedIn, { now: NOW })).toEqual({
      id: "u1",
      email: "ana@scaleup.my",
      lastSignInAt: "2026-09-29T01:00:00Z",
      mfaEnrolled: true,
      banned: false,
      createdAt: "2026-09-01T00:00:00Z",
    });
    const invited = user({ id: "u2", email: "new@batik.my", banned_until: "2126-01-01T00:00:00Z" });
    expect(summariseAuthUser(invited, { now: NOW })).toMatchObject({ lastSignInAt: null, mfaEnrolled: false, banned: true });
    expect(summariseAuthUser(invited, { factorsReported: false, now: NOW }).mfaEnrolled).toBeNull();
    expect(summariseAuthUser(signedIn, { factorsReported: false, now: NOW }).mfaEnrolled).toBe(true);
  });

  it("normalises emails like Supabase Auth stores them", () => {
    expect(normaliseEmail("  Ana.Tan@ScaleUp.MY ")).toBe("ana.tan@scaleup.my");
  });
});

describe("finding and creating accounts", () => {
  it("pages through the account list (1,000 per request) and matches the email case-insensitively", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => authUser({ id: `p1-${i}`, email: `person${i}@x.my` }));
    const page2 = [authUser({ id: "target", email: "Siti@Batik.my" })];
    const { client, requests } = fakeSupabase((request) => {
      if (request.path !== "/auth/v1/admin/users") return undefined;
      return { body: { users: request.params.get("page") === "1" ? page1 : page2, aud: "authenticated" } };
    });
    expect((await findAuthUserByEmail(client, " siti@batik.MY "))?.id).toBe("target");
    expect(requests.map((r) => [r.params.get("page"), r.params.get("per_page")])).toEqual([
      ["1", "1000"],
      ["2", "1000"],
    ]);
    expect(await listAllAuthUsers(client)).toHaveLength(1001);
    expect(await findAuthUserByEmail(client, "nobody@x.my")).toBeNull();
  });

  it("keeps reading when the server caps the page size but reports a next page", async () => {
    const { client, requests } = fakeSupabase((request): FakeReply | undefined => {
      if (request.path !== "/auth/v1/admin/users") return undefined;
      const page = request.params.get("page");
      if (page === "1") {
        return {
          body: { users: [authUser({ id: "a", email: "a@x.my" }), authUser({ id: "b", email: "b@x.my" })], aud: "authenticated" },
          headers: { "x-total-count": "3", link: '</admin/users?page=2&per_page=1000>; rel="next"' },
        };
      }
      return { body: { users: [authUser({ id: "c", email: "c@x.my" })], aud: "authenticated" }, headers: { "x-total-count": "3" } };
    });
    expect((await listAllAuthUsers(client)).map((u) => u.id)).toEqual(["a", "b", "c"]);
    expect((await findAuthUserByEmail(client, "C@x.my"))?.id).toBe("c");
    expect(requests.map((r) => r.params.get("page"))).toEqual(["1", "2", "1", "2"]);
  });

  it("returns an existing account unchanged", async () => {
    const existing = authUser({ id: "u1", email: "ana@scaleup.my", last_sign_in_at: "2026-09-01T00:00:00Z" });
    const { client, requests } = fakeSupabase((request) =>
      request.method === "GET" ? { body: { users: [existing], aud: "authenticated" } } : undefined,
    );
    const result = await ensureAuthUserWith(client, { email: "ANA@scaleup.my", fullName: "Ana" });
    expect(result.created).toBe(false);
    expect(result.user.id).toBe("u1");
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("creates a missing account with a confirmed email, no password and the full name", async () => {
    const { client, requests } = fakeSupabase((request) => {
      if (request.method === "GET") return { body: { users: [], aud: "authenticated" } };
      if (request.method === "POST" && request.path === "/auth/v1/admin/users") {
        return { body: authUser({ id: "new", email: "siti@batik.my" }) };
      }
      return undefined;
    });
    const result = await ensureAuthUserWith(client, { email: " Siti@Batik.my ", fullName: " Siti Aminah " });
    expect(result).toMatchObject({ created: true, user: { id: "new" } });
    const create = requests.find((r) => r.method === "POST");
    expect(create?.body).toEqual({ email: "siti@batik.my", email_confirm: true, user_metadata: { full_name: "Siti Aminah" } });
    expect(create?.body).not.toHaveProperty("password");
  });

  it("uses the account someone else created at the same moment", async () => {
    let listed = 0;
    const { client } = fakeSupabase((request) => {
      if (request.method === "GET") {
        listed += 1;
        return { body: { users: listed === 1 ? [] : [authUser({ id: "raced", email: "siti@batik.my" })], aud: "authenticated" } };
      }
      if (request.method === "POST") return { status: 422, body: { error_code: "email_exists", msg: "A user with this email address has already been registered" } };
      return undefined;
    });
    expect(await ensureAuthUserWith(client, { email: "siti@batik.my", fullName: "Siti" })).toMatchObject({
      created: false,
      user: { id: "raced" },
    });
  });

  it("throws other Auth errors", async () => {
    const { client } = fakeSupabase((request) => {
      if (request.method === "GET") return { body: { users: [], aud: "authenticated" } };
      return { status: 400, body: { error_code: "validation_failed", msg: "Unable to validate email address: invalid format" } };
    });
    await expect(ensureAuthUserWith(client, { email: "bad", fullName: "X" })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("bans and 2FA resets", () => {
  it("bans a deactivated account for 100 years and lifts the ban again", async () => {
    const { client, requests } = fakeSupabase((request) =>
      request.method === "PUT" && request.path === `/auth/v1/admin/users/${U1}` ? { body: authUser({ id: U1, email: "a@b.my" }) } : undefined,
    );
    await setBanned(client, U1, true);
    await setBanned(client, U1, false);
    expect(requests.map((r) => r.body)).toEqual([{ ban_duration: BAN_DURATION_DEACTIVATED }, { ban_duration: BAN_DURATION_NONE }]);
    expect(BAN_DURATION_DEACTIVATED).toBe("876000h");
  });

  it("removes every factor of the account and counts them", async () => {
    const { client, requests } = fakeSupabase((request) => {
      if (request.method === "GET" && request.path === `/auth/v1/admin/users/${U1}/factors`) {
        return { body: [factor("verified"), factor("unverified")] };
      }
      if (request.method === "DELETE") return { body: { id: request.path.split("/").pop() } };
      return undefined;
    });
    expect(await removeAllFactors(client, U1)).toBe(2);
    expect(requests.filter((r) => r.method === "DELETE").map((r) => r.path)).toEqual([
      `/auth/v1/admin/users/${U1}/factors/${FACTOR_IDS.verified}`,
      `/auth/v1/admin/users/${U1}/factors/${FACTOR_IDS.unverified}`,
    ]);
  });
});
