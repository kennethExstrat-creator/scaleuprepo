import "server-only";

// Server-side loading of comment threads (module M6), shared by the comment server actions
// (src/lib/actions/comments.ts) and server-rendered pages (the review page). Every query runs through the
// caller's RLS-scoped client: ScaleUp staff read every thread and profile; company users only the shared
// threads of their own company, and never a ScaleUp staff profile — they see ScaleUp people as
// "<full name> (ScaleUp)" through staff_display_names (getStaffDisplayNames, BRD B28), never an email or role.
// Callers check access first (assertCanViewCompany / requireScaleUp); this module only reads.

import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayNames } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import { COMPANY_ROLES, type CompanyRole } from "@/lib/types/enums";

import { buildCommentThreads, hiddenAuthorIds, type CommentRowWithProfiles, type CommentViewer } from "./model";
import type { CommentCounts, CommentThread } from "./types";

// One string literal, so postgrest-js (and tsc) check every column against the generated types.
const COMMENT_SELECT =
  "id, submission_id, parent_id, target, visibility, body, created_at, resolved_at, resolved_by, author_id, author:profiles!comments_author_id_fkey(id, full_name, email, scaleup_role), resolver:profiles!comments_resolved_by_fkey(id, full_name, email, scaleup_role)";

/** The submission a comment belongs to, with what access checks and revalidation need. */
export type CommentScope = { id: string; company_id: string; month: string };

type MemberRoleRow = { user_id: string; role: string };
type RootCountRow = { target: string; resolved_at: string | null };

function isCompanyRole(value: string): value is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(value);
}

/** The submission (id, company, month) if the caller may see it, else null. */
export async function findCommentScope(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<CommentScope | null> {
  const { data, error } = await sb
    .from("submissions")
    .select("id, company_id, month")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  const scope: CommentScope | null = data;
  return scope;
}

/** Every comment of the submission the caller may see (roots and replies), oldest first. */
export async function fetchCommentRows(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<CommentRowWithProfiles[]> {
  const { data, error } = await sb
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  const rows: CommentRowWithProfiles[] = data ?? [];
  return rows;
}

/** Company role of each member of the company (active or not), for author role labels. */
export async function fetchMemberRoles(
  sb: SupabaseClient<Database>,
  companyId: string,
): Promise<Record<string, CompanyRole>> {
  const { data, error } = await sb.from("company_members").select("user_id, role").eq("company_id", companyId);
  if (error) throw error;
  const rows: MemberRoleRow[] = data ?? [];
  const roles: Record<string, CompanyRole> = {};
  for (const row of rows) if (isCompanyRole(row.role)) roles[row.user_id] = row.role;
  return roles;
}

/**
 * The ScaleUp display names a company viewer needs for these rows (BRD B28): one staff_display_names
 * request for the authors and resolvers they cannot read (none when every one is a co-member).
 */
export async function loadStaffNames(
  sb: SupabaseClient<Database>,
  rows: ReadonlyArray<CommentRowWithProfiles>,
): Promise<Record<string, string>> {
  return getStaffDisplayNames(sb, hiddenAuthorIds(rows));
}

/**
 * The submission's threads for this viewer (roots oldest first, replies oldest first). Pass `memberRoles`
 * when already loaded (e.g. from `bundle.config.members`) to save a query. Company viewers' ScaleUp authors
 * and resolvers are named "<full name> (ScaleUp)" (one more request when there are any).
 */
export async function loadCommentThreads(
  sb: SupabaseClient<Database>,
  options: {
    submissionId: string;
    companyId: string;
    viewer: Omit<CommentViewer, "memberRoles" | "staffNames">;
    memberRoles?: Record<string, CompanyRole>;
  },
): Promise<CommentThread[]> {
  const [rows, memberRoles] = await Promise.all([
    fetchCommentRows(sb, options.submissionId),
    options.memberRoles ? Promise.resolve(options.memberRoles) : fetchMemberRoles(sb, options.companyId),
  ]);
  const staffNames = options.viewer.audience === "company" ? await loadStaffNames(sb, rows) : undefined;
  return buildCommentThreads(rows, { ...options.viewer, memberRoles, staffNames });
}

/** Threads and unresolved threads per target that the caller may see (root comments only). */
export async function loadCommentCounts(sb: SupabaseClient<Database>, submissionId: string): Promise<CommentCounts> {
  const { data, error } = await sb
    .from("comments")
    .select("target, resolved_at")
    .eq("submission_id", submissionId)
    .is("parent_id", null);
  if (error) throw error;
  const rows: RootCountRow[] = data ?? [];
  const counts: CommentCounts = {};
  for (const row of rows) {
    const entry = (counts[row.target] ??= { total: 0, unresolved: 0 });
    entry.total += 1;
    if (row.resolved_at === null) entry.unresolved += 1;
  }
  return counts;
}

/** Member roles from a company config's memberships (e.g. `bundle.config.members`). */
export function memberRolesFrom(members: ReadonlyArray<{ user_id: string; role: string }>): Record<string, CompanyRole> {
  const roles: Record<string, CompanyRole> = {};
  for (const member of members) if (isCompanyRole(member.role)) roles[member.user_id] = member.role;
  return roles;
}
