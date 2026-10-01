"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CoinsIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MESSAGES } from "@/lib/actions/result";
import { NOT_YET_REPORTING_META } from "@/lib/constants";
import { formatDate, formatNumberTrimmed, formatPct } from "@/lib/format";
import { monthLabel, monthLabelLong, type MonthKey } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { deleteFxRateAction } from "../actions";
import { joinNames, plural, type FxCompany, type FxCurrency, type FxMonthRow } from "../_lib/cycles-model";
import { FX_RATE_DECIMALS } from "../_lib/schemas";
import { FxRateDialog, type FxDialogTarget } from "./fx-rate-dialog";

/** Months shown per currency before "Show all". */
const INITIAL_ROWS = 12;

type DeleteTarget = { currency: string; month: MonthKey; companies: string[] };

function companyLine(company: FxCompany): string {
  if (company.status !== "active") return `${company.name} (no longer active)`;
  if (!company.reportingStartMonth) return `${company.name} (${NOT_YET_REPORTING_META.label.toLowerCase()})`;
  return `${company.name} (reports from ${monthLabel(company.reportingStartMonth)})`;
}

function ChangeCell({ row }: { row: FxMonthRow }) {
  if (row.changePct === null || !row.comparedWith) return <span className="text-muted-foreground">—</span>;
  const text = `${formatPct(row.changePct, 1, { signed: true })} vs ${monthLabel(row.comparedWith)}`;
  if (!row.unusual) return <span className="text-muted-foreground">{text}</span>;
  return (
    <span className="inline-flex items-center gap-1 font-medium text-warning" title="A large change: check the rate">
      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </span>
  );
}

