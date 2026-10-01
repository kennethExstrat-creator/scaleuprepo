"use client";

import { RotateCcwIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { reopenPeriodClose } from "@/lib/actions/documents";

/**
 * "Reopen" for a confirmed close (Super Admin, Fund Admin; active companies): asks for a reason and calls
 * reopen_period_close. The company then confirms the period again; its restated figures and reason are
 * kept until then.
 */
export function ReopenCloseButton({
  companyId,
  companyName,
  closeId,
  label,
}: {
  companyId: string;
  companyName: string;
  closeId: string;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
        Reopen
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Reopen ${label}?`}
        description={`${companyName} will need to confirm ${label} again. The calculated totals are cleared; any restated figures and their reason are kept until the next confirmation. The reason is recorded in the audit log.`}
        requireReason
        reasonLabel="Reason for reopening"
        reasonPlaceholder="For example: the management accounts were revised after the audit."
        confirmLabel="Reopen period"
        onConfirm={async (reason) => {
          let result: Awaited<ReturnType<typeof reopenPeriodClose>>;
          try {
            result = await reopenPeriodClose({ companyId, closeId, reason });
          } catch {
            throw new Error("Couldn't reach the server. Please try again.");
          }
          if (!result.ok) {
            const first = result.fieldErrors ? Object.values(result.fieldErrors)[0] : undefined;
            throw new Error(first ?? result.error);
          }
          toast.success(`${label} reopened`, { description: `${companyName} can now confirm it again.` });
        }}
      />
    </>
  );
}
