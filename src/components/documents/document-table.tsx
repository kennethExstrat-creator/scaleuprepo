import { DownloadIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, type LucideIcon } from "lucide-react";

import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { formatDateTime, formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

import { documentExtension } from "./document-rules";
import type { DocumentItem } from "./view-model";

/** The download route of a document (signed URL redirect, audited). */
export function documentDownloadHref(documentId: string): string {
  return `/api/documents/${documentId}/download`;
}

function fileIcon(fileName: string): LucideIcon {
  switch (documentExtension(fileName)) {
    case "xlsx":
    case "xls":
    case "csv":
      return FileSpreadsheetIcon;
    case "pdf":
    case "docx":
      return FileTextIcon;
    default:
      return FileIcon;
  }
}

/**
 * Documents with their versions: file name, version, size, who uploaded it and when, and a Download link
 * (GET /api/documents/<id>/download). On narrow screens the details fold under the file name.
 */
export function DocumentTable({
  documents,
  caption,
  emptyText,
  markLatest = false,
  showType = false,
  className,
}: {
  documents: readonly DocumentItem[];
  /** Accessible table caption (visually hidden). */
  caption: string;
  emptyText: string;
  /** Badge the newest version ("Latest"), e.g. for management accounts. */
  markLatest?: boolean;
  /** Show the document type under the file name. */
  showType?: boolean;
  className?: string;
}) {
  if (documents.length === 0) {
    return <p className={cn("rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground", className)}>{emptyText}</p>;
  }

  return (
    <div className={cn("rounded-lg border", className)}>
      <Table className="table-fixed">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">File</TableHead>
            <TableHead className="hidden w-20 text-right md:table-cell">Version</TableHead>
            <TableHead className="hidden w-24 text-right md:table-cell">Size</TableHead>
            <TableHead className="hidden w-44 lg:table-cell">Uploaded by</TableHead>
            <TableHead className="hidden w-40 md:table-cell">Uploaded</TableHead>
            <TableHead className="w-14 pr-3 text-right sm:w-32">
              <span className="sr-only">Download</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => {
            const Icon = fileIcon(doc.fileName);
            const uploaded = formatDateTime(doc.uploadedAt);
            return (
              <TableRow key={doc.id}>
                <TableCell className="pl-3 whitespace-normal">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium" title={doc.fileName}>
                          {doc.fileName}
                        </span>
                        {markLatest && doc.isLatest ? <ToneBadge tone="success">Latest</ToneBadge> : null}
                      </div>
                      {showType ? (
                        <div className="text-xs text-muted-foreground">{DOCUMENT_TYPE_LABELS[doc.docType]}</div>
                      ) : null}
                      <div className="text-xs text-muted-foreground md:hidden">
                        Version {doc.version} · {formatFileSize(doc.sizeBytes)} · {uploaded}
                      </div>
                      <div className="truncate text-xs text-muted-foreground lg:hidden">Uploaded by {doc.uploadedBy}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">v{doc.version}</TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                  {formatFileSize(doc.sizeBytes)}
                </TableCell>
                <TableCell className="hidden truncate lg:table-cell" title={doc.uploadedBy}>
                  {doc.uploadedBy}
                </TableCell>
                <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{uploaded}</TableCell>
                <TableCell className="pr-3 text-right">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={documentDownloadHref(doc.id)}
                      aria-label={`Download ${doc.fileName}, version ${doc.version}`}
                      title={`Download ${doc.fileName}`}
                    >
                      <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                      <span className="hidden sm:inline">Download</span>
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
