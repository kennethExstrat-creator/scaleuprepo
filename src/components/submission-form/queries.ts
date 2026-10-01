import "server-only";

// Small server-side reads for the monthly form pages (/portal/[companyId]/updates/[month] and
// /admin/companies/[companyId]/updates/[month]) and the submission Server Actions. Every query runs on the
// RLS-scoped client, so each viewer only counts what they may see (company users: shared threads only).

import type { SupabaseClient } from "@supabase/supabase-js";

import { dateToMonthKey, monthKeyToDate } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";

import { countCommentThreads, type CommentCounts } from "./presentation";

type ThreadRoot = { target: string; resolved_at: string | null };
type MonthRow = { month: string };

/** Comment threads per target (§2.5) visible to the viewer: `{ total, unresolved }` from the root comments. */
export async function loadCommentCounts(sb: SupabaseClient<Database>, submissionId: string): Promise<CommentCounts> {
  const { data, error } = await sb
    .from("comments")
    .select("target, resolved_at")
    .eq("submission_id", submissionId)
    .is("parent_id", null);
  if (error) throw error;
  const roots: ThreadRoot[] = data ?? [];
  return countCommentThreads(roots);
}

/**
 * Months before `month` that are still drafts ('YYYY-MM', oldest first): they must be submitted first
 * (BRD B5, validation rule 6). Counts from the company's reporting start month when it has one, like
 * `private.validate_submission()`; a month sent back for changes counts as submitted for ordering.
 */
export async function listEarlierDrafts(
  sb: SupabaseClient<Database>,
  companyId: string,
  month: string,
  reportingStartMonth: string | null,
): Promise<string[]> {
  let query = sb
    .from("submissions")
    .select("month")
    .eq("company_id", companyId)
    .eq("status", "draft")
    .lt("month", monthKeyToDate(month));
  if (reportingStartMonth) query = query.gte("month", monthKeyToDate(reportingStartMonth));
  const { data, error } = await query.order("month", { ascending: true });
  if (error) throw error;
  const rows: MonthRow[] = data ?? [];
  return rows.map((row) => dateToMonthKey(row.month));
}
