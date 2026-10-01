"use client";

import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { loginAction, type LoginState } from "../actions";
import { FormError } from "@/components/app/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const INITIAL_STATE: LoginState = { error: null, email: "" };

export function LoginForm({
  next,
  notice,
  linkError,
}: {
  next: string;
  notice: string | null;
  linkError: string | null;
}) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);
  const error = state.error ?? (state === INITIAL_STATE ? linkError : null);
  const describedBy = error ? "login-error" : undefined;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>ScaleUp Portfolio Reporting</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <input type="hidden" name="next" value={next} />
          <FieldGroup>
            {notice && state === INITIAL_STATE ? (
              <Alert className="border-info/25 bg-info/5">
                <InfoIcon className="text-info" aria-hidden="true" />
                <AlertDescription className="text-foreground">{notice}</AlertDescription>
              </Alert>
            ) : null}
            <FormError id="login-error" message={error} />
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
                aria-describedby={describedBy}
              />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={state.error ? true : undefined}
                aria-describedby={describedBy}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Sign in
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
