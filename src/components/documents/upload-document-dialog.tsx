"use client";

import { CloudUploadIcon, FileIcon, InfoIcon, UploadIcon, XIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { FormError } from "@/components/app/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { prepareDocumentUpload, saveDocument } from "@/lib/actions/documents";
import { DOCUMENT_ACCEPT, DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { DocumentType } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import { ALLOWED_FILE_TYPES_TEXT, checkDocumentFile, DOCUMENT_MAX_SIZE_TEXT, storageErrorMessage } from "./document-rules";

export type UploadDocumentDialogProps = {
  companyId: string;
  companyName: string;
  /** The close the document belongs to; null for the company's other documents (supporting files only). */
  periodCloseId: string | null;
  closeLabel?: string | null;
  closeConfirmed?: boolean;
  /** The version the next management accounts upload gets (1 + the latest), shown as a hint. */
  nextManagementAccountsVersion?: number;
  /** ScaleUp staff uploading for the company (Fund Admin): shows the on-behalf note. */
  onBehalf?: boolean;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
};

function isDocumentType(value: string): value is DocumentType {
  return value === "management_accounts" || value === "supporting";
}

/** A message meant for the person (anything else thrown, e.g. a network TypeError, gets a generic one). */
class UploadProblem extends Error {}

/** The most specific message of a failed action: its first field error, else its error. */
function failureMessage(result: { error: string; fieldErrors?: Record<string, string> }): string {
  const first = result.fieldErrors ? Object.values(result.fieldErrors)[0] : undefined;
  return first ?? result.error;
}

/**
 * "Upload" button and dialog. The file goes straight from the browser to Storage: the server signs an
 * upload to the exact path the database accepts (prepareDocumentUpload), the browser uploads to it, and
 * the server records the `documents` row (saveDocument), which assigns the version.
 */
export function UploadDocumentDialog({
  companyId,
  companyName,
  periodCloseId,
  closeLabel = null,
  closeConfirmed = false,
  nextManagementAccountsVersion,
  onBehalf = false,
  triggerLabel = "Upload",
  triggerVariant = "outline",
}: UploadDocumentDialogProps) {
  const forClose = periodCloseId !== null;
  const defaultType: DocumentType = forClose ? "management_accounts" : "supporting";
  const [open, setOpen] = React.useState(false);
  const [docType, setDocType] = React.useState<DocumentType>(defaultType);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const ids = {
    input: React.useId(),
    error: React.useId(),
    ma: React.useId(),
    supporting: React.useId(),
  };

  function reset() {
    setDocType(defaultType);
    setFile(null);
    setError(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) reset();
    setOpen(next);
  }

  function choose(chosen: File | null | undefined) {
    const picked = chosen ?? null;
    setFile(picked);
    setError(picked ? checkDocumentFile(picked) : null);
  }

  function clearFile() {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.focus();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const problem = checkDocumentFile(file);
    if (problem || !file) {
      setError(problem ?? "Choose a file to upload.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const details = { companyId, periodCloseId, docType, fileName: file.name, sizeBytes: file.size };
      const target = await prepareDocumentUpload(details);
      if (!target.ok) throw new UploadProblem(failureMessage(target));

      // Send the file with the type the bucket expects for its extension (browsers disagree about
      // CSV and Excel files, and sometimes send none).
      const body = file.slice(0, file.size, target.data.contentType);
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(target.data.bucket)
        .uploadToSignedUrl(target.data.path, target.data.token, body, { contentType: target.data.contentType });
      if (uploadError) throw new UploadProblem(storageErrorMessage(uploadError));

      const saved = await saveDocument({ ...details, path: target.data.path });
      if (!saved.ok) throw new UploadProblem(failureMessage(saved));

      const what = saved.data.docType === "management_accounts" ? "Management accounts" : "Supporting document";
      toast.success(`${what} uploaded`, {
        description: `${file.name} was saved as version ${saved.data.version}${closeLabel ? ` for ${closeLabel}` : ""}.`,
      });
      reset();
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof UploadProblem && e.message
          ? e.message
          : "The file couldn't be uploaded. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  // The hint is part of the input's label; the error is announced with it.
  const describedBy = error ? ids.error : "";
  const title = closeLabel ? `Upload a document for ${closeLabel}` : "Upload a document";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <UploadIcon data-icon="inline-start" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onPointerDownOutside={(event) => pending && event.preventDefault()}
        onInteractOutside={(event) => pending && event.preventDefault()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {forClose
                ? "Management accounts or a supporting file for this period. Earlier versions are always kept."
                : "A supporting file that isn't tied to a quarter or half, such as a board pack or audited accounts."}
            </DialogDescription>
          </DialogHeader>

          {forClose ? (
            <FieldSet>
              <FieldLegend variant="label">Type of document</FieldLegend>
              <RadioGroup
                value={docType}
                onValueChange={(value) => {
                  if (isDocumentType(value)) setDocType(value);
                }}
                disabled={pending}
                className="gap-2"
              >
                <FieldLabel htmlFor={ids.ma}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{DOCUMENT_TYPE_LABELS.management_accounts}</FieldTitle>
                      <FieldDescription>
                        Profit and loss, balance sheet and cash flow for the period. Needed to confirm the close.
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value="management_accounts" id={ids.ma} />
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor={ids.supporting}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{DOCUMENT_TYPE_LABELS.supporting}</FieldTitle>
                      <FieldDescription>Anything else that backs up the figures, such as bank statements.</FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value="supporting" id={ids.supporting} />
                  </Field>
                </FieldLabel>
              </RadioGroup>
            </FieldSet>
          ) : null}

          <Field>
            <span className="text-sm font-medium" aria-hidden="true">
              File
            </span>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={clearFile}
                  disabled={pending}
                  aria-label={`Remove ${file.name}`}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <label
              htmlFor={ids.input}
              onDragOver={(event) => {
                event.preventDefault();
                if (!pending) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!pending) choose(event.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
                "hover:bg-muted/40 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
                dragging && "border-primary bg-primary/5",
                error && "border-destructive/50",
                file && "py-3",
                pending && "pointer-events-none opacity-60",
              )}
            >
              <CloudUploadIcon className="size-6 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">
                {file ? "Choose a different file" : "Choose a file or drag it here"}
              </span>
              <span className="text-xs text-muted-foreground">
                {ALLOWED_FILE_TYPES_TEXT}, up to {DOCUMENT_MAX_SIZE_TEXT}
              </span>
              <input
                ref={inputRef}
                id={ids.input}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="sr-only"
                disabled={pending}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                onChange={(event) => choose(event.target.files?.[0])}
              />
            </label>
          </Field>

          {forClose && docType === "management_accounts" && nextManagementAccountsVersion ? (
            <p className="text-sm text-muted-foreground">
              {nextManagementAccountsVersion === 1
                ? `This will be the first version of the management accounts for ${closeLabel ?? "this period"}.`
                : `This will be version ${nextManagementAccountsVersion} of the management accounts for ${closeLabel ?? "this period"}. Earlier versions stay available.`}
            </p>
          ) : null}

          {closeConfirmed || onBehalf ? (
            <Alert className="border-info/25 bg-info/5">
              <InfoIcon className="text-info" aria-hidden="true" />
              <AlertDescription className="text-foreground">
                {closeConfirmed ? (
                  <p>{closeLabel ?? "This period"} is confirmed. The file is added to its history; the confirmed totals don&apos;t change.</p>
                ) : null}
                {onBehalf ? <p>You&apos;re uploading on behalf of {companyName}. This is recorded in the audit log.</p> : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <FormError id={ids.error} message={error} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file} aria-busy={pending || undefined}>
              {pending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" aria-hidden="true" />}
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
