"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isConfirmLinkType, isPlausibleTokenHash } from "./link-types";
import { AUTH_SERVICE_DOWN_MESSAGE, isAuthUnavailableError } from "@/lib/auth/availability";
import { clientIp, consumeRateLimit, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { safeNextPath } from "@/lib/auth/redirects";
import { startIdleClock } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type ConfirmLinkState = { error: string | null };

const LINK_INVALID =
  "This link is invalid, has already been used or has expired. Ask ScaleUp (or your company owner) for a new one.";

/**
 * POST from the /auth/confirm page: verifies the invitation or recovery token hash (which signs
 * the user in), starts the idle clock and continues to the validated `next` (default
 * /set-password). Server Actions only accept same-origin posts, so another site cannot submit
 * this for a visitor, and link scanners that only GET the page never use the token up.
 */
export async function confirmEmailLinkAction(
  _previous: ConfirmLinkState,
  formData: FormData,
): Promise<ConfirmLinkState> {
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  if (!isPlausibleTokenHash(tokenHash) || !isConfirmLinkType(type)) return { error: LINK_INVALID };
  const next = safeNextPath(formData.get("next"), "/set-password");

  const throttle = consumeRateLimit(RATE_LIMITS.emailLinkPerIp, clientIp(await headers()));
  if (!throttle.ok) return { error: "Too many attempts. Please wait a few minutes and try again." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    if (isAuthUnavailableError(error)) return { error: AUTH_SERVICE_DOWN_MESSAGE };
    console.warn("[auth/confirm] verifyOtp failed", error.code, error.message);
    return { error: LINK_INVALID };
  }

  // A new session: start the idle-timeout clock before the first authenticated request.
  await startIdleClock();
  redirect(next);
}
