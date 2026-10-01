// Access-link purposes and validity (BRD B14, B23). Pure and client-safe (no node:crypto): Client
// Components, schemas and scripts may import it.

export const ACCESS_LINK_PURPOSES = ["invite", "signin"] as const;
/** `invite` = first sign-in (choose a password); `signin` = a new sign-in link (forgotten password, B23). */
export type AccessLinkPurpose = (typeof ACCESS_LINK_PURPOSES)[number];

const HOUR_MS = 60 * 60 * 1000;

/** How long a new link stays valid: invitations 7 days, sign-in links 24 hours (BRD B14, B23). */
export const ACCESS_LINK_VALIDITY_MS: Readonly<Record<AccessLinkPurpose, number>> = {
  invite: 7 * 24 * HOUR_MS,
  signin: 24 * HOUR_MS,
};

/** "7 days" / "24 hours", for copy that explains how long a link works. */
export const ACCESS_LINK_VALIDITY_LABELS: Readonly<Record<AccessLinkPurpose, string>> = {
  invite: "7 days",
  signin: "24 hours",
};

export function isAccessLinkPurpose(value: unknown): value is AccessLinkPurpose {
  return typeof value === "string" && (ACCESS_LINK_PURPOSES as readonly string[]).includes(value);
}
