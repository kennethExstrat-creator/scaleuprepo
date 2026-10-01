// Responses of the export route handlers (/api/exports/*): file downloads with a safe
// Content-Disposition, and JSON errors `{ error }` with a matching status (401 signed out, 403 not
// allowed, 404 not found, 400 bad request, 413 too large, 503 sign-in service unavailable). The
// message always comes from toActionError, so no SQL or stack trace reaches the client. A plain link
// that the browser follows (a top-level navigation, e.g. "Download my data" on the company's history
// page) gets the same message as a small HTML page with a way back instead of raw JSON.
import { z } from "zod";

import { ActionError, MESSAGES, toActionError } from "@/lib/actions/result";
import { AUTH_RETRY_AFTER_SECONDS } from "@/lib/auth/availability";

/** An expected failure with an HTTP status, e.g. `throw new ExportHttpError(404, "…")`. */
export class ExportHttpError extends ActionError {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ExportHttpError";
    this.status = status;
  }
}

const NO_STORE = "private, no-store, max-age=0";

/**
 * The HTTP status for an error thrown while exporting:
 * ExportHttpError → its status; the guards' ActionErrors → 401 (no session), 404 (not found) or 403
 * (inactive, MFA, terms, role, company access); AuthUnavailableError → 503; ZodError → 400; Postgres
 * 42501 → 403, PGRST116 / not-found DataError → 404, PGRST301/303 → 401, P0001 → 400; anything else 500.
 */
export function exportErrorStatus(e: unknown): number {
  if (e instanceof ExportHttpError) return e.status;
  if (e instanceof Error && e.name === "AuthUnavailableError") return 503;
  if (e instanceof ActionError) {
    if (e.message === MESSAGES.session) return 401;
    if (e.message === MESSAGES.notFound) return 404;
    return 403;
  }
  if (e instanceof z.ZodError) return 400;
  if (typeof e === "object" && e !== null) {
    if ("notFound" in e && e.notFound === true) return 404;
    const code = "code" in e ? e.code : undefined;
    if (code === "42501") return 403;
    if (code === "PGRST116") return 404;
    if (code === "PGRST301" || code === "PGRST303") return 401;
    if (code === "P0001") return 400;
  }
  return 500;
}

/** The user-facing message for an export error (zod: the first issue's message). */
export function exportErrorMessage(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message || MESSAGES.invalid;
  const result = toActionError(e);
  return result.ok ? MESSAGES.generic : result.error;
}

/**
 * True when the browser is showing the response as a page (a followed link or a new tab), not reading it
 * with fetch() (the exports page's download buttons): `Sec-Fetch-Mode: navigate`, or, from browsers that
 * do not send it, an `Accept` header asking for HTML.
 */
export function isPageNavigation(request: Request | undefined): boolean {
  if (!request) return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return /\btext\/html\b/i.test(request.headers.get("accept") ?? "");
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Where "Go back" leads: the same-origin page the link was on (Referer), else the home page. */
function backHref(request: Request): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/";
  try {
    const from = new URL(referer);
    const self = new URL(request.url);
    if (from.origin !== self.origin || from.pathname.startsWith("/api/")) return "/";
    return `${from.pathname}${from.search}`;
  } catch {
    return "/";
  }
}

function errorTitle(status: number): string {
  if (status === 401) return "Please sign in again";
  if (status === 403) return "You can't download this";
  if (status === 404) return "Nothing to download";
  if (status === 503) return "Please try again in a moment";
  return "The download didn't work";
}

/** The error as a small self-contained page (no scripts; light and dark). */
export function exportErrorPage(message: string, status: number, back: string): string {
  const title = errorTitle(status);
  const action =
    status === 401
      ? `<a href="/login">Sign in</a>`
      : `<a href="${escapeHtml(back)}">Go back</a>`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ScaleUp Portfolio Reporting</title>
<style>
:root{color-scheme:light dark;--bg:#fafafa;--card:#fff;--fg:#1f1f1f;--muted:#6b6b6b;--ring:rgba(0,0,0,.1);--link:#c25716}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1e1e1e;--fg:#f2f2f2;--muted:#a3a3a3;--ring:rgba(255,255,255,.12);--link:#f0915a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{box-sizing:border-box;max-width:34rem;margin:12vh auto 0;padding:0 16px}
section{background:var(--card);border-radius:12px;box-shadow:0 0 0 1px var(--ring);padding:24px}
p.eyebrow{margin:0 0 8px;color:var(--muted);font-size:13px}
h1{margin:0 0 8px;font-size:20px;line-height:1.3}
p{margin:0 0 16px}
a{color:var(--link);font-weight:600;text-underline-offset:3px}
</style>
</head>
<body>
<main>
<section>
<p class="eyebrow">ScaleUp Portfolio Reporting · Error ${status}</p>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<p>${action}</p>
</section>
</main>
</body>
</html>
`;
}

/**
 * Error response for any thrown value (re-throws Next.js redirect/notFound signals): JSON `{ error }`,
 * or, when `request` is a page navigation, the same message as an HTML page with the same status.
 */
export function exportErrorResponse(e: unknown, request?: Request): Response {
  const message = exportErrorMessage(e);
  const status = exportErrorStatus(e);
  const headers: Record<string, string> = { "Cache-Control": NO_STORE };
  if (status === 503) headers["Retry-After"] = String(AUTH_RETRY_AFTER_SECONDS);
  if (request && isPageNavigation(request)) {
    return new Response(exportErrorPage(message, status, backHref(request)), {
      status,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }
  return Response.json({ error: message }, { status, headers });
}

const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f"*/:<>?\\|]+/g;

/** A file name without path separators, quotes or control characters (at most 150 characters). */
export function safeFileName(name: string, fallback = "export"): string {
  const cleaned = name.replace(UNSAFE_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  if (cleaned.length <= 150) return cleaned;
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(cleaned)?.[0] ?? "";
  return cleaned.slice(0, 150 - extension.length).trimEnd() + extension;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `attachment` Content-Disposition with an ASCII fallback name and the UTF-8 name (RFC 6266 / 5987), e.g.
 * `attachment; filename="E.R.T.H C4 workbook.xlsx"; filename*=UTF-8''E.R.T.H%20C4%20workbook.xlsx`.
 */
export function contentDisposition(filename: string): string {
  const safe = safeFileName(filename);
  const ascii =
    safe
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[%;]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "export";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}

type FileBody = Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array> | string;

/** A private, uncached download response. Strings are sent as UTF-8. */
export function fileResponse(body: FileBody, options: { filename: string; contentType: string }): Response {
  const headers = new Headers({
    "Content-Type": options.contentType,
    "Content-Disposition": contentDisposition(options.filename),
    "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff",
  });
  if (typeof body === "string") {
    const bytes = new TextEncoder().encode(body);
    headers.set("Content-Length", String(bytes.byteLength));
    return new Response(bytes, { status: 200, headers });
  }
  if (body instanceof Uint8Array) headers.set("Content-Length", String(body.byteLength));
  return new Response(body, { status: 200, headers });
}
