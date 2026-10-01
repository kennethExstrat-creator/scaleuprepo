"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { AUTH_SERVICE_DOWN_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import { passwordResetEmailsEnabled } from "@/lib/auth/features";
import { clientIp, consumeRateLimits, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { status: "idle" | "sent"; error: string | null; email: string };

/**
 * Sends a password-reset email (only when PASSWORD_RESET_EMAILS_ENABLED=true; see
 * `passwordResetEmailsEnabled`). Always answers with the same neutral confirmation so the form
 * cannot be used to discover which email addresses have accounts. Throttled per client IP and
 * per email address before Supabase is called.
 */
export async function requestPasswordResetAction(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const rawEmail = String(formData.get("email") ?? "").trim();
  if (!passwordResetEmailsEnabled()) {
    return {
      status: "idle",
      error: "Password reset emails aren't available. Ask ScaleUp for a new sign-in link.",
      email: rawEmail,
    };
  }

  const parsed = z.email().max(320).safeParse(rawEmail.toLowerCase());
  if (!parsed.success) {
    return { status: "idle", error: "Enter a valid email address.", email: rawEmail };
  }

  const throttle = consumeRateLimits([
    [RATE_LIMITS.passwordResetPerIp, clientIp(await headers())],
    [RATE_LIMITS.passwordResetPerEmail, parsed.data],
  ]);
  if (!throttle.ok) {
    return { status: "idle", error: "Too many reset requests. Please wait a while and try again.", email: rawEmail };
  }

  const siteUrl = getSiteUrl();
  if (!siteUrl) {
    console.error("[forgot-password] NEXT_PUBLIC_SITE_URL is not set; cannot build the reset link.");
    return { status: "sent", error: null, email: rawEmail };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl}/auth/callback?next=/set-password`,
  });
  if (error) {
    if (isAuthUnavailableError(error) && error.status !== 429) {
      return { status: "idle", error: AUTH_SERVICE_DOWN_MESSAGE, email: rawEmail };
    }
    // Logged for operators only; the user sees the same confirmation either way.
    console.error("[forgot-password] resetPasswordForEmail failed", error.code, error.message);
  }
  return { status: "sent", error: null, email: rawEmail };
}

function getSiteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}
