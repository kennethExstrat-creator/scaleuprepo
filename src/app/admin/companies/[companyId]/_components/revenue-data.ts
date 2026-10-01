import "server-only";

// Reads of the Revenue tab of the ScaleUp company page (BRD B30) on the RLS-scoped client: every revenue
// segment of the company, both kinds — ScaleUp's revenue lines (kind 'scaleup', managed on the tab) and
// the company's own segments (kind 'company', set by its owner; shown read-only).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { RevenueSegmentRow } from "@/lib/types/domain";

/** Every revenue segment of the company, both kinds, active and retired (any order). */
export async function loadCompanyRevenueSegments(
  sb: SupabaseClient<Database>,
  companyId: string,
): Promise<RevenueSegmentRow[]> {
  const { data, error } = await sb.from("revenue_segments").select("*").eq("company_id", companyId);
  if (error) throw new Error(`Could not load the revenue lines and segments: ${error.message}`);
  const rows: RevenueSegmentRow[] = data;
  return rows;
}
