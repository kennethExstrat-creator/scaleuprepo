"use client";

// An ordered list of named configuration rows (revenue lines, KPI dimension members): move up/down,
// rename, deactivate / reactivate and delete (only while nothing has been reported against the row; the
// database refuses it anyway).

import { MoreHorizontalIcon, PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";
import { cn } from "@/lib/utils";

import { useDialogState } from "../../_components/form-controls";
import { canMove, type MoveDirection } from "../../_components/reorder";
import { NameDialog, OrderButtons, useRowAction } from "./config-controls";

export type ConfigItem = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** Months with figures for this row (rows with figures cannot be deleted). */
  usedIn: number;
};

/** How the rows are named in dialogs, e.g. { singular: "revenue line" }. */
export type ConfigItemNoun = { singular: string };

type Confirmation = { kind: "deactivate" | "delete"; item: ConfigItem };

function monthsText(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"}`;
}

export function ConfigItemList({
  items,
  canManage,
  noun,
  deactivateEffect,
  onMove,
  onRename,
  onSetActive,
  onDelete,
  className,
}: {
  /** In display order (active first, then sort order). */
  items: ConfigItem[];
  canManage: boolean;
  noun: ConfigItemNoun;
  /** What deactivating does, e.g. "It is no longer asked for in open monthly updates." */
  deactivateEffect: string;
  onMove: (id: string, direction: MoveDirection) => Promise<ActionResult<unknown>>;
  onRename: (id: string, name: string) => Promise<ActionResult<unknown>>;
  onSetActive: (id: string, active: boolean) => Promise<ActionResult<unknown>>;
  onDelete: (id: string) => Promise<ActionResult<unknown>>;
  className?: string;
}) {
  const { pending, pendingKey, run } = useRowAction();
  const rename = useDialogState<ConfigItem>();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function confirm(kind: Confirmation["kind"], item: ConfigItem) {
    setConfirmation({ kind, item });
    setConfirmOpen(true);
  }

  return (
    <>
      <ul className={cn("divide-y rounded-lg border", className)}>
        {items.map((item) => {
          const busy = pendingKey?.endsWith(item.id) ?? false;
          return (
            <li key={item.id} className="flex min-h-11 items-center gap-2 px-2 py-1.5 sm:px-3">
              {canManage ? (
                <OrderButtons
                  name={item.name}
                  canMoveUp={canMove(items, item.id, "up")}
                  canMoveDown={canMove(items, item.id, "down")}
                  disabled={pending}
                  onMove={(direction) => run(`move:${item.id}`, () => onMove(item.id, direction))}
                />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn("truncate font-medium", !item.is_active && "text-muted-foreground")}>
                  {item.name}
                </span>
                {item.is_active ? null : <ToneBadge tone="neutral">Inactive</ToneBadge>}
                {item.usedIn > 0 ? (
                  <span className="text-xs text-muted-foreground">Figures in {monthsText(item.usedIn)}</span>
                ) : null}
              </div>
              {canManage ? (
                busy ? (
                  <span className="flex size-7 items-center justify-center" aria-label="Saving…">
                    <Spinner />
                  </span>
                ) : (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.name}`} disabled={pending}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => rename.show(item)}>
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      {item.is_active ? (
                        <DropdownMenuItem onSelect={() => confirm("deactivate", item)}>
                          <PowerOffIcon />
                          Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() =>
                            run(`activate:${item.id}`, () => onSetActive(item.id, true), `${item.name} is active again`)
                          }
                        >
                          <PowerIcon />
                          Reactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={item.usedIn > 0}
                        onSelect={() => confirm("delete", item)}
                      >
                        <Trash2Icon />
                        {item.usedIn > 0 ? "Can't delete: has figures" : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        <>
          <NameDialog
            key={rename.key}
            open={rename.open}
            onOpenChange={rename.setOpen}
            title={`Rename ${noun.singular}`}
            description="The new name is used in monthly updates, including past ones, and in exports."
            initialName={rename.item?.name ?? ""}
            successMessage={(name) => `Renamed to ${name}`}
            onSubmit={(name) => (rename.item ? onRename(rename.item.id, name) : Promise.resolve({ ok: true, data: undefined }))}
          />
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={
              confirmation?.kind === "delete"
                ? `Delete ${confirmation.item.name}?`
                : `Deactivate ${confirmation?.item.name ?? noun.singular}?`
            }
            description={
              confirmation?.kind === "delete"
                ? `The ${noun.singular} is removed for good. Nothing has been reported for it yet.`
                : `${deactivateEffect} Figures already reported are kept, and you can reactivate it later.`
            }
            confirmLabel={confirmation?.kind === "delete" ? "Delete" : "Deactivate"}
            destructive={confirmation?.kind === "delete"}
            onConfirm={async () => {
              if (!confirmation) return;
              const { item, kind } = confirmation;
              let result: ActionResult<unknown>;
              try {
                result = kind === "delete" ? await onDelete(item.id) : await onSetActive(item.id, false);
              } catch {
                throw new Error(MESSAGES.network);
              }
              if (!result.ok) throw new Error(result.error);
              toast.success(kind === "delete" ? `${item.name} deleted` : `${item.name} deactivated`);
            }}
          />
        </>
      ) : null}
    </>
  );
}
