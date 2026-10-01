import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TermsContent } from "./_components/terms-content";
import { TermsForm } from "./_components/terms-form";
import { IdleTimer } from "@/components/shell/idle-timer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessContext, getAuthSettings } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Terms of use" };

export default async function TermsPage() {
  const ctx = await getAccessContext();
  if (!ctx) redirect("/login");
  if (!ctx.isActive) redirect("/no-access?reason=inactive");
  if (ctx.mfaRequired && ctx.aal !== "aal2") redirect("/mfa");
  if (ctx.termsAccepted) redirect("/");

  const { termsVersion } = await getAuthSettings();

  return (
    <>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-lg">
            <h1>Terms of use</h1>
          </CardTitle>
          <CardDescription>
            Before you continue, please read and accept the terms for using the ScaleUp Portfolio Reporting Platform.
            Version {termsVersion}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <TermsContent />
          <TermsForm version={termsVersion} />
        </CardContent>
      </Card>
      {/* Reading the terms counts as activity; warns 2 minutes before the 30-minute timeout. */}
      <IdleTimer />
    </>
  );
}
