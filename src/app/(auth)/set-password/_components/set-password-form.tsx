"use client";

import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { setPasswordAction, type SetPasswordMode, type SetPasswordState } from "../actions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../password-rules";
import { FormError } from "@/components/app/form-error";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const INITIAL_STATE: SetPasswordState = { error: null, fieldErrors: {} };

/** Joins the ids of the descriptions that apply, for aria-describedby. */
function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list === "" ? undefined : list;
}

/**
 * "link": first password after an invitation, or a new one after a recovery link (no current
 * password). "change": signed-in password change, which asks for the current password.
 */
export function SetPasswordForm({ mode, email }: { mode: SetPasswordMode; email: string }) {
  const [state, formAction, pending] = useActionState(setPasswordAction, INITIAL_STATE);
  const { current: currentError, password: passwordError, confirm: confirmError } = state.fieldErrors;
  const isChange = mode === "change";

  if (state.done) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
            <CircleCheckIcon className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">
            <h1>Password changed</h1>
          </CardTitle>
          <CardDescription>Use your new password the next time you sign in.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/">Continue</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">
          <h1>{isChange ? "Change your password" : "Set your password"}</h1>
        </CardTitle>
        <CardDescription>
          {email ? (
            <>
              {isChange ? "Choose a new password for " : "Choose a password for "}
              <span className="font-medium text-foreground">{email}</span>.
            </>
          ) : (
            "Choose a password for your account."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          {/* Only used to explain an expired link; the server decides the mode itself. */}
          <input type="hidden" name="mode" value={mode} />
          {/* Lets password managers save the new password against the right account. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <FieldGroup>
            <FormError id="set-password-error" message={state.error} />
            {isChange ? (
              <Field data-invalid={currentError ? true : undefined}>
                <FieldLabel htmlFor="current">Current password</FieldLabel>
                <Input
                  id="current"
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  maxLength={200}
                  required
                  autoFocus
                  aria-invalid={currentError ? true : undefined}
                  aria-describedby={describedBy(currentError && "current-error", state.error && "set-password-error")}
                />
                {currentError ? <FieldError id="current-error">{currentError}</FieldError> : null}
              </Field>
            ) : null}
            <Field data-invalid={passwordError ? true : undefined}>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                required
                autoFocus={!isChange}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={describedBy(
                  "password-hint",
                  passwordError && "password-error",
                  !isChange && state.error && "set-password-error",
                )}
              />
              <FieldDescription id="password-hint">
                At least {MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember and hard to guess.
              </FieldDescription>
              {passwordError ? <FieldError id="password-error">{passwordError}</FieldError> : null}
            </Field>
            <Field data-invalid={confirmError ? true : undefined}>
              <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
              <Input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                required
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={describedBy(confirmError && "confirm-error")}
              />
              {confirmError ? <FieldError id="confirm-error">{confirmError}</FieldError> : null}
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {isChange ? "Change password" : "Save password and continue"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        {isChange ? (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/">Cancel</Link>
          </Button>
        ) : (
          <SignOutButton variant="ghost" size="sm" className="text-muted-foreground">
            Cancel and sign out
          </SignOutButton>
        )}
      </CardFooter>
    </Card>
  );
}
