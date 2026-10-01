import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_DUE_DAY } from "@/lib/constants";
import {
  DataError,
  getClientSettings,
  getCompany,
  getFinancialSeries,
  getStaffDisplayNames,
  listCompanySubmissions,
} from "@/lib/data";
import { todayMYT } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";

import { changeEventActorIds, type ChangeEvent, type HomeClose, type HomeData, type HomeManagementAccounts } from "./home-model";

// Data for the company home (/portal/[companyId]), read with the RLS-scoped client as the company user:
// only this company's rows and shared comment threads. ScaleUp people are named "<full name> (ScaleUp)"
// through staff_display_names only (BRD B24, B28): no ScaleUp profile, email, role or partner-in-charge.

type Client = SupabaseClient<Database>;

function loadError(what: string, error: { message: string; code?: string }): DataError {
  return new DataError("loadHome", `could not load ${what}: ${error.message}`, { code: error.code, cause: error });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Opens the months that are due (the contract has the home call open_due_periods() on load; company
 * users always get 0 back, but their months still open). A failure never blocks the page.
 */
async function openDueMonths(sb: Client): Promise<void> {
  const { error } = await sb.rpc("open_due_periods");
  if (error) console.error("[portal home] open_due_periods failed", error.code, error.message);
}

/** platform_settings.due_day (get_client_settings); the default when it cannot be read (it only words "due by"). */
async function loadDueDay(sb: Client): Promise<number> {
  try {
    return (await getClientSettings(sb)).due_day;
  } catch (e) {
    console.error("[portal home] could not load the due day", errorText(e));
    return DEFAULT_DUE_DAY;
  }
}

async function loadCloses(sb: Client, companyId: string): Promise<HomeClose[]> {
  const { data, error } = await sb
    .from("period_closes")
    .select("id, period_type, period_start, period_end, label, status, confirmed_at")
    .eq("company_id", companyId)
    .order("period_end", { ascending: true });
  if (error) throw loadError("the quarter and half closes", error);
  const rows: HomeClose[] = data;
  return rows;
}

async function loadManagementAccounts(sb: Client, companyId: string): Promise<HomeManagementAccounts[]> {
  const { data, error } = await sb
    .from("documents")
    .select("id, period_close_id, version, uploaded_at")
    .eq("company_id", companyId)
    .eq("doc_type", "management_accounts")
    .not("period_close_id", "is", null);
  if (error) throw loadError("the management accounts", error);
  const rows: HomeManagementAccounts[] = data;
  return rows;
}

/** The messages of the months ScaleUp sent back, newest first (only queried when there are any). */
async function loadChangeEvents(sb: Client, submissionIds: string[]): Promise<ChangeEvent[]> {
  if (submissionIds.length === 0) return [];
  const { data, error } = await sb
    .from("submission_events")
    .select("id, submission_id, event, actor_id, message, created_at")
    .in("submission_id", submissionIds)
    .in("event", ["changes_requested", "reopened"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw loadError("the change requests", error);
  const rows: ChangeEvent[] = data;
  return rows;
}

/**
 * "<full name> (ScaleUp)" for the people who sent months back (BRD B28; one request, none without
 * actors). When the names cannot be loaded the requests still show, signed "ScaleUp".
 */
async function loadStaffNames(sb: Client, events: readonly ChangeEvent[]): Promise<Record<string, string>> {
  const ids = changeEventActorIds(events);
  if (ids.length === 0) return {};
  try {
    return await getStaffDisplayNames(sb, ids);
  } catch (e) {
    console.error("[portal home] could not load the names of ScaleUp staff", errorText(e));
    return {};
  }
}

/**
 * Everything the home page shows, or null when the company is not visible. Opens due months first,
 * then reads in parallel; the change-request messages (and their authors' names) follow only when a
 * month has been sent back. Throws a DataError when a query fails.
 */
export async function loadHome(sb: Client, companyId: string): Promise<HomeData | null> {
  await openDueMonths(sb);
  const [company, submissions, series, dueDay, closes, managementAccounts] = await Promise.all([
    getCompany(sb, companyId),
    listCompanySubmissions(sb, companyId),
    getFinancialSeries(sb, companyId),
    loadDueDay(sb),
    loadCloses(sb, companyId),
    loadManagementAccounts(sb, companyId),
  ]);
  if (!company) return null;
  const sentBack = submissions.filter((s) => s.status === "changes_requested").map((s) => s.id);
  const changeEvents = await loadChangeEvents(sb, sentBack);
  const staffNames = await loadStaffNames(sb, changeEvents);
  return {
    company,
    submissions,
    series,
    changeEvents,
    staffNames,
    closes,
    managementAccounts,
    dueDay,
    today: todayMYT(),
  };
}
