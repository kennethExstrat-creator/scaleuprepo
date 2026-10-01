import type { NextRequest } from "next/server";

import { DOCUMENTS_BUCKET, safeDownloadName, storageErrorMessage } from "@/components/documents/document-rules";
import { ActionError, MESSAGES } from "@/lib/actions/result";
import { safeNextPath } from "@/lib/auth/redirects";
import { assertCanViewCompany, assertUser, AuthUnavailableError, isUuid } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { DocumentType } from "@/lib/types/enums";

// Never cache: every download is checked and audited.
export const dynamic = "force-dynamic";

/** Signed download URLs expire after a minute (docs/ARCHITECTURE.md §2.8). */
const SIGNED_URL_SECONDS = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
const NOT_FOUND_MESSAGE = "This document was not found, or you don't have access to it.";

type DownloadRow = {
  id: string;
  company_id: string;
  period_close_id: string | null;
  doc_type: DocumentType;
  file_name: string;
  storage_path: string;
  version: number;
};

/**
 * GET /api/documents/[documentId]/download — reads the document with the caller's RLS client (not
 * visible → 404), re-checks that the caller may view its company, signs a 60-second download URL with
 * the RLS storage client (Storage's own SELECT policy applies), records the download in the audit log
 * (`log_audit_event('download', 'documents', id, company_id, file name)`; no download without it) and
 * redirects to the signed URL. Browsers get a small HTML page for errors, other clients JSON `{ error }`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  try {
    await assertUser();
    if (!isUuid(documentId)) return failure(request, 404, NOT_FOUND_MESSAGE);

    const sb = await createClient();
    const { data, error } = await sb
      .from("documents")
      .select("id, company_id, period_close_id, doc_type, file_name, storage_path, version")
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw error;
    const doc: DownloadRow | null = data;
    if (!doc) return failure(request, 404, NOT_FOUND_MESSAGE);
    await assertCanViewCompany(doc.company_id);

    const { data: signed, error: signError } = await sb.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, { download: safeDownloadName(doc.file_name) });
    if (signError || !signed?.signedUrl) {
      const status = typeof signError?.status === "number" ? signError.status : undefined;
      console.error("[documents/download] could not sign the download", doc.id, status, signError?.message);
      return status === 404 || status === 400
        ? failure(request, 404, "The file of this document could not be found in storage. Please contact ScaleUp.")
        : failure(request, 502, storageErrorMessage(signError, "The download couldn't be started. Please try again."));
    }

    const { error: auditError } = await sb.rpc("log_audit_event", {
      p_action: "download",
      p_entity: "documents",
      p_entity_id: doc.id,
      p_company_id: doc.company_id,
      p_summary: doc.file_name,
      p_data: {
        file_name: doc.file_name,
        version: doc.version,
        doc_type: doc.doc_type,
        period_close_id: doc.period_close_id,
      },
    });
    if (auditError) {
      console.error("[documents/download] could not record the download", doc.id, auditError.code, auditError.message);
      return failure(request, 500, "The download couldn't be recorded, so it was not started. Please try again.");
    }

    return new Response(null, {
      status: 302,
      headers: { ...NO_STORE, Location: signed.signedUrl, "Referrer-Policy": "no-referrer" },
    });
  } catch (e) {
    return errorResponse(request, e);
  }
}

/**
 * HEAD would otherwise run GET (Next.js implements HEAD with the GET handler), signing a URL and
 * recording a download nobody made. Downloads are GET only.
 */
export function HEAD() {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "GET" } });
}

function errorResponse(request: NextRequest, e: unknown): Response {
  if (e instanceof AuthUnavailableError) return failure(request, 503, e.message);
  if (e instanceof ActionError) {
    // Signed out, inactive, MFA or terms pending, or no access to the company.
    return failure(request, e.message === MESSAGES.session ? 401 : 403, e.message);
  }
  console.error("[documents/download] unexpected error", e);
  return failure(request, 500, "The download couldn't be started. Please try again.");
}

function wantsHtml(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** The same-origin page the user came from (for the error page's "Go back" link), else "/". */
function backHref(request: NextRequest): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/";
  try {
    const url = new URL(referer);
    if (url.origin !== request.nextUrl.origin) return "/";
    return safeNextPath(`${url.pathname}${url.search}`, "/");
  } catch {
    return "/";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TITLES: Record<number, string> = {
  401: "Please sign in again",
  403: "You can't download this document",
  404: "Document not found",
  503: "Temporarily unavailable",
};

function failure(request: NextRequest, status: number, message: string): Response {
  if (!wantsHtml(request)) return Response.json({ error: message }, { status, headers: NO_STORE });
  const title = TITLES[status] ?? "The download couldn't start";
  const [href, linkText] = status === 401 ? ["/login", "Sign in"] : [backHref(request), "Go back"];
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} - ScaleUp Portfolio Reporting</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 16px;background:#f7f7f7;color:#1f1f1f;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:28rem;display:flex;flex-direction:column;align-items:center;gap:32px}
img{height:56px;width:auto}
.card{width:100%;background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:24px}
h1{margin:0 0 8px;font-size:1.125rem;font-weight:600;line-height:1.3}
p{margin:0 0 20px;font-size:.875rem;line-height:1.55;color:#595959}
a{display:inline-block;background:#c25716;color:#fff;text-decoration:none;font-size:.875rem;font-weight:500;padding:8px 14px;border-radius:8px}
a:focus-visible{outline:3px solid #1f1f1f;outline-offset:2px}
</style>
</head>
<body>
<main>
<img src="/brand/scaleup-logo.png" alt="ScaleUp Malaysia" width="100" height="56">
<div class="card">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<a href="${escapeHtml(href)}">${escapeHtml(linkText)}</a>
</div>
</main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" } });
}
