"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Submit button for `<form action={…}>`: disabled with a spinner while the form's action
 * is pending (`useFormStatus`). Accepts all Button props.
 */
export function SubmitButton({
  children,
  pendingText,
  disabled,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type"> & { pendingText?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
