import "server-only";

// Audit entries for access management (docs/ARCHITECTURE.md §2.4 `log_audit_event`): invite,
// sign_in_link, invite_revoke and mfa_reset are written with the CALLER's RLS client, so the acting user
// is the actor (Super Admins; company owners must pass their own company id). The access_links table is
// not row-audited: these entries are the only record of who issued which link. Never put a token, a
// token hash or a link into an audit entry.
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDateTime } from "@/lib/format";
import type { Database, Json } from "@/lib/supabase/database.types";

import { createAccessLink, revokeAccessLink, revokeEarlierAccessLinks } from "./index";
import type { AccessLinkPurpose } from "./purpose";
import type { IssuedLinkView } from "./types";

type RlsClient = SupabaseClient<Database>;

export type AccessAuditAction = "invite" | "invite_revoke" | "sign_in_link" | "mfa_reset";

/**
 * Appends an audit entry for the caller about the account `userId` (entity `profiles`). Company owners
 * must pass `companyId` (their own company); Super Admins may. Throws on failure.
 */
export async function logAccessEvent(
  sb: RlsClient,
  input: { action: AccessAuditAction; userId: string; companyId?: string; summary: string; data?: Json },
): Promise<void> {
  const { error } = await sb.rpc("log_audit_event", {
    p_action: input.action,
    p_entity: "profiles",
    p_entity_id: input.userId,
    p_company_id: input.companyId,
    p_summary: input.summary,
    p_data: input.data,
  });
  if (error) throw error;
}

/**
 * Issues a link as `createdBy` and records it (`invite` / `sign_in_link`). If the audit entry cannot be
 * written the new link is revoked again and the error is thrown, so no usable link is ever unrecorded.
 * The person's earlier pending links of the same purpose are revoked only AFTER the new link is
 * recorded: a failed request never leaves them without the working link they may already have.
 * The database's refusals (42501, BRD B29) are thrown unchanged (`isOwnerLinkRefusal`).
 */
export async function issueLinkWithAudit(
  sb: RlsClient,
  input: {
    userId: string;
    purpose: AccessLinkPurpose;
    createdBy: string;
    companyId?: string;
    /** e.g. "Invited Ana Tan (ana@scaleup.my) as Fund Admin" — the expiry is appended. */
    summary: string;
    data?: Record<string, Json>;
  },
): Promise<IssuedLinkView> {
  const link = await createAccessLink({
    userId: input.userId,
    purpose: input.purpose,
    createdBy: input.createdBy,
    revokeEarlier: false,
  });
  try {
    await logAccessEvent(sb, {
      action: input.purpose === "invite" ? "invite" : "sign_in_link",
      userId: input.userId,
      companyId: input.companyId,
      summary: `${input.summary} (link valid until ${formatDateTime(link.expiresAt)})`,
      data: { ...input.data, link_id: link.id, purpose: input.purpose, expires_at: link.expiresAt },
    });
  } catch (error) {
    await revokeAccessLink(link.id).catch(() => null);
    throw error;
  }
  await revokeEarlierAccessLinks(link);
  return { url: link.url, expiresAt: link.expiresAt, purpose: link.purpose };
}
