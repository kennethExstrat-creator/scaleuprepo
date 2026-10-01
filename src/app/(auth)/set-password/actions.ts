"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-rules";
import { toActionError } from "@/lib/actions/result";
import { AUTH_SERVICE_DOWN_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import { passwordResetEmailsEnabled } from "@/lib/auth/features";
import { isRecentEmailLinkSession, verifyCurrentPassword } from "@/lib/auth/password";
import { clientIp, consumeRateLimits, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { getAccessContext, getSessionClaims, type AccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type SetPasswordMode = "link" | "change";

export type SetPasswordState = {
  error: string | null;
  fieldErrors: { current?: string; password?: string; confirm?: string };
  /** A password change ("change" mode) succeeded; the form shows a confirmation. */
  done?: boolean;
};

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords don't match.",
  });

const fail = (error: string): SetPasswordState => ({ error, fieldErrors: {} });

/** Where to get a fresh link, depending on whether self-service reset emails are switched on. */
function newLinkAdvice(): string {
  return passwordResetEmailsEnabled()
    ? 'Use "Forgot password?" on the sign-in page to get a new link.'
    : "Ask ScaleUp (or your company owner) for a new sign-in link.";
}

/**
 * Sets or changes the signed-in user's password.
 * - Session from an invitation or recovery link opened in the last 15 minutes: no current
 *   password needed; continues to /mfa when two-factor authentication is still needed, else "/".
 * - Any other session: the user must be fully signed in and confirm the current password.
 */
export async function setPasswordAction(_previous: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const parsed = passwordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: SetPasswordState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "password" || key === "confirm") && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: null, fieldErrors };
  }

  let ctx: AccessContext | null;
  try {
    ctx = await getAccessContext();
  } catch (e) {
    const result = toActionError(e);
    return fail(result.ok ? AUTH_SERVICE_DOWN_MESSAGE : result.error);
  }
  if (!ctx) return fail("Your session has expired. Please sign in again.");
  if (!ctx.isActive) return fail("Your account is inactive. Please contact ScaleUp.");

  const mode: SetPasswordMode = isRecentEmailLinkSession(await getSessionClaims()) ? "link" : "change";

  if (mode === "change") {
    if (formData.get("mode") === "link") {
      // The form was opened from an email link whose 15-minute window has since passed.
      return fail(`For security, a link can only be used to set a password within 15 minutes. ${newLinkAdvice()}`);
    }
    if (ctx.mfaRequired && ctx.aal !== "aal2") redirect("/mfa?next=/set-password");
    if (!ctx.termsAccepted) redirect("/terms");

    const current = String(formData.get("current") ?? "");
    if (!current) return { error: null, fieldErrors: { current: "Enter your current password." } };
    if (current.length > 200) return { error: null, fieldErrors: { current: "That isn't your current password." } };

    const throttle = consumeRateLimits([
      [RATE_LIMITS.signInPerIp, clientIp(await headers())],
      [RATE_LIMITS.signInPerEmail, ctx.email],
    ]);
    if (!throttle.ok) return fail("Too many attempts. Please wait a few minutes and try again.");

    const check = await verifyCurrentPassword(ctx.email, current);
    if (check === "invalid") return { error: null, fieldErrors: { current: "That isn't your current password." } };
    if (check === "unavailable") return fail(AUTH_SERVICE_DOWN_MESSAGE);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "insufficient_aal") {
      // Accounts with an authenticator need a verified code before the password can change.
      redirect("/mfa?next=/set-password");
    }
    if (error.code === "same_password") {
      return { error: null, fieldErrors: { password: "Choose a password you haven't used before." } };
    }
    if (error.code === "weak_password") {
      return { error: null, fieldErrors: { password: "That password is too easy to guess. Try a longer passphrase." } };
    }
    if (error.code === "reauthentication_needed") {
      return fail(
        mode === "change"
          ? "For security, sign out and sign in again, then change your password."
          : `For security, this link can no longer be used to set a password. ${newLinkAdvice()}`,
      );
    }
    if (isAuthUnavailableError(error)) return fail(AUTH_SERVICE_DOWN_MESSAGE);
    console.error("[set-password] updateUser failed", error.code, error.message);
    return fail("We couldn't update your password. Please try again.");
  }

  if (mode === "change") return { error: null, fieldErrors: {}, done: true };
  redirect(ctx.mfaRequired && ctx.aal !== "aal2" ? "/mfa" : "/");
}
