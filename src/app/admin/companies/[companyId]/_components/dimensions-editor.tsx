"use client";

import { LayersIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";

import {
  addDimensionAction,
  addDimensionMemberAction,
  deleteDimensionAction,
  deleteDimensionMemberAction,
  moveDimensionMemberAction,
  renameDimensionAction,
  renameDimensionMemberAction,
  setDimensionMemberActiveAction,
} from "../../actions";
import { useDialogState } from "../../_components/form-controls";
import { AddNameForm, NameDialog } from "./config-controls";
import { ConfigItemList, type ConfigItem } from "./config-item-list";

export type DimensionItem = {
  id: string;
  name: string;
  /** KPIs broken down by this dimension (it cannot be deleted while used). */
  kpiNames: string[];
  /** All members, in display order. */
  members: ConfigItem[];
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Why a dimension cannot be deleted, or null. */
function deleteBlocker(dimension: DimensionItem): string | null {
  if (dimension.kpiNames.length > 0) return `Used by ${dimension.kpiNames.join(", ")}`;
  if (dimension.members.some((member) => member.usedIn > 0)) return "Its members have figures";
  return null;
}

/**
 * KPI dimensions (e.g. "Outlet") and their members (e.g. "Mont Kiara"), BRD §6.2 and A4. Members are
 * ordered, renamed and deactivated like revenue lines; a dimension is deleted with its members only
 * while no KPI uses it and nothing has been reported for its members.
 */
export function DimensionsEditor({
  companyId,
  dimensions,
  canManage,
}: {
  companyId: string;
  dimensions: DimensionItem[];
  canManage: boolean;
}) {
  const rename = useDialogState<DimensionItem>();
  const [deleting, setDeleting] = useState<DimensionItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Dimensions</h2>
        </CardTitle>
        <CardDescription>
          Break a KPI down by outlet, product or region. Each active member gets its own value in the monthly update.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {dimensions.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title="No dimensions"
            description={
              canManage
                ? "Add one when a KPI needs a value per outlet, product or region."
                : "Super Admins and Fund Admins set up dimensions."
            }
          />
        ) : (
          dimensions.map((dimension) => {
            const blocker = deleteBlocker(dimension);
            const activeMembers = dimension.members.filter((member) => member.is_active).length;
            return (
              <section key={dimension.id} aria-labelledby={`dimension-${dimension.id}`} className="rounded-lg border">
                <header className="flex items-start justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <h3 id={`dimension-${dimension.id}`} className="font-medium">
                      {dimension.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {plural(activeMembers, "active member")}
                      {dimension.kpiNames.length > 0
                        ? ` · used by ${dimension.kpiNames.join(", ")}`
                        : " · not used by a KPI yet"}
                    </p>
                  </div>
                  {canManage ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${dimension.name}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        <DropdownMenuItem onSelect={() => rename.show(dimension)}>
                          <PencilIcon />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={blocker !== null}
                          onSelect={() => {
                            setDeleting(dimension);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2Icon />
                          {blocker ? `Can't delete: ${blocker.toLowerCase()}` : "Delete"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </header>
                <div className="flex flex-col gap-3 p-3">
                  {dimension.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members yet.</p>
                  ) : (
                    <ConfigItemList
                      items={dimension.members}
                      canManage={canManage}
                      noun={{ singular: "member" }}
                      deactivateEffect="It is no longer asked for in monthly updates that are still open."
                      onMove={(id, direction) => moveDimensionMemberAction({ companyId, id, direction })}
                      onRename={(id, name) => renameDimensionMemberAction({ companyId, id, name })}
                      onSetActive={(id, active) => setDimensionMemberActiveAction({ companyId, id, active })}
                      onDelete={(id) => deleteDimensionMemberAction({ companyId, id })}
                    />
                  )}
                  {canManage ? (
                    <AddNameForm
                      id={`add-member-${dimension.id}`}
                      label={`New member of ${dimension.name}`}
                      placeholder={`New ${dimension.name.toLowerCase()}, e.g. Mont Kiara`}
                      buttonLabel="Add member"
                      successMessage={(name) => `${name} added to ${dimension.name}`}
                      onAdd={(name) => addDimensionMemberAction({ companyId, dimensionId: dimension.id, name })}
                      className="sm:max-w-md"
                    />
                  ) : null}
                </div>
              </section>
            );
          })
        )}
        {canManage ? (
          <AddNameForm
            id="add-dimension"
            label="New dimension"
            placeholder="New dimension, e.g. Outlet"
            buttonLabel="Add dimension"
            successMessage={(name) => `${name} added`}
            onAdd={(name) => addDimensionAction({ companyId, name })}
            className="sm:max-w-md"
          />
        ) : null}
      </CardContent>

      {canManage ? (
        <>
          <NameDialog
            key={rename.key}
            open={rename.open}
            onOpenChange={rename.setOpen}
            title="Rename dimension"
            description="The new name is shown wherever the dimension is used."
            initialName={rename.item?.name ?? ""}
            successMessage={(name) => `Renamed to ${name}`}
            onSubmit={(name) =>
              rename.item
                ? renameDimensionAction({ companyId, id: rename.item.id, name })
                : Promise.resolve({ ok: true, data: undefined })
            }
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={`Delete ${deleting?.name ?? "this dimension"}?`}
            description={
              deleting && deleting.members.length > 0
                ? `Its ${plural(deleting.members.length, "member")} are deleted too. Nothing has been reported for them.`
                : "The dimension is removed for good."
            }
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              if (!deleting) return;
              let result: ActionResult;
              try {
                result = await deleteDimensionAction({ companyId, id: deleting.id });
              } catch {
                throw new Error(MESSAGES.network);
              }
              if (!result.ok) throw new Error(result.error);
              toast.success(`${deleting.name} deleted`);
            }}
          />
        </>
      ) : null}
    </Card>
  );
}
