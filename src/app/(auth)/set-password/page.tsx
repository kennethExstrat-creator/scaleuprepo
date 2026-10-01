import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetPasswordForm } from "./_components/set-password-form";
import { IdleTimer } from "@/components/shell/idle-timer";
import { isRecentEmailLinkSession } from "@/lib/auth/password";
import { getAccessContext, getSessionClaims } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set your password" };

const MFA_THEN_BACK = "/mfa?next=/set-password";

/**
 * Two modes:
 * - "link": the session came from an invitation or password-recovery link opened less than 15
 *   minutes ago, so the user may choose a password without the current one.
 * - "change": any other session (e.g. signed in with a password). Only for fully signed-in users
 *   (active, MFA done, terms accepted), and the current password must be entered.
 * The Server Action applies the same rules.
 */
export default async function SetPasswordPage() {
  const ctx = await getAccessContext();
  if (!ctx) redirect("/login");
  if (!ctx.isActive) redirect("/no-access?reason=inactive");

  const mode = isRecentEmailLinkSession(await getSessionClaims()) ? "link" : "change";
  if (mode === "change") {
    if (ctx.mfaRequired && ctx.aal !== "aal2") redirect(MFA_THEN_BACK);
    if (!ctx.termsAccepted) redirect("/terms");
  }

  // Supabase requires an aal2 session to change the password of an account that already has
  // an authenticator (e.g. a password reset for an existing user): verify the code first.
  if (ctx.aal !== "aal2") {
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    if ((data?.totp.length ?? 0) > 0) redirect(MFA_THEN_BACK);
  }

  return (
    <>
      <SetPasswordForm mode={mode} email={ctx.email} />
      <IdleTimer />
    </>
  );
}
