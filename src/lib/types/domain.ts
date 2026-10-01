// Domain types for the data layer (src/lib/data/*, docs/ARCHITECTURE.md §5.5) and small bridge
// helpers from those types to the pure libs (src/lib/validation.ts, src/lib/metrics.ts).
//
// * Row aliases are the generated `Database` types (src/lib/supabase/database.types.ts), so they follow
//   the migrations after `npm run db:types`.
// * View rows (`SubmissionFinancialsRow`, `SubmissionOverviewRow`) are the generated view types with the
//   columns that can never be null narrowed to non-null (the generator types every view column as
//   nullable). The data layer checks those columns at runtime before returning a row.
// * Months are Postgres dates on the first of the month ('2026-09-01'); timestamps are ISO strings.
// * Everything here is plain data (no Map, Date or class instances), so it can be passed from Server
//   Components to Client Components.
//
// Client-safe: no server-only imports. Client Components may import these types (`import type`) and
// call the helpers, e.g. `validateSubmissionDraft(toValidationInput(bundle, liveValues))` in the form.

import { REVENUE_SEGMENT_NAME_MAX, REVENUE_SEGMENTS_MAX, type RevenueSegmentKind } from "@/lib/constants";
import { toFiniteNumber } from "@/lib/format";
import { financialsFromValues, type MonthlyFinancials } from "@/lib/metrics";
import { parseInstant } from "@/lib/periods";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import type { ValidationInput, ValidationIssue } from "@/lib/validation";

export type { Json, RevenueSegmentKind };

// ---------------------------------------------------------------------------------------------
// Table rows (aliases of the generated types)
// ---------------------------------------------------------------------------------------------

export type ProfileRow = Tables<"profiles">;
export type FundRow = Tables<"funds">;
export type CompanyRow = Tables<"companies">;
export type FundInvestmentRow = Tables<"fund_investments">;
export type CompanyMemberRow = Tables<"company_members">;
export type CompanyInternalRow = Tables<"company_internal">;
export type RevenueSegmentRow = Tables<"revenue_segments">;
export type KpiDimensionRow = Tables<"kpi_dimensions">;
export type KpiDimensionMemberRow = Tables<"kpi_dimension_members">;
export type CompanyKpiRow = Tables<"company_kpis">;
export type TemplateRow = Tables<"templates">;
export type TemplateVersionRow = Tables<"template_versions">;
export type TemplateSectionRow = Tables<"template_sections">;
export type TemplateFieldRow = Tables<"template_fields">;
export type ReportingPeriodRow = Tables<"reporting_periods">;
export type SubmissionRow = Tables<"submissions">;
export type SubmissionValueRow = Tables<"submission_values">;
export type SubmissionSegmentValueRow = Tables<"submission_segment_values">;
export type SubmissionKpiValueRow = Tables<"submission_kpi_values">;
export type SubmissionEventRow = Tables<"submission_events">;
export type CommentRow = Tables<"comments">;
export type PeriodCloseRow = Tables<"period_closes">;
export type DocumentRow = Tables<"documents">;
export type FxRateRow = Tables<"fx_rates">;
export type AuditLogRow = Tables<"audit_log">;
export type PlatformSettingsRow = Tables<"platform_settings">;
/** Service-role only (auth plumbing, BRD B14): used by server code with the admin client, never the RLS client. */
export type AccessLinkRow = Tables<"access_links">;

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

/**
 * The part of the platform settings every signed-in session may read (`get_client_settings()`, BRD
 * B27): whether MFA is required, the current terms version, the submission declaration, the due day and
 * (BRD B29) `owner_contributor_limit` — the most active contributors a company owner can have (see
 * `contributorSlotsLeft`). The full `PlatformSettingsRow` (flag thresholds, escalation and grace days, …)
 * is ScaleUp-only.
 */
export type ClientSettings = Database["public"]["Functions"]["get_client_settings"]["Returns"][number];

// ---------------------------------------------------------------------------------------------
// Company team (BRD B29)
// ---------------------------------------------------------------------------------------------

