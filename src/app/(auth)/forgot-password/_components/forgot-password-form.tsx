"use client";

import { ArrowLeftIcon, MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordResetAction, type ForgotPasswordState } from "../actions";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const INITIAL_STATE: ForgotPasswordState = { status: "idle", error: null, email: "" };

/** Self-service reset form; only rendered when PASSWORD_RESET_EMAILS_ENABLED=true. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL_STATE);

  if (state.status === "sent") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
            <MailCheckIcon className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            <h1>Check your email</h1>
          </CardTitle>
          <CardDescription>
            If an account exists for <span className="font-medium text-foreground">{state.email}</span>, we&apos;ve
            sent a link to reset your password. Open it in this browser. The link expires after one hour.
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

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">
          <h1>Reset your password</h1>
        </CardTitle>
        <CardDescription>Enter the email address you use to sign in and we&apos;ll email you a reset link.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <FieldGroup>
            <FormError id="forgot-error" message={state.error} />
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                autoFocus
                defaultValue={state.email}
                aria-invalid={state.error ? true : undefined}
                aria-describedby={state.error ? "forgot-error email-hint" : "email-hint"}
              />
              <FieldDescription id="email-hint">
                No account yet? Ask your company owner or ScaleUp to invite you.
              </FieldDescription>
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Send reset link
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Link
          href="/login"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
