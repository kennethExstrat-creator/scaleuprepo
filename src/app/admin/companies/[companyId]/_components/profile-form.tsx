"use client";

import { LockIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";

import { updateCompanyProfileAction } from "../../actions";
import {
  companyFieldId,
  CompanyProfileFields,
  PROFILE_FIELDS,
  type ProfileField,
  type ProfileFieldValues,
} from "../../_components/company-profile-fields";
import { errorsOf, NO_ERRORS, TextField, zodErrors, type FormErrors } from "../../_components/form-controls";
import { storedProfileValue, updateCompanyProfileSchema } from "../../_components/schemas";
import { CURRENCY_SUGGESTIONS } from "../../_components/suggestions";

export type ProfileValues = ProfileFieldValues & { reportingCurrency: string };

const PROFILE_KEYS: (keyof ProfileValues)[] = [...PROFILE_FIELDS, "reportingCurrency"];

/** Whether saving `a` would store exactly `b` (so "example.com" is not a change from "https://example.com"). */
function sameValues(a: ProfileValues, b: ProfileValues): boolean {
  return PROFILE_KEYS.every((key) => storedProfileValue(key, a[key]) === storedProfileValue(key, b[key]));
}

/**
 * The company profile, editable by Super Admins. Key it on its saved values (`key={JSON.stringify(initial)}`)
 * so it starts afresh when the profile changes in the database, and only then: saving another card on the
 * page (start month, status) keeps unsaved edits here.
 */
export function ProfileForm({
  companyId,
  initial,
  sectors,
  currencyLocked,
}: {
  companyId: string;
  initial: ProfileValues;
  sectors: string[];
  /** The company has reported figures, so its currency can no longer change. */
  currencyLocked: boolean;
}) {
  const [values, setValues] = useState<ProfileValues>(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();
  const dirty = !sameValues(values, initial);

  function set(field: ProfileField | "reportingCurrency", value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { ...values, companyId };
    const checked = updateCompanyProfileSchema.safeParse(input);
    if (!checked.success) {
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      try {
        const result = await updateCompanyProfileAction(input);
        if (!result.ok) {
          setErrors(errorsOf(result));
          return;
        }
        toast.success("Company profile saved");
      } catch {
        setErrors({ form: MESSAGES.network, fields: {} });
      }
    });
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CardTitle>
            <h2>Company profile</h2>
          </CardTitle>
          <CardDescription>The legal entity and how the company appears across the platform.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormError message={errors.form} />
          <CompanyProfileFields values={values} onChange={set} errors={errors.fields} sectors={sectors} />
          <datalist id="currency-suggestions">
            {CURRENCY_SUGGESTIONS.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
          <TextField
            id={companyFieldId("reportingCurrency")}
            label="Reporting currency"
            className="max-w-sm"
            value={values.reportingCurrency}
            onValueChange={(value) => set("reportingCurrency", value.toUpperCase())}
            error={errors.fields.reportingCurrency}
            description={
              currencyLocked ? (
                <span className="inline-flex items-start gap-1.5">
                  <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Locked: the company has reported figures in this currency.
                </span>
              ) : (
                "Figures are entered in this currency. Other currencies are converted to RM with the monthly FX rate."
              )
            }
            maxLength={3}
            list="currency-suggestions"
            autoComplete="off"
            spellCheck={false}
            disabled={currencyLocked}
          />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || pending}
            onClick={() => {
              setValues(initial);
              setErrors(NO_ERRORS);
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={!dirty || pending} aria-busy={pending || undefined}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
