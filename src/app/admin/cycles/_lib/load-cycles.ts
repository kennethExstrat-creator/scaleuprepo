import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toActionError } from "@/lib/actions/result";
import { DEFAULT_BACKFILL_GRACE_DAYS, DEFAULT_DUE_DAY, DEFAULT_ESCALATION_DAYS } from "@/lib/constants";
import { DataError, getPlatformSettings, isNotFoundError } from "@/lib/data";
import { fetchAllRows } from "@/lib/fetch-all";
import { currentMonthMYT, parseMonthKey, todayMYT } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import type {
  ClosePeriodType,
  CompanyStatus,
  PeriodCloseStatus,
  SubmissionStatus,
  TemplateStatus,
} from "@/lib/types/enums";

import {
  buildCycleMonths,
  buildDeadlineChoices,
  buildExtensions,
  buildFxCurrencies,
  companiesReportingIn,
  currenciesInUse,
  fxMonthRange,
  groupCloses,
  isDeadlineEventKind,
  openEarlyPreview,
  summariseOverdue,
  upcomingCloses,
  type CloseInput,
  type CompanyInput,
  type CyclesData,
  type ExtensionEventInput,
  type ExtensionInput,
  type FxRateInput,
  type NameMap,
  type OverviewInput,
  type PeriodInput,
} from "./cycles-model";

// Data for /admin/cycles (module M4, BRD A5): Super Admins and Fund Admins, read with the RLS-scoped client
// (every table here is readable by ScaleUp staff; fx_rates and platform_settings are ScaleUp-only).

type Client = SupabaseClient<Database>;

export type { CyclesData };

export type CyclesLoad = {
  data: CyclesData;
  /** Friendly message when open_due_periods() failed (e.g. no published default template). */
  openError: string | null;
};

const OVERVIEW_SELECT = "id, company_id, month, status, due_date, original_due_date, is_overdue, days_overdue";

type OverviewRow = {
  id: string | null;
  company_id: string | null;
  month: string | null;
  status: SubmissionStatus | null;
  due_date: string | null;
  original_due_date: string | null;
  is_overdue: boolean | null;
  days_overdue: number | null;
};

type PeriodRow = {
  month: string;
  due_date: string;
  opened_at: string;
  opened_by: string | null;
  template_version: {
    version_no: number;
    status: TemplateStatus;
    template: { name: string } | null;
  } | null;
};

type CompanyRowLite = {
  id: string;
  name: string;
  status: CompanyStatus;
  reporting_start_month: string | null;
  reporting_currency: string;
};

type ExtensionRow = {
  id: string;
  company_id: string;
  month: string;
  status: SubmissionStatus;
  due_date: string;
  original_due_date: string | null;
  extension_reason: string | null;
};

type SendBackEventRow = {
  id: number;
  submission_id: string;
  event: string;
  actor_id: string | null;
  created_at: string;
};

type ExtensionEventRow = SendBackEventRow & { message: string | null };

type CloseRow = {
  id: string;
  company_id: string;
  period_type: ClosePeriodType;
  period_start: string;
  period_end: string;
  label: string;
  status: PeriodCloseStatus;
};

type DefaultTemplateRow = {
  name: string;
  template_versions: { version_no: number; status: TemplateStatus }[];
};

type ProfileName = { id: string; full_name: string | null; email: string };

function loadError(what: string, error: { message: string; code?: string }): DataError {
  return new DataError("loadCycles", `could not load ${what}: ${error.message}`, { code: error.code, cause: error });
}

/**
 * Opens every month that is due (idempotent; BRD A5 "monthly cycles open automatically"). A failure does
 * not stop the page: it shows what is open and explains why nothing new opened.
 */
async function openDueMonths(sb: Client): Promise<string | null> {
  const { error } = await sb.rpc("open_due_periods");
  if (!error) return null;
  console.error("[cycles] open_due_periods failed", error.code, error.message);
  const result = toActionError(error);
  return result.ok ? null : result.error;
}

async function loadPeriods(sb: Client): Promise<PeriodInput[]> {
  const { data, error } = await sb
    .from("reporting_periods")
    .select("month, due_date, opened_at, opened_by, template_version:template_versions(version_no, status, template:templates(name))")
    .order("month", { ascending: false });
  if (error) throw loadError("the reporting months", error);
  const rows: PeriodRow[] = data;
  return rows.map((row) => ({
    month: row.month,
    due_date: row.due_date,
    opened_at: row.opened_at,
    opened_by: row.opened_by,
    template: row.template_version
      ? {
          name: row.template_version.template?.name ?? "Template",
          versionNo: row.template_version.version_no,
          status: row.template_version.status,
        }
      : null,
  }));
}

