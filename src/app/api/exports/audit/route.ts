import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { canViewAudit } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { AUDIT_EXPORT_MAX_ROWS, auditFileName, auditQueryString } from "@/lib/exports/audit";
import { auditCsvStream, countAuditEntries, latestAuditEntryId, loadCompanyNames } from "@/lib/exports/audit-data";
import { parseAuditFilters } from "@/lib/exports/audit-params";
import { CSV_CONTENT_TYPE } from "@/lib/exports/csv";
import { ExportHttpError, exportErrorResponse, fileResponse } from "@/lib/exports/http";
import { formatNumber } from "@/lib/format";
import { todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/exports/audit?company=&actor=&action=&entity=&from=YYYY-MM-DD&to=YYYY-MM-DD — the filtered
 * audit log as CSV (UTF-8 BOM, CRLF), newest first, at most AUDIT_EXPORT_MAX_ROWS entries (413 above).
 * The file holds the entries that existed when the export started. It is also bounded by size
 * (AUDIT_EXPORT_MAX_BYTES) and time (AUDIT_EXPORT_TIME_BUDGET_MS): a file that stops early ends with a
 * record beginning AUDIT_EXPORT_INCOMPLETE_MARKER that says where and why. Audit viewers only: Super
 * Admin, Fund Admin, Partner (BRD A14). Logged as `export` / `audit_log`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin", "partner"]);
    if (!canViewAudit(ctx)) throw new ExportHttpError(403, "You don't have permission to view the audit log.");
    const { filters } = parseAuditFilters(request.nextUrl.searchParams);

    const sb = await createClient();
    const [count, upToId, companyNames] = await Promise.all([
      countAuditEntries(sb, filters),
      latestAuditEntryId(sb),
      loadCompanyNames(sb),
    ]);
    if (count > AUDIT_EXPORT_MAX_ROWS) {
      throw new ExportHttpError(
        413,
        `${formatNumber(count)} entries match these filters, more than the ${formatNumber(AUDIT_EXPORT_MAX_ROWS)} one export can hold. Narrow the filters, for example to a shorter date range.`,
      );
    }

    const query = auditQueryString(filters);
    const { error } = await sb.rpc("log_audit_event", {
      p_action: "export",
      p_entity: "audit_log",
      p_summary: `Exported the audit log as CSV: ${formatNumber(count)} ${count === 1 ? "entry" : "entries"}${query ? ` (filters: ${decodeURIComponent(query.replace(/\+/g, " "))})` : ""}`,
      p_data: { format: "csv", filters, rows: count },
    });
    if (error) throw error;
    revalidatePath("/admin/audit");

    return fileResponse(auditCsvStream(sb, filters, companyNames, AUDIT_EXPORT_MAX_ROWS, { upToId, total: count }), {
      filename: auditFileName(filters, todayMYT()),
      contentType: CSV_CONTENT_TYPE,
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
