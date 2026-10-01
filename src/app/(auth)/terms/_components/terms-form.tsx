"use client";

import { useActionState, useState } from "react";

import { acceptTermsAction, type AcceptTermsState } from "../actions";
import { FormError } from "@/components/app/form-error";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

const INITIAL_STATE: AcceptTermsState = { error: null };

export function TermsForm({ version }: { version: string }) {
  const [state, formAction, pending] = useActionState(acceptTermsAction, INITIAL_STATE);
  const [accepted, setAccepted] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="version" value={version} />
        <Field orientation="horizontal">
          <Checkbox
            id="accept"
            name="accept"
            checked={accepted}
            onCheckedChange={(value) => setAccepted(value === true)}
            required
            aria-describedby={state.error ? "terms-error" : undefined}
          />
          <FieldLabel htmlFor="accept" className="font-normal">
            I have read and accept these terms, including the confidentiality obligations and the personal data notice.
          </FieldLabel>
        </Field>
        <FormError id="terms-error" message={state.error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">If you don&apos;t accept, you can&apos;t use the platform.</p>
          <Button type="submit" disabled={!accepted || pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Accept and continue
          </Button>
        </div>
      </form>
      <div className="flex justify-center border-t pt-3">
        <SignOutButton variant="ghost" size="sm" className="text-muted-foreground">
          Decline and sign out
        </SignOutButton>
      </div>
    </div>
  );
}
