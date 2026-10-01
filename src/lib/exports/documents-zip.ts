// Document pack (BRD A13 "document pack download", C4 management accounts): a zip of a company's
// documents — all of them, or those of one quarter / half-year close — with a contents list. Pure: the
// files are downloaded by documents-data.ts with the caller's RLS-scoped storage client.
//
// Layout: "<Company> documents/<Q3 2026 | H2 2026 | General>/<Document type> v<version> - <file name>"
// plus "<Company> documents/Contents.csv" (every document, who uploaded it, whether it could be included).
import JSZip from "jszip";

import { DOCUMENT_TYPE_LABELS, SCALEUP_LABEL, SCALEUP_ROLE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { DocumentType, PeriodCloseStatus, ScaleupRole } from "@/lib/types/enums";

import { toCsv } from "./csv";

// The pack's size limit is in document-pack-limits.ts (client-safe, without the zip library).

export const ZIP_CONTENT_TYPE = "application/zip";
/** The storage bucket of company documents (docs/ARCHITECTURE.md §2.8). */
export const DOCUMENTS_BUCKET = "company-documents";

/** Who the pack is for: ScaleUp staff, or a company owner (decides how people are named, BRD B28). */
export type PackAudience = "scaleup" | "company";

export type PackDocument = {
  id: string;
  period_close_id: string | null;
  doc_type: DocumentType;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  uploaded_at: string;
  /** Who uploaded it, as the caller may see it (uploaderName); "" when nobody can be named. */
  uploaded_by_name: string;
};

/** An uploader's profile as the caller can read it (company users never read ScaleUp staff profiles). */
export type UploaderProfile = { full_name: string | null; email: string | null; scaleup_role: ScaleupRole | null };

/**
 * The "Uploaded by" text of the contents list (BRD B28, docs/ARCHITECTURE.md §6):
 * - for ScaleUp staff: the person's name (else email), with the ScaleUp role for staff so on-behalf
 *   uploads stand out ("Aisha Rahman (Fund Admin)"); "System" when there is no uploader;
 * - for company owners: their own people by name (else email), and ScaleUp staff as
 *   "<full name> (ScaleUp)" (`staffName`, from staff_display_names) — never a ScaleUp email or role;
 *   "ScaleUp" when there is no uploader (a system upload); "" when nobody can be named.
 */
export function uploaderName(
  uploadedBy: string | null,
  sources: { profile?: UploaderProfile | null; staffName?: string | null },
  audience: PackAudience,
): string {
  const profile = sources.profile ?? null;
  const name = profile ? profile.full_name?.trim() || profile.email?.trim() || null : null;
  if (audience === "scaleup") {
    if (uploadedBy === null) return "System";
    if (!profile || name === null) return "Unknown user";
    return profile.scaleup_role ? `${name} (${SCALEUP_ROLE_LABELS[profile.scaleup_role]})` : name;
  }
  if (uploadedBy === null) return SCALEUP_LABEL;
  // Only company-side profiles are named from the profile itself; ScaleUp staff only by display name.
  if (profile && profile.scaleup_role === null && name !== null) return name;
  return sources.staffName?.trim() || "";
}

export type PackClose = {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  period_type: "quarter" | "half";
};

export type PlannedDocument = { document: PackDocument; folder: string; zipPath: string };

/** A period close offered on the export form, with its document count and total size. */
export type DocumentPackOption = {
  id: string;
  label: string;
  status: PeriodCloseStatus;
  count: number;
  bytes: number;
};

/** What the document pack form offers for a company (listDocumentPackOptions). */
export type DocumentPackOptions = {
  /** Newest first (a half-year before the quarter that ends with it). */
  closes: DocumentPackOption[];
  /** Documents not linked to a period close. */
  generalCount: number;
  totalCount: number;
  totalBytes: number;
};

export type DocumentPackPlan = { root: string; entries: PlannedDocument[] };

const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f"*/:<>?\\|]+/g;

/** A name split into base and extension (".pdf"); the extension is "" when there is none. */
export function splitExtension(name: string): { base: string; extension: string } {
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(name);
  if (!match || match.index === 0) return { base: name, extension: "" };
  return { base: name.slice(0, match.index), extension: match[0] };
}

/** One path segment: no separators, quotes, control characters or leading dots; at most `max` characters. */
export function safePathSegment(value: string, fallback: string, max = 120): string {
  let text = value.replace(UNSAFE_PATH_CHARS, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (!text) return fallback;
  if (text.length > max) {
    const { base, extension } = splitExtension(text);
    text = base.slice(0, max - extension.length).trimEnd() + extension;
  }
  return text;
}

const DOC_TYPE_ORDER: Record<DocumentType, number> = { management_accounts: 0, supporting: 1 };

/**
 * Where each document goes in the zip: one folder per period close (by period end; a quarter before the
 * half-year that ends with it), "General" for documents without a close, names made unique.
 */
export function planDocumentPack(
  companyName: string,
  documents: readonly PackDocument[],
  closes: readonly PackClose[],
): DocumentPackPlan {
  const root = safePathSegment(`${companyName} documents`, "Documents");
  const closeById = new Map(closes.map((close) => [close.id, close]));
  const folderOf = (document: PackDocument): string => {
    if (!document.period_close_id) return "General";
    const close = closeById.get(document.period_close_id);
    return close ? safePathSegment(close.label, "Period close") : "Other";
  };
  const sortKey = (document: PackDocument): string => {
    const close = document.period_close_id ? closeById.get(document.period_close_id) : undefined;
    if (!document.period_close_id) return "2";
    if (!close) return "1";
    // By period end; a quarter before the half-year that ends with it (Q3, Q4, then H2).
    return `0${close.period_end}${close.period_type === "quarter" ? "0" : "1"}${close.period_start}`;
  };
  const sorted = [...documents].sort(
    (a, b) =>
      sortKey(a).localeCompare(sortKey(b)) ||
      DOC_TYPE_ORDER[a.doc_type] - DOC_TYPE_ORDER[b.doc_type] ||
      a.version - b.version ||
      a.file_name.localeCompare(b.file_name, "en-GB") ||
      a.id.localeCompare(b.id),
  );

  const used = new Set<string>();
  const entries = sorted.map((document) => {
    const folder = folderOf(document);
    const base = safePathSegment(
      `${DOCUMENT_TYPE_LABELS[document.doc_type]} v${document.version} - ${document.file_name}`,
      `Document v${document.version}`,
    );
    let name = base;
    for (let n = 2; used.has(`${folder}/${name}`.toLowerCase()); n++) {
      const parts = splitExtension(base);
      name = `${parts.base} (${n})${parts.extension}`;
    }
    used.add(`${folder}/${name}`.toLowerCase());
    return { document, folder, zipPath: `${root}/${folder}/${name}` };
  });
  return { root, entries };
}

/**
 * Contents.csv: every planned document, who uploaded it (as `uploaded_by_name` names them for the
 * caller) and whether its file could be included.
 */
export function documentPackManifest(entries: readonly PlannedDocument[], included: ReadonlySet<string>): string {
  const header = [
    "Folder",
    "File in pack",
    "Document type",
    "Version",
    "Original file name",
    "Size (bytes)",
    "Uploaded (Malaysia time)",
    "Uploaded by",
    "Status",
  ];
  const rows = entries.map(({ document, folder, zipPath }) => [
    folder,
    zipPath.slice(zipPath.lastIndexOf("/") + 1),
    DOCUMENT_TYPE_LABELS[document.doc_type],
    document.version,
    document.file_name,
    document.size_bytes,
    formatDateTime(document.uploaded_at),
    document.uploaded_by_name,
    included.has(document.id) ? "Included" : "Not available (the file could not be read)",
  ]);
  return toCsv(header, rows);
}

/** Formats that are already compressed are stored as they are; others are deflated. */
export function shouldCompress(fileName: string, mimeType: string | null): boolean {
  const name = fileName.toLowerCase();
  if (/\.(pdf|xlsx|docx|zip|png|jpe?g)$/.test(name)) return false;
  if (mimeType && /(pdf|openxmlformats|zip|image\/)/.test(mimeType)) return false;
  return true;
}

export type PackFile = { zipPath: string; data: Uint8Array; compress: boolean; date?: Date };

/** The zip: the files plus "<root>/Contents.csv". */
export function buildDocumentPackZip(root: string, files: readonly PackFile[], manifestCsv: string): JSZip {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.zipPath, file.data, {
      binary: true,
      compression: file.compress ? "DEFLATE" : "STORE",
      ...(file.date ? { date: file.date } : {}),
    });
  }
  zip.file(`${root}/Contents.csv`, manifestCsv, { compression: "DEFLATE" });
  return zip;
}

/** Streams the zip as it is generated (no second copy of the pack in memory). */
export function zipToStream(zip: JSZip): ReadableStream<Uint8Array> {
  const helper = zip.generateInternalStream({
    type: "uint8array",
    streamFiles: true,
    compressionOptions: { level: 6 },
  });
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      helper
        .on("data", (chunk) => {
          if (finished) return;
          controller.enqueue(chunk);
          if ((controller.desiredSize ?? 1) <= 0) helper.pause();
        })
        .on("error", (error) => {
          if (finished) return;
          finished = true;
          controller.error(error);
        })
        .on("end", () => {
          if (finished) return;
          finished = true;
          controller.close();
        });
      helper.resume();
    },
    pull() {
      if (!finished) helper.resume();
    },
    cancel() {
      finished = true;
      helper.pause();
    },
  });
}

/** e.g. "Batik Boutique documents Q3 2026 2026-09-30.zip". */
export function documentPackFileName(companyName: string, closeLabel: string | null, today: string): string {
  return `${companyName} documents${closeLabel ? ` ${closeLabel}` : ""} ${today}.zip`;
}
