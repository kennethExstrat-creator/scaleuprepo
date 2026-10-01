// Pure helpers for comment threads (module M6): turning comment rows into threads with the right author
// display for the viewer, counting threads per target and checking targets. Client-safe (no server
// imports); used by the server actions (src/lib/actions/comments.ts), the loaders and the components.
import { COMPANY_ROLE_LABELS, SCALEUP_LABEL, SCALEUP_ROLE_LABELS, SCALEUP_STAFF_SUFFIX } from "@/lib/constants";
import { parseInstant } from "@/lib/periods";
import { GENERAL_TARGET } from "@/lib/targets";
import type { CommentVisibility, CompanyRole, ScaleupRole } from "@/lib/types/enums";

import type { CommentAuthor, CommentCounts, CommentMessage, CommentMode, CommentThread } from "./types";

/** Maximum length of a comment body (`comments.body` check constraint). */
export const COMMENT_MAX_LENGTH = 5000;

/**
 * How company users see a ScaleUp author who cannot be named (BRD B28: `SCALEUP_LABEL`). Named staff read
 * "<full name> (ScaleUp)" (`staff_display_names`).
 */
export const SCALEUP_AUTHOR_NAME = SCALEUP_LABEL;

/**
 * How company users see an author whose profile they can no longer read and who is not ScaleUp staff —
 * someone who has been removed from the company's team.
 */
export const FORMER_MEMBER_NAME = "Former team member";

/** The profile columns loaded with a comment's author and resolver. */
export type CommentProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  scaleup_role: ScaleupRole | null;
};

/**
 * A `comments` row with its author and resolver profiles. Row Level Security leaves a profile null when
 * the viewer may not read it — for company users that is every ScaleUp staff profile.
 */
export type CommentRowWithProfiles = {
  id: string;
  submission_id: string;
  parent_id: string | null;
  target: string;
  visibility: CommentVisibility;
  body: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  author_id: string;
  author: CommentProfile | null;
  resolver: CommentProfile | null;
};

/** Who is reading the threads and what they may do (computed on the server with the permission helpers). */
export type CommentViewer = {
  userId: string;
  audience: CommentMode;
  /** Company role of each member of the submission's company (user id → role), for role labels. */
  memberRoles?: Readonly<Record<string, CompanyRole>>;
  /**
   * Company viewers (BRD B28): the ScaleUp display names ("Renuka Sena (ScaleUp)") of the authors and
   * resolvers they cannot name from `profiles` — every id of `hiddenAuthorIds(rows)` passed to
   * `getStaffDisplayNames` — keyed by lower-case id. Ids missing from a loaded map are not ScaleUp staff
   * (former team members). Leave it out for ScaleUp viewers, who read every profile.
   */
  staffNames?: Readonly<Record<string, string>>;
  /** canReplyToComments(ctx, companyId). */
  canReply: boolean;
  /** canResolveComments(ctx, companyId). */
  canResolve: boolean;
};

function personName(profile: CommentProfile | null | undefined): string | null {
  const name = profile?.full_name?.trim();
  if (name) return name;
  const email = profile?.email?.trim();
  return email ? email : null;
}

/**
 * How the viewer sees the author (or resolver) of a comment:
 * - company viewers: company people (co-members, whose profiles they read) by name with their company role;
 *   ScaleUp staff as "<full name> (ScaleUp)" from `viewer.staffNames`, never with their email or role (BRD
 *   B24, B28) — "ScaleUp" when no name is known; anyone else whose profile is hidden as a former team member;
 * - ScaleUp viewers: staff by name with their ScaleUp role; company people by name with their company role.
 */
