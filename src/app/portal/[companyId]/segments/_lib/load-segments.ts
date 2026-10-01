import "server-only";

// Server-side reads of the company revenue segments page (BRD B30), all on the RLS-scoped client: the
// company's segments of both kinds (getCompanyConfig), its months (listCompanySubmissions) and the
// stored amounts of its own segments, to tell which months use each segment; and, for the save, the
// company's segments in use right now (loadCurrentCompanySegments).

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCompanyConfig, listCompanySubmissions } from "@/lib/data";
import { dateToMonthKey } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import {
  isCompanySegment,
  partitionRevenueSegments,
  type CompanyRow,
  type RevenueSegmentRow,
} from "@/lib/types/domain";

import { buildSegmentUsage, type MonthStatus, type SegmentFigure, type SegmentUsage } from "./segments-model";

type Sb = SupabaseClient<Database>;

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export type SegmentsPageData = {
  company: Pick<CompanyRow, "id" | "name" | "status">;
  /** The company's own segments in use (kind 'company', active), in order. */
  current: RevenueSegmentRow[];
  /** Its retired segments, most recently retired first. */
  retired: RevenueSegmentRow[];
  /** ScaleUp's revenue lines in use (shown read-only: they need not add up to total revenue). */
  scaleupLines: RevenueSegmentRow[];
  /** Months with figures, per segment id (the company's own segments only). */
  usage: Record<string, SegmentUsage>;
  /** Months not submitted yet (draft, changes requested), oldest first: they follow the current segments. */
  openMonths: string[];
};

/** Every stored amount of these segments (page by page; PostgREST returns at most 1,000 rows at a time). */
async function loadSegmentFigures(sb: Sb, segmentIds: readonly string[]): Promise<SegmentFigure[]> {
  if (segmentIds.length === 0) return [];
  const figures: SegmentFigure[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await sb
      .from("submission_segment_values")
      .select("segment_id, submission_id, amount")
      .in("segment_id", [...segmentIds])
      .order("submission_id", { ascending: true })
      .order("segment_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load the revenue segment figures: ${error.message}`);
    const batch: SegmentFigure[] = data;
    figures.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return figures;
}

/**
 * The company's own segments in use right now (kind 'company', active), in the order the page lists
 * them (`config.companySegments`): what a save compares the editor's starting list with. A failed query
 * throws the database error, for toActionError.
 */
export async function loadCurrentCompanySegments(sb: Sb, companyId: string): Promise<RevenueSegmentRow[]> {
  const { data, error } = await sb
    .from("revenue_segments")
    .select("*")
    .eq("company_id", companyId)
    .eq("kind", "company")
    .eq("is_active", true);
  if (error) throw error;
  const rows: RevenueSegmentRow[] = data;
  return partitionRevenueSegments(rows).companySegments;
}

/**
 * Everything the page shows. Throws a not-found DataError (isNotFoundError) when the company does not
 * exist or is not visible.
 */
export async function loadSegmentsPage(sb: Sb, companyId: string): Promise<SegmentsPageData> {
  const [config, months] = await Promise.all([getCompanyConfig(sb, companyId), listCompanySubmissions(sb, companyId)]);
  const ownIds = config.segments.filter((segment) => isCompanySegment(segment)).map((segment) => segment.id);
  const figures = await loadSegmentFigures(sb, ownIds);
  const submissions: MonthStatus[] = months.map((row) => ({ id: row.id, month: row.month, status: row.status }));

  return {
    company: { id: config.company.id, name: config.company.name, status: config.company.status },
    current: config.companySegments,
    retired: config.retiredCompanySegments,
    scaleupLines: config.scaleupSegments,
    usage: buildSegmentUsage(figures, submissions),
    openMonths: submissions
      .filter((row) => row.status === "draft" || row.status === "changes_requested")
      .map((row) => dateToMonthKey(row.month))
      .sort(),
  };
}
