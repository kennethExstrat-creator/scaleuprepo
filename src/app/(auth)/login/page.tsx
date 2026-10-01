import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "./_components/login-form";
import { AUTH_SERVICE_DOWN_MESSAGE } from "@/lib/auth/availability";
import { passwordResetEmailsEnabled } from "@/lib/auth/features";
import { firstParam, safeNextPath } from "@/lib/auth/redirects";
import { getSessionClaims } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  timeout: "You were signed out after 30 minutes of inactivity.",
  password_reset: "Your password has been changed. Please sign in.",
};

function linkErrorMessage(code: string): string | null {
  if (code === "too_many_attempts") return "Too many attempts. Please wait a few minutes and try again.";
  if (code === "service_unavailable") return AUTH_SERVICE_DOWN_MESSAGE;
  if (code !== "link_invalid") return null;
  return passwordResetEmailsEnabled()
    ? 'That link is invalid or has expired. Password reset links only work once, within an hour, in the browser that requested them. Use "Forgot password?" to get a new one, or ask ScaleUp for a new invitation.'
    : "That link is invalid or has expired. Links only work once. Ask ScaleUp (or your company owner) for a new one.";
}

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(firstParam(searchParams.next));

  // Already signed in: continue (requireUser on the destination handles MFA and terms).
  if (await getSessionClaims()) redirect(next);

  const reason = firstParam(searchParams.reason);
  const error = firstParam(searchParams.error);

  return (
    <LoginForm
      next={next}
      notice={reason ? (NOTICES[reason] ?? null) : null}
      linkError={error ? linkErrorMessage(error) : null}
    />
  );
}
