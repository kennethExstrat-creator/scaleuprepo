// Comment thread types (module M6, docs/ARCHITECTURE.md §5.7). Type-only and client-safe: the server
// actions in src/lib/actions/comments.ts return these shapes, and the comment components render them.
import type { CommentVisibility } from "@/lib/types/enums";

/** Who is looking: ScaleUp staff (shared and internal threads) or company users (shared threads only). */
export type CommentMode = "scaleup" | "company";

/**
 * The author of a message as the viewer may see it. Company users see ScaleUp staff by name with a
 * "(ScaleUp)" label — `{ name: "Renuka Sena (ScaleUp)", roleLabel: null }` — never their email or role
 * (BRD B24, B28); "ScaleUp" when no name is known.
 */
export type CommentAuthor = {
  /**
   * The person's name (or email). For company users: ScaleUp staff as "<full name> (ScaleUp)" (or
   * "ScaleUp"), and "Former team member" for someone no longer on the company's team.
   */
  name: string;
  /** "Partner", "Fund Admin", "Company Owner", "Contributor", … (null when not shown). */
  roleLabel: string | null;
  /** Which side of the platform wrote it. */
  side: "scaleup" | "company";
  /** The viewer wrote it. */
  isViewer: boolean;
};

/** One message of a thread (the root comment or a reply). */
export type CommentMessage = {
  id: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  author: CommentAuthor;
};

/** A comment thread: the root comment with its replies (one level deep, oldest first). */
export type CommentThread = {
  /** The root comment's id (resolve / reopen and replies use it). */
  id: string;
  submissionId: string;
  /** docs/ARCHITECTURE.md §2.5: general · field:<key> · segment:<id> · kpi:<id>[:<member id>]. */
  target: string;
  /** Internal threads are ScaleUp only (never returned to company users). */
  visibility: CommentVisibility;
  resolved: boolean;
  resolvedAt: string | null;
  /** Who resolved it (null when open, or when not known to the viewer). */
  resolvedBy: CommentAuthor | null;
  root: CommentMessage;
  /** Oldest first. */
  replies: CommentMessage[];
  /** Timestamp of the newest message. */
  lastActivityAt: string;
  /** The viewer may reply to this thread. */
  canReply: boolean;
  /** The viewer may resolve or reopen this thread. */
  canResolve: boolean;
};

/** Threads per target (§2.5), e.g. for `SubmissionForm`'s `commentCounts` and the field comment buttons. */
export type CommentCounts = Record<string, { total: number; unresolved: number }>;

/**
 * Input of `addComment` (src/lib/actions/comments.ts). A new thread (ScaleUp non-viewers only) needs
 * `target` (default 'general') and `visibility` (default 'shared'); a reply (`parentId` = the thread's root
 * id) inherits both from its thread, so they are ignored.
 */
export type AddCommentInput = {
  submissionId: string;
  body: string;
  target?: string;
  visibility?: CommentVisibility;
  parentId?: string | null;
};
