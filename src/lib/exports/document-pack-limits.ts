// The document pack's size limit (BRD A13 document pack), shared by the export route and the export form.
// Client-safe and free of the zip library, so the form can check a selection before anyone waits for it.
import { formatFileSize } from "@/lib/format";

/**
 * Largest pack built in one request (sum of the files' sizes). The files are read into memory before the
 * zip starts, and the whole pack must reach the browser within the route's 60-second limit (100 MB needs
 * about 15 Mbit/s), so larger selections are refused with documentPackTooLargeMessage.
 */
export const DOCUMENT_PACK_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Why a pack of `totalBytes` cannot be downloaded in one go: every document of the company
 * (`closeLabel` null) → one period close at a time; one period close → its files one at a time.
 */
export function documentPackTooLargeMessage(totalBytes: number, closeLabel: string | null): string {
  const sizes = `${formatFileSize(totalBytes)}; the limit is ${formatFileSize(DOCUMENT_PACK_MAX_BYTES)}`;
  return closeLabel
    ? `The documents of ${closeLabel} are too large to download as one pack (${sizes}). Download the files one at a time instead.`
    : `This document pack is too large to download in one go (${sizes}). Download one period close at a time instead.`;
}
