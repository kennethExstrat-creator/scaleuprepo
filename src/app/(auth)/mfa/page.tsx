import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MfaForm } from "./_components/mfa-form";
import { IdleTimer } from "@/components/shell/idle-timer";
import { firstParam, safeNextPath } from "@/lib/auth/redirects";
import { getAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage(props: PageProps<"/mfa">) {
  const searchParams = await props.searchParams;
  const next = safeNextPath(firstParam(searchParams.next));

  const ctx = await getAccessContext();
  if (!ctx) redirect("/login");
  if (!ctx.isActive) redirect("/no-access?reason=inactive");
  if (ctx.aal === "aal2") redirect(next);

  if (!ctx.mfaRequired) {
    // MFA is optional platform-wide: only users who already have an authenticator are asked
    // for a code here (e.g. to change their password); everyone else continues.
    const supabase = await createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    if ((data?.totp.length ?? 0) === 0) redirect(next);
  }

  return (
    <>
      <MfaForm next={next} email={ctx.email} />
      <IdleTimer />
    </>
  );
}
