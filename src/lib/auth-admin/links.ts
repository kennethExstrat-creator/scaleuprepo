// Access links in the database (BRD B14, B23, B29; docs/ARCHITECTURE.md §2.2 `access_links`, §2.4
// `claim_access_link`). The table is service-role only: every function takes the service-role client
// (`createAdminClient()`, or the script's own) as its first argument and must only be called after the
// caller's own permission checks. Who may issue a link for whom is enforced by the database
// (`private.access_links_guard()`): a refusal is thrown as the PostgrestError (code 42501) with a
// friendly message, which `toActionError` shows as-is.
//
// No "server-only" import and no runtime `@/` imports, so scripts/create-user.ts (plain tsx) can reuse
// it; the app goes through the server-only wrappers in ./index.ts. Tokens and token hashes are never
// logged or returned, except the link itself from `issueAccessLink` (shown once to the issuer).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../supabase/database.types";
import {
  accessLinkExpiry,
  accessLinkUrl,
  generateAccessToken,
  hashAccessToken,
  isAccessLinkPurpose,
  type AccessLinkPurpose,
} from "./tokens";

type AdminClient = SupabaseClient<Database>;

/** The database's refusal when a company owner asks for a link it may not hold (BRD B29). */
export const OWNER_LINK_REFUSAL_MESSAGE =
  "Only ScaleUp can send this person a link, because they are not just a contributor of your company. Ask them to sign in as usual.";

/** The database's refusal for anyone who is neither a Super Admin nor a company owner. */
export const ISSUER_REFUSAL_MESSAGE = "Only Super Admins and company owners can issue invitation and sign-in links.";

/** A link just issued. `url` contains the token: show it once to the issuer, never log or store it. */
export type IssuedAccessLink = {
  id: string;
  userId: string;
  purpose: AccessLinkPurpose;
  url: string;
  expiresAt: string;
};

/** An unused, unrevoked, unexpired link (no token or hash). */
export type PendingAccessLink = {
  id: string;
  userId: string;
  purpose: AccessLinkPurpose;
  /** Who issued it; null = a trusted script. */
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
};

