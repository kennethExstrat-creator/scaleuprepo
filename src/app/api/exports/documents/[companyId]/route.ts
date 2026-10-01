import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { canExport } from "@/lib/auth/permissions";
import { assertCanViewCompany } from "@/lib/auth/session";
import { DOCUMENT_PACK_MAX_BYTES, documentPackTooLargeMessage } from "@/lib/exports/document-pack-limits";
import { downloadPackFiles, loadDocumentPack } from "@/lib/exports/documents-data";
import {
  ZIP_CONTENT_TYPE,
  buildDocumentPackZip,
  documentPackFileName,
  documentPackManifest,
  planDocumentPack,
  shouldCompress,
  zipToStream,
  type PackAudience,
  type PackFile,
} from "@/lib/exports/documents-zip";
import { ExportHttpError, exportErrorResponse, fileResponse } from "@/lib/exports/http";
import { parseInstant, todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const querySchema = z.object({
  closeId: z
    .guid({ error: "That period close was not found." })
    .transform((value) => value.toLowerCase())
    .optional(),
});

/**
 * GET /api/exports/documents/[companyId]?closeId=<period close id> — a zip of the company's documents
 * (all, or one quarter / half-year close) with a Contents.csv (BRD A13 document pack). ScaleUp staff (any
 * role) and the company's owners. Files are read with the caller's own storage access (RLS). The contents
 * list names uploaders as the caller may see them: owners see ScaleUp staff as "<full name> (ScaleUp)",
 * never an email or role (BRD B28). At most DOCUMENT_PACK_MAX_BYTES (100 MB) per pack, so it reaches the
 * browser within the time limit (413 above, documentPackTooLargeMessage). Logged as `export` / `documents`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const companyId = (await params).companyId.toLowerCase();
    const ctx = await assertCanViewCompany(companyId);
    if (!canExport(ctx, companyId)) {
      throw new ExportHttpError(403, "Only ScaleUp and the company's owners can download its document pack.");
    }
    const closeParam = request.nextUrl.searchParams.get("closeId")?.trim();
    const { closeId } = querySchema.parse({ closeId: closeParam ? closeParam : undefined });

    const sb = await createClient();
    const audience: PackAudience = ctx.scaleupRole ? "scaleup" : "company";
    const pack = await loadDocumentPack(sb, companyId, closeId ?? null, { audience });
    if (!pack.found) {
      throw new ExportHttpError(
        404,
        pack.what === "company" ? "We couldn't find that company." : "That period close was not found.",
      );
    }
    if (pack.documents.length === 0) {
      throw new ExportHttpError(
        404,
        pack.close
          ? `No documents have been uploaded for ${pack.close.label} yet.`
          : `No documents have been uploaded for ${pack.company.name} yet.`,
      );
    }
    const totalBytes = pack.documents.reduce((sum, document) => sum + (document.size_bytes ?? 0), 0);
    if (totalBytes > DOCUMENT_PACK_MAX_BYTES) {
      throw new ExportHttpError(413, documentPackTooLargeMessage(totalBytes, pack.close?.label ?? null));
    }

    const plan = planDocumentPack(pack.company.name, pack.documents, pack.closes);
    const contents = await downloadPackFiles(sb, plan.entries);
    const files: PackFile[] = [];
    const included = new Set<string>();
    plan.entries.forEach((entry, index) => {
      const data = contents[index];
      if (!data) return;
      included.add(entry.document.id);
      const uploaded = parseInstant(entry.document.uploaded_at);
      files.push({
        zipPath: entry.zipPath,
        data,
        compress: shouldCompress(entry.document.file_name, entry.document.mime_type),
        ...(uploaded === null ? {} : { date: new Date(uploaded) }),
      });
    });
    if (files.length === 0) {
      throw new ExportHttpError(502, "The documents could not be read from storage right now. Please try again.");
    }
    const manifest = documentPackManifest(plan.entries, included);
    const zip = buildDocumentPackZip(plan.root, files, manifest);

    const scope = pack.close ? pack.close.label : "all documents";
    const missing = plan.entries.length - files.length;
    const { error } = await sb.rpc("log_audit_event", {
      p_action: "export",
      p_entity: "documents",
      p_entity_id: pack.close?.id,
      p_company_id: companyId,
      p_summary: `Downloaded the document pack of ${pack.company.name} (${scope}): ${files.length} ${files.length === 1 ? "file" : "files"}${missing > 0 ? `, ${missing} not available` : ""}`,
      p_data: {
        format: "zip",
        close_id: pack.close?.id ?? null,
        close_label: pack.close?.label ?? null,
        files: files.length,
        missing,
        // The ids of the files handed over (kept well under log_audit_event's 64 KB limit).
        ...(included.size <= 500 ? { document_ids: [...included] } : {}),
      },
    });
    if (error) throw error;
    revalidatePath("/admin/audit");

    return fileResponse(zipToStream(zip), {
      filename: documentPackFileName(pack.company.name, pack.close?.label ?? null, todayMYT()),
      contentType: ZIP_CONTENT_TYPE,
    });
  } catch (e) {
    return exportErrorResponse(e, request);
  }
}

/**
 * HEAD would otherwise run GET (building the file and logging an export, e.g. for a download manager's
 * probe): exports happen on GET only.
 */
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "private, no-store" } });
}
