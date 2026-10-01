"use client";

import { UserRoundCheckIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";
import { INTERNAL_RATING_META } from "@/lib/constants";
import { INTERNAL_RATINGS, type InternalRating, type ScaleupRole } from "@/lib/types/enums";

import { assignPartnerAction, updateInternalFieldsAction } from "../../actions";
import { DetailList, EmptyValue } from "../../_components/detail-list";
import {
  errorsOf,
  NO_ERRORS,
  SelectField,
  TextAreaField,
  TextField,
  zodErrors,
  type FormErrors,
} from "../../_components/form-controls";
import { internalFieldsSchema, LIMITS } from "../../_components/schemas";
import { EXIT_STATUS_SUGGESTIONS } from "../../_components/suggestions";
import { partnerOptionLabel, type PartnerOption } from "../../_components/types";

const NOT_RATED = "none";
const NO_PARTNER = "none";

export type InternalValues = {
  internalRating: InternalRating | "";
  exitStrategyStatus: string;
  exitStrategyNotes: string;
  notes: string;
};

/**
 * Internal rating, exit strategy and notes (BRD §6.3): edited by Super Admins, Fund Admins and the
 * partner-in-charge; read-only for everyone else. Key it on its saved values
 * (`key={JSON.stringify(initial)}`) so it starts afresh only when these fields change in the database.
 */
export function InternalFieldsForm({
  companyId,
  initial,
  canEdit,
  lastUpdated,
}: {
  companyId: string;
  initial: InternalValues;
  canEdit: boolean;
  /** "Last updated 30 Sep 2026 by Renuka Sena", or null. */
  lastUpdated: string | null;
}) {
  const [values, setValues] = useState<InternalValues>(initial);
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();
  const dirty =
    values.internalRating !== initial.internalRating ||
    values.exitStrategyStatus.trim() !== initial.exitStrategyStatus.trim() ||
    values.exitStrategyNotes.trim() !== initial.exitStrategyNotes.trim() ||
    values.notes.trim() !== initial.notes.trim();

  function set<K extends keyof InternalValues>(key: K, value: InternalValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { ...values, companyId, internalRating: values.internalRating || null };
    const checked = internalFieldsSchema.safeParse(input);
    if (!checked.success) {
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      try {
        const result = await updateInternalFieldsAction(input);
        if (!result.ok) {
          setErrors(errorsOf(result));
          return;
        }
        toast.success("Internal details saved");
      } catch {
        setErrors({ form: MESSAGES.network, fields: {} });
      }
    });
  }

  const header = (
    <CardHeader>
      <CardTitle>
        <h2>Assessment and exit strategy</h2>
      </CardTitle>
      <CardDescription>
        {canEdit
          ? "Kept up to date by the partner-in-charge and the fund team, and carried forward each half."
          : "Only Super Admins, Fund Admins and the partner-in-charge can change these."}
        {lastUpdated ? <span className="mt-1 block text-xs">{lastUpdated}</span> : null}
      </CardDescription>
    </CardHeader>
  );

  if (!canEdit) {
    const rating = initial.internalRating ? INTERNAL_RATING_META[initial.internalRating] : null;
    return (
      <Card>
        {header}
        <CardContent>
          <DetailList
            items={[
              {
                label: "Internal rating",
                value: rating ? <ToneBadge tone={rating.tone}>{rating.label}</ToneBadge> : <EmptyValue>Not rated</EmptyValue>,
              },
              { label: "Exit strategy status", value: initial.exitStrategyStatus || <EmptyValue /> },
              { label: "Exit strategy notes", value: initial.exitStrategyNotes || <EmptyValue /> },
              { label: "Notes", value: initial.notes || <EmptyValue /> },
            ]}
            className="sm:grid-cols-1"
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-(--card-spacing)">
        {header}
        <CardContent className="flex flex-col gap-5">
          <FormError message={errors.form} />
          <datalist id="exit-status-suggestions">
            {EXIT_STATUS_SUGGESTIONS.map((status) => (
              <option key={status} value={status} />
            ))}
          </datalist>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              id="internal-rating"
              label="Internal rating"
              value={values.internalRating || NOT_RATED}
              onValueChange={(value) =>
                set("internalRating", INTERNAL_RATINGS.find((rating) => rating === value) ?? "")
              }
              options={[
                { value: NOT_RATED, label: "Not rated" },
                ...INTERNAL_RATINGS.map((rating) => ({ value: rating, label: INTERNAL_RATING_META[rating].label })),
              ]}
              error={errors.fields.internalRating}
            />
            <TextField
              id="internal-exit-status"
              label="Exit strategy status"
              optional
              value={values.exitStrategyStatus}
              onValueChange={(value) => set("exitStrategyStatus", value)}
              error={errors.fields.exitStrategyStatus}
              maxLength={LIMITS.exitStrategyStatus}
              list="exit-status-suggestions"
              autoComplete="off"
            />
          </div>
          <TextAreaField
            id="internal-exit-notes"
            label="Exit strategy notes"
            optional
            value={values.exitStrategyNotes}
            onValueChange={(value) => set("exitStrategyNotes", value)}
            error={errors.fields.exitStrategyNotes}
            maxLength={LIMITS.internalNotes}
            rows={5}
            description="The exit thread: options, conversations and next steps."
          />
          <TextAreaField
            id="internal-notes"
            label="Notes"
            optional
            value={values.notes}
            onValueChange={(value) => set("notes", value)}
            error={errors.fields.notes}
            maxLength={LIMITS.internalNotes}
            rows={6}
            description="Partner meeting notes and anything else the ScaleUp team should know."
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
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/** The partner-in-charge (BRD §6.3, B24): only Super Admins assign it; never shown to the company. */
export type CurrentPartner = {
  id: string;
  name: string;
  email: string;
  /** Null when the profile is not (any more) ScaleUp staff. */
  role: ScaleupRole | null;
  isActive: boolean;
};

export function PartnerCard({
  companyId,
  current,
  partners,
  canAssign,
}: {
  companyId: string;
  current: CurrentPartner | null;
  /** Choices for Super Admins: active partners and Super Admins (the current one even when inactive). */
  partners: PartnerOption[];
  canAssign: boolean;
}) {
  const saved = current?.id ?? "";
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = value !== saved;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignPartnerAction({ companyId, partnerId: value || null });
        if (!result.ok) {
          setError(result.fieldErrors?.partnerId ?? result.error);
          return;
        }
        const chosen = partners.find((partner) => partner.id === value);
        toast.success(chosen ? `${chosen.name} is now partner-in-charge` : "Partner-in-charge removed");
      } catch {
        setError(MESSAGES.network);
      }
    });
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRoundCheckIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2>Partner-in-charge</h2>
          </CardTitle>
          <CardDescription>
            Approves the company&apos;s monthly updates, can reopen them and edits the internal fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {current ? (
            <div>
              <div className="font-medium">
                {current.name}
                {current.isActive ? null : <span className="font-normal text-muted-foreground"> (inactive)</span>}
              </div>
              <div className="text-muted-foreground">{current.email}</div>
            </div>
          ) : (
            <EmptyValue>No partner assigned yet</EmptyValue>
          )}
          {current && !current.isActive ? (
            <p className="text-muted-foreground">
              This account is deactivated, so it no longer has partner rights. Assign someone else.
            </p>
          ) : current && current.role !== "partner" && current.role !== "super_admin" ? (
            <p className="text-muted-foreground">
              This person is not a partner, so they don&apos;t get partner rights for the company. Assign a partner.
            </p>
          ) : null}
          {canAssign ? (
            <>
              <FormError message={error} />
              <SelectField
                id="partner-in-charge"
                label={current ? "Change partner-in-charge" : "Assign partner-in-charge"}
                value={value || NO_PARTNER}
                onValueChange={(next) => {
                  setValue(next === NO_PARTNER ? "" : next);
                  setError(null);
                }}
                options={[
                  { value: NO_PARTNER, label: "No partner assigned" },
                  ...partners.map((partner) => ({
                    value: partner.id,
                    label: partnerOptionLabel(partner),
                    disabled: !partner.isActive && partner.id !== saved,
                  })),
                  // Keep the current value selectable for display when it is not in the list.
                  ...(current && !partners.some((partner) => partner.id === current.id)
                    ? [{ value: current.id, label: `${current.name} (not a partner)`, disabled: true }]
                    : []),
                ]}
                disabled={pending}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Only Super Admins assign the partner-in-charge.</p>
          )}
        </CardContent>
        {canAssign ? (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={!dirty || pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
