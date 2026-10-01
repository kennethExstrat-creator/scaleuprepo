// Wording for the /access accept page and its Server Action (BRD B14, B23). Plain constants: safe for
// Server and Client Components.

export const ACCESS_LINK_MESSAGES = {
  /** The link could not be claimed: expired, used, revoked, deactivated account, issuer no longer allowed. */
  invalid: "This link has expired or was already used. Ask ScaleUp (or your company owner) for a new one.",
  tooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
  unavailable: "We can't check your link right now. Please try again in a minute.",
  claimedServiceDown:
    "Your link has now been used, but the sign-in service is busy, so we couldn't sign you in. Ask ScaleUp (or your company owner) for a new link.",
  claimedSignInFailed:
    "Your link has now been used, but we couldn't sign you in. Ask ScaleUp (or your company owner) for a new link.",
} as const;

export type LinkProblem = "used" | "expired" | "revoked" | "not_found" | "unavailable";

/** What the accept page says when a link cannot be used (looked up without using it). */
export const LINK_PROBLEM_COPY: Record<LinkProblem, { title: string; description: string }> = {
  used: {
    title: "This link has already been used",
    description:
      "Each link works once. If you have already set up your account, sign in with your email address and password. Otherwise, ask ScaleUp (or your company owner) for a new link.",
  },
  expired: {
    title: "This link has expired",
    description:
      "Invitation links work for 7 days and sign-in links for 24 hours. Ask ScaleUp (or your company owner) for a new one.",
  },
  revoked: {
    title: "This link is no longer valid",
    description:
      "It may have been cancelled or replaced by a newer link. Ask ScaleUp (or your company owner) for a new one.",
  },
  not_found: {
    title: "This link isn't valid",
    description:
      "Check that you opened the whole link from your message. If it still doesn't work, ask ScaleUp (or your company owner) for a new one.",
  },
  unavailable: {
    title: "We can't check this link right now",
    description: "The service is busy or unreachable. Please try again in a minute.",
  },
};
