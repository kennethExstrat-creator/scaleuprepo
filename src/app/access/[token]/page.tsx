import type { Metadata } from "next";
import { connection } from "next/server";

import { AcceptLinkForm } from "./_components/accept-link-form";
import { LinkProblemCard } from "../_components/link-problem-card";
import { AuthShell } from "@/components/shell/auth-shell";
import { previewAccessLink, type AccessLinkPreview } from "@/lib/auth-admin";
import { isPlausibleAccessToken } from "@/lib/auth-admin/tokens";

export const metadata: Metadata = {
  title: "Your access link",
  // The URL carries a single-use token: never send it on in a Referer header.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Public accept page for our own invitation and sign-in links (BRD B14, B23; module M2):
 * `/access/<token>`. Opening it (GET) never signs anyone in and never uses the link up: it only looks
 * the link up (service role, read-only) to say who it is for and shows an "Accept invitation" /
 * "Sign in" button. The link is used by `acceptAccessLinkAction` when that button is pressed.
 * It does not read or refresh the visitor's current session (the proxy leaves /access alone).
 */
export default async function AccessLinkPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const preview: AccessLinkPreview | { status: "unavailable" } = isPlausibleAccessToken(token)
    ? await previewAccessLink(token)
    : { status: "not_found" };

  return (
    <AuthShell>
      {preview.status === "valid" ? (
        <AcceptLinkForm
          token={token}
          purpose={preview.purpose}
          email={preview.email}
          fullName={preview.fullName}
          expiresAt={preview.expiresAt}
        />
      ) : (
        <LinkProblemCard problem={preview.status} retryHref={`/access/${token}`} />
      )}
    </AuthShell>
  );
}
