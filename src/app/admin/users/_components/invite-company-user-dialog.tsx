"use client";

import { Building2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { inviteCompanyUserAction } from "../actions";
import type { CompanyOption } from "./directory-model";
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
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import { COMPANY_ROLES, type CompanyRole } from "@/lib/types/enums";

/** What each company role may do (BRD §5), shown under the role picker. */
export const COMPANY_ROLE_DESCRIPTIONS: Record<CompanyRole, string> = {
  owner: "Founder or CEO: submits monthly updates, confirms quarter and half closes and manages the company's team.",
  contributor: "Finance or operations lead: enters data and uploads files, but cannot submit.",
};

const COMPANY_ROLE_OPTIONS = COMPANY_ROLES.map((role) => ({ value: role, label: COMPANY_ROLE_LABELS[role] }));

function isCompanyRole(value: string): value is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(value);
}

export type InviteCompanyUserDefaults = { companyId?: string; email?: string; fullName?: string };

/** "Invite company user" button: the invitation form, then the link to copy (or why none was needed). */
export function InviteCompanyUserButton({
  companies,
  defaultCompanyId,
}: {
  /** Active companies only. */
  companies: readonly CompanyOption[];
  defaultCompanyId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Building2Icon data-icon="inline-start" />
        Invite company user
      </Button>
      <InviteCompanyUserDialog
        open={open}
        onOpenChange={setOpen}
        companies={companies}
        defaults={{ companyId: defaultCompanyId }}
        onInvited={(result) => {
          setOpen(false);
          setOutcome(result);
        }}
      />
      <AccessLinkDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </>
  );
}

/** Controlled form dialog; `defaults` prefill it (e.g. "Add to a company" for an existing person). */
export function InviteCompanyUserDialog({
  open,
  onOpenChange,
  companies,
  defaults,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: readonly CompanyOption[];
  defaults?: InviteCompanyUserDefaults;
  onInvited: (outcome: InviteOutcome) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <InviteCompanyUserForm companies={companies} defaults={defaults} onInvited={onInvited} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteCompanyUserForm({
  companies,
  defaults,
  onInvited,
}: {
  companies: readonly CompanyOption[];
  defaults?: InviteCompanyUserDefaults;
  onInvited: (outcome: InviteOutcome) => void;
}) {
  const id = useId();
  const initialCompany = companies.some((c) => c.id === defaults?.companyId) ? (defaults?.companyId ?? "") : "";
  const [companyId, setCompanyId] = useState(initialCompany);
  const [role, setRole] = useState<CompanyRole>("owner");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const existingPerson = Boolean(defaults?.email);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    if (!companyId) {
      setFieldErrors({ companyId: "Choose a company." });
      return;
    }
    startTransition(async () => {
      const result = await inviteCompanyUserAction({
        companyId,
        role,
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
        <DialogTitle>{existingPerson ? "Add to a company" : "Invite a company user"}</DialogTitle>
        <DialogDescription>
          {existingPerson
            ? "They keep their account and see the company the next time they sign in."
            : "New people get a single-use invitation link (valid for 7 days) for you to send them. People who already have an account are simply added and sign in as usual."}
        </DialogDescription>
      </DialogHeader>
      <FormError id={`${id}-error`} message={error} />
      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no active companies to add people to.</p>
      ) : (
        <FieldGroup className="gap-4">
          <SelectField
            id={`${id}-company`}
            name="companyId"
            label="Company"
            value={companyId}
            onValueChange={setCompanyId}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            placeholder="Choose a company"
            error={fieldErrors.companyId}
          />
          <SelectField
            id={`${id}-role`}
            name="role"
            label="Company role"
            value={role}
            onValueChange={(value) => {
              if (isCompanyRole(value)) setRole(value);
            }}
            options={COMPANY_ROLE_OPTIONS}
            description={COMPANY_ROLE_DESCRIPTIONS[role]}
            error={fieldErrors.role}
          />
          <TextField
            id={`${id}-name`}
            name="fullName"
            label="Full name"
            autoComplete="off"
            defaultValue={defaults?.fullName}
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
            defaultValue={defaults?.email}
            error={fieldErrors.email}
          />
        </FieldGroup>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || companies.length === 0} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {existingPerson ? "Add to company" : "Create invitation"}
        </Button>
      </DialogFooter>
    </form>
  );
}