/** Any link row (no token or hash). */
export type AccessLinkRecord = PendingAccessLink & { usedAt: string | null; revokedAt: string | null };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  const message = (error as { message: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** True when the database refused an OWNER's link for this person (BRD B29): not just their contributor. */
export function isOwnerLinkRefusal(error: unknown): boolean {
  return errorCode(error) === "42501" && errorMessage(error).startsWith("Only ScaleUp can send this person a link");
}

/**
 * Issues a single-use link for `userId` and returns it. The previous pending links of the same person
 * and purpose are revoked afterwards (only the newest works), and only once the new one exists: a
 * refused request leaves the earlier links untouched. With `revokeEarlier: false` they are left alone,
 * so a caller with more to do before the new link counts (recording it in the audit log) can call
 * `revokeEarlierLinks` once that has succeeded.
 *
 * `createdBy` must be the acting user (null only for a trusted script such as scripts/create-user.ts).
 * Throws the PostgrestError when the database refuses — 42501 from the issuer guard
 * (`isOwnerLinkRefusal`), 23514 for an invalid expiry — or on any other failure.
 */
export async function issueAccessLink(
  admin: AdminClient,
  input: {
    userId: string;
    purpose: AccessLinkPurpose;
    createdBy: string | null;
    siteUrl: string;
    now?: number;
    /** Revoke the person's earlier pending links of this purpose right away (default true). */
    revokeEarlier?: boolean;
  },
): Promise<IssuedAccessLink> {
  const now = input.now ?? Date.now();
  const token = generateAccessToken();
  const url = accessLinkUrl(input.siteUrl, token); // validates the site URL before anything is stored

  const { data, error } = await admin
    .from("access_links")
    .insert({
      user_id: input.userId,
      purpose: input.purpose,
      token_hash: hashAccessToken(token),
      expires_at: accessLinkExpiry(input.purpose, now),
      created_by: input.createdBy,
    })
    .select("id, expires_at")
    .single();
  if (error) throw error;
  const created: { id: string; expires_at: string } = data;

  const link: IssuedAccessLink = {
    id: created.id,
    userId: input.userId,
    purpose: input.purpose,
    url,
    expiresAt: created.expires_at,
  };
  if (input.revokeEarlier !== false) await revokeEarlierLinks(admin, link, now);
  return link;
}

/**
 * Revokes the person's other pending links of the same purpose as `link`, so only the newest one works.
 * Never throws: when it fails the new link still works and the older ones stay valid until they expire
 * (logged with ids only, never tokens). Returns how many were revoked (0 after a failure).
 */
export async function revokeEarlierLinks(
  admin: AdminClient,
  link: Pick<IssuedAccessLink, "id" | "userId" | "purpose">,
  now?: number,
): Promise<number> {
  try {
    return await revokePendingLinks(admin, { userId: link.userId, purpose: link.purpose, exceptId: link.id, now });
  } catch (revokeError) {
    console.warn("[access-links] could not revoke earlier links", { userId: link.userId, error: errorMessage(revokeError) });
    return 0;
  }
}

/**
 * Revokes one pending link. Returns the revoked link, or null when it was already used, revoked or does
 * not exist (links never change otherwise: access_links_guard).
 */
export async function revokeLink(admin: AdminClient, linkId: string): Promise<AccessLinkRecord | null> {
  const { data, error } = await admin
    .from("access_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id, user_id, purpose, created_by, created_at, expires_at, used_at, revoked_at")
    .maybeSingle();
  if (error) throw error;
  return data ? toRecord(data) : null;
}

/**
 * Revokes a person's pending links (unused, unrevoked, unexpired), optionally only one purpose, only
 * links issued by `createdBy`, or all but `exceptId`. Returns how many were revoked.
 */
export async function revokePendingLinks(
  admin: AdminClient,
  options: {
    userId: string;
    purpose?: AccessLinkPurpose;
    createdBy?: readonly string[];
    exceptId?: string;
    now?: number;
  },
): Promise<number> {
  if (options.createdBy && options.createdBy.length === 0) return 0;
  const nowIso = new Date(options.now ?? Date.now()).toISOString();
  let query = admin
    .from("access_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", options.userId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso);
  if (options.purpose) query = query.eq("purpose", options.purpose);
  if (options.createdBy) query = query.in("created_by", [...options.createdBy]);
  if (options.exceptId) query = query.neq("id", options.exceptId);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return data.length;
}

/** One link by id (no token or hash), or null. */
export async function getLink(admin: AdminClient, linkId: string): Promise<AccessLinkRecord | null> {
  const { data, error } = await admin
    .from("access_links")
    .select("id, user_id, purpose, created_by, created_at, expires_at, used_at, revoked_at")
    .eq("id", linkId)
    .maybeSingle();
  if (error) throw error;
  return data ? toRecord(data) : null;
}

/**
 * Pending links (unused, unrevoked, unexpired), newest first; optionally only those of `userIds`.
 */
export async function listPendingLinks(
  admin: AdminClient,
  filter: { userIds?: readonly string[]; now?: number } = {},
): Promise<PendingAccessLink[]> {
  if (filter.userIds && filter.userIds.length === 0) return [];
  const nowIso = new Date(filter.now ?? Date.now()).toISOString();
  let query = admin
    .from("access_links")
    .select("id, user_id, purpose, created_by, created_at, expires_at")
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });
  if (filter.userIds) query = query.in("user_id", [...new Set(filter.userIds)]);
  const { data, error } = await query;
  if (error) throw error;
  const rows: LinkRow[] = data;
  return rows.flatMap((row) => {
    if (!isAccessLinkPurpose(row.purpose)) return [];
    return [
      {
        id: row.id,
        userId: row.user_id,
        purpose: row.purpose,
        createdBy: row.created_by,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// The /access/[token] page
// ---------------------------------------------------------------------------------------------

/** What the accept page may say about a token, looked up WITHOUT using the link. */
export type AccessLinkPreview =
  | { status: "valid"; purpose: AccessLinkPurpose; email: string; fullName: string | null; expiresAt: string }
  | { status: "used" | "expired" | "revoked" | "not_found" };

type PreviewRow = {
  purpose: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  user: { email: string; full_name: string | null; is_active: boolean } | null;
};

/**
 * Classifies a looked-up link (pure). A deactivated account's link counts as revoked. Only a valid link
 * reveals who it is for. The accept action still decides with `claimLink` (the database also re-checks
 * the issuer), so a "valid" preview can be refused.
 */
export function classifyAccessLink(row: PreviewRow | null, now: number = Date.now()): AccessLinkPreview {
  if (!row || !isAccessLinkPurpose(row.purpose)) return { status: "not_found" };
  if (row.used_at) return { status: "used" };
  if (row.revoked_at || !row.user || !row.user.is_active) return { status: "revoked" };
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) return { status: "expired" };
  return {
    status: "valid",
    purpose: row.purpose,
    email: row.user.email,
    fullName: row.user.full_name,
    expiresAt: row.expires_at,
  };
}

/** Read-only lookup by token (never marks the link used): for rendering the accept page. */
export async function previewLink(admin: AdminClient, token: string, now: number = Date.now()): Promise<AccessLinkPreview> {
  const { data, error } = await admin
    .from("access_links")
    .select("purpose, expires_at, used_at, revoked_at, user:profiles!access_links_user_id_fkey(email, full_name, is_active)")
    .eq("token_hash", hashAccessToken(token))
    .maybeSingle();
  if (error) throw error;
  const row: PreviewRow | null = data;
  return classifyAccessLink(row, now);
}

/** A link claimed by `claimLink`: whose account to sign in, and why. */
export type ClaimedAccessLink = { userId: string; purpose: AccessLinkPurpose; email: string };

/**
 * Uses the link: `claim_access_link()` marks it used in ONE conditional update (single use even under
 * concurrent requests) and returns the account, or null when the link is not valid for any reason
 * (expired, used, revoked, deactivated account, issuer no longer allowed). Never check-then-set.
 */
export async function claimLink(admin: AdminClient, token: string): Promise<ClaimedAccessLink | null> {
  const { data, error } = await admin.rpc("claim_access_link", { p_token_hash: hashAccessToken(token) }).maybeSingle();
  if (error) throw error;
  const row: { user_id: string; purpose: string; email: string } | null = data;
  if (!row || !row.email) return null;
  return { userId: row.user_id, purpose: isAccessLinkPurpose(row.purpose) ? row.purpose : "signin", email: row.email };
}

type LinkRow = {
  id: string;
  user_id: string;
  purpose: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
};

function toRecord(row: LinkRow & { used_at: string | null; revoked_at: string | null }): AccessLinkRecord {
  return {
    id: row.id,
    userId: row.user_id,
    purpose: isAccessLinkPurpose(row.purpose) ? row.purpose : "signin",
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
  };
}
