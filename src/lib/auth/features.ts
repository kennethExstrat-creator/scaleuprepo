// Switches for auth features that depend on how the deployment is set up.

/**
 * Self-service password-reset emails. Off by default: they need working email delivery (custom
 * SMTP and the recovery template in Supabase Auth), which v1 does not have (BRD §12 open items,
 * B14: v1 uses copyable links and the email provider comes in Phase 2). Supabase's built-in
 * email service only reaches members of the Supabase organisation's team, so company users would
 * never get the link. While off, /forgot-password tells people to ask ScaleUp (or their company
 * owner) for a new sign-in link. Turn on with PASSWORD_RESET_EMAILS_ENABLED=true once SMTP is set up.
 */
export function passwordResetEmailsEnabled(): boolean {
  return process.env.PASSWORD_RESET_EMAILS_ENABLED === "true";
}
