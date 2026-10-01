// The /access/[token] accept action (docs/ARCHITECTURE.md §2.2 access_links, §4): throttle, claim the
// link atomically FIRST, then sign in, start the idle clock and redirect.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimAccessLink: vi.fn(),
  signInWithEmailLink: vi.fn(),
  startIdleClock: vi.fn(),
  calls: [] as string[],
  ip: "203.0.113.7",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": mocks.ip }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.calls.push(`redirect ${url}`);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth-admin", () => ({
  claimAccessLink: mocks.claimAccessLink,
  signInWithEmailLink: mocks.signInWithEmailLink,
}));
vi.mock("@/lib/auth/session", () => ({ startIdleClock: mocks.startIdleClock }));

import { acceptAccessLinkAction } from "@/app/access/[token]/actions";
import { ACCESS_LINK_MESSAGES } from "@/app/access/_components/messages";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { generateAccessToken } from "@/lib/auth-admin/tokens";

const INITIAL = { error: null, spent: false };

function form(token: unknown): FormData {
  const data = new FormData();
  if (typeof token === "string") data.set("token", token);
  return data;
}

beforeEach(() => {
  resetRateLimits();
  mocks.calls.length = 0;
  mocks.ip = "203.0.113.7";
  mocks.claimAccessLink.mockReset().mockImplementation(async () => {
    mocks.calls.push("claim");
    return { userId: "u1", purpose: "invite", email: "ana@scaleup.my" };
  });
  mocks.signInWithEmailLink.mockReset().mockImplementation(async (email: string) => {
    mocks.calls.push(`sign-in ${email}`);
    return { ok: true };
  });
  mocks.startIdleClock.mockReset().mockImplementation(async () => {
    mocks.calls.push("idle clock");
  });
});

describe("acceptAccessLinkAction", () => {
  it("claims the link first, then signs in, starts the idle clock and sends invitations to /set-password", async () => {
    const token = generateAccessToken();
    await expect(acceptAccessLinkAction(INITIAL, form(token))).rejects.toThrow("NEXT_REDIRECT /set-password");
    expect(mocks.claimAccessLink).toHaveBeenCalledWith(token);
    expect(mocks.calls).toEqual(["claim", "sign-in ana@scaleup.my", "idle clock", "redirect /set-password"]);
  });

  it("sends sign-in links through /mfa and then /set-password (a forgotten password, BRD B23)", async () => {
    mocks.claimAccessLink.mockResolvedValueOnce({ userId: "u1", purpose: "signin", email: "ana@scaleup.my" });
    await expect(acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).rejects.toThrow(
      "NEXT_REDIRECT /mfa?next=%2Fset-password",
    );
  });

  it("refuses a malformed token without touching the database", async () => {
    for (const token of [undefined, "", "x".repeat(42), `${"x".repeat(42)}!`]) {
      expect(await acceptAccessLinkAction(INITIAL, form(token))).toEqual({ error: ACCESS_LINK_MESSAGES.invalid, spent: true });
    }
    expect(mocks.claimAccessLink).not.toHaveBeenCalled();
  });

  it("a link that cannot be claimed (expired, used, revoked, …) never signs anyone in", async () => {
    mocks.claimAccessLink.mockResolvedValueOnce(null);
    expect(await acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).toEqual({
      error: ACCESS_LINK_MESSAGES.invalid,
      spent: true,
    });
    expect(mocks.signInWithEmailLink).not.toHaveBeenCalled();
    expect(mocks.startIdleClock).not.toHaveBeenCalled();
  });

  it("when the database is unreachable the link is not used up: try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.claimAccessLink.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { code: "" }));
    expect(await acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).toEqual({
      error: ACCESS_LINK_MESSAGES.unavailable,
      spent: false,
    });
    expect(mocks.signInWithEmailLink).not.toHaveBeenCalled();
  });

  it("a claimed link stays used when signing in fails: ask for a new link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.signInWithEmailLink.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).toEqual({
      error: ACCESS_LINK_MESSAGES.claimedServiceDown,
      spent: true,
    });
    mocks.signInWithEmailLink.mockRejectedValueOnce(new Error("boom"));
    expect(await acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).toEqual({
      error: ACCESS_LINK_MESSAGES.claimedSignInFailed,
      spent: true,
    });
    expect(mocks.startIdleClock).not.toHaveBeenCalled();
  });

  it("throttles attempts per client IP before claiming anything", async () => {
    mocks.claimAccessLink.mockResolvedValue(null);
    for (let i = 0; i < 10; i += 1) await acceptAccessLinkAction(INITIAL, form(generateAccessToken()));
    expect(mocks.claimAccessLink).toHaveBeenCalledTimes(10);
    expect(await acceptAccessLinkAction(INITIAL, form(generateAccessToken()))).toEqual({
      error: ACCESS_LINK_MESSAGES.tooManyAttempts,
      spent: false,
    });
    expect(mocks.claimAccessLink).toHaveBeenCalledTimes(10);
    // Another client is not affected.
    mocks.ip = "198.51.100.9";
    await acceptAccessLinkAction(INITIAL, form(generateAccessToken()));
    expect(mocks.claimAccessLink).toHaveBeenCalledTimes(11);
  });
});
