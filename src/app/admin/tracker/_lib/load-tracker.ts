import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toActionError } from "@/lib/actions/result";
import { DEFAULT_ESCALATION_DAYS } from "@/lib/constants";
import { DataError, getPlatformSettings, isNotFoundError } from "@/lib/data";
import { fetchAllRows } from "@/lib/fetch-all";
import { isDateKey, monthKeyToDate, parseMonthKey, todayMYT } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";

import {
  TRACKER_MAX_MONTHS,
  toTrackerCompany,
  toTrackerSubmission,
  type TrackerCompany,
  type TrackerCompanyRow,
  type TrackerData,
  type TrackerFund,
  type TrackerMonth,
  type TrackerOverviewRow,
  type TrackerSubmission,
} from "./tracker-model";

// Data for /admin/tracker (docs/ARCHITECTURE.md §6 "Tracker"): ScaleUp staff only, read with the
// RLS-scoped client. The grid is built from it on the client (tracker-model.ts).

type Client = SupabaseClient<Database>;

export type TrackerLoad = {
  data: TrackerData;
  /** Friendly message when open_due_periods() failed (e.g. no published default template). */
  openError: string | null;
  /**
   * Unique per load. The page keys the client workspace with it, so every server render (a navigation
   * to the tracker, e.g. the sidebar link) starts from the URL's filters instead of the previous state.
   */
  loadId: string;
};

const COMPANY_SELECT =
  "id, name, status, reporting_start_month, fund_investments(fund:funds(id, code, name)), company_internal(partner_in_charge_id, partner:profiles!company_internal_partner_in_charge_id_fkey(id, full_name, email))";

const OVERVIEW_SELECT =
  "id, company_id, month, status, due_date, original_due_date, submitted_at, approved_at, revision, is_overdue, days_overdue, has_narrative, open_threads";

function loadError(what: string, error: { message: string; code?: string }): DataError {
  return new DataError("loadTracker", `could not load ${what}: ${error.message}`, { code: error.code, cause: error });
}

/**
 * Opens every month that is due (idempotent; the contract has the tracker call it on load). A failure
 * does not stop the page: the grid shows what is open and the message explains why nothing new opened.
 */
async function openDueMonths(sb: Client): Promise<string | null> {
  const { error } = await sb.rpc("open_due_periods");
  if (!error) return null;
  console.error("[tracker] open_due_periods failed", error.code, error.message);
  const result = toActionError(error);
  return result.ok ? null : result.error;
}

/** The latest TRACKER_MAX_MONTHS open months (reporting_periods), newest first. */
async function loadMonths(sb: Client): Promise<TrackerMonth[]> {
  const { data, error } = await sb
    .from("reporting_periods")
    .select("month, due_date")
    .order("month", { ascending: false })
    .limit(TRACKER_MAX_MONTHS);
  if (error) throw loadError("the open months", error);
  const rows: { month: string; due_date: string }[] = data;
  return rows.flatMap((row) => {
    const month = parseMonthKey(row.month);
    return month && isDateKey(row.due_date) ? [{ month, dueDate: row.due_date }] : [];
  });
}

/** Every company with its funds and partner-in-charge (company_internal is ScaleUp-only). */
async function loadCompanies(sb: Client): Promise<TrackerCompany[]> {
  const { data, error } = await sb.from("companies").select(COMPANY_SELECT).order("name", { ascending: true });
  if (error) throw loadError("the companies", error);
  const rows: TrackerCompanyRow[] = data;
  return rows.map(toTrackerCompany);
}

async function loadFunds(sb: Client): Promise<TrackerFund[]> {
  const { data, error } = await sb.from("funds").select("id, code, name").order("code", { ascending: true });
  if (error) throw loadError("the funds", error);
  const rows: TrackerFund[] = data;
  return rows;
}

/** platform_settings.escalation_days (ScaleUp-only); the default when the row is missing. */
async function loadEscalationDays(sb: Client): Promise<number> {
  try {
    const settings = await getPlatformSettings(sb);
    return settings.escalation_days;
  } catch (e) {
    if (isNotFoundError(e)) return DEFAULT_ESCALATION_DAYS;
    throw e;
  }
}

/** The v_submission_overview rows of the loaded months (paged: companies × 12 can pass max_rows). */
async function loadSubmissions(sb: Client, months: TrackerMonth[]): Promise<TrackerSubmission[]> {
  if (months.length === 0) return [];
  const keys = months.map((month) => month.month).sort();
  const from = monthKeyToDate(keys[0]);
  const to = monthKeyToDate(keys[keys.length - 1]);
  const rows = await fetchAllRows<TrackerOverviewRow>(async (start, end) => {
    const { data, error, count } = await sb
      .from("v_submission_overview")
      .select(OVERVIEW_SELECT, { count: "exact" })
      .gte("month", from)
      .lte("month", to)
      .order("month", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end);
    const page: TrackerOverviewRow[] | null = data;
    return { data: page, error: error ? loadError("the monthly updates", error) : null, count };
  });
  return rows.flatMap((row) => toTrackerSubmission(row) ?? []);
}

/**
 * Opens due months, then loads the portfolio for the tracker in parallel (the monthly updates as soon
 * as the open months are known). Throws a DataError when a query fails.
 */
export async function loadTracker(sb: Client, currentUserId: string): Promise<TrackerLoad> {
  const openError = await openDueMonths(sb);
  const monthsPromise = loadMonths(sb);
  const [months, companies, funds, escalationDays, submissions] = await Promise.all([
    monthsPromise,
    loadCompanies(sb),
    loadFunds(sb),
    loadEscalationDays(sb),
    monthsPromise.then((months) => loadSubmissions(sb, months)),
  ]);
  return {
    data: { months, companies, submissions, funds, escalationDays, today: todayMYT(), currentUserId },
    openError,
    loadId: randomUUID(),
  };
}
