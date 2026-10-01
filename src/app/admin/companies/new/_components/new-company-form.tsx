"use client";

import { LandmarkIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";
import type { MonthKey } from "@/lib/periods";

import { createCompanyAction } from "../../actions";
import {
  companyFieldId,
  CompanyProfileFields,
  PROFILE_FIELDS,
  type ProfileField,
  type ProfileFieldValues,
} from "../../_components/company-profile-fields";
import { errorsOf, NO_ERRORS, SelectField, TextField, zodErrors, type FormErrors } from "../../_components/form-controls";
import {
  EMPTY_FUND_MAPPING,
  FundMappingFields,
  InstrumentSuggestions,
  type FundMappingInput,
} from "../../_components/fund-mapping-fields";
import { createCompanySchema, MAX_FUND_MAPPINGS } from "../../_components/schemas";
import { StartMonthField } from "../../_components/start-month-field";
import { CURRENCY_SUGGESTIONS } from "../../_components/suggestions";
import { partnerOptionLabel, type FundOption, type PartnerOption } from "../../_components/types";

const NO_PARTNER = "none";

/** A fund row; `rowKey` keeps React's keys stable when rows are removed (the schema ignores it). */
type FundRow = FundMappingInput & { rowKey: number };

type Values = ProfileFieldValues & {
  reportingCurrency: string;
  reportingStartMonth: string;
  partnerId: string;
  funds: FundRow[];
};

/** Field keys in page order, for focusing the first error. */
function orderedFieldKeys(values: Values): string[] {
  return [
    ...PROFILE_FIELDS,
    "reportingCurrency",
    "reportingStartMonth",
    "partnerId",
    ...values.funds.flatMap((_, index) =>
      ["fundId", "investmentDate", "instrument", "ownershipPct"].map((field) => `funds.${index}.${field}`),
    ),
  ];
}

/** "Add company" (Super Admin): profile, reporting, partner-in-charge and fund mappings in one go. */
export function NewCompanyForm({
  funds,
  partners,
  sectors,
  startMonths,
  today,
  dueDay,
  graceDays,
}: {
  funds: FundOption[];
  partners: PartnerOption[];
  sectors: string[];
  startMonths: MonthKey[];
  today: string;
  dueDay: number;
  graceDays: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    name: "",
    legalName: "",
    registrationNo: "",
    sector: "",
    country: "Malaysia",
    website: "",
    description: "",
    reportingCurrency: "MYR",
    reportingStartMonth: "",
    partnerId: "",
    funds: [],
  });
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();
  const focusFirstError = useRef(false);
  const nextRowKey = useRef(1);

  useEffect(() => {
    if (!focusFirstError.current || !errors.form) return;
    focusFirstError.current = false;
    const first = orderedFieldKeys(values).find((key) => errors.fields[key]);
    const element = document.getElementById(first ? companyFieldId(first) : "new-company-error");
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [errors, values]);

  function setField(field: ProfileField | "reportingCurrency" | "reportingStartMonth" | "partnerId", value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function setFund(index: number, field: keyof FundMappingInput, value: string) {
    setValues((current) => ({
      ...current,
      funds: current.funds.map((fund, i) => (i === index ? { ...fund, [field]: value } : fund)),
    }));
  }

  function addFund() {
    const rowKey = nextRowKey.current++;
    setValues((current) => ({ ...current, funds: [...current.funds, { ...EMPTY_FUND_MAPPING, rowKey }] }));
  }

  function removeFund(index: number) {
    setValues((current) => ({ ...current, funds: current.funds.filter((_, i) => i !== index) }));
    // Field errors are keyed by position: clear the fund errors rather than show them on the wrong row.
    setErrors((current) => ({
      form: current.form,
      fields: Object.fromEntries(Object.entries(current.fields).filter(([key]) => !key.startsWith("funds."))),
    }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = createCompanySchema.safeParse(values);
    if (!checked.success) {
      focusFirstError.current = true;
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createCompanyAction>>;
      try {
        result = await createCompanyAction(values);
      } catch {
        // The call itself failed (connection dropped, or the app was redeployed): keep everything typed.
        focusFirstError.current = true;
        setErrors({ form: MESSAGES.network, fields: {} });
        return;
      }
      if (!result.ok) {
        focusFirstError.current = true;
        setErrors(errorsOf(result));
        return;
      }
      toast.success(`${values.name.trim()} has been added`);
      for (const warning of result.data.warnings) toast.warning(warning, { duration: 12000 });
      router.push(`/admin/companies/${result.data.id}`);
    });
  }

  const usedFundIds = values.funds.map((fund) => fund.fundId).filter(Boolean);
  const canAddFund =
    values.funds.length < MAX_FUND_MAPPINGS && funds.some((fund) => fund.isActive && !usedFundIds.includes(fund.id));
  const partnerOptions = [
    { value: NO_PARTNER, label: "Not assigned yet" },
    ...partners.map((partner) => ({ value: partner.id, label: partnerOptionLabel(partner) })),
  ];

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" aria-describedby={errors.form ? "new-company-error" : undefined}>
      <FormError id="new-company-error" message={errors.form} />
      <InstrumentSuggestions />
      <datalist id="currency-suggestions">
        {CURRENCY_SUGGESTIONS.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Company details</h2>
              </CardTitle>
              <CardDescription>The legal entity and how the company appears on the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyProfileFields
                values={values}
                onChange={setField}
                errors={errors.fields}
                sectors={sectors}
                autoFocus
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Funds</h2>
              </CardTitle>
              <CardDescription>
                The funds that hold the company. Investment date, instrument and ownership are recorded per fund.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {values.funds.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
                  <LandmarkIcon className="size-4 shrink-0" aria-hidden="true" />
                  Not in a fund yet. You can also map funds later on the company&apos;s page.
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {values.funds.map((fund, index) => (
                    <li key={fund.rowKey} className="rounded-lg border p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-medium">Fund {index + 1}</h3>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFund(index)}
                          disabled={pending}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          Remove<span className="sr-only"> fund {index + 1}</span>
                        </Button>
                      </div>
                      <FundMappingFields
                        idPrefix={companyFieldId(`funds.${index}`)}
                        compact
                        value={fund}
                        onChange={(field, value) => setFund(index, field, value)}
                        errors={{
                          fundId: errors.fields[`funds.${index}.fundId`],
                          investmentDate: errors.fields[`funds.${index}.investmentDate`],
                          instrument: errors.fields[`funds.${index}.instrument`],
                          ownershipPct: errors.fields[`funds.${index}.ownershipPct`],
                        }}
                        funds={funds}
                        unavailableFundIds={usedFundIds.filter((id) => id !== fund.fundId)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {errors.fields.funds ? <p className="text-sm text-destructive">{errors.fields.funds}</p> : null}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={addFund} disabled={!canAddFund || pending}>
                  <PlusIcon data-icon="inline-start" />
                  Add fund
                </Button>
                {funds.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No funds exist yet. <Link href="/admin/funds" className="underline underline-offset-4">Add a fund</Link>{" "}
                    first.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Reporting</h2>
              </CardTitle>
              <CardDescription>
                Monthly updates are requested from the start month. Leave it as &ldquo;Not yet reporting&rdquo; until
                the company is ready to onboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <TextField
                id={companyFieldId("reportingCurrency")}
                label="Reporting currency"
                value={values.reportingCurrency}
                onValueChange={(value) => setField("reportingCurrency", value.toUpperCase())}
                error={errors.fields.reportingCurrency}
                description="Figures are entered in this currency. Other currencies are converted to RM with the monthly FX rate."
                maxLength={3}
                list="currency-suggestions"
                autoComplete="off"
                spellCheck={false}
                className="max-w-56"
              />
              <StartMonthField
                id={companyFieldId("reportingStartMonth")}
                value={values.reportingStartMonth}
                onValueChange={(value) => setField("reportingStartMonth", value)}
                months={startMonths}
                today={today}
                dueDay={dueDay}
                graceDays={graceDays}
                error={errors.fields.reportingStartMonth}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Partner-in-charge</h2>
              </CardTitle>
              <CardDescription>
                Approves the company&apos;s monthly updates. ScaleUp only: never shown to the company.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SelectField
                id={companyFieldId("partnerId")}
                label="Partner-in-charge"
                optional
                value={values.partnerId || NO_PARTNER}
                onValueChange={(value) => setField("partnerId", value === NO_PARTNER ? "" : value)}
                options={partnerOptions}
                error={errors.fields.partnerId}
                description={partners.length === 0 ? "No active partners yet. You can assign one later." : undefined}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 sm:flex-row sm:justify-end md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        <Button variant="outline" asChild>
          <Link href="/admin/companies">Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Adding company…" : "Add company"}
        </Button>
      </div>
    </form>
  );
}
