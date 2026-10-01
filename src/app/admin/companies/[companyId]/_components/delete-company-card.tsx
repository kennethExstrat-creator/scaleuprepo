"use client";

import { Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES } from "@/lib/actions/result";

import { deleteCompanyAction } from "../../actions";
import { TextAreaField, TextField } from "../../_components/form-controls";
import { LIMITS } from "../../_components/schemas";

/**
 * Permanent deletion (Super Admin, BRD §11 "deletion only by Super Admin with logged reason"): a reason for
 * the audit log and the company's name typed to confirm. Exiting or writing off keeps the history instead.
 */
export function DeleteCompanyCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <Card className="ring-destructive/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <TriangleAlertIcon className="size-4" aria-hidden="true" />
          <h2>Delete company</h2>
        </CardTitle>
        <CardDescription>
          Removes the company and everything reported for it. Only for companies added by mistake: to keep the
          history, mark it as exited or written off instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setSession((current) => current + 1);
            setOpen(true);
          }}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete company…
        </Button>
      </CardContent>
      <DeleteCompanyDialog
        key={session}
        open={open}
        onOpenChange={setOpen}
        companyId={companyId}
        companyName={companyName}
      />
    </Card>
  );
}

function DeleteCompanyDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [errors, setErrors] = useState<{ form: string | null; reason?: string; confirmName?: string }>({ form: null });
  const [pending, startTransition] = useTransition();
  const nameMatches = confirmName.trim() === companyName.trim();
  const canDelete = !pending && reason.trim().length > 0 && nameMatches;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete) return;
    setErrors({ form: null });
    startTransition(async () => {
      try {
        const result = await deleteCompanyAction({ companyId, reason, confirmName });
        if (!result.ok) {
          setErrors({
            form: result.fieldErrors ? null : result.error,
            reason: result.fieldErrors?.reason,
            confirmName: result.fieldErrors?.confirmName,
          });
          return;
        }
        toast.success(`${companyName} has been deleted`);
        if (result.data.warning) toast.warning(result.data.warning, { duration: 20000 });
        onOpenChange(false);
        router.replace("/admin/companies");
      } catch {
        setErrors({ form: MESSAGES.network });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        onEscapeKeyDown={(event) => pending && event.preventDefault()}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {companyName} permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the company with all its monthly updates, figures, comments, period closes, uploaded
              documents, KPIs, revenue lines, fund mappings and team memberships. People&apos;s accounts and the audit
              log are kept. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormError message={errors.form} />
          <TextAreaField
            id="delete-company-reason"
            label="Reason"
            value={reason}
            onValueChange={setReason}
            error={errors.reason}
            description="Recorded in the audit log."
            maxLength={LIMITS.reason}
            rows={3}
            placeholder="For example: added by mistake (duplicate of another company)."
          />
          <TextField
            id="delete-company-confirm"
            label={
              <>
                Type <span className="font-semibold">{companyName}</span> to confirm
              </>
            }
            value={confirmName}
            onValueChange={setConfirmName}
            error={errors.confirmName}
            autoComplete="off"
            spellCheck={false}
          />
          <AlertDialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!canDelete} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : <Trash2Icon data-icon="inline-start" />}
              Delete permanently
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