/**
 * How many more active contributors a company owner can add (BRD B29): `limit` is
 * `ClientSettings.owner_contributor_limit`, `activeContributors` the company's ACTIVE contributor
 * memberships (pending invitations included — an invitation creates an active membership; deactivated
 * contributors do not count). Never below 0. ScaleUp (Super Admins) is not limited. UX only: the database
 * enforces the limit (trigger `private.company_members_contributor_limit`).
 */
export function contributorSlotsLeft(activeContributors: number, limit: number): number {
  return Math.max(0, Math.floor(limit) - Math.max(0, Math.floor(activeContributors)));
}

/**
 * The database's refusal (P0001) when an owner would go over the limit, word for word, e.g. to show it
 * before trying: `activeContributors` = the company's other active contributors (at least the limit).
 * "Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more." — or, when the
 * limit is 0 and the team has none, "Only ScaleUp can add contributors to your team. Ask ScaleUp to add
 * them." (tests/db/decisions-2026-10-01.test.ts compares both with the database).
 */
export function contributorLimitMessage(activeContributors: number): string {
  if (activeContributors <= 0) return "Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.";
  const noun = activeContributors === 1 ? "contributor" : "contributors";
  return `Your team already has ${activeContributors} ${noun}. Deactivate one, or ask ScaleUp to add more.`;
}

// ---------------------------------------------------------------------------------------------
// ScaleUp-internal company data
// ---------------------------------------------------------------------------------------------

/** The profile columns loaded for a company's partner-in-charge. */
export type PartnerProfile = Pick<ProfileRow, "id" | "full_name" | "email" | "scaleup_role" | "is_active">;

/**
 * A company's `company_internal` row (ScaleUp-only, BRD §6.3: partner-in-charge, internal rating, exit
 * strategy, notes) with the partner-in-charge's profile (null when none is assigned). Pass it to
 * `canApprove` / `canReopen` / `canEditInternal` (src/lib/auth/permissions.ts).
 */
export type CompanyInternalWithPartner = CompanyInternalRow & { partner: PartnerProfile | null };

// ---------------------------------------------------------------------------------------------
// View rows
// ---------------------------------------------------------------------------------------------

/** Flattens an intersection so editors show one object type. */
type Simplify<T> = { [K in keyof T]: T[K] };
/** `T` with the columns `K` made non-null. */
type WithNonNull<T, K extends keyof T> = Simplify<Omit<T, K> & { [P in K]-?: NonNullable<T[P]> }>;

/** A `v_submission_financials` row exactly as generated (every column nullable). */
export type SubmissionFinancialsViewRow = Tables<"v_submission_financials">;
/** A `v_submission_overview` row exactly as generated (every column nullable). */
export type SubmissionOverviewViewRow = Tables<"v_submission_overview">;

/**
 * One row per submission with the pivoted system numbers (§2.3). Identity, status, due date and currency
 * are non-null; `submitted_at`, `approved_at`, `fx_rate_to_myr` (null for company users on non-MYR
 * companies, or when no rate is set) and the seven numbers may be null.
 */
export type SubmissionFinancialsRow = WithNonNull<
  SubmissionFinancialsViewRow,
  "submission_id" | "company_id" | "month" | "status" | "due_date" | "currency"
>;

/**
 * One row per submission for trackers and home pages (§2.3). Only `original_due_date`, `submitted_at`,
 * `approved_at` and `last_saved_at` may be null. `is_overdue` / `days_overdue` use today in Malaysia time
 * (active companies, months from the reporting start); `open_threads` counts the unresolved root comments
 * the caller can see.
 */
export type SubmissionOverviewRow = WithNonNull<
  SubmissionOverviewViewRow,
  | "id"
  | "company_id"
  | "month"
  | "status"
  | "due_date"
  | "revision"
  | "is_overdue"
  | "days_overdue"
  | "has_narrative"
  | "open_threads"
>;

// ---------------------------------------------------------------------------------------------
// Company configuration
// ---------------------------------------------------------------------------------------------

/**
 * A company KPI with its dimension (e.g. "Outlet") and that dimension's ACTIVE members, sorted by
 * `sort_order`, then name. `dimension` is null and `members` is [] when the KPI has no dimension.
 */
