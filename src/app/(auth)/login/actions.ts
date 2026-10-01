"use server";

import type { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AUTH_SERVICE_DOWN_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import { clientIp, consumeRateLimits, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { safeNextPath, withNext } from "@/lib/auth/redirects";
import { startIdleClock } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null; email: string };

const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Please wait a few minutes and try again.";

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

/** Email + password sign-in. On success continues to /mfa (when required) or the validated `next`. */
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = String(formData.get("email") ?? "").trim();
  const parsed = loginSchema.safeParse({
    email: rawEmail.toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Enter your email address and password.", email: rawEmail };
  }
  const next = safeNextPath(formData.get("next"));

  // Our own limits per client IP and per account come first, so one client cannot use up the
  // server's shared Supabase sign-in budget and lock everyone out.
  const ip = clientIp(await headers());
  const throttle = consumeRateLimits([
    [RATE_LIMITS.signInPerIp, ip],
    [RATE_LIMITS.signInPerEmail, parsed.data.email],
  ]);
  if (!throttle.ok) return { error: TOO_MANY_ATTEMPTS, email: rawEmail };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: signInErrorMessage(error), email: rawEmail };
  }

  // Start the idle-timeout clock (checked by the proxy on every request).
  await startIdleClock();

  // A password sign-in is always aal1: go through /mfa unless the platform does not require it.
  // (get_client_settings() works for aal1 sessions; the settings table itself is ScaleUp-only.)
  const { data: settings } = await supabase.rpc("get_client_settings").maybeSingle();
  const requireMfa = settings?.require_mfa ?? true;

  redirect(requireMfa ? withNext("/mfa", next) : next);
}

function signInErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Your email address hasn't been confirmed yet. Use the link in your invitation email.";
    case "user_banned":
      return "Your account has been deactivated. Contact ScaleUp if you think this is a mistake.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return TOO_MANY_ATTEMPTS;
  }
  if (error.status === 429) return TOO_MANY_ATTEMPTS;
  if (isAuthUnavailableError(error)) return AUTH_SERVICE_DOWN_MESSAGE;
  if (error.status === 400) return "Incorrect email or password.";
  console.error("[login] sign-in failed", error.code, error.message);
  return "We couldn't sign you in. Please try again.";
}