export function describeAuthor(
  profile: CommentProfile | null | undefined,
  userId: string,
  viewer: Pick<CommentViewer, "userId" | "audience" | "memberRoles" | "staffNames">,
): CommentAuthor {
  const isViewer = userId === viewer.userId;
  const memberRole = viewer.memberRoles?.[userId];
  const companyRoleLabel = memberRole ? COMPANY_ROLE_LABELS[memberRole] : null;

  if (viewer.audience === "company") {
    if (profile && profile.scaleup_role === null) {
      return { name: personName(profile) ?? "Team member", roleLabel: companyRoleLabel, side: "company", isViewer };
    }
    // Never the profile's own name or email here: a ScaleUp profile is only ever named by staff_display_names.
    const staffName = viewer.staffNames?.[userId.toLowerCase()];
    if (staffName) return { name: staffName, roleLabel: null, side: "scaleup", isViewer: false };
    if (!profile && viewer.staffNames) {
      return { name: FORMER_MEMBER_NAME, roleLabel: null, side: "company", isViewer: false };
    }
    return { name: SCALEUP_AUTHOR_NAME, roleLabel: null, side: "scaleup", isViewer: false };
  }

  if (profile?.scaleup_role) {
    return {
      name: personName(profile) ?? "ScaleUp staff",
      roleLabel: SCALEUP_ROLE_LABELS[profile.scaleup_role],
      side: "scaleup",
      isViewer,
    };
  }
  return {
    name: personName(profile) ?? "Unknown user",
    roleLabel: companyRoleLabel ?? (profile ? "Company user" : null),
    side: "company",
    isViewer,
  };
}

function instantOf(value: string): number {
  return parseInstant(value) ?? 0;
}

function byCreatedAt(a: CommentRowWithProfiles, b: CommentRowWithProfiles): number {
  return instantOf(a.created_at) - instantOf(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function toMessage(row: CommentRowWithProfiles, viewer: CommentViewer): CommentMessage {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    author: describeAuthor(row.author, row.author_id, viewer),
  };
}

/**
 * Builds threads from comment rows: roots (oldest first), each with its replies (oldest first). Company
 * viewers never get internal threads (Row Level Security already hides them; this is a second guard).
 * Replies whose root is not visible are dropped. Per-thread `canReply` / `canResolve` combine the viewer's
 * rights with the thread's visibility (company users act on shared threads only).
 */
export function buildCommentThreads(
  rows: ReadonlyArray<CommentRowWithProfiles>,
  viewer: CommentViewer,
): CommentThread[] {
  const visible = viewer.audience === "company" ? rows.filter((row) => row.visibility === "shared") : [...rows];
  visible.sort(byCreatedAt);

  const roots = new Map<string, { row: CommentRowWithProfiles; replies: CommentRowWithProfiles[] }>();
  for (const row of visible) {
    if (row.parent_id === null) roots.set(row.id, { row, replies: [] });
  }
  for (const row of visible) {
    if (row.parent_id !== null) roots.get(row.parent_id)?.replies.push(row);
  }

  return Array.from(roots.values(), ({ row, replies }): CommentThread => {
    const shared = row.visibility === "shared";
    const actsOnThread = viewer.audience === "scaleup" || shared;
    const messages = [row, ...replies];
    const last = messages.reduce((latest, message) =>
      instantOf(message.created_at) > instantOf(latest.created_at) ? message : latest,
    );
    const resolved = row.resolved_at !== null;
    return {
      id: row.id,
      submissionId: row.submission_id,
      target: row.target,
      visibility: row.visibility,
      resolved,
      resolvedAt: row.resolved_at,
      resolvedBy: resolved && row.resolved_by ? describeAuthor(row.resolver, row.resolved_by, viewer) : null,
      root: toMessage(row, viewer),
      replies: replies.map((reply) => toMessage(reply, viewer)),
      lastActivityAt: last.created_at,
      canReply: viewer.canReply && actsOnThread,
      canResolve: viewer.canResolve && actsOnThread,
    };
  });
}

/**
 * The authors and resolvers of shared comments that a company viewer cannot name from `profiles`: ScaleUp
 * staff (Row Level Security hides their profiles from company users) and anyone else whose profile is
 * hidden. Ask `getStaffDisplayNames` for these (BRD B28) and pass the result as `CommentViewer.staffNames`.
 * Distinct ids, in order of appearance.
 */
export function hiddenAuthorIds(rows: ReadonlyArray<CommentRowWithProfiles>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.visibility !== "shared") continue;
    if (!row.author || row.author.scaleup_role !== null) ids.add(row.author_id);
    if (row.resolved_by && (!row.resolver || row.resolver.scaleup_role !== null)) ids.add(row.resolved_by);
  }
  return [...ids];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TARGET_RE = new RegExp(`^(general|field:[a-z][a-z0-9_]*|segment:${UUID}|kpi:${UUID}(:${UUID})?)$`);