export type KpiDefinition = CompanyKpiRow & {
  dimension: KpiDimensionRow | null;
  members: KpiDimensionMemberRow[];
};

/** A KPI dimension with ALL its members (active first, then `sort_order`, then name). */
export type KpiDimensionWithMembers = KpiDimensionRow & { members: KpiDimensionMemberRow[] };

/** The profile columns loaded for company members. */
export type MemberProfile = Pick<
  ProfileRow,
  "id" | "email" | "full_name" | "job_title" | "is_active" | "terms_accepted_at"
>;

/**
 * A company membership with the member's profile. `profile` is null when Row Level Security hides it
 * (should not happen for ScaleUp staff or co-members, but never assume it).
 */
export type MemberWithProfile = CompanyMemberRow & { profile: MemberProfile | null };

/** Everything that shapes a company's monthly form (getCompanyConfig). */
export type CompanyConfig = {
  company: CompanyRow;
  /**
   * All revenue segments of both kinds (BRD B30: `kind` 'company' or 'scaleup'): active first, then
   * `sort_order`, then name. Inactive (retired) ones are kept for history. For a month's form or view use
   * `segmentsForMonth(config, values, editable)`.
   */
  segments: RevenueSegmentRow[];
  /**
   * The company's own ACTIVE revenue segments (kind 'company', defined by the owner): `sort_order`, then
   * name. They add up to total revenue, which is calculated from them when there are any.
   */
  companySegments: RevenueSegmentRow[];
  /** ScaleUp's ACTIVE revenue lines for the company (kind 'scaleup'), in order. They need not add up. */
  scaleupSegments: RevenueSegmentRow[];
  /** The company's RETIRED own segments (kind 'company', `retired_at` set), most recently retired first. */
  retiredCompanySegments: RevenueSegmentRow[];
  /** All KPIs: active first, then `sort_order`, then name. Filter on `is_active` for input forms. */
  kpis: KpiDefinition[];
  /** All KPI dimensions by name, each with all its members (for the KPI builder). */
  dimensions: KpiDimensionWithMembers[];
  /** All memberships: active first, owners before contributors, then by name (or email). */
  members: MemberWithProfile[];
};

// ---------------------------------------------------------------------------------------------
// Revenue segments (BRD B30): the company's own segments and ScaleUp's revenue lines
// ---------------------------------------------------------------------------------------------

/**
 * A segment's kind: 'company' (the company's own segments; they add up to total revenue) or 'scaleup'
 * (ScaleUp's revenue lines; need not add up). Any other value counts as a ScaleUp line (the database
 * default; the column only allows these two).
 */
export function segmentKind(segment: { kind?: string | null }): RevenueSegmentKind {
  return segment.kind === "company" ? "company" : "scaleup";
}

/** True for the company's own revenue segments (kind 'company'). */
export function isCompanySegment(segment: { kind?: string | null }): boolean {
  return segment.kind === "company";
}

/** Human order for names: case- and accent-insensitive, numbers by value (as the data layer sorts). */
function compareSegmentNames(a: string, b: string): number {
  return a.localeCompare(b, "en-GB", { sensitivity: "base", numeric: true });
}

