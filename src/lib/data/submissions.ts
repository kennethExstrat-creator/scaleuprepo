import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addMonths, dateToMonthKey, monthKeyToDate, parseMonthKey } from "@/lib/periods";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  emptySubmissionValues,
  toMonthlyFinancials,
  type SubmissionBundle,
  type SubmissionEventWithActor,
  type SubmissionKpiValueRow,
  type SubmissionOverviewRow,
  type SubmissionRow,
  type SubmissionSegmentValueRow,
  type SubmissionSnapshot,
  type SubmissionValidation,
  type SubmissionValueRow,
  type SubmissionValues,
} from "@/lib/types/domain";
import type { ValidationIssue } from "@/lib/validation";

import { getCompanyConfig } from "./companies";
import { DataError, notFoundError, queryError } from "./errors";
import { findPlatformSettings, getClientSettings } from "./settings";
import {
  buildSubmissionValues,
  displayName,
  isUuid,
  sortByMonthDesc,
  sortEvents,
  toOverviewRow,
} from "./shared";
import { getStaffDisplayNames } from "./staff";
import { getTemplateVersion } from "./templates";

// A submission with all its stored values, in one request.
const SUBMISSION_WITH_VALUES_SELECT =
  "*, field_values:submission_values!submission_values_submission_id_fkey(*), segment_values:submission_segment_values!submission_segment_values_submission_id_fkey(*), kpi_values:submission_kpi_values!submission_kpi_values_submission_id_fkey(*)";

type SubmissionWithValuesRow = SubmissionRow & {
  field_values: SubmissionValueRow[];
  segment_values: SubmissionSegmentValueRow[];
  kpi_values: SubmissionKpiValueRow[];
};

function splitSubmission(row: SubmissionWithValuesRow): { submission: SubmissionRow; values: SubmissionValues } {
  const { field_values, segment_values, kpi_values, ...submission } = row;
  return {
    submission,
    values: buildSubmissionValues(field_values ?? [], segment_values ?? [], kpi_values ?? []),
  };
}

/** 'YYYY-MM' or 'YYYY-MM-DD' → the stored month date ('YYYY-MM-01'); null when malformed. */
function toMonthDate(month: string): string | null {
  const key = parseMonthKey(month);
  return key ? monthKeyToDate(key) : null;
}

// ---------------------------------------------------------------------------------------------
// Single submissions
// ---------------------------------------------------------------------------------------------

/** The submission, or null when it does not exist or the caller may not see its company. */
export async function getSubmission(sb: SupabaseClient<Database>, submissionId: string): Promise<SubmissionRow | null> {
  if (!isUuid(submissionId)) return null;
  const { data, error } = await sb.from("submissions").select("*").eq("id", submissionId).maybeSingle();
  if (error) throw queryError("getSubmission", `load monthly update ${submissionId}`, error);
  return data;
}

/**
 * The company's submission for a month ('YYYY-MM' or 'YYYY-MM-DD', e.g. a `[month]` route param), or null
 * when there is none, it is not visible, or the month is malformed.
 */
export async function getSubmissionByMonth(
  sb: SupabaseClient<Database>,
  companyId: string,
  month: string,
): Promise<SubmissionRow | null> {
  const monthDate = toMonthDate(month);
  if (!isUuid(companyId) || !monthDate) return null;
  const { data, error } = await sb
    .from("submissions")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", monthDate)
    .maybeSingle();
  if (error) throw queryError("getSubmissionByMonth", `load the ${monthDate} update of company ${companyId}`, error);
  return data;
}

/**
 * A submission's stored values keyed by field key, segment id and KPI cell key (three parallel queries).
 * Empty maps when nothing is saved or the submission is not visible.
 */
