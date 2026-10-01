"use server";

// Server Actions of the ScaleUp company pages (M1: BRD A1, A4). Every action re-checks the caller's role
// (assertScaleUp), validates its input with zod (./_components/schemas.ts) and writes through the
// RLS-scoped client, so Row Level Security, the table triggers and the RPCs stay the real enforcement
// (docs/ARCHITECTURE.md §1, §2.4, §2.7):
// - companies, fund investments, status, deletion, partner-in-charge: Super Admin;
// - revenue lines, KPI dimensions and members, KPIs: Super Admin and Fund Admin;
// - internal rating, exit strategy and notes: Super Admin, Fund Admin, the partner-in-charge.
// The service-role client is used only to remove a deleted company's files from Storage.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canEditInternal } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { getCompany, getCompanyInternal, getPlatformSettings } from "@/lib/data";
import { dateToMonthKey, monthKeyToDate, todayMYT, type MonthKey } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { KpiValueType, ScaleupRole } from "@/lib/types/enums";

import { lockedKpiChange } from "./_components/kpi-rules";
import { hasReportedFigures } from "./_components/queries";
import { nextSortOrder, planMove, type SortableRow, type SortOrderUpdate } from "./_components/reorder";
import { startMonthBounds, startMonthIssue } from "./_components/reporting";
import {
  addCompanyItemSchema,
  addMemberSchema,
  assignPartnerSchema,
  companyItemSchema,
  companyStatusSchema,
  createCompanySchema,
  deleteCompanySchema,
  fundInvestmentSchema,
  internalFieldsSchema,
  kpiSchema,
  moveItemSchema,
  renameItemSchema,
  reportingStartSchema,
  setItemActiveSchema,
  updateCompanyProfileSchema,
} from "./_components/schemas";
import { COMPANY_DOCUMENTS_BUCKET, removeFolder } from "./_components/storage-cleanup";

type Sb = SupabaseClient<Database>;

/** Who manages company KPIs and revenue lines (canManageTemplates). */
const CONFIG_ROLES: readonly ScaleupRole[] = ["super_admin", "fund_admin"];
/** Who edits the internal fields (canEditInternal; partners only for their own companies). */
const INTERNAL_ROLES: readonly ScaleupRole[] = ["super_admin", "fund_admin", "partner"];

const CURRENCY_LOCKED_MESSAGE =
  "The reporting currency can't change once the company has reported figures, because they are stored in this currency.";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === "23505";
}

/** Postgres 17 raises 23503 for ON DELETE RESTRICT, 18 raises 23001 (docs/ARCHITECTURE.md §0). */
function isForeignKeyViolation(error: PostgrestError): boolean {
  return error.code === "23503" || error.code === "23001";
}

/** A friendly message for a database error (toActionError's wording). */
function describe(error: unknown): string {
  const result = toActionError(error);
  return result.ok ? MESSAGES.generic : result.error;
}

/** An ActionError that highlights one field. */
function fieldError(field: string, message: string): ActionError {
  return new ActionError(MESSAGES.invalid, { [field]: message });
}

function notFound(): ActionError {
  return new ActionError(MESSAGES.notFound);
}

function revalidateCompany(companyId: string, ...paths: string[]): void {
  revalidatePath(`/admin/companies/${companyId}`);
  for (const path of paths) revalidatePath(path);
}

/**
 * Opens any months that are now due (open_due_periods(); idempotent), e.g. right after a start month is
 * set, so they appear at once instead of after the nightly run. Returns why it failed, or null.
 */
async function openDueMonths(sb: Sb): Promise<string | null> {
  const { error } = await sb.rpc("open_due_periods");
  return error ? describe(error) : null;
}

/** Refuses a start month outside the allowed range (unchanged values are always fine). */
async function assertStartMonthAllowed(sb: Sb, month: MonthKey, current: string | null, field: string): Promise<void> {
  if (current && dateToMonthKey(current) === month) return;
  const settings = await getPlatformSettings(sb);
  const issue = startMonthIssue(month, startMonthBounds(settings.default_reporting_start, todayMYT()));
  if (issue) throw fieldError(field, issue);
}