/** `sort_order`, then name, then id (a stable order whatever the input order). */
function bySegmentOrder(a: RevenueSegmentRow, b: RevenueSegmentRow): number {
  return a.sort_order - b.sort_order || compareSegmentNames(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The derived segment lists of CompanyConfig from all of a company's segments (any order):
 * `companySegments` and `scaleupSegments` (active, by `sort_order`, then name) and
 * `retiredCompanySegments` (most recently retired first). getCompanyConfig uses it; test fixtures that
 * build a CompanyConfig can too: `{ ...config, segments, ...partitionRevenueSegments(segments) }`.
 */
export function partitionRevenueSegments(
  segments: readonly RevenueSegmentRow[],
): Pick<CompanyConfig, "companySegments" | "scaleupSegments" | "retiredCompanySegments"> {
  const ordered = [...segments].sort(bySegmentOrder);
  const retiredAt = (segment: RevenueSegmentRow) => parseInstant(segment.retired_at) ?? 0;
  return {
    companySegments: ordered.filter((segment) => segment.is_active && isCompanySegment(segment)),
    scaleupSegments: ordered.filter((segment) => segment.is_active && !isCompanySegment(segment)),
    retiredCompanySegments: ordered
      .filter((segment) => !segment.is_active && isCompanySegment(segment))
      .sort((a, b) => retiredAt(b) - retiredAt(a) || bySegmentOrder(a, b)),
  };
}

/** The revenue segments to show for one month, each kind in display order (segmentsForMonth). */
export type MonthSegments = {
  /** The company's own segments: they add up to total revenue. */
  company: RevenueSegmentRow[];
  /** ScaleUp's revenue lines: reported every month, need not add up. */
  scaleup: RevenueSegmentRow[];
};

/**
 * Which revenue segments a month shows (BRD B30), split by kind and ordered by `sort_order`, then name:
 * - a month open for changes (`editable`: status draft or changes requested — whoever is looking) follows
 *   the company's CURRENT segments: the active ones, with or without an amount;
 * - a read-only month (submitted, approved) shows exactly the segments it has amounts for, retired ones
 *   included, so it keeps the segment names and figures it was submitted with.
 * `values` is the month's SubmissionValues (or the live form state with the same `segments` map).
 */
export function segmentsForMonth(
  config: Pick<CompanyConfig, "segments">,
  values: Pick<SubmissionValuesInput, "segments">,
  editable: boolean,
): MonthSegments {
  const shown = config.segments
    .filter((segment) => (editable ? segment.is_active : toFiniteNumber(values.segments?.[segment.id]) !== null))
    .sort(bySegmentOrder);
  return {
    company: shown.filter((segment) => isCompanySegment(segment)),
    scaleup: shown.filter((segment) => !isCompanySegment(segment)),
  };
}

/**
 * The amounts entered for `segments` added up (each segment once), exact to 4 decimals for everyday
 * amounts; null when none of them has an amount. E.g. the calculated total revenue of a month with
 * company segments: `sumSegmentAmounts(segmentsForMonth(config, values, true).company, values.segments)`,
 * or the ScaleUp lines for computeFlags' `scaleupLinesTotal`.
 */
export function sumSegmentAmounts(
  segments: ReadonlyArray<Pick<RevenueSegmentRow, "id">>,
  amounts: Readonly<Record<string, number | null | undefined>> | null | undefined,
): number | null {
  const seen = new Set<string>();
  const present: number[] = [];
  for (const segment of segments) {
    if (seen.has(segment.id)) continue;
    seen.add(segment.id);
    const amount = toFiniteNumber(amounts?.[segment.id]);
    if (amount !== null) present.push(amount);
  }
  if (present.length === 0) return null;
  if (present.every((amount) => Math.abs(amount) < 1e10)) {
    let scaled = 0;
    for (const amount of present) scaled += Math.round(amount * 1e4); // amounts have at most 4 decimals
    return scaled / 1e4 + 0;
  }
  return Number(present.reduce((sum, amount) => sum + amount, 0).toFixed(4)) + 0;
}

/** One item of the list `set_company_revenue_segments` takes: a current segment's id, or none for a new one. */
export type CompanySegmentInput = { id?: string | null; name: string };

/** A name as `set_company_revenue_segments` stores it: spaces, tabs and line breaks trimmed at both ends. */
export function normaliseSegmentName(name: string): string {
  return name.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "");
}

function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 1 && code <= 0x1f) || code === 0x7f) return true;
  }
  return false;
}

/**
 * The first problem `set_company_revenue_segments` would refuse in this list, word for word, or null:
 * more than 50 segments; a blank name; a name over 80 characters or with line breaks or tabs; two names
 * that differ only in case; a segment listed twice. (Whether the listed ids are still the company's
 * current segments only the database knows: "The revenue segments have changed since this page was
 * opened. Reload the page and try again.") tests/db/revenue-segments-b30.test.ts compares the messages.
 */