async function loadOverview(sb: Client): Promise<OverviewInput[]> {
  const rows = await fetchAllRows<OverviewRow>(async (from, to) => {
    const { data, error, count } = await sb
      .from("v_submission_overview")
      .select(OVERVIEW_SELECT, { count: "exact" })
      .order("month", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    const page: OverviewRow[] | null = data;
    return { data: page, error: error ? loadError("the monthly updates", error) : null, count };
  });
  return rows.flatMap((row): OverviewInput[] =>
    row.id && row.company_id && row.month && row.status && row.due_date
      ? [
          {
            id: row.id,
            company_id: row.company_id,
            month: row.month,
            status: row.status,
            due_date: row.due_date,
            original_due_date: row.original_due_date,
            is_overdue: row.is_overdue === true,
            days_overdue: row.days_overdue ?? 0,
          },
        ]
      : [],
  );
}

async function loadCompanies(sb: Client): Promise<CompanyInput[]> {
  const { data, error } = await sb
    .from("companies")
    .select("id, name, status, reporting_start_month, reporting_currency")
    .order("name", { ascending: true });
  if (error) throw loadError("the companies", error);
  const rows: CompanyRowLite[] = data;
  return rows;
}

async function loadExtensions(sb: Client): Promise<ExtensionInput[]> {
  const rows = await fetchAllRows<ExtensionRow>(async (from, to) => {
    const { data, error, count } = await sb
      .from("submissions")
      .select("id, company_id, month, status, due_date, original_due_date, extension_reason", { count: "exact" })
      .not("original_due_date", "is", null)
      .order("month", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    const page: ExtensionRow[] | null = data;
    return { data: page, error: error ? loadError("the deadline extensions", error) : null, count };
  });
  return rows.flatMap((row): ExtensionInput[] =>
    row.original_due_date ? [{ ...row, original_due_date: row.original_due_date }] : [],
  );
}

function toEventInputs(rows: readonly (SendBackEventRow & { message?: string | null })[]): ExtensionEventInput[] {
  return rows.flatMap((row): ExtensionEventInput[] =>
    isDeadlineEventKind(row.event)
      ? [
          {
            id: row.id,
            submission_id: row.submission_id,
            event: row.event,
            actor_id: row.actor_id,
            created_at: row.created_at,
            message: row.message ?? null,
          },
        ]
      : [],
  );
}

/** The deadline extensions, with their message (it names the new due date). */
async function loadExtensionEvents(sb: Client): Promise<ExtensionEventInput[]> {
  const rows = await fetchAllRows<ExtensionEventRow>(async (from, to) => {
    const { data, error, count } = await sb
      .from("submission_events")
      .select("id, submission_id, event, actor_id, message, created_at", { count: "exact" })
      .eq("event", "deadline_extended")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    const page: ExtensionEventRow[] | null = data;
    return { data: page, error: error ? loadError("the deadline extension history", error) : null, count };
  });
  return toEventInputs(rows);
}

/**
 * Send-backs and reopenings, which move a due date that is too close (their messages, written to the
 * company, are not needed here).
 */
async function loadSendBackEvents(sb: Client): Promise<ExtensionEventInput[]> {
  const rows = await fetchAllRows<SendBackEventRow>(async (from, to) => {
    const { data, error, count } = await sb
      .from("submission_events")
      .select("id, submission_id, event, actor_id, created_at", { count: "exact" })
      .in("event", ["changes_requested", "reopened"])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);
    const page: SendBackEventRow[] | null = data;
    return { data: page, error: error ? loadError("the send-back history", error) : null, count };
  });
  return toEventInputs(rows);
}

async function loadCloses(sb: Client): Promise<CloseInput[]> {
  return fetchAllRows<CloseRow>(async (from, to) => {
    const { data, error, count } = await sb
      .from("period_closes")
      .select("id, company_id, period_type, period_start, period_end, label, status", { count: "exact" })
      .order("period_end", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    const page: CloseRow[] | null = data;
    return { data: page, error: error ? loadError("the period closes", error) : null, count };
  });
}

async function loadRates(sb: Client): Promise<FxRateInput[]> {
  return fetchAllRows<FxRateInput>(async (from, to) => {
    const { data, error, count } = await sb
      .from("fx_rates")
      .select("currency, month, rate_to_myr, updated_at, updated_by", { count: "exact" })
      .order("currency", { ascending: true })
      .order("month", { ascending: false })
      .range(from, to);
    const page: FxRateInput[] | null = data;
    return { data: page, error: error ? loadError("the FX rates", error) : null, count };
  });
}

/** The published version of the default template ("Portfolio Update v1"), or null. */
async function loadCurrentTemplateLabel(sb: Client): Promise<string | null> {
  const { data, error } = await sb
    .from("templates")
    .select("name, template_versions(version_no, status)")
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (error) throw loadError("the default template", error);
  const row: DefaultTemplateRow | null = data;
  const published = row?.template_versions.find((version) => version.status === "published");
  return row && published ? `${row.name} v${published.version_no}` : null;
}

type CycleSettings = { dueDay: number; graceDays: number; escalationDays: number; updatedAt: string | null };

async function loadSettings(sb: Client): Promise<CycleSettings> {
  try {
    const settings = await getPlatformSettings(sb);
    return {
      dueDay: settings.due_day,
      graceDays: settings.backfill_grace_days,
      escalationDays: settings.escalation_days,
      updatedAt: settings.updated_at,
    };
  } catch (e) {
    if (isNotFoundError(e)) {
      return {
        dueDay: DEFAULT_DUE_DAY,
        graceDays: DEFAULT_BACKFILL_GRACE_DAYS,
        escalationDays: DEFAULT_ESCALATION_DAYS,
        updatedAt: null,
      };
    }
    throw e;
  }
}

/** Display names of the given profiles (ScaleUp pages show plain names; email when the name is blank). */
async function loadNames(sb: Client, ids: Iterable<string | null>): Promise<NameMap> {
  const unique = [...new Set([...ids].filter((id): id is string => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return {};
  const names: Record<string, string> = {};
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    const { data, error } = await sb.from("profiles").select("id, full_name, email").in("id", chunk);
    if (error) throw loadError("the names of the people involved", error);
    const rows: ProfileName[] = data;
    for (const row of rows) names[row.id.toLowerCase()] = row.full_name?.trim() || row.email;
  }
  return names;
}

/**
 * Opens the months that are due, then loads everything /admin/cycles shows. Throws a DataError when a
 * query fails (the route's error boundary explains it).
 */
export async function loadCycles(sb: Client): Promise<CyclesLoad> {
  const openError = await openDueMonths(sb);
  const [
    periods,
    overview,
    companies,
    extensionRows,
    extensionEvents,
    sendBackEvents,
    closeRows,
    rates,
    templateLabel,
    settings,
  ] = await Promise.all([
    loadPeriods(sb),
    loadOverview(sb),
    loadCompanies(sb),
    loadExtensions(sb),
    loadExtensionEvents(sb),
    loadSendBackEvents(sb),
    loadCloses(sb),
    loadRates(sb),
    loadCurrentTemplateLabel(sb),
    loadSettings(sb),
  ]);

  // Only the events of the months listed (whose due date has moved).
  const extensionIds = new Set(extensionRows.map((row) => row.id));
  const events = [...extensionEvents, ...sendBackEvents].filter((event) => extensionIds.has(event.submission_id));
  const names = await loadNames(sb, [
    ...periods.map((period) => period.opened_by),
    ...events.map((event) => event.actor_id),
    ...rates.map((rate) => rate.updated_by),
  ]);

  const today = todayMYT();
  const currentMonth = currentMonthMYT();
  const months = buildCycleMonths(periods, overview, names);
  const openMonths = months.map((month) => month.month);
  const overdueById = new Map(overview.map((row) => [row.id, row.is_overdue] as const));
  const fx = buildFxCurrencies({ companies, rates, overview, openMonths, names });
  const knownFxMonths = rates.flatMap((rate) => parseMonthKey(rate.month) ?? []);

  return {
    data: {
      today,
      currentMonth,
      dueDay: settings.dueDay,
      graceDays: settings.graceDays,
      escalationDays: settings.escalationDays,
      settingsUpdatedAt: settings.updatedAt,
      months,
      overdue: summariseOverdue(overview, settings.escalationDays),
      openEarly: openEarlyPreview(currentMonth, openMonths, settings.dueDay, companies),
      currentTemplateLabel: templateLabel,
      extensions: buildExtensions({
        rows: extensionRows,
        events,
        companies,
        overdueById,
        names,
        graceDays: settings.graceDays,
      }),
      deadlineChoices: buildDeadlineChoices(overview, companies),
      closes: groupCloses(closeRows),
      upcoming: upcomingCloses(openMonths[0] ?? null, currentMonth, settings.dueDay, companies),
      fx,
      fxCurrencies: currenciesInUse(companies),
      fxRange: fxMonthRange([...knownFxMonths, ...openMonths], currentMonth),
      reportingCompanies: companiesReportingIn(companies, currentMonth).length,
    },
    openError,
  };
}
