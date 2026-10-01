import { ArrowRightIcon, BuildingIcon, UserXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/shell/auth-shell";
import { IdleTimer } from "@/components/shell/idle-timer";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessContext } from "@/lib/auth/session";

export const metadata: Metadata = { title: "No access" };

/**
 * Shown when the account is inactive or is not linked to ScaleUp or any company.
 * The message is derived from the account itself, not from the ?reason= parameter.
 */
export default async function NoAccessPage() {
  const ctx = await getAccessContext();
  if (!ctx) redirect("/login");
  // Roles and memberships are only known once the session is fully verified (MFA done and the
  // current terms accepted), so finish those steps first.
  if (ctx.isActive && ctx.mfaRequired && ctx.aal !== "aal2") redirect("/mfa");
  if (ctx.isActive && !ctx.termsAccepted) redirect("/terms");

  const inactive = !ctx.isActive;
  const unlinked = ctx.isActive && ctx.scaleupRole === null && ctx.memberships.length === 0;

  const Icon = inactive ? UserXIcon : BuildingIcon;
  const title = inactive
    ? "Your account is inactive"
    : unlinked
      ? "Your account isn't linked to a company yet"
      : "You don't have access to that page";
  const description = inactive
    ? "Your access to the ScaleUp Portfolio Reporting Platform has been switched off. If you think this is a mistake, contact your ScaleUp representative."
    : unlinked
      ? "You're signed in, but you haven't been added to a portfolio company. Ask your company owner or ScaleUp to invite you, then sign in again."
      : "Go back to your home page to continue.";

  return (
    <AuthShell>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{ctx.email}</span>
        </CardContent>
        <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <SignOutButton />
          {!inactive && !unlinked ? (
            <Button asChild>
              <Link href="/">
                Go to home
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
        </CardFooter>
      </Card>
      <IdleTimer />
    </AuthShell>
  );
}
