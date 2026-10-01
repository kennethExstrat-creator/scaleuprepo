"use client";

import { ArchiveIcon, CircleCheckIcon, CircleSlashIcon, FlagIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MESSAGES } from "@/lib/actions/result";
import { COMPANY_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { CompanyStatus } from "@/lib/types/enums";

import { setCompanyStatusAction } from "../../actions";
import { statusChangeNeedsReason, statusChangesFor, type StatusChange } from "./status-changes";

/** Portfolio status (BRD A1, B15, B21): active, exited or written off; Super Admins change it. */
export function StatusCard({
  companyId,
  companyName,
  status,
  changedAt,
  reason,
  canManage,
}: {
  companyId: string;
  companyName: string;
  status: CompanyStatus;
  changedAt: string | null;
  reason: string | null;
  canManage: boolean;
}) {
  const [change, setChange] = useState<StatusChange | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const meta = COMPANY_STATUS_META[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlagIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2>Portfolio status</h2>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
          {changedAt && status !== "active" ? <span>since {formatDate(changedAt)}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {status === "active" ? (
          <p className="text-muted-foreground">
            Active companies report every month. Mark the company as exited or written off when ScaleUp no longer holds
            it; it then becomes read-only and its history is kept.
          </p>
        ) : (
          <>
            {reason ? (
              <blockquote className="border-l-2 pl-3 whitespace-pre-line text-muted-foreground">{reason}</blockquote>
            ) : null}
            <p className="text-muted-foreground">
              Read-only: its users can no longer enter or submit data and no new months are opened. ScaleUp can still
              approve months already submitted.
            </p>
            {canManage ? (
              <p className="text-muted-foreground">
                To correct the status, switch between exited and written off directly. Make the company active again
                only if it will report again: every month it missed then opens and has to be reported.
              </p>
            ) : null}
          </>
        )}
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            {statusChangesFor(companyName, status).map((option) => (
              <Button
                key={option.status}
                variant={option.destructive ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  setChange(option);
                  setDialogOpen(true);
                }}
              >
                {option.status === "active" ? (
                  <CircleCheckIcon data-icon="inline-start" />
                ) : option.status === "exited" ? (
                  <ArchiveIcon data-icon="inline-start" />
                ) : (
                  <CircleSlashIcon data-icon="inline-start" />
                )}
                {option.confirmLabel}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={change?.title ?? ""}
        description={change?.description}
        confirmLabel={change?.confirmLabel}
        destructive={change?.destructive}
        requireReason={change !== null && statusChangeNeedsReason(change.status)}
        reasonLabel="Reason"
        reasonPlaceholder={
          change?.status === "written_off"
            ? "For example: fully impaired; voluntary strike-off in progress."
            : "For example: sold to a trade buyer in September 2026."
        }
        onConfirm={async (reason) => {
          if (!change) return;
          let result;
          try {
            result = await setCompanyStatusAction({ companyId, status: change.status, reason: reason ?? null });
          } catch {
            throw new Error(MESSAGES.network);
          }
          if (!result.ok) throw new Error(result.fieldErrors?.reason ?? result.error);
          toast.success(`${companyName} is now ${COMPANY_STATUS_META[change.status].label.toLowerCase()}`);
          if (result.data.warning) toast.warning(result.data.warning, { duration: 12000 });
        }}
      />
    </Card>
  );
}
