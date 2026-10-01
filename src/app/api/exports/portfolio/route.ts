import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { canExport } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { CSV_CONTENT_TYPE } from "@/lib/exports/csv";
import { ExportHttpError, exportErrorResponse, fileResponse } from "@/lib/exports/http";
import {
  PORTFOLIO_FORMAT_VALUES,
  PORTFOLIO_STATUS_VALUES,
  buildPortfolioWorkbook,
  portfolioCsv,
  portfolioFileName,
  portfolioSummary,
  type PortfolioExportMeta,
} from "@/lib/exports/portfolio";
import { loadPortfolioData } from "@/lib/exports/portfolio-data";
import { XLSX_CONTENT_TYPE, workbookBytes } from "@/lib/exports/xlsx";
import { compareMonths, isMonthKey, todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const monthParam = (label: string) =>
  z
    .string()
    .refine(isMonthKey, { error: `${label} must be a month in the form YYYY-MM.` })
    .optional();

const querySchema = z
  .object({
    format: z.enum(PORTFOLIO_FORMAT_VALUES, { error: "format must be “xlsx” or “csv”." }).default("xlsx"),
    fund: z
      .string()
      .trim()
      .max(64, { error: "That fund was not found." })
      .regex(/^[A-Za-z0-9_-]*$/, { error: "That fund was not found." })
      .optional(),
    from: monthParam("from"),
    to: monthParam("to"),
    status: z.enum(PORTFOLIO_STATUS_VALUES, { error: "status must be “approved” or “all”." }).default("approved"),
  })
  .refine((q) => !q.from || !q.to || compareMonths(q.from, q.to) <= 0, {
    error: "The first month must be on or before the last month.",
  });

function param(request: NextRequest, key: string): string | undefined {
  const value = request.nextUrl.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

/**
 * GET /api/exports/portfolio?format=xlsx|csv&fund=<id or code>&from=YYYY-MM&to=YYYY-MM&status=approved|all
 * — one row per company and month with the figures, derived metrics and RM columns (BRD A13, §10 data
 * extract); the Excel file adds the "Revenue segments" (BRD B30), "KPIs" and "Period closes" sheets. ScaleUp
 * staff only (any role).
 * Logged as `export` / `portfolio_data`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await assertScaleUp();
    if (!canExport(ctx)) throw new ExportHttpError(403, "You don't have permission to export portfolio data.");
    const fundParam = param(request, "fund");
    const query = querySchema.parse({
      format: param(request, "format"),
      fund: fundParam === "all" ? undefined : fundParam,
      from: param(request, "from"),
      to: param(request, "to"),
      status: param(request, "status"),
    });

    const sb = await createClient();
    const data = await loadPortfolioData(sb, {
      fund: query.fund ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      status: query.status,
      withSegments: query.format === "xlsx",
      withDetails: query.format === "xlsx",
    });
    if (!data.found) throw new ExportHttpError(404, "That fund was not found.");
    const meta: PortfolioExportMeta = {
      generatedAt: new Date().toISOString(),
      fund: data.fund ? { code: data.fund.code, name: data.fund.name } : null,
      from: query.from ?? null,
      to: query.to ?? null,
      status: query.status,
    };
    if (data.rows.length === 0) {
      throw new ExportHttpError(
        404,
        query.status === "approved"
          ? "No approved monthly figures match these choices. Try a wider month range or include months not yet approved."
          : "No monthly figures match these choices. Try a wider month range or another fund.",
      );
    }

    const today = todayMYT();
    const body =
      query.format === "csv"
        ? portfolioCsv(data.rows)
        : await workbookBytes(buildPortfolioWorkbook(data.rows, meta, data.segmentRows, data.details));

    const rowCount = data.rows.length;
    const { error } = await sb.rpc("log_audit_event", {
      p_action: "export",
      p_entity: "portfolio_data",
      p_entity_id: data.fund?.code,
      p_summary: `Exported portfolio data (${portfolioSummary(meta)}) as ${query.format.toUpperCase()}: ${rowCount} ${rowCount === 1 ? "row" : "rows"}`,
      p_data: {
        format: query.format,
        fund: data.fund?.code ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        status: query.status,
        rows: rowCount,
        companies: new Set(data.rows.map((row) => row.companyId)).size,
        ...(data.segmentRows ? { segment_rows: data.segmentRows.length } : {}),
        ...(data.details ? { kpi_rows: data.details.kpiRows.length, period_closes: data.details.closeRows.length } : {}),
      },
    });
    if (error) throw error;
    revalidatePath("/admin/audit");

    return fileResponse(body, {
      filename: portfolioFileName(meta, query.format, today),
      contentType: query.format === "csv" ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE,
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
