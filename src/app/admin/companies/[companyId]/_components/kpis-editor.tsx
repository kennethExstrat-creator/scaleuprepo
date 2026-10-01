"use client";

import {
  ChartNoAxesColumnIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { FormError } from "@/components/app/form-error";
import { ToneBadge } from "@/components/app/status-badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";
import { KPI_FREQUENCY_LABELS, KPI_VALUE_TYPE_LABELS } from "@/lib/constants";
import { KPI_FREQUENCIES, KPI_VALUE_TYPES, type KpiFrequency, type KpiValueType } from "@/lib/types/enums";

import { deleteKpiAction, moveKpiAction, saveKpiAction, setKpiActiveAction } from "../../actions";
import {
  errorsOf,
  formMessage,
  NO_ERRORS,
  SelectField,
  TextAreaField,
  TextField,
  useDialogState,
  zodErrors,
  type FormErrors,
} from "../../_components/form-controls";
import { allowedKpiValueTypes, KPI_DIMENSION_LOCKED_MESSAGE, KPI_TYPE_LOCKED_MESSAGE } from "../../_components/kpi-rules";
import { canMove } from "../../_components/reorder";
import { kpiSchema, LIMITS } from "../../_components/schemas";
import { UNIT_SUGGESTIONS } from "../../_components/suggestions";
import { OrderButtons, useRowAction } from "./config-controls";

export type KpiItem = {
  id: string;
  name: string;
  description: string | null;
  unit: string | null;
  valueType: KpiValueType;
  frequency: KpiFrequency;
  dimensionId: string | null;
  dimensionName: string | null;
  isRequired: boolean;
  /** Also `is_active` / `sort_order` for ordering (reorder.ts). */
  is_active: boolean;
  sort_order: number;
  /** Months with figures for the KPI. */
  usedIn: number;
};

export type DimensionChoice = { id: string; name: string; activeMembers: number };

const NO_DIMENSION = "none";
const KPI_FIELDS = ["name", "description", "unit", "valueType", "frequency", "dimensionId"];

function monthsText(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"}`;
}

/** The company's KPIs (BRD §6.2, A4); Super Admins and Fund Admins manage them. */
export function KpisEditor({
  companyId,
  companyName,
  kpis,
  dimensions,
  canManage,
}: {
  companyId: string;
  companyName: string;
  /** In display order (active first, then sort order). */
  kpis: KpiItem[];
  dimensions: DimensionChoice[];
  canManage: boolean;
}) {
  const dialog = useDialogState<KpiItem>();
  const { pending, pendingKey, run } = useRowAction();
  const [confirmation, setConfirmation] = useState<{ kind: "deactivate" | "delete"; kpi: KpiItem } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const orderRows = kpis.map((kpi) => ({ id: kpi.id, name: kpi.name, sort_order: kpi.sort_order, is_active: kpi.is_active }));

  function confirm(kind: "deactivate" | "delete", kpi: KpiItem) {
    setConfirmation({ kind, kpi });
    setConfirmOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Company KPIs</h2>
        </CardTitle>
        <CardDescription>
          Metrics {companyName} reports in its monthly update besides the financials: every month, or half-yearly in
          the June and December updates. A KPI broken down by a dimension gets one value per active member.
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button size="sm" onClick={() => dialog.show(null)}>
              <PlusIcon data-icon="inline-start" />
              Add KPI
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {kpis.length === 0 ? (
          <EmptyState
            icon={ChartNoAxesColumnIcon}
            title="No company KPIs"
            description={
              canManage
                ? "Add the metrics that matter for this company, e.g. outlets' revenue, app downloads or active users."
                : "Super Admins and Fund Admins set up company KPIs."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {canManage ? (
                    <TableHead className="w-0 pl-2">
                      <span className="sr-only">Order</span>
                    </TableHead>
                  ) : null}
                  <TableHead className={canManage ? undefined : "pl-3"}>KPI</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Broken down by</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? (
                    <TableHead className="w-0 pr-2">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.map((kpi) => (
                  <TableRow key={kpi.id} className={kpi.is_active ? undefined : "text-muted-foreground"}>
                    {canManage ? (
                      <TableCell className="pl-2">
                        <OrderButtons
                          name={kpi.name}
                          canMoveUp={canMove(orderRows, kpi.id, "up")}
                          canMoveDown={canMove(orderRows, kpi.id, "down")}
                          disabled={pending}
                          onMove={(direction) =>
                            run(`move:${kpi.id}`, () => moveKpiAction({ companyId, id: kpi.id, direction }))
                          }
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className={canManage ? "max-w-80 whitespace-normal" : "max-w-80 pl-3 whitespace-normal"}>
                      <div className="font-medium text-foreground">{kpi.name}</div>
                      {kpi.description ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground" title={kpi.description}>
                          {kpi.description}
                        </p>
                      ) : null}
                      {kpi.usedIn > 0 ? (
                        <p className="text-xs text-muted-foreground">Figures in {monthsText(kpi.usedIn)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>{kpi.unit ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{KPI_VALUE_TYPE_LABELS[kpi.valueType]}</TableCell>
                    <TableCell>{KPI_FREQUENCY_LABELS[kpi.frequency]}</TableCell>
                    <TableCell>{kpi.dimensionName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{kpi.isRequired ? "Required" : "Optional"}</TableCell>
                    <TableCell>
                      <ToneBadge tone={kpi.is_active ? "success" : "neutral"}>
                        {kpi.is_active ? "Active" : "Inactive"}
                      </ToneBadge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="pr-2 text-right">
                        {pendingKey?.endsWith(kpi.id) ? (
                          <span className="inline-flex size-7 items-center justify-center" aria-label="Saving…">
                            <Spinner />
                          </span>
                        ) : (
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${kpi.name}`} disabled={pending}>
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onSelect={() => dialog.show(kpi)}>
                                <PencilIcon />
                                Edit
                              </DropdownMenuItem>
                              {kpi.is_active ? (
                                <DropdownMenuItem onSelect={() => confirm("deactivate", kpi)}>
                                  <PowerOffIcon />
                                  Deactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    run(
                                      `activate:${kpi.id}`,
                                      () => setKpiActiveAction({ companyId, id: kpi.id, active: true }),
                                      `${kpi.name} is active again`,
                                    )
                                  }
                                >
                                  <PowerIcon />
                                  Reactivate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={kpi.usedIn > 0}
                                onSelect={() => confirm("delete", kpi)}
                              >
                                <Trash2Icon />
                                {kpi.usedIn > 0 ? "Can't delete: has figures" : "Delete"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
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
          <KpiDialog
            key={dialog.key}
            open={dialog.open}
            onOpenChange={dialog.setOpen}
            companyId={companyId}
            kpi={dialog.item}
            dimensions={dimensions}
          />
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={
              confirmation?.kind === "delete"
                ? `Delete ${confirmation.kpi.name}?`
                : `Deactivate ${confirmation?.kpi.name ?? "this KPI"}?`
            }
            description={
              confirmation?.kind === "delete"
                ? "The KPI is removed for good. Nothing has been reported for it yet."
                : "It is no longer asked for in monthly updates that are still open. Figures already reported are kept, and you can reactivate it later."
            }
            confirmLabel={confirmation?.kind === "delete" ? "Delete" : "Deactivate"}
            destructive={confirmation?.kind === "delete"}
            onConfirm={async () => {
              if (!confirmation) return;
              const { kind, kpi } = confirmation;
              let result: ActionResult;
              try {
                result =
                  kind === "delete"
                    ? await deleteKpiAction({ companyId, id: kpi.id })
                    : await setKpiActiveAction({ companyId, id: kpi.id, active: false });
              } catch {
                throw new Error(MESSAGES.network);
              }
              if (!result.ok) throw new Error(result.error);
              toast.success(kind === "delete" ? `${kpi.name} deleted` : `${kpi.name} deactivated`);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

type KpiFormValues = {
  name: string;
  description: string;
  unit: string;
  valueType: KpiValueType;
  frequency: KpiFrequency;
  dimensionId: string;
  isRequired: boolean;
  isActive: boolean;
};

function KpiDialog({
  open,
  onOpenChange,
  companyId,
  kpi,
  dimensions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  kpi: KpiItem | null;
  dimensions: DimensionChoice[];
}) {
  const [values, setValues] = useState<KpiFormValues>(() => ({
    name: kpi?.name ?? "",
    description: kpi?.description ?? "",
    unit: kpi?.unit ?? "",
    valueType: kpi?.valueType ?? "number",
    frequency: kpi?.frequency ?? "monthly",
    dimensionId: kpi?.dimensionId ?? "",
    isRequired: kpi?.isRequired ?? true,
    isActive: kpi?.is_active ?? true,
  }));
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  const [pending, startTransition] = useTransition();
  const hasFigures = (kpi?.usedIn ?? 0) > 0;
  const valueTypes = kpi ? allowedKpiValueTypes(kpi.valueType, hasFigures, KPI_VALUE_TYPES) : [...KPI_VALUE_TYPES];

  function set<K extends keyof KpiFormValues>(key: K, value: KpiFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { ...values, companyId, id: kpi?.id ?? null, dimensionId: values.dimensionId || null };
    const checked = kpiSchema.safeParse(input);
    if (!checked.success) {
      setErrors(zodErrors(checked.error));
      return;
    }
    setErrors(NO_ERRORS);
    startTransition(async () => {
      try {
        const result = await saveKpiAction(input);
        if (!result.ok) {
          setErrors(errorsOf(result));
          return;
        }
        toast.success(kpi ? `${checked.data.name} saved` : `${checked.data.name} added`);
        onOpenChange(false);
      } catch {
        setErrors({ form: MESSAGES.network, fields: {} });
      }
    });
  }

  const dimensionOptions = [
    { value: NO_DIMENSION, label: "Not broken down (one value)" },
    ...dimensions.map((dimension) => ({
      value: dimension.id,
      label: `${dimension.name} (${dimension.activeMembers} active ${dimension.activeMembers === 1 ? "member" : "members"})`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{kpi ? `Edit ${kpi.name}` : "Add KPI"}</DialogTitle>
          <DialogDescription>
            {kpi
              ? "Changes apply to monthly updates that are still open. Figures already reported are kept."
              : "The KPI is asked for in the company's open monthly updates from now on."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormError message={formMessage(errors, KPI_FIELDS)} />
          <datalist id="kpi-unit-suggestions">
            {UNIT_SUGGESTIONS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <TextField
              id="kpi-name"
              label="Name"
              value={values.name}
              onValueChange={(value) => set("name", value)}
              error={errors.fields.name}
              maxLength={LIMITS.configName}
              placeholder="e.g. Active carers"
              autoComplete="off"
              autoFocus={!kpi}
            />
            <TextField
              id="kpi-unit"
              label="Unit"
              optional
              value={values.unit}
              onValueChange={(value) => set("unit", value)}
              error={errors.fields.unit}
              maxLength={LIMITS.unit}
              list="kpi-unit-suggestions"
              placeholder="e.g. RM"
              autoComplete="off"
            />
          </div>
          <TextAreaField
            id="kpi-description"
            label="Description"
            optional
            value={values.description}
            onValueChange={(value) => set("description", value)}
            error={errors.fields.description}
            description="What the KPI measures and how to count it."
            maxLength={LIMITS.kpiDescription}
            rows={2}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="kpi-value-type"
              label="Value type"
              value={values.valueType}
              onValueChange={(value) => {
                const type = KPI_VALUE_TYPES.find((option) => option === value);
                if (type) set("valueType", type);
              }}
              options={valueTypes.map((type) => ({ value: type, label: KPI_VALUE_TYPE_LABELS[type] }))}
              error={errors.fields.valueType}
              description={
                hasFigures ? (
                  <span className="inline-flex items-start gap-1.5">
                    <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {KPI_TYPE_LOCKED_MESSAGE}
                  </span>
                ) : undefined
              }
            />
            <SelectField
              id="kpi-frequency"
              label="Frequency"
              value={values.frequency}
              onValueChange={(value) => {
                const frequency = KPI_FREQUENCIES.find((option) => option === value);
                if (frequency) set("frequency", frequency);
              }}
              options={KPI_FREQUENCIES.map((frequency) => ({ value: frequency, label: KPI_FREQUENCY_LABELS[frequency] }))}
              error={errors.fields.frequency}
            />
          </div>
          <SelectField
            id="kpi-dimension"
            label="Broken down by"
            value={values.dimensionId || NO_DIMENSION}
            onValueChange={(value) => set("dimensionId", value === NO_DIMENSION ? "" : value)}
            options={dimensionOptions}
            error={errors.fields.dimensionId}
            disabled={hasFigures}
            description={
              hasFigures ? (
                <span className="inline-flex items-start gap-1.5">
                  <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {KPI_DIMENSION_LOCKED_MESSAGE}
                </span>
              ) : dimensions.length === 0 ? (
                "Add a dimension (e.g. Outlet) under Dimensions below to break a KPI down."
              ) : (
                "One value per active member of the dimension, e.g. per outlet."
              )
            }
          />
          <div className="flex flex-col gap-4 rounded-lg border p-3">
            <Field orientation="horizontal">
              <Switch
                id="kpi-required"
                checked={values.isRequired}
                onCheckedChange={(checked) => set("isRequired", checked)}
                aria-describedby="kpi-required-description"
              />
              <FieldContent>
                <FieldLabel htmlFor="kpi-required">Required</FieldLabel>
                <FieldDescription id="kpi-required-description">
                  The company can&apos;t submit a month without it.
                </FieldDescription>
              </FieldContent>
            </Field>
            {kpi ? (
              <Field orientation="horizontal">
                <Switch
                  id="kpi-active"
                  checked={values.isActive}
                  onCheckedChange={(checked) => set("isActive", checked)}
                  aria-describedby="kpi-active-description"
                />
                <FieldContent>
                  <FieldLabel htmlFor="kpi-active">Active</FieldLabel>
                  <FieldDescription id="kpi-active-description">
                    Inactive KPIs are no longer asked for; their figures are kept.
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {kpi ? "Save KPI" : "Add KPI"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
