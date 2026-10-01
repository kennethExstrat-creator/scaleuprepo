"use client";

import { CalendarClockIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  ordinal,
  parseCycleTab,
  plural,
  type CycleTab,
  type CyclesData,
  type ExtendTarget,
} from "../_lib/cycles-model";
import { ClosesPanel } from "./closes-panel";
import { CyclesSummary } from "./cycles-summary";
import { DeadlinesPanel } from "./deadlines-panel";
import { ExtendDeadlineDialog } from "./extend-deadline-dialog";
import { FxPanel } from "./fx-panel";
import { MonthsTable } from "./months-table";
import { OpenMonthButton } from "./open-month-button";

function Count({ value, tone = "muted" }: { value: number; tone?: "muted" | "warning" }) {
  return (
    <span
      className={cn(
        "ml-1 rounded-full px-1.5 text-xs tabular-nums",
        tone === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/** The month that `?extend=<submission id>` points at, when it can be extended. */
function targetFor(data: CyclesData, submissionId: string | null): ExtendTarget | null {
  if (!submissionId) return null;
  for (const choice of data.deadlineChoices) {
    const month = choice.months.find((item) => item.submissionId === submissionId.toLowerCase());
    if (month) return { companyId: choice.companyId, submissionId: month.submissionId };
  }
  return null;
}

/**
 * /admin/cycles (BRD A5): the header with "Open <month> early" and "Extend a deadline", the cycle summary
 * and four tabs (months, deadlines, closes, FX rates). The tab lives in the URL (?tab=), and
 * ?extend=<submission id> opens the extension dialog on that month.
 */
export function CyclesWorkspace({
  data,
  openError,
  initialTab,
  initialExtendId,
  canOpenMonths,
  canExtend,
  canManageFx,
  canEditSettings,
  canViewAudit,
}: {
  data: CyclesData;
  openError: string | null;
  initialTab: CycleTab;
  initialExtendId: string | null;
  canOpenMonths: boolean;
  canExtend: boolean;
  canManageFx: boolean;
  canEditSettings: boolean;
  /** Link the tabs to their change history in the audit log. */
  canViewAudit: boolean;
}) {
  const [tab, setTab] = useState<CycleTab>(initialTab);
  const [extend, setExtend] = useState<{ key: number; open: boolean; target: ExtendTarget | null }>(() => {
    const target = canExtend ? targetFor(data, initialExtendId) : null;
    return { key: 0, open: target !== null, target };
  });

  const hasChoices = data.deadlineChoices.length > 0;
  const missingRates = data.fx.reduce((total, group) => total + group.missing.length, 0);

  function changeTab(value: string) {
    const next = parseCycleTab(value);
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "months") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    url.searchParams.delete("extend");
    window.history.replaceState(window.history.state, "", url);
  }

  function openExtend(target: ExtendTarget | null) {
    setExtend((current) => ({ key: current.key + 1, open: true, target }));
  }

  function changeExtendOpen(open: boolean) {
    setExtend((current) => ({ ...current, open }));
    if (open) return;
    // A deep link (?extend=) has done its job: reloading the page should not reopen the dialog.
    const url = new URL(window.location.href);
    if (url.searchParams.has("extend")) {
      url.searchParams.delete("extend");
      window.history.replaceState(window.history.state, "", url);
    }
  }

  return (
    <>
      <PageHeader
        title="Reporting cycles"
        description={
          <>
            Months open automatically on the 1st of the following month and are due on the {ordinal(data.dueDay)} of
            that month. A month that opens after that date gets {plural(data.graceDays, "day")} from opening.{" "}
            {canEditSettings ? (
              <Link href="/admin/settings" className="font-medium text-foreground underline underline-offset-3">
                Change these in Settings
              </Link>
            ) : null}
          </>
        }
        actions={
          (canExtend && hasChoices) || (canOpenMonths && data.openEarly) ? (
            <>
              {canExtend && hasChoices ? (
                <Button variant="outline" onClick={() => openExtend(null)}>
                  <CalendarClockIcon data-icon="inline-start" aria-hidden="true" />
                  Extend a deadline
                </Button>
              ) : null}
              {canOpenMonths && data.openEarly ? (
                <OpenMonthButton preview={data.openEarly} templateLabel={data.currentTemplateLabel} />
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6">
        {openError ? (
          <Alert className="border-warning/30 bg-warning/5">
            <TriangleAlertIcon aria-hidden="true" className="text-warning" />
            <AlertTitle>New months could not be opened</AlertTitle>
            <AlertDescription>
              {openError} The page shows the months that are already open.
              {canEditSettings ? null : " Ask a Super Admin if this keeps happening."}
            </AlertDescription>
          </Alert>
        ) : null}

        <CyclesSummary data={data} />

        <Tabs value={tab} onValueChange={changeTab}>
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList>
              <TabsTrigger value="months">
                Months <Count value={data.months.length} />
              </TabsTrigger>
              <TabsTrigger value="deadlines">
                Deadlines <Count value={data.extensions.length} />
              </TabsTrigger>
              <TabsTrigger value="closes">Quarter and half closes</TabsTrigger>
              <TabsTrigger value="fx">
                FX rates
                {missingRates > 0 ? (
                  <>
                    <Count value={missingRates} tone="warning" />
                    <span className="sr-only"> missing</span>
                  </>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="months" className="mt-2">
            <MonthsTable months={data.months} currentMonth={data.currentMonth} />
          </TabsContent>
          <TabsContent value="deadlines" className="mt-2">
            <DeadlinesPanel
              extensions={data.extensions}
              canExtend={canExtend}
              hasChoices={hasChoices}
              onExtend={openExtend}
              historyHref={canViewAudit ? "/admin/audit?action=extend_due_date" : null}
            />
          </TabsContent>
          <TabsContent value="closes" className="mt-2">
            <ClosesPanel upcoming={data.upcoming} closes={data.closes} />
          </TabsContent>
          <TabsContent value="fx" className="mt-2">
            <FxPanel
              groups={data.fx}
              currencies={data.fxCurrencies}
              range={data.fxRange}
              canManage={canManageFx}
              historyHref={canViewAudit ? "/admin/audit?entity=fx_rates" : null}
            />
          </TabsContent>
        </Tabs>
      </div>

      {canExtend ? (
        <ExtendDeadlineDialog
          key={extend.key}
          open={extend.open}
          onOpenChange={changeExtendOpen}
          choices={data.deadlineChoices}
          today={data.today}
          initial={extend.target}
        />
      ) : null}
    </>
  );
}
