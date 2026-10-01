import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ACCESS_LINK_CLOCK_MARGIN_MS,
  ACCESS_LINK_PURPOSES,
  ACCESS_LINK_VALIDITY_MS,
  accessLinkExpiry,
  accessLinkPath,
  accessLinkUrl,
  generateAccessToken,
  hashAccessToken,
  isAccessLinkPurpose,
  isPlausibleAccessToken,
  normaliseSiteUrl,
} from "@/lib/auth-admin/tokens";
import { ACCESS_LINK_VALIDITY_LABELS } from "@/lib/auth-admin/purpose";

const DAY = 24 * 60 * 60 * 1000;

describe("access tokens", () => {
  it("are 32 random bytes in base64url: 43 URL-safe characters, never repeated", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = generateAccessToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);
  });

  it("are stored as the lower-case hex sha256 of the token string (what access_links.token_hash accepts)", () => {
    expect(hashAccessToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const token = generateAccessToken();
    const hash = hashAccessToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashAccessToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("only plausible tokens reach the database", () => {
    expect(isPlausibleAccessToken(generateAccessToken())).toBe(true);
    for (const value of [
      undefined,
      null,
      42,
      "",
      "short",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}=`,
      `${"a".repeat(42)}/`,
      `${"a".repeat(42)} `,
      "../../etc/passwd".padEnd(43, "a"),
    ]) {
      expect(isPlausibleAccessToken(value), String(value)).toBe(false);
    }
  });
});

describe("validity", () => {
  it("invitations last 7 days and sign-in links 24 hours, minus a one-minute clock margin", () => {
    expect(ACCESS_LINK_PURPOSES).toEqual(["invite", "signin"]);
    expect(ACCESS_LINK_VALIDITY_MS).toEqual({ invite: 7 * DAY, signin: DAY });
    expect(ACCESS_LINK_VALIDITY_LABELS).toEqual({ invite: "7 days", signin: "24 hours" });
    const now = Date.parse("2026-09-30T06:00:00Z");
    expect(accessLinkExpiry("invite", now)).toBe("2026-10-07T05:59:00.000Z");
    expect(accessLinkExpiry("signin", now)).toBe("2026-10-01T05:59:00.000Z");
    expect(ACCESS_LINK_CLOCK_MARGIN_MS).toBe(60_000);
  });

  it("stays inside the database cap (access_links_max_validity) even when this clock is up to a minute ahead", () => {
    const appNow = Date.parse("2026-09-30T06:00:00Z");
    const dbNow = appNow - 59_000;
    for (const purpose of ACCESS_LINK_PURPOSES) {
      const expires = Date.parse(accessLinkExpiry(purpose, appNow));
      expect(expires).toBeLessThanOrEqual(dbNow + ACCESS_LINK_VALIDITY_MS[purpose]);
      expect(expires).toBeGreaterThan(dbNow);
    }
  });

  it("recognises the two purposes only", () => {
    expect(isAccessLinkPurpose("invite")).toBe(true);
    expect(isAccessLinkPurpose("signin")).toBe(true);
    expect(isAccessLinkPurpose("recovery")).toBe(false);
    expect(isAccessLinkPurpose(undefined)).toBe(false);
  });
});

describe("links", () => {
  it("normalises the site URL (absolute http(s), no trailing slash, no query)", () => {
    expect(normaliseSiteUrl("https://reporting.scaleup.my/")).toBe("https://reporting.scaleup.my");
    expect(normaliseSiteUrl(" https://reporting.scaleup.my ")).toBe("https://reporting.scaleup.my");
    expect(normaliseSiteUrl("https://example.com/app//?x=1#y")).toBe("https://example.com/app");
    expect(normaliseSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of [undefined, null, "", "reporting.scaleup.my", "/relative", "javascript:alert(1)", "ftp://x.y", "https://user:pw@x.y"]) {
      expect(normaliseSiteUrl(bad), String(bad)).toBeNull();
    }
  });

  it("builds <site>/access/<token>", () => {
    const token = generateAccessToken();
    expect(accessLinkPath(token)).toBe(`/access/${token}`);
    expect(accessLinkUrl("https://reporting.scaleup.my/", token)).toBe(`https://reporting.scaleup.my/access/${token}`);
    expect(() => accessLinkUrl("not a url", token)).toThrow(/absolute http/);
  });
});