export function companySegmentListError(segments: readonly CompanySegmentInput[]): string | null {
  if (segments.length > REVENUE_SEGMENTS_MAX) return `A company can have at most ${REVENUE_SEGMENTS_MAX} revenue segments.`;
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const segment of segments) {
    const name = typeof segment.name === "string" ? normaliseSegmentName(segment.name) : "";
    if (name === "") return "Each revenue segment needs a name.";
    if ([...name].length > REVENUE_SEGMENT_NAME_MAX) {
      return `Revenue segment names can be at most ${REVENUE_SEGMENT_NAME_MAX} characters.`;
    }
    if (hasControlCharacter(name)) return "Revenue segment names cannot contain line breaks or tabs.";
    const key = name.toLowerCase();
    if (names.has(key)) return `There are two revenue segments called "${name}". Give each segment a different name.`;
    names.add(key);
    if (segment.id) {
      const id = segment.id.toLowerCase();
      if (ids.has(id)) return "Each revenue segment can only be listed once.";
      ids.add(id);
    }
  }
  return null;
}

/** What saving a new list of company segments would change (diffCompanySegments). */
export type CompanySegmentChanges = {
  /** Names of the segments that would be added, in list order. */
  added: string[];
  /** Current segments no longer listed: retired (their figures in months not yet submitted are cleared). */
  removed: RevenueSegmentRow[];
  /**
   * Current segments with a new name. One that already has figures in a submitted or approved month
   * continues as a new series under the new name (those months keep the old name); otherwise it is
   * simply renamed. Months not yet submitted keep their figures either way.
   */
  renamed: { segment: RevenueSegmentRow; name: string }[];
  /** The segments that stay are in a different order. */
  reordered: boolean;
  /** Something was added, removed or renamed: confirm REVENUE_SEGMENT_CHANGE_WARNING first (BRD B30). */
  affectsComparability: boolean;
  /** Anything changes at all (including only the order). */
  changed: boolean;
};

/**
 * Compares the company's current segments (`config.companySegments`) with an edited list the way
 * `set_company_revenue_segments` will apply it: items match current segments by id; an item without id
 * that is named (ignoring case) like a current segment not listed by id is that segment; names are
 * compared after trimming. Use it to decide whether to show the comparability warning (BRD B30) and
 * what to say.
 */
export function diffCompanySegments(
  current: readonly RevenueSegmentRow[],
  next: readonly CompanySegmentInput[],
): CompanySegmentChanges {
  const byId = new Map(current.map((segment) => [segment.id.toLowerCase(), segment] as const));
  const listed = new Set(next.flatMap((item) => (item.id ? [item.id.toLowerCase()] : [])));
  const taken = new Set<string>();
  const matched = next.map((item): RevenueSegmentRow | null => {
    let segment: RevenueSegmentRow | null = null;
    if (item.id) {
      segment = byId.get(item.id.toLowerCase()) ?? null;
    } else {
      const name = normaliseSegmentName(item.name).toLowerCase();
      segment =
        current.find(
          (candidate) =>
            !listed.has(candidate.id.toLowerCase()) && !taken.has(candidate.id) && candidate.name.toLowerCase() === name,
        ) ?? null;
    }
    if (segment === null || taken.has(segment.id)) return null;
    taken.add(segment.id);
    return segment;
  });

  const added: string[] = [];
  const renamed: CompanySegmentChanges["renamed"] = [];
  next.forEach((item, i) => {
    const segment = matched[i];
    const name = normaliseSegmentName(item.name);
    if (segment === null) added.push(name);
    else if (segment.name !== name) renamed.push({ segment, name });
  });
  const removed = current.filter((segment) => !taken.has(segment.id));
  const before = current.filter((segment) => taken.has(segment.id)).map((segment) => segment.id);
  const after = matched.flatMap((segment) => (segment ? [segment.id] : []));
  const reordered = before.some((id, i) => id !== after[i]);
  const affectsComparability = added.length > 0 || removed.length > 0 || renamed.length > 0;
  return { added, removed, renamed, reordered, affectsComparability, changed: affectsComparability || reordered };
}

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

/** A template section with its fields sorted by `sort_order`, then key. */
export type TemplateSectionFull = TemplateSectionRow & { fields: TemplateFieldRow[] };