/** The partner-in-charge must be an active partner or Super Admin (BRD §6.3). */
async function assertPartnerCandidate(sb: Sb, partnerId: string, field: string): Promise<void> {
  const { data, error } = await sb
    .from("profiles")
    .select("id, scaleup_role, is_active")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) throw error;
  const profile: { id: string; scaleup_role: ScaleupRole | null; is_active: boolean } | null = data;
  if (!profile || !profile.is_active || (profile.scaleup_role !== "partner" && profile.scaleup_role !== "super_admin")) {
    throw fieldError(field, "Choose an active partner or Super Admin.");
  }
}

/** New fund mappings need existing, active funds. `fieldFor(i)` names the field of the i-th fund. */
async function assertFundsSelectable(sb: Sb, fundIds: readonly string[], fieldFor: (index: number) => string) {
  const { data, error } = await sb.from("funds").select("id, is_active").in("id", [...fundIds]);
  if (error) throw error;
  const funds: { id: string; is_active: boolean }[] = data;
  const fieldErrors: Record<string, string> = {};
  fundIds.forEach((fundId, index) => {
    const fund = funds.find((row) => row.id === fundId);
    if (!fund) fieldErrors[fieldFor(index)] = "Choose a fund from the list.";
    else if (!fund.is_active) fieldErrors[fieldFor(index)] = "This fund is inactive. Reactivate it on the Funds page first.";
  });
  if (Object.keys(fieldErrors).length > 0) throw new ActionError(MESSAGES.invalid, fieldErrors);
}

/** Applies sort_order updates (after planMove) to rows of one table. */
async function applySortOrders(
  updates: readonly SortOrderUpdate[],
  update: (row: SortOrderUpdate) => PromiseLike<{ error: PostgrestError | null }>,
): Promise<void> {
  const results = await Promise.all(updates.map((row) => update(row)));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

/** Throws not found when an update or delete matched no row (RLS or a wrong company). */
function expectRow(rows: readonly unknown[]): void {
  if (rows.length === 0) throw notFound();
}

// ---------------------------------------------------------------------------------------------
// Companies (Super Admin)
// ---------------------------------------------------------------------------------------------

/**
 * Creates a company with its partner-in-charge (company_internal) and fund mappings, then opens its due
 * months when a reporting start month is given. The company is created even when a later step fails;
 * those failures come back as `warnings` (the company page lets the admin finish the set-up).
 */
export async function createCompanyAction(input: unknown): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = createCompanySchema.parse(input);
    const sb = await createClient();

    if (values.reportingStartMonth) {
      await assertStartMonthAllowed(sb, values.reportingStartMonth, null, "reportingStartMonth");
    }
    if (values.partnerId) await assertPartnerCandidate(sb, values.partnerId, "partnerId");
    if (values.funds.length > 0) {
      await assertFundsSelectable(
        sb,
        values.funds.map((fund) => fund.fundId),
        (index) => `funds.${index}.fundId`,
      );
    }

    const { data, error } = await sb
      .from("companies")
      .insert({
        name: values.name,
        legal_name: values.legalName,
        registration_no: values.registrationNo,
        sector: values.sector,
        country: values.country,
        website: values.website,
        description: values.description,
        reporting_currency: values.reportingCurrency,
        reporting_start_month: values.reportingStartMonth ? monthKeyToDate(values.reportingStartMonth) : null,
      })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", "A company with this name already exists.");
      throw error;
    }
    const companyId: string = data.id;
    const warnings: string[] = [];

    if (values.partnerId) {
      const { error: partnerError } = await sb
        .from("company_internal")
        .update({ partner_in_charge_id: values.partnerId })
        .eq("company_id", companyId);
      if (partnerError) warnings.push(`The partner-in-charge could not be assigned: ${describe(partnerError)}`);
    }
    if (values.funds.length > 0) {
      const { error: fundsError } = await sb.from("fund_investments").insert(
        values.funds.map((fund) => ({
          company_id: companyId,
          fund_id: fund.fundId,
          investment_date: fund.investmentDate,
          instrument: fund.instrument,
          ownership_pct: fund.ownershipPct,
          notes: fund.notes,
        })),
      );
      if (fundsError) warnings.push(`The fund mappings could not be saved: ${describe(fundsError)}`);
    }
    if (values.reportingStartMonth) {
      const reason = await openDueMonths(sb);
      if (reason) warnings.push(`Its monthly updates could not be opened yet: ${reason}`);
    }

    revalidatePath("/admin/companies");
    revalidatePath("/admin/funds");
    revalidatePath("/admin/tracker");
    return ok({ id: companyId, warnings });
  } catch (e) {
    return toActionError(e);
  }
}