/**
 * The canonical form of a comment target (docs/ARCHITECTURE.md §2.5), exactly as the comments trigger stores
 * it: trimmed, blank → 'general', segment/kpi targets lower-cased. Null when the database would refuse it
 * ("That comment target is not recognised.").
 */
export function normaliseCommentTarget(raw: string | null | undefined): string | null {
  let target = (raw ?? "").trim();
  if (target === "") return GENERAL_TARGET;
  if (/^(segment|kpi):/i.test(target)) target = target.toLowerCase();
  return TARGET_RE.test(target) ? target : null;
}

/** Target strings compared the way the database stores them (ids lower-case). */
export function sameTarget(a: string, b: string): boolean {
  return (normaliseCommentTarget(a) ?? a) === (normaliseCommentTarget(b) ?? b);
}

/** The threads on one target (in their existing order). */
export function threadsForTarget(threads: ReadonlyArray<CommentThread>, target: string): CommentThread[] {
  return threads.filter((thread) => sameTarget(thread.target, target));
}

/** Threads grouped by target (keys as stored), each group in its existing order. */
export function groupThreadsByTarget(threads: ReadonlyArray<CommentThread>): Record<string, CommentThread[]> {
  const groups: Record<string, CommentThread[]> = {};
  for (const thread of threads) (groups[thread.target] ??= []).push(thread);
  return groups;
}

/** Number of threads and unresolved threads per target (the `commentCounts` shape). */
export function countThreadsByTarget(
  threads: ReadonlyArray<Pick<CommentThread, "target" | "resolved">>,
): CommentCounts {
  const counts: CommentCounts = {};
  for (const thread of threads) {
    const entry = (counts[thread.target] ??= { total: 0, unresolved: 0 });
    entry.total += 1;
    if (!thread.resolved) entry.unresolved += 1;
  }
  return counts;
}

/** Total and unresolved thread counts of a list. */
export function summariseThreads(threads: ReadonlyArray<Pick<CommentThread, "resolved">>): {
  total: number;
  unresolved: number;
} {
  const unresolved = threads.filter((thread) => !thread.resolved).length;
  return { total: threads.length, unresolved };
}

/** Open threads first (oldest first), then resolved ones (most recently resolved first). */
export function partitionThreads(threads: ReadonlyArray<CommentThread>): {
  open: CommentThread[];
  resolved: CommentThread[];
} {
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads
    .filter((thread) => thread.resolved)
    .sort((a, b) => instantOf(b.resolvedAt ?? b.lastActivityAt) - instantOf(a.resolvedAt ?? a.lastActivityAt));
  return { open, resolved };
}

/**
 * Two letters for an author's avatar: "Renuka Sena (ScaleUp)" → "RS", "finance@batik.test" → "FI",
 * "ScaleUp" → "SU" (the " (ScaleUp)" label of staff names is not part of the person's name).
 */
export function authorInitials(name: string): string {
  if (name === SCALEUP_AUTHOR_NAME) return "SU";
  const base = name.endsWith(SCALEUP_STAFF_SUFFIX) ? name.slice(0, -SCALEUP_STAFF_SUFFIX.length) : name;
  const words = base
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .map((word) => word.replace(/[()[\]{}"'‘’“”,]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length >= 2 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/** First line of a message, shortened to `max` characters (for reminders and summaries). */
export function commentExcerpt(body: string, max = 120): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
