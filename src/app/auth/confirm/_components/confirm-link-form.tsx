"use client";

import { KeyRoundIcon, MailOpenIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { confirmEmailLinkAction, type ConfirmLinkState } from "../actions";
import type { ConfirmLinkType } from "../link-types";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const INITIAL_STATE: ConfirmLinkState = { error: null };

const COPY: Record<ConfirmLinkType, { title: string; description: string; button: string }> = {
  invite: {
    title: "Accept your invitation",
    description:
      "You've been invited to the ScaleUp Portfolio Reporting Platform. Continue to choose your password and set up two-factor authentication.",
    button: "Accept invitation",
  },
  recovery: {
    title: "Reset your password",
    description: "Continue to choose a new password for your account.",
    button: "Continue",
  },
};

export function ConfirmLinkForm({ tokenHash, type, next }: { tokenHash: string; type: ConfirmLinkType; next: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailLinkAction, INITIAL_STATE);
  const copy = COPY[type];
  const Icon = type === "invite" ? MailOpenIcon : KeyRoundIcon;

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
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <FormError id="confirm-error" message={state.error} />
          <Button
            type="submit"
            className="w-full"
            disabled={pending}
            aria-describedby={state.error ? "confirm-error" : undefined}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {copy.button}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <Link
          href="/login"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Go to sign in instead
        </Link>
      </CardFooter>
    </Card>
  );
}
