// Pure rules for company documents (docs/ARCHITECTURE.md §2.2 "documents", §2.8 "Storage"): which files
// may be uploaded, the exact storage object path the database accepts, the file name offered on
// download and friendly wording for Storage errors. Client-safe (used by the upload dialog, the server
// actions and the download route).

import { DOCUMENT_MAX_BYTES } from "@/lib/constants";
import { formatFileSize } from "@/lib/format";

/** Private bucket of company documents (created by the storage migration). */
export const DOCUMENTS_BUCKET = "company-documents";

/** Second folder of a document that belongs to no period close. */
export const GENERAL_FOLDER = "general";

/** Longest file name kept for display (`documents.file_name`). */
export const FILE_NAME_MAX_LENGTH = 255;

/** Longest sanitised name part of a storage object key (after the uuid prefix). */
const STORED_NAME_MAX_LENGTH = 100;

/**
 * Extension → the MIME type the bucket accepts (`DOCUMENT_ACCEPT` / `DOCUMENT_MIME_TYPES` in
 * src/lib/constants.ts). Browsers report file types inconsistently (e.g. CSV as Excel on Windows, or
 * nothing at all), so the type sent to Storage is always derived from the extension.
 */
export const DOCUMENT_EXTENSION_MIME = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type DocumentExtension = keyof typeof DOCUMENT_EXTENSION_MIME;

/** Human wording of the allowed types, e.g. for "Upload a … file." */
export const ALLOWED_FILE_TYPES_TEXT = "PDF, Excel (XLSX or XLS), CSV or Word (DOCX)";

/** "25 MB" */
export const DOCUMENT_MAX_SIZE_TEXT = formatFileSize(DOCUMENT_MAX_BYTES);

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");
// Control characters (C0, DEL, C1) never belong in a file name.
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function isDocumentExtension(value: string): value is DocumentExtension {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_EXTENSION_MIME, value);
}

/** Lower-case extension without the dot ('Q3 Accounts.PDF' → 'pdf'); null when there is none. */
export function rawExtension(fileName: string): string | null {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The allowed extension of a file name, or null when the type is not accepted. */
export function documentExtension(fileName: string): DocumentExtension | null {
  const ext = rawExtension(fileName);
  return ext !== null && isDocumentExtension(ext) ? ext : null;
}

/** The MIME type to store the file with (from its extension), or null when the type is not accepted. */
export function documentMimeType(fileName: string): string | null {
  const ext = documentExtension(fileName);
  return ext === null ? null : DOCUMENT_EXTENSION_MIME[ext];
}

/**
 * The file name to show and store in `documents.file_name`: the last path segment, without control
 * characters, whitespace collapsed, at most 255 characters (the extension is kept when shortening).
 */
export function cleanDisplayFileName(fileName: string): string {
  const lastSegment = fileName.split(/[\\/]/).pop() ?? "";
  // Tabs and line breaks become spaces; other control characters are dropped.
  const clean = lastSegment.replace(/\s+/g, " ").replace(CONTROL_CHARS_RE, "").replace(/ {2,}/g, " ").trim();
  if (clean.length <= FILE_NAME_MAX_LENGTH) return clean;
  const ext = rawExtension(clean);
  if (ext === null) return clean.slice(0, FILE_NAME_MAX_LENGTH).trimEnd();
  const base = clean.slice(0, clean.length - ext.length - 1);
  return `${base.slice(0, FILE_NAME_MAX_LENGTH - ext.length - 1).trimEnd()}.${ext}`;
}

/** Splits a cleaned name into base and lower-case extension. */
function splitName(fileName: string): { base: string; ext: string | null } {
  const clean = cleanDisplayFileName(fileName);
  const ext = rawExtension(clean);
  return { base: ext === null ? clean : clean.slice(0, clean.length - ext.length - 1), ext };
}

/** Accented letters → plain ASCII letters ('Relatório' → 'Relatorio'). */
function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(COMBINING_MARKS_RE, "");
}

/**
 * The name part of a storage object key: ASCII letters, digits, '.', '_' and '-' only (Storage refuses
 * many other characters), at most 100 characters, extension kept in lower case. Never empty and never
 * '.' or '..': falls back to 'document'. E.g. 'Q3 Accounts (final).PDF' → 'Q3-Accounts-final.pdf'.
 */
export function storageSafeFileName(fileName: string): string {
  const { base, ext } = splitName(fileName);
  const safe = stripAccents(base)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, STORED_NAME_MAX_LENGTH)
    .replace(/[-.]+$/g, "");
  return `${safe || "document"}${ext ? `.${ext}` : ""}`;
}

