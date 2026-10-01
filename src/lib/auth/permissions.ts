// Pure permission helpers mirroring the matrix in docs/ARCHITECTURE.md §1 and the database checks
// (RLS policies in supabase/migrations/20260930000400_rls.sql, RPC checks in 20260930000500_rpc.sql)
// — for showing and hiding UI only. The database and assertScaleUp/assertCompanyAccess in every
// action remain the real enforcement. Exited and written-off companies are read-only (BRD B15, B21):
// helpers for company-side changes need the membership's company to be active, and ScaleUp can no
// longer send their months back (request changes, reopen, extend deadlines) or reopen their confirmed
// period closes — only approve months already submitted.
// They check roles and company state only, not the state of a month or thread (e.g. a submission
// must also be draft/changes_requested to be edited). Safe to import from Client Components.
import type { AccessContext, CompanyRole, CompanyStatus, Membership, ScaleupRole } from "@/lib/auth/types";

/** The parts of an AccessContext the helpers need (a full AccessContext also fits). */
export type PermissionSubject = Pick<AccessContext, "userId" | "scaleupRole" | "memberships">;

/**
 * Who is in charge of a company: its `company_internal` row (ScaleUp-only, BRD §6.3), e.g. from
 * `getCompanyInternal(sb, companyId)`, or just its `partner_in_charge_id`. Pass null when the row is
 * not available (company users never see it): only role-based rights remain.
 */
export type PartnerAssignment = { partner_in_charge_id: string | null };

function hasRole(ctx: PermissionSubject, ...roles: ScaleupRole[]): boolean {
  return ctx.scaleupRole !== null && roles.includes(ctx.scaleupRole);
}

function isPartnerInCharge(ctx: PermissionSubject, internal: PartnerAssignment | null | undefined): boolean {
  const partnerId = internal?.partner_in_charge_id ?? null;
  return ctx.scaleupRole === "partner" && partnerId !== null && partnerId === ctx.userId;
}

/** Omitted = active (the caller already knows the company is active). */
function isActiveStatus(companyStatus: CompanyStatus | undefined): boolean {
  return (companyStatus ?? "active") === "active";
}

/** ScaleUp staff (any ScaleUp role). */
export function isScaleUp(ctx: PermissionSubject): boolean {
  return ctx.scaleupRole !== null;
}

/** The user's active membership of a company, if any. */
export function membershipFor(ctx: PermissionSubject, companyId: string): Membership | null {
  return ctx.memberships.find((m) => m.companyId === companyId) ?? null;
}

/** The user's company role in a company (null when not a member). */
export function companyRoleOf(ctx: PermissionSubject, companyId: string): CompanyRole | null {
  return membershipFor(ctx, companyId)?.role ?? null;
}

/** Manage funds, companies, users and platform settings — Super Admin. */
export function canManagePlatform(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin");
}

/** Manage templates, company KPIs, revenue segments and FX rates — Super Admin, Fund Admin. */
export function canManageTemplates(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin", "fund_admin");
}

/** Manage reporting cycles: open months early — Super Admin, Fund Admin (open_period; portfolio-wide). */
export function canManageCycles(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin", "fund_admin");
}

/**
 * Extend a month's due date — Super Admin, Fund Admin, for ACTIVE companies only (extend_due_date;
 * exited / written-off companies are read-only, BRD B21). Pass the company's `companyStatus`
 * (omitted = active).
 */
export function canExtendDueDate(ctx: PermissionSubject, companyStatus?: CompanyStatus): boolean {
  return canManageCycles(ctx) && isActiveStatus(companyStatus);
}

/**
 * Reopen a confirmed quarter/half close — Super Admin, Fund Admin, for ACTIVE companies only
 * (reopen_period_close; the confirmed closes of exited / written-off companies stay confirmed, BRD
 * B21). Pass the company's `companyStatus` (omitted = active).
 */
export function canReopenPeriodClose(ctx: PermissionSubject, companyStatus?: CompanyStatus): boolean {
  return hasRole(ctx, "super_admin", "fund_admin") && isActiveStatus(companyStatus);
}

/**
 * Enter data and upload files: Fund Admin on behalf (logged); company owners and
 * contributors. Super Admin, Partner and Viewer cannot. Exited and written-off companies are
 * read-only (BRD B15): members' status comes from their membership; for Fund Admins pass the
 * company's `companyStatus` (without it the status is not checked).
 */
export function canEnterData(ctx: PermissionSubject, companyId: string, companyStatus?: CompanyStatus): boolean {
  if (ctx.scaleupRole) return ctx.scaleupRole === "fund_admin" && isActiveStatus(companyStatus);
  const membership = membershipFor(ctx, companyId);
  return membership !== null && membership.companyStatus === "active";
}

/** Submit / resubmit a month and request an amendment — company owner of an active company. */
export function canSubmit(ctx: PermissionSubject, companyId: string): boolean {
  if (ctx.scaleupRole) return false;
  const membership = membershipFor(ctx, companyId);
  return membership?.role === "owner" && membership.companyStatus === "active";
}

/**
 * Confirm a quarter/half period close — company owner, or Fund Admin on behalf; active
 * companies only (BRD B15). For Fund Admins pass the company's `companyStatus`.
 */
export function canConfirmPeriodClose(
  ctx: PermissionSubject,
  companyId: string,
  companyStatus?: CompanyStatus,
): boolean {
  if (ctx.scaleupRole) return ctx.scaleupRole === "fund_admin" && isActiveStatus(companyStatus);
  return canSubmit(ctx, companyId);
}

