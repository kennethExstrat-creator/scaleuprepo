// Email-link types /auth/confirm accepts. Only the flows v1 uses: invitations and password
// recovery. Magic-link, signup and email-change tokens are refused, so a token hash from some
// other flow cannot be used to sign a visitor into another account (login CSRF).
export const CONFIRM_LINK_TYPES = ["invite", "recovery"] as const;
export type ConfirmLinkType = (typeof CONFIRM_LINK_TYPES)[number];

export function isConfirmLinkType(value: unknown): value is ConfirmLinkType {
  return typeof value === "string" && (CONFIRM_LINK_TYPES as readonly string[]).includes(value);
}

/** Token hashes are hex digests; anything else is not worth sending to Supabase. */
export function isPlausibleTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,256}$/.test(value);
}
