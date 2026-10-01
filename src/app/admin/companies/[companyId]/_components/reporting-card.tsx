"use client";

import { CalendarClockIcon, InfoIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormError } from "@/components/app/form-error";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";
import { COMPANY_STATUS_LABELS, NOT_YET_REPORTING_META } from "@/lib/constants";
import { dateToMonthKey, monthLabelLong, type MonthKey } from "@/lib/periods";
import type { CompanyStatus } from "@/lib/types/enums";

import { setReportingStartAction } from "../../actions";
import { StartMonthField } from "../../_components/start-month-field";

/**
 * The reporting start month (BRD B3, B16) with what it means; Super Admins set, change or clear it. Setting
 * it opens the months that are due at once; clearing it keeps every month already opened.
 */
export function ReportingCard({
  companyId,
  companyName,
  companyStatus,
  startMonth,
  months,
  today,
  dueDay,
  graceDays,
  canManage,
}: {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  /** 'YYYY-MM-DD' or null (not yet reporting). */
  startMonth: string | null;
  /** Months that can be chosen (startMonthOptions). */
  months: MonthKey[];
  today: string;
  dueDay: number;
  graceDays: number;
  canManage: boolean;
}) {
  const saved = startMonth ? dateToMonthKey(startMonth) : "";
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = value !== saved;

  async function save(month: string): Promise<string | null> {
    const result = await setReportingStartAction({ companyId, month: month || null });
    if (!result.ok) return result.fieldErrors?.month ?? result.error;
    toast.success(month ? `Reporting starts ${monthLabelLong(month)}` : `${companyName} is not reporting any more`);
    if (result.data.warning) toast.warning(result.data.warning, { duration: 12000 });
    return null;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    if (!value) {
      setConfirmClear(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        setError(await save(value));
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
            <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2>Reporting</h2>
          </CardTitle>
          <CardDescription>
            {saved ? (
              <>
                Monthly updates are requested from <strong className="font-medium text-foreground">{monthLabelLong(saved)}</strong>.
              </>
            ) : (
              <ToneBadge tone={NOT_YET_REPORTING_META.tone}>{NOT_YET_REPORTING_META.label}</ToneBadge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Each month opens on the 1st of the following month and is due on day {dueDay}. A month that opens after its
            due date gets {graceDays} days from the day it opens. Earlier history comes from the workbook migration.
          </p>
          {companyStatus !== "active" ? (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The company is {COMPANY_STATUS_LABELS[companyStatus].toLowerCase()}, so no new months are opened for it.
            </p>
          ) : null}
          {canManage ? (
            <>
              <FormError message={error} />
              <StartMonthField
                id="reporting-start-month"
                label="Reporting start month"
                value={value}
                onValueChange={(next) => {
                  setValue(next);
                  setError(null);
                }}
                months={months}
                today={today}
                dueDay={dueDay}
                graceDays={graceDays}
                disabled={pending}
              />
              {saved && !value ? (
                <p className="text-muted-foreground">
                  Clearing the start month stops new months from opening. Months already opened, and their figures, are
                  kept.
                </p>
              ) : null}
            </>
          ) : null}
        </CardContent>
        {canManage ? (
          <CardFooter className="justify-end gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setValue(saved)}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={!dirty || pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save start month
            </Button>
          </CardFooter>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={`Stop monthly reporting for ${companyName}?`}
        description="No new months will be opened, and the company shows as not yet reporting. Months already opened, and their figures, are kept."
        confirmLabel="Stop reporting"
        destructive
        onConfirm={async () => {
          const message = await save("");
          if (message) throw new Error(message);
        }}
      />
    </Card>
  );
}
