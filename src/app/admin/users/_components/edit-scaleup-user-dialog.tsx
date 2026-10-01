"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateScaleUpUserAction } from "../actions";
import type { DirectoryUser } from "./directory-model";
import { SCALEUP_ROLE_DESCRIPTIONS, SCALEUP_ROLE_OPTIONS } from "./invite-scaleup-user-dialog";
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
import { displayName } from "@/lib/auth-admin/status";
import { SCALEUP_ROLES, type ScaleupRole } from "@/lib/types/enums";

function isScaleupRole(value: string): value is ScaleupRole {
  return (SCALEUP_ROLES as readonly string[]).includes(value);
}

/** Edit a ScaleUp team member's name, job title and role. Open while `user` is set. */
export function EditScaleUpUserDialog({ user, onClose }: { user: DirectoryUser | null; onClose: () => void }) {
  return (
    <Dialog open={user !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {user ? <EditScaleUpUserForm key={user.id} user={user} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditScaleUpUserForm({ user, onDone }: { user: DirectoryUser; onDone: () => void }) {
  const id = useId();
  const [role, setRole] = useState<ScaleupRole>(user.scaleupRole ?? "viewer");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateScaleUpUserAction({
        userId: user.id,
        fullName: formText(form, "fullName"),
        jobTitle: formText(form, "jobTitle"),
        role,
      });
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success("Details saved");
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Edit {displayName(user.fullName, user.email)}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      <FormError id={`${id}-error`} message={error} />
      <FieldGroup className="gap-4">
        <TextField
          id={`${id}-name`}
          name="fullName"
          label="Full name"
          autoComplete="off"
          defaultValue={user.fullName ?? ""}
          error={fieldErrors.fullName}
        />
        <TextField
          id={`${id}-title`}
          name="jobTitle"
          label="Job title"
          optional
          autoComplete="off"
          defaultValue={user.jobTitle ?? ""}
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
          disabled={user.isSelf}
          description={
            user.isSelf
              ? "You can't change your own role. Ask another Super Admin."
              : SCALEUP_ROLE_DESCRIPTIONS[role]
          }
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
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
