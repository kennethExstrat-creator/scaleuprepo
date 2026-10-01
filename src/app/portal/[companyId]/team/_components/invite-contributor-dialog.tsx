"use client";

import { UserPlusIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { inviteContributorAction } from "../actions";
import { AccessLinkDialog } from "@/app/access/_components/access-link-dialog";
import { formText, TextField } from "@/app/access/_components/form-fields";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { InviteOutcome } from "@/lib/auth-admin/types";

/**
 * "Invite contributor" (company owners): the form, then the link to copy or why none was needed.
 * Disabled when the team has no contributor place left (BRD B29); the page shows `blockedReason` in the
 * element `reasonId` next to it.
 */
export function InviteContributorButton({
  companyId,
  companyName,
  blockedReason = null,
  reasonId,
}: {
  companyId: string;
  companyName: string;
  blockedReason?: string | null;
  reasonId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const blocked = blockedReason !== null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={blockedReason ?? undefined}
        aria-describedby={blocked ? reasonId : undefined}
      >
        <UserPlusIcon data-icon="inline-start" />
        Invite contributor
      </Button>
      <Dialog open={open && !blocked} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open && !blocked ? (
            <InviteContributorForm
              companyId={companyId}
              companyName={companyName}
              onInvited={(result) => {
                setOpen(false);
                setOutcome(result);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <AccessLinkDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </>
  );
}

function InviteContributorForm({
  companyId,
  companyName,
  onInvited,
}: {
  companyId: string;
  companyName: string;
  onInvited: (outcome: InviteOutcome) => void;
}) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await inviteContributorAction({
        companyId,
        fullName: formText(form, "fullName"),
        email: formText(form, "email"),
      });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onInvited(result.data);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Invite a contributor</DialogTitle>
        <DialogDescription>
          Contributors enter {companyName}&apos;s monthly figures and upload files, but can&apos;t submit. You&apos;ll get
          a single-use invitation link (valid for 7 days) to send them by email or chat.
        </DialogDescription>
      </DialogHeader>
      <FormError id={`${id}-error`} message={error} />
      <FieldGroup className="gap-4">
        <TextField
          id={`${id}-name`}
          name="fullName"
          label="Full name"
          autoComplete="off"
          autoFocus
          error={fieldErrors.fullName}
        />
        <TextField
          id={`${id}-email`}
          name="email"
          label="Work email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={254}
          error={fieldErrors.email}
        />
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Create invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
