"use client";

import { EllipsisIcon, PlusIcon, UserCheckIcon, UserCogIcon, UserMinusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { updateMembershipAction } from "../actions";
import type { DirectoryMembership, DirectoryUser } from "./directory-model";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayName } from "@/lib/auth-admin/status";
import { COMPANY_ROLE_LABELS, COMPANY_STATUS_LABELS } from "@/lib/constants";
import type { CompanyRole } from "@/lib/types/enums";

type PendingChange =
  | { kind: "role"; membership: DirectoryMembership; role: CompanyRole }
  | { kind: "active"; membership: DirectoryMembership; active: boolean };

/**
 * A company user's memberships: change the company role or switch a membership off and on again
 * (memberships are never deleted). Open while `user` is set; `user` is re-read from the page data, so
 * it updates after every change.
 */
export function CompanyAccessDialog({
  user,
  onClose,
  onAddToCompany,
}: {
  user: DirectoryUser | null;
  onClose: () => void;
  onAddToCompany: (user: DirectoryUser) => void;
}) {
  const [change, setChange] = useState<PendingChange | null>(null);
  const name = user ? displayName(user.fullName, user.email) : "";

  async function applyChange(pending: PendingChange) {
    if (!user) return;
    const result = await updateMembershipAction(
      pending.kind === "role"
        ? { companyId: pending.membership.companyId, userId: user.id, role: pending.role }
        : { companyId: pending.membership.companyId, userId: user.id, active: pending.active },
    );
    if (!result.ok) throw new Error(result.error);
    toast.success(
      pending.kind === "role"
        ? `${name} is now ${COMPANY_ROLE_LABELS[pending.role]} of ${pending.membership.companyName}.`
        : pending.active
          ? `${name} can use ${pending.membership.companyName} again.`
          : `${name} no longer has access to ${pending.membership.companyName}.`,
    );
  }

  return (
    <>
      <Dialog open={user !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Company access for {name}</DialogTitle>
            <DialogDescription>
              Change their role or switch access to a company off. Memberships are kept for the history.
            </DialogDescription>
          </DialogHeader>
          {user && user.memberships.length > 0 ? (
            <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
              {user.memberships.map((membership) => (
                <li key={membership.companyId} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={`/admin/companies/${membership.companyId}`}
                      className="truncate font-medium underline-offset-4 hover:underline"
                    >
                      {membership.companyName}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{COMPANY_ROLE_LABELS[membership.role]}</span>
                      <ToneBadge tone={membership.isActive ? "success" : "neutral"}>
                        {membership.isActive ? "Active" : "Deactivated"}
                      </ToneBadge>
                      {membership.companyStatus !== "active" ? (
                        <ToneBadge tone="neutral">{COMPANY_STATUS_LABELS[membership.companyStatus]}</ToneBadge>
                      ) : null}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Change access to ${membership.companyName}`}>
                        <EllipsisIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        onSelect={() =>
                          setChange({
                            kind: "role",
                            membership,
                            role: membership.role === "owner" ? "contributor" : "owner",
                          })
                        }
                      >
                        <UserCogIcon />
                        {membership.role === "owner" ? "Make contributor" : "Make company owner"}
                      </DropdownMenuItem>
                      {membership.isActive ? (
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setChange({ kind: "active", membership, active: false })}
                        >
                          <UserMinusIcon />
                          Deactivate access
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setChange({ kind: "active", membership, active: true })}>
                          <UserCheckIcon />
                          Reactivate access
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              {name} isn&apos;t a member of any company yet.
            </p>
          )}
          <DialogFooter>
            {user?.isActive ? (
              <Button variant="outline" onClick={() => user && onAddToCompany(user)}>
                <PlusIcon data-icon="inline-start" />
                Add to a company
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={change !== null}
        onOpenChange={(open) => (open ? undefined : setChange(null))}
        title={change ? confirmTitle(change, name) : ""}
        description={change ? confirmDescription(change, name) : undefined}
        confirmLabel={change ? confirmLabel(change) : "Confirm"}
        destructive={change?.kind === "active" && !change.active}
        onConfirm={async () => {
          if (change) await applyChange(change);
        }}
      />
    </>
  );
}

function confirmTitle(change: PendingChange, name: string): string {
  const company = change.membership.companyName;
  if (change.kind === "role") return `Make ${name} ${COMPANY_ROLE_LABELS[change.role]} of ${company}?`;
  return change.active ? `Reactivate ${name}'s access to ${company}?` : `Deactivate ${name}'s access to ${company}?`;
}

function confirmDescription(change: PendingChange, name: string): string {
  const company = change.membership.companyName;
  if (change.kind === "role") {
    return change.role === "owner"
      ? `${name} will be able to submit monthly updates, confirm period closes and manage ${company}'s team.`
      : `${name} will still enter data and upload files, but can no longer submit or manage the team.`;
  }
  return change.active
    ? `${name} will see ${company} again the next time they sign in.`
    : `${name} will no longer see or enter anything for ${company}. Their earlier entries stay in the history, and you can reactivate their access later.`;
}

function confirmLabel(change: PendingChange): string {
  if (change.kind === "role") return change.role === "owner" ? "Make owner" : "Make contributor";
  return change.active ? "Reactivate" : "Deactivate";
}
