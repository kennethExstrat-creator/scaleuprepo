// Result types shared by the Users and Team Server Actions and their Client Components (client-safe,
// types only).
import type { AccessLinkPurpose } from "./purpose";

/** A link just issued, as shown once to the issuer (the token is never stored, so it can't be shown again). */
export type IssuedLinkView = {
  url: string;
  /** ISO timestamp. */
  expiresAt: string;
  purpose: AccessLinkPurpose;
};

/** What an invitation (or a new link) produced: the link to send, or why none was needed. */
export type InviteOutcome = {
  userId: string;
  /** Display name: the full name, or the email address. */
  name: string;
  email: string;
  link: IssuedLinkView | null;
  /** Shown instead of (or next to) the link, e.g. "They already have an account: …". */
  notice: string | null;
};
