"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";

import {
  errorsOf,
  formMessage,
  NO_ERRORS,
  TextAreaField,
  TextField,
  zodErrors,
  type FormErrors,
} from "@/app/admin/companies/_components/form-controls";
import { LIMITS } from "@/app/admin/companies/_components/schemas";

import { createFundAction, updateFundAction } from "../actions";
import { FUND_CODE_MAX, fundSchema, normaliseFundCode } from "./fund-schema";
import type { FundListRow } from "./fund-types";

type Values = { code: string; name: string; legalName: string; description: string; isActive: boolean };

function initialValues(fund: FundListRow | null): Values {
  return {
    code: fund?.code ?? "",
    name: fund?.name ?? "",
    legalName: fund?.legalName ?? "",
    description: fund?.description ?? "",
    isActive: fund?.isActive ?? true,
  };
}

const FIELDS = ["code", "name", "legalName", "description"];

/** Create (fund = null) or edit a fund — Super Admin. */
export function FundFormDialog({
  fund,
  open,
  onOpenChange,
}: {
  fund: FundListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(fund));
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();
  const isNew = fund === null;

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = fundSchema.safeParse(values);
    if (!checked.success) {
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = fund ? await updateFundAction({ ...values, id: fund.id }) : await createFundAction(values);
      } catch {
        // The call itself failed (connection dropped, or the app was redeployed): keep the dialog and its values.
        setErrors({ form: MESSAGES.network, fields: {} });
        return;
      }
      if (!result.ok) {
        setErrors(errorsOf(result));
        return;
      }
      const code = normaliseFundCode(values.code);
      toast.success(isNew ? `Fund ${code} added` : `Fund ${code} saved`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add fund" : `Edit ${fund.code}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "Funds hold the portfolio companies. The code is used in lists, filters and exports."
              : "Changes show everywhere the fund appears, including its companies."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError id="fund-form-error" message={formMessage(errors, FIELDS)} />
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <TextField
              id="fund-code"
              label="Code"
              value={values.code}
              onValueChange={(value) => set("code", value.toUpperCase())}
              error={errors.fields.code}
              maxLength={FUND_CODE_MAX}
              autoComplete="off"
              spellCheck={false}
              placeholder="SV1"
              autoFocus={isNew}
            />
            <TextField
              id="fund-name"
              label="Name"
              value={values.name}
              onValueChange={(value) => set("name", value)}
              error={errors.fields.name}
              maxLength={LIMITS.name}
              placeholder="ScaleUp Ventures 1"
            />
          </div>
          <TextField
            id="fund-legal-name"
            label="Legal name"
            optional
            value={values.legalName}
            onValueChange={(value) => set("legalName", value)}
            error={errors.fields.legalName}
            maxLength={LIMITS.legalName}
            placeholder="ScaleUp Ventures 1 Sdn Bhd"
          />
          <TextAreaField
            id="fund-description"
            label="Description"
            optional
            value={values.description}
            onValueChange={(value) => set("description", value)}
            error={errors.fields.description}
            maxLength={LIMITS.fundDescription}
            rows={3}
          />
          <Field orientation="horizontal">
            <Switch
              id="fund-active"
              checked={values.isActive}
              onCheckedChange={(checked) => set("isActive", checked)}
              aria-describedby="fund-active-description"
            />
            <FieldContent>
              <FieldLabel htmlFor="fund-active">Active</FieldLabel>
              <FieldDescription id="fund-active-description">
                Inactive funds stay on their companies&apos; records but can&apos;t be chosen for new ones.
              </FieldDescription>
            </FieldContent>
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {isNew ? "Add fund" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