/**
 * A template version with its template row and its sections sorted by `sort_order`, then key (the order
 * the form and `private.validate_submission()` use), each with its fields sorted the same way.
 */
export type TemplateVersionFull = TemplateVersionRow & {
  template: TemplateRow;
  sections: TemplateSectionFull[];
};

/** A template field with the section it belongs to (flattenTemplateFields). */
export type TemplateFieldWithSection = TemplateFieldRow & {
  section_key: string;
  section_kind: TemplateSectionRow["kind"];
  section_title: string;
};

/** The parsed `template_fields.validation` settings (§2.2); keys with the wrong JSON type are dropped. */
export type FieldValidation = {
  /** `false` forbids negative values on a number field (system figures have fixed rules). */
  allow_negative?: boolean;
  min?: number;
  max?: number;
  /** Maximum text length (the database defaults to 20,000 characters). */
  max_length?: number;
};

/** The parsed `template_fields.options` (§2.2). */
export type FieldOptions = {
  /** Picklist / tags choices, in template order ([] for other field types). */
  choices: string[];
  /** Rating scale (defaults 1–5, as the database applies them); null for other field types. */
  rating: { min: number; max: number; labels: Record<string, string> } | null;
};

// ---------------------------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------------------------

/**
 * A submission's stored values:
 * - `values`: template field values keyed by field key (`revenue_total`, `key_milestones`, …);
 * - `segments`: revenue segment amounts keyed by segment id;
 * - `kpis`: KPI cells keyed by `kpiCellKey(kpi_id, dimension_member_id)` from src/lib/targets.ts.
 * Missing keys mean "no value" (the database deletes empty entries).
 */
export type SubmissionValues = {
  values: Record<string, SubmissionValueRow>;
  segments: Record<string, number | null>;
  kpis: Record<string, SubmissionKpiValueRow>;
};

/**
 * Value maps in the SubmissionValues shape but only with the columns validation reads, e.g. the live
 * state of the monthly form. Every SubmissionValues is one.
 */
export type SubmissionValuesInput = {
  values: ValidationInput["values"];
  segments: ValidationInput["segmentValues"];
  kpis: ValidationInput["kpiValues"];
};

/** Another month of the same company (prior month / same month last year) with its values and figures. */
export type SubmissionSnapshot = {
  submission: SubmissionRow;
  values: SubmissionValues;
  /** The month's seven system numbers (toMonthlyFinancials). */
  financials: MonthlyFinancials;
};

/**
 * Who recorded a timeline event: the actor's profile when the caller may read it, else null (no actor —
 * the system — or a profile the caller cannot read). Company users never read ScaleUp staff profiles (BRD
 * B24, B28: no email or role), so for them every ScaleUp actor is null — `actor_name` still names them.
 */
export type EventActor = Pick<ProfileRow, "id" | "full_name" | "email" | "scaleup_role">;

/**
 * A timeline event with its actor. `actor_name` is what the caller may see of who did it:
 * - a readable profile (ScaleUp staff seeing anyone; company users seeing their co-members): the full
 *   name, else the email;
 * - company users seeing ScaleUp staff (BRD B28): "<full name> (ScaleUp)", e.g. "Renuka Sena (ScaleUp)"
 *   (or "ScaleUp" when the person has no name), from `staff_display_names` — never an email or role;
 * - null when there is no actor (the system) or the person cannot be named (e.g. someone who has left
 *   the company): show `actor_name ?? SCALEUP_LABEL` ("ScaleUp", src/lib/constants.ts).
 */
export type SubmissionEventWithActor = SubmissionEventRow & {
  actor: EventActor | null;
  actor_name: string | null;
};

/**
 * Everything the monthly form and the review page need for one submission (getSubmissionBundle). Safe
 * for company users: nothing ScaleUp-internal is included (no partner-in-charge, no internal fields; the
 * full platform settings only for ScaleUp staff). ScaleUp staff profiles stay hidden from them — ids such
 * as `submission.approved_by` or `events[].actor_id` resolve to no profile they can read — but the
 * timeline names ScaleUp people "<full name> (ScaleUp)" (BRD B28; never an email or role).
 */