export async function getSubmissionValues(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<SubmissionValues> {
  const op = "getSubmissionValues";
  if (!isUuid(submissionId)) return emptySubmissionValues();
  const [valuesRes, segmentsRes, kpisRes] = await Promise.all([
    sb.from("submission_values").select("*").eq("submission_id", submissionId),
    sb.from("submission_segment_values").select("*").eq("submission_id", submissionId),
    sb.from("submission_kpi_values").select("*").eq("submission_id", submissionId),
  ]);
  if (valuesRes.error) throw queryError(op, `load the values of monthly update ${submissionId}`, valuesRes.error);
  if (segmentsRes.error) {
    throw queryError(op, `load the segment revenue of monthly update ${submissionId}`, segmentsRes.error);
  }
  if (kpisRes.error) throw queryError(op, `load the KPI values of monthly update ${submissionId}`, kpisRes.error);
  return buildSubmissionValues(valuesRes.data, segmentsRes.data, kpisRes.data);
}

/**
 * A submission's timeline (submitted, changes requested, approved, …), oldest first, with each actor's
 * name as the caller may see it:
 * - `actor` is the actor's profile when the caller may read it, else null — for company users every
 *   ScaleUp actor (RLS hides ScaleUp staff profiles from them: no email or role, BRD B24/B28);
 * - `actor_name` is the full name (else email) of a readable profile; for actors whose profile is hidden,
 *   the ScaleUp display name "<full name> (ScaleUp)" from getStaffDisplayNames (BRD B28: company users
 *   see who at ScaleUp sent a month back or approved it); null without an actor (the system) or for
 *   someone who cannot be named. Show `actor_name ?? SCALEUP_LABEL`.
 * ScaleUp staff read every profile, so their timeline needs one request; company users' timelines with
 * ScaleUp actors need a second one (staff_display_names).
 */
export async function listSubmissionEvents(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<SubmissionEventWithActor[]> {
  if (!isUuid(submissionId)) return [];
  const { data, error } = await sb
    .from("submission_events")
    .select("*, actor:profiles!submission_events_actor_id_fkey(id, full_name, email, scaleup_role)")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw queryError("listSubmissionEvents", `load the timeline of monthly update ${submissionId}`, error);
  const events: SubmissionEventWithActor[] = data.map(({ actor, ...event }) => ({
    ...event,
    actor: actor ?? null,
    actor_name: displayName(actor),
  }));
  // Actors whose profile the caller cannot read: ScaleUp staff seen from the company side get their
  // "(ScaleUp)" display name; anyone else stays unnamed.
  const hidden = events.flatMap((event) => (event.actor === null && event.actor_id !== null ? [event.actor_id] : []));
  if (hidden.length > 0) {
    const names = await getStaffDisplayNames(sb, hidden);
    for (const event of events) {
      if (event.actor === null && event.actor_id !== null) event.actor_name = names[event.actor_id.toLowerCase()] ?? null;
    }
  }
  return sortEvents(events);
}

// ---------------------------------------------------------------------------------------------
// Bundle (monthly form and review page)
// ---------------------------------------------------------------------------------------------

/**
 * Everything the monthly form and the review page need for one submission, in two round trips:
 * 1. the submission with its stored values;
 * 2. in parallel: the company config (getCompanyConfig), the submission's own template version
 *    (getTemplateVersion), the prior month (month − 1) and the same month last year (month − 12) of the
 *    same company with their values (either may be missing → null), the timeline with actor names
 *    (oldest first; listSubmissionEvents), the client settings (every user) and the full platform
 *    settings (ScaleUp staff; null for company users).
 * (For company users whose timeline has ScaleUp actors, the timeline adds one request for their
 * "(ScaleUp)" display names.)
 * `financials` are the current month's system numbers. Nothing ScaleUp-internal is included for company
 * users: the partner-in-charge lives in company_internal (getCompanyInternal), and ScaleUp staff profiles
 * stay hidden from them (no email or role; ids such as `submission.approved_by` resolve to no profile they
 * can read) — the timeline names ScaleUp people "<full name> (ScaleUp)" (BRD B28). Returns null when the
 * submission does not exist or is not visible.
 */
export async function getSubmissionBundle(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<SubmissionBundle | null> {
  const op = "getSubmissionBundle";
  if (!isUuid(submissionId)) return null;
  const { data, error } = await sb
    .from("submissions")
    .select(SUBMISSION_WITH_VALUES_SELECT)
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw queryError(op, `load monthly update ${submissionId}`, error);
  return data ? assembleBundle(sb, op, data) : null;
}

/**
 * getSubmissionBundle for the company's month ('YYYY-MM' or 'YYYY-MM-DD', e.g. a `[month]` route param),
 * without a separate lookup of the submission id. Null when there is no submission for that month, it is
 * not visible, or the month is malformed.
 */
export async function getSubmissionBundleByMonth(
  sb: SupabaseClient<Database>,
  companyId: string,
  month: string,
): Promise<SubmissionBundle | null> {
  const op = "getSubmissionBundleByMonth";
  const monthDate = toMonthDate(month);
  if (!isUuid(companyId) || !monthDate) return null;
  const { data, error } = await sb
    .from("submissions")
    .select(SUBMISSION_WITH_VALUES_SELECT)
    .eq("company_id", companyId)
    .eq("month", monthDate)
    .maybeSingle();
  if (error) throw queryError(op, `load the ${monthDate} update of company ${companyId}`, error);
  return data ? assembleBundle(sb, op, data) : null;
}

async function assembleBundle(
  sb: SupabaseClient<Database>,
  op: string,
  row: SubmissionWithValuesRow,
): Promise<SubmissionBundle> {
  const { submission, values: current } = splitSubmission(row);
  const previousMonth = monthKeyToDate(addMonths(submission.month, -1));
  const lastYearMonth = monthKeyToDate(addMonths(submission.month, -12));

  const [config, template, siblingsRes, events, clientSettings, settings] = await Promise.all([
    getCompanyConfig(sb, submission.company_id),
    getTemplateVersion(sb, submission.template_version_id),
    sb
      .from("submissions")
      .select(SUBMISSION_WITH_VALUES_SELECT)
      .eq("company_id", submission.company_id)
      .in("month", [previousMonth, lastYearMonth]),
    listSubmissionEvents(sb, submission.id),
    getClientSettings(sb),
    findPlatformSettings(sb, op),
  ]);
  if (siblingsRes.error) {
    throw queryError(
      op,
      `load the ${previousMonth} and ${lastYearMonth} updates of company ${submission.company_id}`,
      siblingsRes.error,
    );
  }

  const byMonth = new Map(
    siblingsRes.data.map((sibling) => {
      const split = splitSubmission(sibling);
      return [dateToMonthKey(split.submission.month), split] as const;
    }),
  );
  const snapshot = (month: string): SubmissionSnapshot | null => {
    const found = byMonth.get(dateToMonthKey(month));
    return found ? { ...found, financials: toMonthlyFinancials(found.submission.month, found.values) } : null;
  };

  return {
    submission,
    company: config.company,
    config,
    template,
    current,
    previous: snapshot(previousMonth),
    lastYear: snapshot(lastYearMonth),
    events,
    financials: toMonthlyFinancials(submission.month, current),
    clientSettings,
    settings,
  };
}

// ---------------------------------------------------------------------------------------------
// Lists and validation
// ---------------------------------------------------------------------------------------------

/**
 * The company's submissions from v_submission_overview (status, due dates, overdue flags, narrative
 * filled, unresolved threads), newest month first. [] when none are visible.
 */
export async function listCompanySubmissions(
  sb: SupabaseClient<Database>,
  companyId: string,
): Promise<SubmissionOverviewRow[]> {
  if (!isUuid(companyId)) return [];
  const { data, error } = await sb
    .from("v_submission_overview")
    .select("*")
    .eq("company_id", companyId)
    .order("month", { ascending: false });
  if (error) throw queryError("listCompanySubmissions", `load the monthly updates of company ${companyId}`, error);
  return sortByMonthDesc(data.flatMap((row) => toOverviewRow(row) ?? []));
}

type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIssue(value: Json | undefined): ValidationIssue | null {
  if (!isJsonObject(value)) return null;
  const { target, code, message } = value;
  if (typeof target !== "string" || typeof code !== "string" || typeof message !== "string") return null;
  return { target, code, message };
}

/**
 * The server-side validation of a submission (`get_submission_validation`, §2.6 rules 1–6 including
 * `prior_months`), e.g. before submitting or for the review page's "blank required fields" flag. Issues
 * keep the database's order and messages. The RPC raises 42501 (kept as the DataError's `code`) when the
 * submission does not exist or is not visible.
 */
export async function getSubmissionValidation(
  sb: SupabaseClient<Database>,
  submissionId: string,
): Promise<SubmissionValidation> {
  const op = "getSubmissionValidation";
  if (!isUuid(submissionId)) throw notFoundError(op, `monthly update ${JSON.stringify(submissionId)}`);
  const { data, error } = await sb.rpc("get_submission_validation", { p_submission_id: submissionId });
  if (error) throw queryError(op, `validate monthly update ${submissionId}`, error);
  if (!isJsonObject(data) || !Array.isArray(data.errors)) {
    throw new DataError(op, `get_submission_validation returned an unexpected result for ${submissionId}`);
  }
  const errors = data.errors.flatMap((item) => toIssue(item) ?? []);
  return { ok: typeof data.ok === "boolean" ? data.ok && errors.length === 0 : errors.length === 0, errors };
}
