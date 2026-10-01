// What the document pack card shows for the current choices (pure; unit-tested in
// tests/features/m9/document-pack-view.test.ts): the pack the choices make, whether it can be downloaded in
// one go (DOCUMENT_PACK_MAX_BYTES, the route's own limit), how it is downloaded, and the hint under the
// Documents field.
import { DOCUMENT_PACK_MAX_BYTES, documentPackTooLargeMessage } from "@/lib/exports/document-pack-limits";
import type { DocumentPackOption, DocumentPackOptions } from "@/lib/exports/documents-zip";
import { BROWSER_DOWNLOAD_MIN_BYTES } from "@/lib/exports/download";
import { formatNumber } from "@/lib/format";

import type { ExportCompanyOption } from "./types";

/** The Documents choice for every document of the company. */
export const ALL_DOCUMENTS = "all";

/** Loading the chosen company's period closes and document counts. */
export type DocumentPackLoadState =
  | { status: "idle" }
  | { status: "loading"; companyId: string }
  | { status: "ready"; companyId: string; options: DocumentPackOptions }
  | { status: "error"; companyId: string; error: string };

/** "no files", "1 file", "1,234 files". */
export function filesText(count: number): string {
  return count === 0 ? "no files" : `${formatNumber(count)} ${count === 1 ? "file" : "files"}`;
}

export type DocumentPackView = {
  company: ExportCompanyOption | null;
  /** The company's period closes and counts, once loaded for the chosen company. */
  options: DocumentPackOptions | null;
  selectedClose: DocumentPackOption | null;
  /** Files and bytes of the chosen pack. */
  count: number;
  bytes: number;
  /** Larger than one pack may be (the route would refuse it with 413). */
  tooLarge: boolean;
  /** The export route for the choices; null while they make no pack that can be downloaded. */
  href: string | null;
  /** Loading the company's documents failed: show the error and a way to try again. */
  failed: boolean;
  closePlaceholder: string;
  hint: string;
  /** Large packs are saved by the browser itself, streamed to disk with its own progress. */
  browserDownload: boolean;
};

export function documentPackView(
  companies: readonly ExportCompanyOption[],
  companyId: string,
  closeId: string,
  state: DocumentPackLoadState,
): DocumentPackView {
  const company = companies.find((option) => option.id === companyId) ?? null;
  const options = state.status === "ready" && state.companyId === companyId ? state.options : null;
  const selectedClose = options?.closes.find((close) => close.id === closeId) ?? null;
  const count = selectedClose ? selectedClose.count : (options?.totalCount ?? 0);
  const bytes = selectedClose ? selectedClose.bytes : (options?.totalBytes ?? 0);
  // The route refuses larger packs: say so before anyone waits for it.
  const tooLarge = count > 0 && bytes > DOCUMENT_PACK_MAX_BYTES;
  const href =
    company && options && count > 0 && !tooLarge
      ? `/api/exports/documents/${company.id}${selectedClose ? `?closeId=${selectedClose.id}` : ""}`
      : null;
  const failed = state.status === "error" && state.companyId === companyId;
  const closePlaceholder = !company
    ? "Choose a company first"
    : failed
      ? "The documents could not be loaded"
      : "No documents yet";
  const hint =
    options && options.totalCount === 0 && company
      ? `No documents have been uploaded for ${company.name} yet.`
      : tooLarge
        ? documentPackTooLargeMessage(bytes, selectedClose?.label ?? null)
        : options && options.generalCount > 0
          ? `All documents also includes ${filesText(options.generalCount)} not linked to a period close.`
          : "Pick one quarter or half-year, or everything the company has uploaded.";
  return {
    company,
    options,
    selectedClose,
    count,
    bytes,
    tooLarge,
    href,
    failed,
    closePlaceholder,
    hint,
    browserDownload: href !== null && bytes >= BROWSER_DOWNLOAD_MIN_BYTES,
  };
}
