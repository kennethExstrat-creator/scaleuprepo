// Browser side of the export downloads: fetch the file from /api/exports/*, show the route's JSON error
// message when it fails ({ error }), otherwise save it under the name from Content-Disposition. Large
// files (BROWSER_DOWNLOAD_MIN_BYTES) are better left to the browser's own download, which streams them to
// disk instead of holding them in memory. Client-safe (no server imports); `downloadFile` needs a browser.

/** `incomplete`: the file ends with the record of an export cut short (DownloadOptions.incompleteMarker). */
export type DownloadResult = { ok: true; filename: string; incomplete: boolean } | { ok: false; error: string };

export type DownloadOptions = {
  /**
   * The start of the final record of a file cut short (e.g. AUDIT_EXPORT_INCOMPLETE_MARKER): when the
   * file's last line begins with it, the result says `incomplete`.
   */
  incompleteMarker?: string;
};

/**
 * Files at least this large (bytes) are left to the browser's own download — streamed to disk with its
 * progress — rather than fetched into memory before saving.
 */
export const BROWSER_DOWNLOAD_MIN_BYTES = 20 * 1024 * 1024;

const NETWORK_ERROR = "Couldn't reach the server. Please try again.";
const SESSION_ERROR = "Your session has ended. Please sign in again, then download the file.";
/** How much of the end of a file is read to find its last line. */
const TAIL_BYTES = 8 * 1024;

/** True when the last line of `text` (the end of a file) begins with `marker`, plain or as a quoted CSV field. */
export function lastLineStartsWith(text: string, marker: string): boolean {
  if (!marker) return false;
  const body = text.replace(/[\r\n]+$/, "");
  const lastLine = body.slice(body.lastIndexOf("\n") + 1);
  return lastLine.startsWith(marker) || lastLine.startsWith(`"${marker}`);
}

/**
 * The file name in a Content-Disposition header: `filename*=UTF-8''…` (preferred) or `filename="…"`.
 * Null when there is none.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
      if (decoded.trim()) return decoded.trim();
    } catch {
      // Malformed percent-encoding: fall back to the plain name.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(header);
  if (quoted && quoted[1].trim()) return quoted[1].replace(/\\(.)/g, "$1").trim();
  const bare = /filename\s*=\s*([^;"\s][^;]*)/.exec(header);
  return bare && bare[1].trim() ? bare[1].trim() : null;
}

/** The message to show for a failed export response (the route's `{ error }` when present). */
export async function downloadErrorMessage(response: Response): Promise<string> {
  let message: string | null = null;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // Not JSON (e.g. a gateway error page).
  }
  if (response.status === 401) return message && !/not signed in/i.test(message) ? message : SESSION_ERROR;
  return message ?? `The download failed (error ${response.status}). Please try again.`;
}

/** True when the file's last line begins with `marker` (an export cut short); false when it cannot be read. */
async function endsWithMarker(blob: Blob, marker: string): Promise<boolean> {
  try {
    return lastLineStartsWith(await blob.slice(Math.max(0, blob.size - TAIL_BYTES)).text(), marker);
  } catch {
    return false;
  }
}

/** Downloads `url` and saves it; resolves with the saved name (and whether it is complete) or the error to show. */
export async function downloadFile(url: string, fallbackName: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  if (!response.ok) return { ok: false, error: await downloadErrorMessage(response) };

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return { ok: false, error: "The download was interrupted. Please try again." };
  }
  const incomplete = options.incompleteMarker ? await endsWithMarker(blob, options.incompleteMarker) : false;
  const filename = filenameFromContentDisposition(response.headers.get("Content-Disposition")) ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start saving before the object URL is released.
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return { ok: true, filename, incomplete };
}
