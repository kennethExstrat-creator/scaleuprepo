// Access-link tokens (BRD B14, B23; docs/ARCHITECTURE.md §2.2 `access_links`).
//
// A link is `<site>/access/<token>`: the token is 32 random bytes in base64url (43 characters) and
// only ever appears in the link itself. The database stores the lower-case hex sha256 of the token
// string (`access_links.token_hash`), so a leaked database row cannot be turned back into a link.
//
// Server and scripts only (node:crypto; no Next.js, no "server-only"): scripts/create-user.ts and the
// unit tests import it directly. Client Components use ./purpose instead. Never log a token or a link
// built from it.
import { createHash, randomBytes } from "node:crypto";

import { ACCESS_LINK_VALIDITY_MS, type AccessLinkPurpose } from "./purpose";

export {
  ACCESS_LINK_PURPOSES,
  ACCESS_LINK_VALIDITY_MS,
  isAccessLinkPurpose,
  type AccessLinkPurpose,
} from "./purpose";

/**
 * Kept off the validity so the expiry always stays within the database's cap
 * (`access_links_max_validity`: at most 7 days / 24 hours after `created_at`, which the database sets
 * with its own clock) even when this server's clock runs slightly ahead.
 */
export const ACCESS_LINK_CLOCK_MARGIN_MS = 60 * 1000;

/** Random bytes per token (256 bits). */
export const ACCESS_TOKEN_BYTES = 32;

/** base64url without padding: 32 bytes → exactly 43 characters. */
const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A new random token (32 bytes, base64url). */
export function generateAccessToken(): string {
  return randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");
}

/** The value stored in `access_links.token_hash`: lower-case hex sha256 of the token string. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True for something shaped like one of our tokens (checked before any database lookup). */
export function isPlausibleAccessToken(value: unknown): value is string {
  return typeof value === "string" && ACCESS_TOKEN_RE.test(value);
}

/** Expiry (ISO timestamp) of a link issued at `now`: 7 days / 24 hours minus a one-minute clock margin. */
export function accessLinkExpiry(purpose: AccessLinkPurpose, now: number = Date.now()): string {
  return new Date(now + ACCESS_LINK_VALIDITY_MS[purpose] - ACCESS_LINK_CLOCK_MARGIN_MS).toISOString();
}

/**
 * The site's base URL without a trailing slash (`https://reporting.scaleup.my`), or null when `raw` is
 * not an absolute http(s) URL. A path is kept (`https://example.com/app`); query and hash are dropped.
 */
export function normaliseSiteUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** `/access/<token>` */
export function accessLinkPath(token: string): string {
  return `/access/${token}`;
}

/** The full link to send: `<site>/access/<token>`. `siteUrl` must be an absolute http(s) URL. */
export function accessLinkUrl(siteUrl: string, token: string): string {
  const base = normaliseSiteUrl(siteUrl);
  if (!base) throw new Error("The site URL for access links must be an absolute http(s) URL.");
  return `${base}${accessLinkPath(token)}`;
}