export type SubmissionBundle = {
  submission: SubmissionRow;
  /** Same row as `config.company`. */
  company: CompanyRow;
  config: CompanyConfig;
  /** The submission's own template version (past months keep theirs). */
  template: TemplateVersionFull;
  current: SubmissionValues;
  /** The prior month of the same company, or null when there is no submission for it. */
  previous: SubmissionSnapshot | null;
  /** The same month last year, or null when there is no submission for it. */
  lastYear: SubmissionSnapshot | null;
  /** Timeline, oldest first (ScaleUp people named "<full name> (ScaleUp)" for company users, BRD B28). */
  events: SubmissionEventWithActor[];
  /** The current month's system numbers (toMonthlyFinancials(submission.month, current)). */
  financials: MonthlyFinancials;
  /**
   * What every user may read: require_mfa, terms_version, declaration_text (the form's declaration),
   * due_day, owner_contributor_limit.
   */
  clientSettings: ClientSettings;
  /** The full platform settings (flag thresholds, …) for ScaleUp staff; null for company users. */
  settings: PlatformSettingsRow | null;
};

/** Result of `get_submission_validation` (server-side rules 1–6, including `prior_months`). */
export type SubmissionValidation = { ok: boolean; errors: ValidationIssue[] };

/** One month of getFinancialSeries: the system numbers plus status and currency information. */
export type FinancialSeriesPoint = MonthlyFinancials & {
  submission_id: string;
  status: SubmissionRow["status"];
  /** The company's reporting currency (amounts are in this currency). */
  currency: string;
  /** 1 for MYR; the admin-set monthly rate otherwise; null when unknown or not visible (company users). */
  fx_rate_to_myr: number | null;
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An empty SubmissionValues (a month with nothing saved yet). */
export function emptySubmissionValues(): SubmissionValues {
  return { values: {}, segments: {}, kpis: {} };
}

/**
 * Parses `template_fields.validation`. Only JSON numbers count for `min`/`max` and only JSON booleans for
 * `allow_negative`, as in `private.validate_submission()`; `max_length` also accepts a digit string.
 * Returns null when nothing usable is set.
 */
export function parseFieldValidation(value: Json | null | undefined): FieldValidation | null {
  if (!isJsonObject(value)) return null;
  const result: FieldValidation = {};
  if (typeof value.allow_negative === "boolean") result.allow_negative = value.allow_negative;
  const min = finiteNumber(value.min);
  if (min !== undefined) result.min = min;
  const max = finiteNumber(value.max);
  if (max !== undefined) result.max = max;
  const maxLength =
    typeof value.max_length === "string" && /^\d+$/.test(value.max_length.trim())
      ? Number(value.max_length.trim())
      : finiteNumber(value.max_length);
  if (maxLength !== undefined && Number.isInteger(maxLength) && maxLength >= 0) result.max_length = maxLength;
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parses `template_fields.options` for a field: picklist/tags `{"options": ["..."]}` → `choices`; rating
 * `{"min": 1, "max": 5, "labels": {"1": "Very low"}}` → `rating` (min 1 and max 5 when missing, as the
 * database applies them).
 */
export function parseFieldOptions(field: Pick<TemplateFieldRow, "field_type" | "options">): FieldOptions {
  const options: JsonObject = isJsonObject(field.options) ? field.options : {};
  const list = options.options;
  const choices =
    (field.field_type === "picklist" || field.field_type === "tags") && Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string")
      : [];
  if (field.field_type !== "rating") return { choices, rating: null };
  const labels: Record<string, string> = {};
  if (isJsonObject(options.labels)) {
    for (const [key, label] of Object.entries(options.labels)) {
      if (typeof label === "string") labels[key] = label;
    }
  }
  return {
    choices,
    rating: { min: finiteNumber(options.min) ?? 1, max: finiteNumber(options.max) ?? 5, labels },
  };
}

/**
 * Every field of a template version in form order (sections by `sort_order`, then key; fields likewise),
 * each with its section's key, kind and title. Expects the sorted TemplateVersionFull the data layer
 * returns.
 */
export function flattenTemplateFields(template: Pick<TemplateVersionFull, "sections">): TemplateFieldWithSection[] {
  return template.sections.flatMap((section) =>
    section.fields.map((field) => ({
      ...field,
      section_key: section.key,
      section_kind: section.kind,
      section_title: section.title,
    })),
  );
}

/**
 * Builds the input of `validateSubmissionDraft` (src/lib/validation.ts) for a submission: its template's
 * fields (in form order, with parsed validation settings), the company's segments with their kind (BRD
 * B30: company segments add up to total revenue, ScaleUp lines do not) and KPIs (KPIs with a dimension
 * list its active members; `members` is null for a KPI without a dimension) and the month.
 *
 * Values come from `bundle.current` unless `values` is given, e.g. the live state of the form:
 *   `validateSubmissionDraft(toValidationInput(bundle, { values, segments, kpis }))`.
 */
export function toValidationInput(
  bundle: Pick<SubmissionBundle, "submission" | "config" | "template" | "current">,
  values: SubmissionValuesInput = bundle.current,
): ValidationInput {
  return {
    month: bundle.submission.month,
    fields: flattenTemplateFields(bundle.template).map((field) => ({
      key: field.key,
      label: field.label,
      field_type: field.field_type,
      is_required: field.is_required,
      section_kind: field.section_kind,
      validation: parseFieldValidation(field.validation),
    })),
    segments: bundle.config.segments.map((segment) => ({
      id: segment.id,
      name: segment.name,
      is_active: segment.is_active,
      kind: segmentKind(segment),
    })),
    kpis: bundle.config.kpis.map((kpi) => ({
      id: kpi.id,
      name: kpi.name,
      is_active: kpi.is_active,
      is_required: kpi.is_required,
      frequency: kpi.frequency,
      value_type: kpi.value_type,
      members:
        kpi.dimension_id === null
          ? null
          : kpi.members.map((member) => ({ id: member.id, name: member.name, is_active: member.is_active })),
    })),
    values: values.values,
    segmentValues: values.segments,
    kpiValues: values.kpis,
  };
}

/** The columns of a v_submission_financials row that toMonthlyFinancials reads. */
export type FinancialColumns = Pick<
  SubmissionFinancialsRow,
  | "month"
  | "revenue_total"
  | "gross_profit"
  | "net_profit"
  | "cash_in_bank"
  | "burn_rate"
  | "headcount_ft"
  | "headcount_pt"
>;

/**
 * The seven system numbers of a month as `MonthlyFinancials` (src/lib/metrics.ts), for gpPct, runwayMonths,
 * computeFlags, periodTotals, …:
 * - `toMonthlyFinancials(month, values)` from a month and its SubmissionValues (e.g. bundle.current);
 * - `toMonthlyFinancials(snapshot)` from `{ submission, values }` (e.g. bundle.previous);
 * - `toMonthlyFinancials(row)` from a SubmissionFinancialsRow (v_submission_financials).
 * `month` is kept as given (the database form 'YYYY-MM-DD'); missing figures are null.
 */
export function toMonthlyFinancials(month: string, values: Pick<SubmissionValues, "values">): MonthlyFinancials;
export function toMonthlyFinancials(
  source: Pick<SubmissionSnapshot, "submission" | "values"> | FinancialColumns,
): MonthlyFinancials;
export function toMonthlyFinancials(
  source: string | Pick<SubmissionSnapshot, "submission" | "values"> | FinancialColumns,
  values?: Pick<SubmissionValues, "values">,
): MonthlyFinancials {
  if (typeof source === "string") return financialsFromValues(source, values?.values);
  if ("submission" in source) return financialsFromValues(source.submission.month, source.values.values);
  return {
    month: source.month,
    revenue_total: toFiniteNumber(source.revenue_total),
    gross_profit: toFiniteNumber(source.gross_profit),
    net_profit: toFiniteNumber(source.net_profit),
    cash_in_bank: toFiniteNumber(source.cash_in_bank),
    burn_rate: toFiniteNumber(source.burn_rate),
    headcount_ft: toFiniteNumber(source.headcount_ft),
    headcount_pt: toFiniteNumber(source.headcount_pt),
  };
}
