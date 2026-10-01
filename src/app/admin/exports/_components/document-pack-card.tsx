"use client";

import { FolderArchiveIcon, RotateCwIcon } from "lucide-react";
import * as React from "react";

import { FormError } from "@/components/app/form-error";
import { ToneBadge } from "@/components/app/status-badge";
import { TONE_TEXT_CLASSES } from "@/components/app/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PERIOD_CLOSE_STATUS_META } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { getDocumentPackOptions } from "../actions";
import { ALL_DOCUMENTS, documentPackView, filesText, type DocumentPackLoadState } from "./document-pack-view";
import { DownloadLink } from "./download-link";
import type { ExportCompanyOption } from "./types";

/** Document pack (BRD A13): a zip of a company's documents, all of them or one period close. */
export function DocumentPackCard({ companies }: { companies: ExportCompanyOption[] }) {
  const [companyId, setCompanyId] = React.useState("");
  const [closeId, setCloseId] = React.useState(ALL_DOCUMENTS);
  const [state, setState] = React.useState<DocumentPackLoadState>({ status: "idle" });
  const latestRequest = React.useRef(0);
  const ids = { company: React.useId(), close: React.useId(), closeHint: React.useId() };

  async function load(nextCompanyId: string) {
    const request = ++latestRequest.current;
    setState({ status: "loading", companyId: nextCompanyId });
    const result = await getDocumentPackOptions(nextCompanyId);
    if (request !== latestRequest.current) return; // a newer choice replaced this one
    setState(
      result.ok
        ? { status: "ready", companyId: nextCompanyId, options: result.data }
        : { status: "error", companyId: nextCompanyId, error: result.error },
    );
  }

  function chooseCompany(value: string) {
    setCompanyId(value);
    setCloseId(ALL_DOCUMENTS);
    void load(value);
  }

  const view = documentPackView(companies, companyId, closeId, state);
  const { options, selectedClose } = view;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderArchiveIcon className="size-4 text-primary" aria-hidden="true" />
          Document pack
        </CardTitle>
        <CardDescription>
          Management accounts and supporting documents as a zip, filed by quarter and half-year, with a contents list.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={ids.company}>Company</FieldLabel>
            <Select value={companyId} onValueChange={chooseCompany}>
              <SelectTrigger id={ids.company} className="w-full">
                <SelectValue placeholder="Choose a company" />
              </SelectTrigger>
              <SelectContent position="popper">
                {companies.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.close}>Documents</FieldLabel>
            {state.status === "loading" ? (
              <div role="status">
                <Skeleton className="h-8 w-full" />
                <span className="sr-only">Loading the documents of the company…</span>
              </div>
            ) : (
              <Select
                value={options && options.totalCount > 0 ? closeId : ""}
                onValueChange={setCloseId}
                disabled={!options || options.totalCount === 0}
              >
                <SelectTrigger id={ids.close} className="w-full" aria-describedby={ids.closeHint}>
                  <SelectValue placeholder={view.closePlaceholder} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {options ? (
                    <>
                      <SelectItem value={ALL_DOCUMENTS}>
                        All documents
                        <span className="text-xs text-muted-foreground">
                          {filesText(options.totalCount)} · {formatFileSize(options.totalBytes)}
                        </span>
                      </SelectItem>
                      {options.closes.map((close) => (
                        <SelectItem key={close.id} value={close.id} disabled={close.count === 0}>
                          {close.label}
                          <span className="text-xs text-muted-foreground">
                            {filesText(close.count)}
                            {close.status === "confirmed" ? ` · ${PERIOD_CLOSE_STATUS_META.confirmed.label}` : ""}
                          </span>
                        </SelectItem>
                      ))}
                    </>
                  ) : null}
                </SelectContent>
              </Select>
            )}
            <FieldDescription id={ids.closeHint} className={cn(view.tooLarge && TONE_TEXT_CLASSES.warning)}>
              {view.hint}
            </FieldDescription>
          </Field>
          {selectedClose ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ToneBadge tone={PERIOD_CLOSE_STATUS_META[selectedClose.status].tone}>
                {PERIOD_CLOSE_STATUS_META[selectedClose.status].label}
              </ToneBadge>
              {selectedClose.label} · {filesText(selectedClose.count)} · {formatFileSize(selectedClose.bytes)}
            </div>
          ) : null}
          {view.failed && state.status === "error" ? (
            // Choosing the same company again does not reload it (the Select only reports changes).
            <div className="flex flex-col items-start gap-2">
              <FormError message={state.error} className="w-full" />
              <Button type="button" variant="outline" size="sm" onClick={() => void load(companyId)}>
                <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <DownloadLink
          href={view.href}
          fallbackFilename="Document pack.zip"
          successMessage="Document pack downloaded"
          browserDownload={view.browserDownload}
          className="w-full sm:w-auto"
          wrapperClassName="w-full sm:w-auto"
        >
          Download pack
        </DownloadLink>
      </CardFooter>
    </Card>
  );
}
