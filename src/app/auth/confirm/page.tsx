import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConfirmLinkForm } from "./_components/confirm-link-form";
import { isConfirmLinkType, isPlausibleTokenHash } from "./link-types";
import { AuthShell } from "@/components/shell/auth-shell";
import { firstParam, safeNextPath } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  title: "Continue",
  // The URL carries a single-use token: never send it on in a Referer header.
  referrer: "no-referrer",
};

/**
 * Landing page for invitation and password-recovery emails:
 * `/auth/confirm?token_hash=…&type=invite|recovery[&next=/set-password]`.
 * Opening (GET/HEAD) the link does nothing; the token is only verified when the person selects
 * the button (a same-origin POST to `confirmEmailLinkAction`), so email link scanners cannot use
 * it up and another site cannot sign a visitor in with someone else's link (BRD B14).
 */
export default async function ConfirmEmailLinkPage(props: PageProps<"/auth/confirm">) {
  const searchParams = await props.searchParams;
  const tokenHash = firstParam(searchParams.token_hash);
  const type = firstParam(searchParams.type);
  if (!isPlausibleTokenHash(tokenHash) || !isConfirmLinkType(type)) redirect("/login?error=link_invalid");
  const next = safeNextPath(firstParam(searchParams.next), "/set-password");

  return (
    <AuthShell>
      <ConfirmLinkForm tokenHash={tokenHash} type={type} next={next} />
    </AuthShell>
  );
}
