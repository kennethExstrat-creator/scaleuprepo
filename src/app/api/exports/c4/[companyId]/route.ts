import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { canExport } from "@/lib/auth/permissions";
import { assertCanViewCompany } from "@/lib/auth/session";
import { buildC4Workbook, C4_INCLUDE_VALUES, c4WorkbookFileName } from "@/lib/exports/c4-workbook";
import { loadC4WorkbookInput } from "@/lib/exports/c4-data";
import { ExportHttpError, exportErrorResponse, fileResponse } from "@/lib/exports/http";
import { XLSX_CONTENT_TYPE, workbookBytes } from "@/lib/exports/xlsx";
import { todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const querySchema = z.object({
  include: z.enum(C4_INCLUDE_VALUES, { error: "include must be “approved” or “all”." }).default("approved"),
});

/**
 * GET /api/exports/c4/[companyId]?include=approved|all — the company's C4 workbook (xlsx: C4, Revenue
 * Lines, KPIs, Monthly Grid; both revenue breakdowns of BRD B30). ScaleUp staff (any role) and the
 * company's owners (BRD A13, §1 Export). Company owners get no RM block (FX rates are ScaleUp-only).
 * Logged as `export` / `c4_workbook`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const companyId = (await params).companyId.toLowerCase();
    const ctx = await assertCanViewCompany(companyId);
    if (!canExport(ctx, companyId)) {
      throw new ExportHttpError(403, "Only ScaleUp and the company's owners can export its data.");
    }
    const { include } = querySchema.parse({ include: request.nextUrl.searchParams.get("include") ?? undefined });

    const sb = await createClient();
    const generatedAt = new Date().toISOString();
    const today = todayMYT();
    const input = await loadC4WorkbookInput(sb, companyId, {
      include,
      fxVisible: ctx.scaleupRole !== null,
      generatedAt,
      today,
    });
    if (!input) throw new ExportHttpError(404, "We couldn't find that company.");
    const bytes = await workbookBytes(buildC4Workbook(input));

    const monthsIncluded = input.months.filter((m) => include === "all" || m.status === "approved").length;
    const { error } = await sb.rpc("log_audit_event", {
      p_action: "export",
      p_entity: "c4_workbook",
      p_entity_id: companyId,
      p_company_id: companyId,
      p_summary: `Exported the C4 workbook of ${input.company.name} (${include === "approved" ? "approved months only" : "all months"})`,
      p_data: { format: "xlsx", include, months: input.months.length, months_included: monthsIncluded },
    });
    if (error) throw error;
    revalidatePath("/admin/audit");

    return fileResponse(bytes, {
      filename: c4WorkbookFileName(input.company.name, today, include),
      contentType: XLSX_CONTENT_TYPE,
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