/**
 * Start comment threads — Super Admin, Fund Admin, Partner (any company, exited and written-off
 * ones included: their history can still be discussed).
 */
export function canComment(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin", "fund_admin", "partner");
}

/**
 * Send a submitted month back (request_changes) — Super Admin, Fund Admin, Partner (any company),
 * ACTIVE companies only (BRD B21). Pass the company's `companyStatus` (omitted = active).
 */
export function canRequestChanges(ctx: PermissionSubject, companyStatus?: CompanyStatus): boolean {
  return canComment(ctx) && isActiveStatus(companyStatus);
}

/**
 * Reply to threads — ScaleUp non-viewers (any thread); members of the company reply to its shared
 * threads while the company is active (comments_insert policy).
 */
export function canReplyToComments(ctx: PermissionSubject, companyId: string): boolean {
  if (ctx.scaleupRole) return canComment(ctx);
  return membershipFor(ctx, companyId)?.companyStatus === "active";
}

/**
 * Resolve / reopen threads (root comments) — ScaleUp non-viewers (any thread); members of the
 * company resolve its shared threads while the company is active (resolve_comment).
 */
export function canResolveComments(ctx: PermissionSubject, companyId: string): boolean {
  return canReplyToComments(ctx, companyId);
}

/**
 * Approve a submission — Super Admin, or the company's partner-in-charge (pass the company's
 * `company_internal` row). Also for exited / written-off companies, so ScaleUp can finalise their
 * history (BRD B21).
 */
export function canApprove(ctx: PermissionSubject, internal: PartnerAssignment | null | undefined): boolean {
  return hasRole(ctx, "super_admin") || isPartnerInCharge(ctx, internal);
}

/**
 * Reopen an approved month — Super Admin, Fund Admin, or the partner-in-charge (pass the company's
 * `company_internal` row), ACTIVE companies only (BRD B21; omitted `companyStatus` = active).
 */
export function canReopen(
  ctx: PermissionSubject,
  internal: PartnerAssignment | null | undefined,
  companyStatus?: CompanyStatus,
): boolean {
  return (hasRole(ctx, "super_admin", "fund_admin") || isPartnerInCharge(ctx, internal)) && isActiveStatus(companyStatus);
}

/**
 * Edit the internal fields (rating, exit status and notes) — Super Admin, Fund Admin, partner-in-charge
 * (pass the company's `company_internal` row). The partner-in-charge itself: `canAssignPartner`.
 */
export function canEditInternal(ctx: PermissionSubject, internal: PartnerAssignment | null | undefined): boolean {
  return hasRole(ctx, "super_admin", "fund_admin") || isPartnerInCharge(ctx, internal);
}

/** Assign (or clear) a company's partner-in-charge — Super Admin only (company_internal guard). */
export function canAssignPartner(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin");
}

/**
 * Export — every ScaleUp role (including Viewer); a company owner for their own company's
 * data (pass `companyId`); contributors cannot export.
 */
export function canExport(ctx: PermissionSubject, companyId?: string): boolean {
  if (ctx.scaleupRole) return true;
  if (!companyId) return false;
  return companyRoleOf(ctx, companyId) === "owner";
}

/** View the audit log — Super Admin, Fund Admin, Partner (not Viewer, never company users). */
export function canViewAudit(ctx: PermissionSubject): boolean {
  return hasRole(ctx, "super_admin", "fund_admin", "partner");
}

/**
 * Invite users — Super Admin (anyone); a company owner may invite contributors to their own
 * company while it is active (pass `companyId`; company_members policies, log_audit_event).
 * An owner's invitation / sign-in LINK is further limited by the database (access_links_guard, BRD
 * B29): only for contributors who belong to no company the owner does not own — the owner cannot see
 * other companies' memberships, so handle its 42501 ("Only ScaleUp can send this person a link, …").
 */
export function canInviteUsers(ctx: PermissionSubject, companyId?: string): boolean {
  if (hasRole(ctx, "super_admin")) return true;
  if (ctx.scaleupRole || !companyId) return false;
  return canManageCompanyTeam(ctx, companyId);
}

/**
 * Set the company's OWN revenue segments (BRD B30; set_company_revenue_segments): the owner of an active
 * company (/portal/[companyId]/segments), or a Super Admin / Fund Admin on the owner's behalf (audited
 * `on_behalf`) while the company is active — for ScaleUp staff pass the company's `companyStatus` (omitted =
 * active). Contributors, partners and viewers only read them; exited / written-off companies are read-only
 * for everyone (B21). ScaleUp's revenue lines (kind 'scaleup') are canManageTemplates.
 */
export function canManageCompanySegments(
  ctx: PermissionSubject,
  companyId: string,
  companyStatus?: CompanyStatus,
): boolean {
  if (ctx.scaleupRole) return canManageTemplates(ctx) && isActiveStatus(companyStatus);
  return canSubmit(ctx, companyId);
}

/**
 * Manage the company's team (/portal/[companyId]/team: add, deactivate or remove contributors) —
 * company owners of an active company. Owners of exited or written-off companies can still see
 * the page read-only.
 */
export function canManageCompanyTeam(ctx: PermissionSubject, companyId: string): boolean {
  if (ctx.scaleupRole) return false;
  const membership = membershipFor(ctx, companyId);
  return membership?.role === "owner" && membership.companyStatus === "active";
}