/** Saves the company profile (name, legal entity, sector, website, currency, …). */
export async function updateCompanyProfileAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = updateCompanyProfileSchema.parse(input);
    const sb = await createClient();
    const company = await getCompany(sb, values.companyId);
    if (!company) throw notFound();
    if (values.reportingCurrency !== company.reporting_currency.trim() && (await hasReportedFigures(sb, company.id))) {
      throw fieldError("reportingCurrency", CURRENCY_LOCKED_MESSAGE);
    }

    const { data, error } = await sb
      .from("companies")
      .update({
        name: values.name,
        legal_name: values.legalName,
        registration_no: values.registrationNo,
        sector: values.sector,
        country: values.country,
        website: values.website,
        description: values.description,
        reporting_currency: values.reportingCurrency,
      })
      .eq("id", company.id)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", "A company with this name already exists.");
      throw error;
    }
    expectRow(data);

    revalidateCompany(company.id, "/admin/companies", "/admin/tracker");
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Sets (or clears) the reporting start month (BRD B3, B16). Setting one opens the months that are due
 * straight away (open_due_periods); clearing it keeps the history and opens nothing new.
 */
export async function setReportingStartAction(input: unknown): Promise<ActionResult<{ warning: string | null }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const { companyId, month } = reportingStartSchema.parse(input);
    const sb = await createClient();
    const company = await getCompany(sb, companyId);
    if (!company) throw notFound();
    if (month) await assertStartMonthAllowed(sb, month, company.reporting_start_month, "month");

    const { data, error } = await sb
      .from("companies")
      .update({ reporting_start_month: month ? monthKeyToDate(month) : null })
      .eq("id", company.id)
      .select("id");
    if (error) throw error;
    expectRow(data);

    let warning: string | null = null;
    if (month) {
      const reason = await openDueMonths(sb);
      if (reason) warning = `The start month was saved, but its monthly updates could not be opened yet: ${reason}`;
    }

    revalidateCompany(company.id, "/admin/companies", "/admin/tracker");
    return ok({ warning });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Marks the company exited or written off (with a reason), or active again (set_company_status). Exited
 * and written-off companies are read-only and get no new months (BRD B15, B21); back to active, the months
 * that are due open straight away.
 */
export async function setCompanyStatusAction(input: unknown): Promise<ActionResult<{ warning: string | null }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = companyStatusSchema.parse(input);
    const sb = await createClient();
    const { error } = await sb.rpc("set_company_status", {
      p_company_id: values.companyId,
      p_status: values.status,
      p_reason: values.reason ?? undefined,
    });
    if (error) throw error;

    let warning: string | null = null;
    if (values.status === "active") {
      const reason = await openDueMonths(sb);
      if (reason) warning = `The company is active again, but its due monthly updates could not be opened yet: ${reason}`;
    }

    revalidateCompany(values.companyId, "/admin/companies", "/admin/tracker", "/admin/funds");
    return ok({ warning });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Deletes the company for good (delete_company: the reason goes to the audit log first; users and the
 * audit trail are kept, BRD B22), then removes its files ("<company_id>/" in the company-documents bucket)
 * with the service-role Storage API. The caller must type the company's name.
 *
 * No revalidatePath here on purpose: revalidating in a Server Action re-renders the current page, which
 * is the deleted company (a 404 flash). The client navigates to the list, which is rendered fresh.
 */
