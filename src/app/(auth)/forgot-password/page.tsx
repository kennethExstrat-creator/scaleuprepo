import { ArrowLeftIcon, KeyRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./_components/forgot-password-form";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { passwordResetEmailsEnabled } from "@/lib/auth/features";

export const metadata: Metadata = { title: "Reset password" };

// Rendered per request like every other page: responses can carry the proxy's session and
// idle-timeout cookies, which must never end up in a statically cached page. It also reads the
// PASSWORD_RESET_EMAILS_ENABLED switch at runtime.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  if (passwordResetEmailsEnabled()) return <ForgotPasswordForm />;

  // v1 has no email delivery (BRD B14): a forgotten password is reset with a new sign-in link.
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRoundIcon className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">
          <h1>Forgotten your password?</h1>
        </CardTitle>
        <CardDescription className="flex flex-col gap-2">
          <span>
            Ask your ScaleUp contact for a new sign-in link. If you report for a portfolio company as a contributor,
            your company owner can send you one.
          </span>
          <span>The link signs you in once, and you can then choose a new password.</span>
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to sign in
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