/**
 * The storage object path of a new document (§2.8), exactly as the database requires it:
 * `<company_id>/<period_close_id or 'general'>/<uuid>-<sanitised file name>` with lower-case ids.
 * `objectId` is a fresh UUID (crypto.randomUUID()), which keeps every upload's path unique.
 */
export function buildDocumentPath(
  companyId: string,
  periodCloseId: string | null,
  objectId: string,
  fileName: string,
): string {
  for (const [name, value] of [
    ["companyId", companyId],
    ["objectId", objectId],
    ["periodCloseId", periodCloseId ?? "00000000-0000-0000-0000-000000000000"],
  ] as const) {
    if (!UUID_RE.test(value)) throw new RangeError(`buildDocumentPath: ${name} must be a UUID.`);
  }
  const folder = (periodCloseId ?? GENERAL_FOLDER).toLowerCase();
  return `${companyId.toLowerCase()}/${folder}/${objectId.toLowerCase()}-${storageSafeFileName(fileName)}`;
}

/**
 * True when `path` is a document path this app builds for the company and period close (or the general
 * folder): the check the save action makes before inserting the `documents` row (the database repeats
 * the folder checks and also requires the object to exist).
 */
export function isDocumentPathFor(path: string, companyId: string, periodCloseId: string | null): boolean {
  if (!UUID_RE.test(companyId) || (periodCloseId !== null && !UUID_RE.test(periodCloseId))) return false;
  const prefix = `${companyId.toLowerCase()}/${(periodCloseId ?? GENERAL_FOLDER).toLowerCase()}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return new RegExp(`^${UUID_PATTERN}-[A-Za-z0-9._-]{1,${STORED_NAME_MAX_LENGTH + 12}}$`).test(name);
}

/**
 * The file name offered when downloading (the signed URL's `download` parameter). Storage and the
 * Supabase client encode that parameter twice for anything but letters, digits, space, '.', '_' and
 * '-', so everything else is dropped: 'Relatório (final).pdf' → 'Relatorio final.pdf'.
 */
export function safeDownloadName(fileName: string): string {
  const { base, ext } = splitName(fileName);
  const safe = stripAccents(base)
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return `${safe || "document"}${ext ? `.${ext}` : ""}`;
}

/**
 * Checks a chosen file before uploading: an accepted type, not empty, at most 25 MB. Returns the message
 * to show, or null when the file is fine.
 */
export function checkDocumentFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file || cleanDisplayFileName(file.name) === "") return "Choose a file to upload.";
  if (documentExtension(file.name) === null) return `Upload a ${ALLOWED_FILE_TYPES_TEXT} file.`;
  if (!Number.isFinite(file.size) || file.size <= 0) return "This file is empty. Choose another file.";
  if (file.size > DOCUMENT_MAX_BYTES) {
    return `This file is ${formatFileSize(file.size)}. Files can be up to ${DOCUMENT_MAX_SIZE_TEXT}.`;
  }
  return null;
}

type StorageErrorLike = { message?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown };

/**
 * Friendly wording for an error from Supabase Storage (signing an upload or download, or uploading to
 * a signed URL). Never shows the raw message.
 */
export function storageErrorMessage(
  error: unknown,
  fallback = "The file couldn't be uploaded. Please try again.",
): string {
  if (typeof error !== "object" || error === null) return fallback;
  const { message, status, statusCode, code, name } = error as StorageErrorLike;
  const httpStatus = typeof status === "number" ? status : Number(typeof statusCode === "string" ? statusCode : NaN);
  const text = [message, code, statusCode, name].filter((part) => typeof part === "string").join(" ");

  if (httpStatus === 413 || /too large|entitytoolarge|maximum allowed size|payload/i.test(text)) {
    return `The file is too large. Files can be up to ${DOCUMENT_MAX_SIZE_TEXT}.`;
  }
  if (httpStatus === 415 || /mime ?type|invalidmimetype|not supported/i.test(text)) {
    return `This type of file isn't allowed. Upload a ${ALLOWED_FILE_TYPES_TEXT} file.`;
  }
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text)) {
    return "Couldn't reach the file storage. Check your connection and try again.";
  }
  if (httpStatus === 404 || /not ?found|nosuchkey/i.test(text)) {
    return "The file could not be found in storage.";
  }
  if (httpStatus === 401 || httpStatus === 403 || /row-level security|unauthori[sz]ed|access ?denied|permission/i.test(text)) {
    return "You don't have permission to do that.";
  }
  return fallback;
}
