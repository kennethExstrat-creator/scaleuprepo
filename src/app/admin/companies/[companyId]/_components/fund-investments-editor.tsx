"use client";

import { LandmarkIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MESSAGES } from "@/lib/actions/result";
import { formatDate, formatNumberInput, formatNumberTrimmed } from "@/lib/format";

import { deleteFundInvestmentAction, saveFundInvestmentAction } from "../../actions";
import { errorsOf, formMessage, NO_ERRORS, useDialogState, zodErrors, type FormErrors } from "../../_components/form-controls";
import {
  EMPTY_FUND_MAPPING,
  FundMappingFields,
  InstrumentSuggestions,
  type FundMappingInput,
} from "../../_components/fund-mapping-fields";
import { fundInvestmentSchema } from "../../_components/schemas";
import type { CompanyInvestment, FundOption } from "../../_components/types";

const MAPPING_FIELDS = ["fundId", "investmentDate", "instrument", "ownershipPct", "notes"];

/** The company's fund mappings (BRD A1, B2); Super Admins add, edit and remove them. */
export function FundInvestmentsEditor({
  companyId,
  companyName,
  investments,
  funds,
  canManage,
}: {
  companyId: string;
  companyName: string;
  investments: CompanyInvestment[];
  funds: FundOption[];
  canManage: boolean;
}) {
  const dialog = useDialogState<CompanyInvestment>();
  const [removing, setRemoving] = useState<CompanyInvestment | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const mappedFundIds = investments.map((investment) => investment.fundId);
  const canAdd = canManage && funds.some((fund) => fund.isActive && !mappedFundIds.includes(fund.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Funds &amp; investment</h2>
        </CardTitle>
        <CardDescription>
          The funds that hold {companyName}. Investment date, instrument and ownership are recorded per fund, because a
          company can sit in more than one fund.
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button size="sm" onClick={() => dialog.show(null)} disabled={!canAdd} title={canAdd ? undefined : "Every active fund is already mapped."}>
              <PlusIcon data-icon="inline-start" />
              Add fund
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {investments.length === 0 ? (
          <EmptyState
            icon={LandmarkIcon}
            title="Not in a fund yet"
            description={canManage ? "Add the funds that hold this company." : "A Super Admin maps companies to funds."}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-3">Fund</TableHead>
                  <TableHead>Investment date</TableHead>
                  <TableHead>Instrument</TableHead>
                  <TableHead className="text-right">Ownership</TableHead>
                  <TableHead>Notes</TableHead>
                  {canManage ? (
                    <TableHead className="w-0 pr-3">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {investments.map((investment) => (
                  <TableRow key={investment.id}>
                    <TableCell className="pl-3">
                      <div className="font-medium">{investment.fundCode}</div>
                      <div className="text-xs text-muted-foreground">
                        {investment.fundName}
                        {investment.fundActive ? null : " (inactive)"}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {investment.investmentDate ? formatDate(investment.investmentDate) : <Muted />}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{investment.instrument ?? <Muted />}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {investment.ownershipPct !== null ? `${formatNumberTrimmed(investment.ownershipPct, 4)}%` : <Muted />}
                    </TableCell>
                    <TableCell className="max-w-64 truncate" title={investment.notes ?? undefined}>
                      {investment.notes ?? <Muted />}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="pr-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => dialog.show(investment)}>
                            <PencilIcon data-icon="inline-start" />
                            Edit<span className="sr-only"> {investment.fundCode}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setRemoving(investment);
                              setRemoveOpen(true);
                            }}
                            aria-label={`Remove ${investment.fundCode}`}
                            title="Remove"
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {canManage ? (
        <>
          <InvestmentDialog
            key={dialog.key}
            open={dialog.open}
            onOpenChange={dialog.setOpen}
            companyId={companyId}
            investment={dialog.item}
            funds={funds}
            mappedFundIds={mappedFundIds}
          />
          <ConfirmDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            title={`Remove ${removing?.fundCode ?? "the fund"} from ${companyName}?`}
            description="The fund mapping and its investment details are deleted. The company's monthly updates are not affected."
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              if (!removing) return;
              let result;
              try {
                result = await deleteFundInvestmentAction({ companyId, id: removing.id });
              } catch {
                throw new Error(MESSAGES.network);
              }
              if (!result.ok) throw new Error(result.error);
              toast.success(`${removing.fundCode} removed`);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}

function InvestmentDialog({
  open,
  onOpenChange,
  companyId,
  investment,
  funds,
  mappedFundIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  investment: CompanyInvestment | null;
  funds: FundOption[];
  mappedFundIds: string[];
}) {
  const [values, setValues] = useState<FundMappingInput>(() =>
    investment
      ? {
          fundId: investment.fundId,
          investmentDate: investment.investmentDate ?? "",
          instrument: investment.instrument ?? "",
          ownershipPct: formatNumberInput(investment.ownershipPct, 4),
          notes: investment.notes ?? "",
        }
      : { ...EMPTY_FUND_MAPPING },
  );
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { ...values, companyId, id: investment?.id ?? null };
    const checked = fundInvestmentSchema.safeParse(input);
    if (!checked.success) {
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      try {
        const result = await saveFundInvestmentAction(input);
        if (!result.ok) {
          setErrors(errorsOf(result));
          return;
        }
        const code = funds.find((fund) => fund.id === values.fundId)?.code ?? "Fund";
        toast.success(investment ? `${code} investment saved` : `${code} added`);
        onOpenChange(false);
      } catch {
        setErrors({ form: MESSAGES.network, fields: {} });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{investment ? `Edit ${investment.fundCode} investment` : "Add fund"}</DialogTitle>
          <DialogDescription>
            {investment
              ? "The investment details of this fund in the company."
              : "Map the company to a fund, with that fund's investment details."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError message={formMessage(errors, MAPPING_FIELDS)} />
          <InstrumentSuggestions />
          <FundMappingFields
            idPrefix="investment"
            value={values}
            onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
            errors={errors.fields}
            funds={funds}
            unavailableFundIds={mappedFundIds}
            fundLocked={investment !== null}
            showNotes
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {investment ? "Save changes" : "Add fund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