export async function deleteCompanyAction(
  input: unknown,
): Promise<ActionResult<{ removedFiles: number; warning: string | null }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = deleteCompanySchema.parse(input);
    const sb = await createClient();
    const company = await getCompany(sb, values.companyId);
    if (!company) throw notFound();
    if (values.confirmName !== company.name.trim()) {
      throw fieldError("confirmName", "The name doesn't match. Type it exactly as shown.");
    }

    const { error } = await sb.rpc("delete_company", { p_company_id: company.id, p_reason: values.reason });
    if (error) throw error;

    let removedFiles = 0;
    let warning: string | null = null;
    try {
      const bucket = createAdminClient().storage.from(COMPANY_DOCUMENTS_BUCKET);
      removedFiles = await removeFolder(bucket, company.id.toLowerCase());
    } catch (storageError) {
      console.error(`[companies] could not remove the files of deleted company ${company.id}`, storageError);
      warning = `The company was deleted, but its uploaded files could not all be removed from storage (folder ${company.id} in ${COMPANY_DOCUMENTS_BUCKET}). They are no longer linked to anything; remove them in the Supabase dashboard.`;
    }
    return ok({ removedFiles, warning });
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Fund investments (Super Admin; per fund, BRD B2)
// ---------------------------------------------------------------------------------------------

/** Adds a fund mapping, or updates one (its fund stays; remove and add to move it). */
export async function saveFundInvestmentAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = fundInvestmentSchema.parse(input);
    const sb = await createClient();
    const fields = {
      investment_date: values.investmentDate,
      instrument: values.instrument,
      ownership_pct: values.ownershipPct,
      notes: values.notes,
    };

    if (values.id) {
      const { data, error } = await sb
        .from("fund_investments")
        .update(fields)
        .eq("id", values.id)
        .eq("company_id", values.companyId)
        .select("id");
      if (error) throw error;
      expectRow(data);
    } else {
      await assertFundsSelectable(sb, [values.fundId], () => "fundId");
      const { error } = await sb
        .from("fund_investments")
        .insert({ company_id: values.companyId, fund_id: values.fundId, ...fields });
      if (error) {
        if (isUniqueViolation(error)) throw fieldError("fundId", "The company is already in this fund.");
        throw error;
      }
    }

    revalidateCompany(values.companyId, "/admin/companies", "/admin/funds");
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteFundInvestmentAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const { companyId, id } = companyItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("fund_investments")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) throw error;
    expectRow(data);

    revalidateCompany(companyId, "/admin/companies", "/admin/funds");
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Revenue lines (Super Admin, Fund Admin)
// ---------------------------------------------------------------------------------------------

// BRD B30: this page manages ScaleUp's revenue lines only (revenue_segments.kind = 'scaleup'). The
// company's own revenue segments (kind = 'company') change only through set_company_revenue_segments(),
// so every query here is limited to ScaleUp lines: renumbering must never take the company's segments
// into account, and updates of company rows would reach no row under RLS anyway.
const SCALEUP_LINE_KIND = "scaleup";

const REVENUE_LINE_TAKEN = "There's already a revenue line with this name.";
const REVENUE_LINE_ACTIVE_NAME_TAKEN =
  "Another active revenue line already has this name. Rename one of them first, then try again.";
const REVENUE_LINE_IN_USE =
  "This revenue line has figures in past months, so it can't be deleted. Deactivate it instead.";

async function loadRevenueLines(sb: Sb, companyId: string): Promise<SortableRow[]> {
  const { data, error } = await sb
    .from("revenue_segments")
    .select("id, name, sort_order, is_active")
    .eq("company_id", companyId)
    .eq("kind", SCALEUP_LINE_KIND);
  if (error) throw error;
  const rows: SortableRow[] = data;
  return rows;
}

