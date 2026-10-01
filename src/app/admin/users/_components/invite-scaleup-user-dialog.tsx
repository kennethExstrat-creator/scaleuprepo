"use client";

import { UserPlusIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { inviteScaleUpUserAction } from "../actions";
import { AccessLinkDialog } from "@/app/access/_components/access-link-dialog";
import { formText, SelectField, TextField } from "@/app/access/_components/form-fields";
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
import { SCALEUP_ROLE_LABELS } from "@/lib/constants";
import { SCALEUP_ROLES, type ScaleupRole } from "@/lib/types/enums";

/** What each ScaleUp role may do (BRD §5), shown under the role picker. */
export const SCALEUP_ROLE_DESCRIPTIONS: Record<ScaleupRole, string> = {
  super_admin: "Everything, including funds, companies, users and platform settings.",
  fund_admin: "Runs cycles and deadlines, manages templates and KPIs, and can enter data on a company's behalf.",
  partner: "Reviews and comments on any company, and approves the companies they are in charge of.",
  viewer: "Read-only access to the tracker, companies and reports.",
};

export const SCALEUP_ROLE_OPTIONS = SCALEUP_ROLES.map((role) => ({ value: role, label: SCALEUP_ROLE_LABELS[role] }));

function isScaleupRole(value: string): value is ScaleupRole {
  return (SCALEUP_ROLES as readonly string[]).includes(value);
}

/** "Invite ScaleUp user" button: the invitation form, then the link to copy. */
export function InviteScaleUpUserButton() {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlusIcon data-icon="inline-start" />
        Invite ScaleUp user
      </Button>
      <InviteScaleUpUserDialog
        open={open}
        onOpenChange={setOpen}
        onInvited={(result) => {
          setOpen(false);
          setOutcome(result);
        }}
      />
      <AccessLinkDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </>
  );
}

function InviteScaleUpUserDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (outcome: InviteOutcome) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Re-mounted on every open, so the form starts empty. */}
        {open ? <InviteScaleUpUserForm onInvited={onInvited} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteScaleUpUserForm({ onInvited }: { onInvited: (outcome: InviteOutcome) => void }) {
  const id = useId();
  const [role, setRole] = useState<ScaleupRole>("partner");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await inviteScaleUpUserAction({
        fullName: formText(form, "fullName"),
        email: formText(form, "email"),
        jobTitle: formText(form, "jobTitle"),
        role,
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
        <DialogTitle>Invite a ScaleUp user</DialogTitle>
        <DialogDescription>
          We&apos;ll create a single-use invitation link (valid for 7 days) for you to send them by email or chat.
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
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={254}
          error={fieldErrors.email}
        />
        <TextField
          id={`${id}-title`}
          name="jobTitle"
          label="Job title"
          optional
          autoComplete="off"
          error={fieldErrors.jobTitle}
        />
        <SelectField
          id={`${id}-role`}
          name="role"
          label="Role"
          value={role}
          onValueChange={(value) => {
            if (isScaleupRole(value)) setRole(value);
          }}
          options={SCALEUP_ROLE_OPTIONS}
          description={SCALEUP_ROLE_DESCRIPTIONS[role]}
          error={fieldErrors.role}
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