function CurrencyBlock({
  group,
  canManage,
  canAdd,
  onAdd,
  onEdit,
  onDelete,
}: {
  group: FxCurrency;
  canManage: boolean;
  /** A rate can be added for this currency (a company reports in it). */
  canAdd: boolean;
  onAdd: (currency: string, month: MonthKey | null) => void;
  onEdit: (currency: string, row: FxMonthRow) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? group.rows : group.rows.slice(0, INITIAL_ROWS);
  const headingId = `fx-${group.currency}-heading`;

  return (
    <Card role="region" className="gap-0 overflow-hidden py-0" aria-labelledby={headingId}>
      <CardHeader className="border-b py-4">
        <CardTitle id={headingId} className="flex flex-wrap items-center gap-2">
          {group.currency}
          {group.missing.length > 0 ? (
            <ToneBadge tone="warning">{plural(group.missing.length, "rate")} missing</ToneBadge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {group.companies.length > 0
            ? `Reported in by ${joinNames(group.companies.map(companyLine))}.`
            : "No company reports in this currency any more; its rates are kept for earlier months."}
        </CardDescription>
      </CardHeader>
      {group.missing.length > 0 ? (
        <Alert className="m-4 mb-0 w-auto border-warning/30 bg-warning/5">
          <TriangleAlertIcon className="text-warning" aria-hidden="true" />
          <AlertTitle>
            No {group.currency} rate for {joinNames(group.missing.map(monthLabel))}
          </AlertTitle>
          <AlertDescription>
            Exports leave the RM amounts of these months blank until a rate is added.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="min-w-32">Month</TableHead>
              <TableHead className="text-right">1 {group.currency} in MYR</TableHead>
              <TableHead className="hidden md:table-cell">Change</TableHead>
              <TableHead className="hidden lg:table-cell">Used for</TableHead>
              <TableHead className="hidden md:table-cell">Last updated</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const missingNeeded = row.rate === null && row.needed;
              return (
                <TableRow
                  key={row.month}
                  className={cn(
                    missingNeeded && "bg-warning/5 hover:bg-warning/10",
                    row.rate === null && !missingNeeded && "bg-muted/30",
                  )}
                >
                  <TableCell className="font-medium whitespace-nowrap">{monthLabelLong(row.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.rate !== null ? (
                      formatNumberTrimmed(row.rate, FX_RATE_DECIMALS)
                    ) : missingNeeded ? (
                      <ToneBadge tone="warning" title="A company reports in this currency this month">
                        Missing
                      </ToneBadge>
                    ) : (
                      <ToneBadge tone="neutral" title="No company needs it yet">
                        No rate
                      </ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap tabular-nums md:table-cell">
                    <ChangeCell row={row} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {row.reportingCompanies.length > 0 ? (
                      joinNames(row.reportingCompanies)
                    ) : (
                      <span className="text-muted-foreground">Not needed yet</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {row.updatedAt ? (
                      <span className="flex flex-col gap-0.5">
                        <span className="tabular-nums">{formatDate(row.updatedAt)}</span>
                        {row.updatedBy ? <span className="text-xs text-muted-foreground">{row.updatedBy}</span> : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {row.rate !== null ? (
                        <span className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onEdit(group.currency, row)}
                            aria-label={`Edit the ${group.currency} rate for ${monthLabelLong(row.month)}`}
                            title="Edit"
                          >
                            <PencilIcon aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              onDelete({ currency: group.currency, month: row.month, companies: row.reportingCompanies })
                            }
                            aria-label={`Delete the ${group.currency} rate for ${monthLabelLong(row.month)}`}
                            title="Delete"
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </span>
                      ) : canAdd ? (
                        <Button
                          variant={missingNeeded ? "outline" : "ghost"}
                          size="sm"
                          onClick={() => onAdd(group.currency, row.month)}
                          aria-label={`Add the ${group.currency} rate for ${monthLabelLong(row.month)}`}
                        >
                          <PlusIcon data-icon="inline-start" aria-hidden="true" />
                          Add
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {group.rows.length > INITIAL_ROWS ? (
        <div className="border-t p-3">
          <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
            {showAll ? <ChevronUpIcon data-icon="inline-start" /> : <ChevronDownIcon data-icon="inline-start" />}
            {showAll ? `Show the latest ${INITIAL_ROWS} months` : `Show all ${group.rows.length} months`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * FX rates (BRD §12, B18): one block per currency companies report in, every open month with its rate (MYR
 * per unit), the change from the previous rate, and the months that still need one. Super Admins and Fund
 * Admins add, edit and delete rates.
 */
export function FxPanel({
  groups,
  currencies,
  range,
  canManage,
  historyHref,
}: {
  groups: FxCurrency[];
  /** The non-MYR currencies companies report in. */
  currencies: string[];
  range: { from: MonthKey; to: MonthKey };
  canManage: boolean;
  /** The FX rate changes in the audit log (null when the role cannot see it). */
  historyHref: string | null;
}) {
  const [dialog, setDialog] = useState<{ key: number; open: boolean; target: FxDialogTarget }>({
    key: 0,
    open: false,
    target: { mode: "create", currency: null, month: null },
  });
  // The target stays while the confirmation closes (its text must not change during the animation).
  const [deletion, setDeletion] = useState<{ open: boolean; target: DeleteTarget | null }>({
    open: false,
    target: null,
  });
  const deleting = deletion.target;

  function openDialog(target: FxDialogTarget) {
    setDialog((current) => ({ key: current.key + 1, open: true, target }));
  }

  async function confirmDelete() {
    if (!deleting) return;
    let result: Awaited<ReturnType<typeof deleteFxRateAction>>;
    try {
      result = await deleteFxRateAction({ currency: deleting.currency, month: deleting.month });
    } catch {
      throw new Error(MESSAGES.network);
    }
    if (!result.ok) throw new Error(result.error);
    toast.success(`${deleting.currency} rate for ${monthLabel(deleting.month)} deleted`);
  }

  const canAddAny = canManage && currencies.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-sm text-pretty text-muted-foreground">
          Companies outside Malaysia enter their figures in their own currency. Exports and dashboards convert them to
          RM with the month&apos;s rate: how many ringgit one unit of the currency was worth.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {historyHref && groups.length > 0 ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={historyHref}>
                <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                Change history
              </Link>
            </Button>
          ) : null}
          {canAddAny ? (
            <Button size="sm" onClick={() => openDialog({ mode: "create", currency: null, month: null })}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add rate
            </Button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={CoinsIcon}
          title="Every company reports in MYR"
          description="No FX rates are needed. A currency appears here as soon as a company reports in it."
        />
      ) : (
        groups.map((group) => (
          <CurrencyBlock
            key={group.currency}
            group={group}
            canManage={canManage}
            canAdd={canManage && currencies.includes(group.currency)}
            onAdd={(currency, month) => openDialog({ mode: "create", currency, month })}
            onEdit={(currency, row) =>
              row.rate !== null && openDialog({ mode: "edit", currency, month: row.month, rate: row.rate })
            }
            onDelete={(target) => setDeletion({ open: true, target })}
          />
        ))
      )}

      {canManage ? (
        <FxRateDialog
          key={dialog.key}
          open={dialog.open}
          onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
          target={dialog.target}
          currencies={currencies}
          groups={groups}
          range={range}
        />
      ) : null}

      <ConfirmDialog
        open={deletion.open}
        onOpenChange={(open) => setDeletion((current) => ({ ...current, open }))}
        title={deleting ? `Delete the ${deleting.currency} rate for ${monthLabelLong(deleting.month)}?` : "Delete the rate?"}
        description={
          deleting && deleting.companies.length > 0
            ? `Exports will leave the RM amounts of ${joinNames(deleting.companies)} for ${monthLabel(deleting.month)} blank until a rate is added again.`
            : "No company needs this rate at the moment. You can add it again later."
        }
        confirmLabel="Delete rate"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