export async function addRevenueLineAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, name } = addCompanyItemSchema.parse(input);
    const sb = await createClient();
    const lines = await loadRevenueLines(sb, companyId);
    const { error } = await sb
      .from("revenue_segments")
      .insert({ company_id: companyId, name, sort_order: nextSortOrder(lines), kind: SCALEUP_LINE_KIND });
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", REVENUE_LINE_TAKEN);
      throw error;
    }
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function renameRevenueLineAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, name } = renameItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("revenue_segments")
      .update({ name })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("kind", SCALEUP_LINE_KIND)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", REVENUE_LINE_TAKEN);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveRevenueLineAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, direction } = moveItemSchema.parse(input);
    const sb = await createClient();
    const lines = await loadRevenueLines(sb, companyId);
    if (!lines.some((line) => line.id === id)) throw notFound();
    await applySortOrders(planMove(lines, id, direction), (row) =>
      sb
        .from("revenue_segments")
        .update({ sort_order: row.sort_order })
        .eq("id", row.id)
        .eq("company_id", companyId)
        .eq("kind", SCALEUP_LINE_KIND),
    );
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setRevenueLineActiveAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, active } = setItemActiveSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("revenue_segments")
      .update({ is_active: active })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("kind", SCALEUP_LINE_KIND)
      .select("id");
    if (error) {
      // Names are unique, ignoring case, among the ACTIVE lines (revenue_segments_active_name_key), so
      // reactivating a line whose name another active line now uses is refused.
      if (isUniqueViolation(error)) throw new ActionError(REVENUE_LINE_ACTIVE_NAME_TAKEN);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteRevenueLineAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id } = companyItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("revenue_segments")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("kind", SCALEUP_LINE_KIND)
      .select("id");
    if (error) {
      if (isForeignKeyViolation(error)) throw new ActionError(REVENUE_LINE_IN_USE);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// KPI dimensions and their members (Super Admin, Fund Admin)
// ---------------------------------------------------------------------------------------------

const DIMENSION_TAKEN = "There's already a dimension with this name.";
const DIMENSION_IN_USE =
  "This dimension is used by a KPI or has figures in past months, so it can't be deleted.";
const MEMBER_TAKEN = "There's already a member with this name in this dimension.";
const MEMBER_IN_USE = "This member has figures in past months, so it can't be deleted. Deactivate it instead.";

export async function addDimensionAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, name } = addCompanyItemSchema.parse(input);
    const sb = await createClient();
    const { error } = await sb.from("kpi_dimensions").insert({ company_id: companyId, name });
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", DIMENSION_TAKEN);
      throw error;
    }
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function renameDimensionAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, name } = renameItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("kpi_dimensions")
      .update({ name })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", DIMENSION_TAKEN);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Deletes a dimension and its members (trigger); refused while a KPI uses it or members have figures. */
