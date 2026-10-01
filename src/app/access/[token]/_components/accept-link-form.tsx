"use client";

import { KeyRoundIcon, MailOpenIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { acceptAccessLinkAction, type AcceptLinkState } from "../actions";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { AccessLinkPurpose } from "@/lib/auth-admin/purpose";
import { formatDateTime } from "@/lib/format";

const INITIAL_STATE: AcceptLinkState = { error: null, spent: false };

const COPY: Record<AccessLinkPurpose, { title: string; description: string; nextSteps: string; button: string }> = {
  invite: {
    title: "Accept your invitation",
    description: "You've been invited to the ScaleUp Portfolio Reporting Platform.",
    nextSteps: "Next you'll choose a password and set up two-factor authentication with an authenticator app.",
    button: "Accept invitation",
  },
  signin: {
    title: "Sign in with your link",
    description: "ScaleUp has sent you a one-time sign-in link.",
    nextSteps: "You'll confirm with your authenticator app and then choose a new password.",
    button: "Sign in",
  },
};

/**
 * The "Accept invitation" / "Sign in" card of /access/[token]. Only pressing the button (a same-origin
 * POST to `acceptAccessLinkAction`) uses the link.
 */
export function AcceptLinkForm({
  token,
  purpose,
  email,
  fullName,
  expiresAt,
}: {
  token: string;
  purpose: AccessLinkPurpose;
  email: string;
  fullName: string | null;
  expiresAt: string;
}) {
  const [state, formAction, pending] = useActionState(acceptAccessLinkAction, INITIAL_STATE);
  const copy = COPY[purpose];
  const Icon = purpose === "invite" ? MailOpenIcon : KeyRoundIcon;
  const name = fullName?.trim() || null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">
          <h1>{copy.title}</h1>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">This link is for</p>
          {name ? <p className="truncate font-medium">{name}</p> : null}
          <p className={name ? "truncate text-sm text-muted-foreground" : "truncate font-medium"}>{email}</p>
        </div>

        {state.spent ? null : (
          <p className="text-sm text-muted-foreground">
            {copy.nextSteps} The link works once and expires on{" "}
            <span className="font-medium whitespace-nowrap text-foreground">{formatDateTime(expiresAt)}</span>.
          </p>
        )}

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <FormError id="accept-error" message={state.error} />
          {state.spent ? (
            <Button asChild className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          ) : (
            <Button
              type="submit"
              className="w-full"
              disabled={pending}
              aria-busy={pending || undefined}
              aria-describedby={state.error ? "accept-error" : undefined}
            >
              {pending ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
              {copy.button}
            </Button>
          )}
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-center gap-2 text-center">
        <p className="text-xs text-muted-foreground">
          Not you? Don&apos;t continue. Ask whoever sent you this link to check the email address.
        </p>
        {state.spent ? null : (
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Go to sign in instead
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}