export async function deleteDimensionAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id } = companyItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("kpi_dimensions")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) {
      if (isForeignKeyViolation(error)) throw new ActionError(DIMENSION_IN_USE);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** The dimension id of a member of one of the company's dimensions (not found otherwise). */
async function memberDimension(sb: Sb, companyId: string, memberId: string): Promise<string> {
  const { data, error } = await sb
    .from("kpi_dimension_members")
    .select("id, dimension_id, dimension:kpi_dimensions!kpi_dimension_members_dimension_id_fkey(company_id)")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  const member: { id: string; dimension_id: string; dimension: { company_id: string } | null } | null = data;
  if (!member || member.dimension?.company_id !== companyId) throw notFound();
  return member.dimension_id;
}

async function loadMembers(sb: Sb, dimensionId: string): Promise<SortableRow[]> {
  const { data, error } = await sb
    .from("kpi_dimension_members")
    .select("id, name, sort_order, is_active")
    .eq("dimension_id", dimensionId);
  if (error) throw error;
  const rows: SortableRow[] = data;
  return rows;
}

export async function addDimensionMemberAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, dimensionId, name } = addMemberSchema.parse(input);
    const sb = await createClient();
    const { data: dimensionData, error: dimensionError } = await sb
      .from("kpi_dimensions")
      .select("id")
      .eq("id", dimensionId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (dimensionError) throw dimensionError;
    const dimension: { id: string } | null = dimensionData;
    if (!dimension) throw notFound();

    const members = await loadMembers(sb, dimension.id);
    const { error } = await sb
      .from("kpi_dimension_members")
      .insert({ dimension_id: dimension.id, name, sort_order: nextSortOrder(members) });
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", MEMBER_TAKEN);
      throw error;
    }
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function renameDimensionMemberAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, name } = renameItemSchema.parse(input);
    const sb = await createClient();
    await memberDimension(sb, companyId, id);
    const { data, error } = await sb.from("kpi_dimension_members").update({ name }).eq("id", id).select("id");
    if (error) {
      if (isUniqueViolation(error)) throw fieldError("name", MEMBER_TAKEN);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveDimensionMemberAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, direction } = moveItemSchema.parse(input);
    const sb = await createClient();
    const dimensionId = await memberDimension(sb, companyId, id);
    const members = await loadMembers(sb, dimensionId);
    await applySortOrders(planMove(members, id, direction), (row) =>
      sb
        .from("kpi_dimension_members")
        .update({ sort_order: row.sort_order })
        .eq("id", row.id)
        .eq("dimension_id", dimensionId),
    );
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setDimensionMemberActiveAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, active } = setItemActiveSchema.parse(input);
    const sb = await createClient();
    await memberDimension(sb, companyId, id);
    const { data, error } = await sb
      .from("kpi_dimension_members")
      .update({ is_active: active })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteDimensionMemberAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id } = companyItemSchema.parse(input);
    const sb = await createClient();
    await memberDimension(sb, companyId, id);
    const { data, error } = await sb.from("kpi_dimension_members").delete().eq("id", id).select("id");
    if (error) {
      if (isForeignKeyViolation(error)) throw new ActionError(MEMBER_IN_USE);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// KPIs (Super Admin, Fund Admin; BRD §6.2, A4)
// ---------------------------------------------------------------------------------------------

const KPI_TAKEN = "There's already a KPI with this name.";
const KPI_IN_USE = "This KPI has figures in past months, so it can't be deleted. Deactivate it instead.";

async function loadKpis(sb: Sb, companyId: string): Promise<SortableRow[]> {
  const { data, error } = await sb
    .from("company_kpis")
    .select("id, name, sort_order, is_active")
    .eq("company_id", companyId);
  if (error) throw error;
  const rows: SortableRow[] = data;
  return rows;
}

async function kpiHasFigures(sb: Sb, kpiId: string): Promise<boolean> {
  const { data, error } = await sb.from("submission_kpi_values").select("id").eq("kpi_id", kpiId).limit(1);
  if (error) throw error;
  const rows: { id: string }[] = data;
  return rows.length > 0;
}

/**
 * Adds a KPI (after the existing ones) or updates one. Once a KPI has figures its value type can only
 * change between the number types and its dimension cannot change (./_components/kpi-rules.ts).
 */
export async function saveKpiAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const values = kpiSchema.parse(input);
    const sb = await createClient();

    if (values.dimensionId) {
      const { data, error } = await sb
        .from("kpi_dimensions")
        .select("id")
        .eq("id", values.dimensionId)
        .eq("company_id", values.companyId)
        .maybeSingle();
      if (error) throw error;
      const dimension: { id: string } | null = data;
      if (!dimension) throw fieldError("dimensionId", "Choose a dimension from the list.");
    }

    const fields = {
      name: values.name,
      description: values.description,
      unit: values.unit,
      value_type: values.valueType,
      frequency: values.frequency,
      dimension_id: values.dimensionId,
      is_required: values.isRequired,
      is_active: values.isActive,
    };

    if (values.id) {
      const { data: currentData, error: currentError } = await sb
        .from("company_kpis")
        .select("id, value_type, dimension_id")
        .eq("id", values.id)
        .eq("company_id", values.companyId)
        .maybeSingle();
      if (currentError) throw currentError;
      const current: { id: string; value_type: KpiValueType; dimension_id: string | null } | null = currentData;
      if (!current) throw notFound();
      const changesShape = current.value_type !== values.valueType || current.dimension_id !== values.dimensionId;
      if (changesShape) {
        const locked = lockedKpiChange(current, values, await kpiHasFigures(sb, current.id));
        if (locked) throw fieldError(locked.field, locked.message);
      }
      const { data, error } = await sb
        .from("company_kpis")
        .update(fields)
        .eq("id", current.id)
        .eq("company_id", values.companyId)
        .select("id");
      if (error) {
        if (isUniqueViolation(error)) throw fieldError("name", KPI_TAKEN);
        throw error;
      }
      expectRow(data);
    } else {
      const kpis = await loadKpis(sb, values.companyId);
      const { error } = await sb
        .from("company_kpis")
        .insert({ company_id: values.companyId, sort_order: nextSortOrder(kpis), ...fields });
      if (error) {
        if (isUniqueViolation(error)) throw fieldError("name", KPI_TAKEN);
        throw error;
      }
    }

    revalidateCompany(values.companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function moveKpiAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, direction } = moveItemSchema.parse(input);
    const sb = await createClient();
    const kpis = await loadKpis(sb, companyId);
    if (!kpis.some((kpi) => kpi.id === id)) throw notFound();
    await applySortOrders(planMove(kpis, id, direction), (row) =>
      sb.from("company_kpis").update({ sort_order: row.sort_order }).eq("id", row.id).eq("company_id", companyId),
    );
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setKpiActiveAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id, active } = setItemActiveSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("company_kpis")
      .update({ is_active: active })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) throw error;
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteKpiAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(CONFIG_ROLES);
    const { companyId, id } = companyItemSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("company_kpis")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) {
      if (isForeignKeyViolation(error)) throw new ActionError(KPI_IN_USE);
      throw error;
    }
    expectRow(data);
    revalidateCompany(companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// ScaleUp-internal fields (company_internal; never shown to companies, BRD §6.3, B24)
// ---------------------------------------------------------------------------------------------

/** Assigns or clears the partner-in-charge — Super Admin only (the company_internal guard agrees). */
export async function assignPartnerAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const { companyId, partnerId } = assignPartnerSchema.parse(input);
    const sb = await createClient();
    if (partnerId) await assertPartnerCandidate(sb, partnerId, "partnerId");
    const { data, error } = await sb
      .from("company_internal")
      .update({ partner_in_charge_id: partnerId })
      .eq("company_id", companyId)
      .select("company_id");
    if (error) throw error;
    expectRow(data);

    revalidateCompany(companyId, "/admin/companies", "/admin/tracker");
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Saves the internal rating, exit strategy and notes — Super Admin, Fund Admin, the partner-in-charge. */
export async function updateInternalFieldsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await assertScaleUp(INTERNAL_ROLES);
    const values = internalFieldsSchema.parse(input);
    const sb = await createClient();
    if (ctx.scaleupRole === "partner") {
      const internal = await getCompanyInternal(sb, values.companyId);
      if (!canEditInternal(ctx, internal)) throw new ActionError(MESSAGES.permission);
    }
    // The partner-in-charge is not part of this update, so Fund Admins and partners never touch it.
    const { data, error } = await sb
      .from("company_internal")
      .update({
        internal_rating: values.internalRating,
        exit_strategy_status: values.exitStrategyStatus,
        exit_strategy_notes: values.exitStrategyNotes,
        notes: values.notes,
      })
      .eq("company_id", values.companyId)
      .select("company_id");
    if (error) throw error;
    expectRow(data);

    revalidateCompany(values.companyId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
