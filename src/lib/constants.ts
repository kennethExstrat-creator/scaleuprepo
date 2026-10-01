// Shared labels and metadata. All user-facing wording for statuses and roles comes from here
// (docs/ARCHITECTURE.md §0 "Coding conventions" and §5.4). British English throughout.
import type {
  ClosePeriodType,
  CommentVisibility,
  CompanyRole,
  CompanyStatus,
  DocumentType,
  FieldType,
  InternalRating,
  KpiFrequency,
  KpiValueType,
  PeriodCloseStatus,
  ScaleupRole,
  SectionKind,
  SubmissionEvent,
  SubmissionStatus,
  TemplateStatus,
} from "@/lib/types/enums";
import type { FlagCode, FlagSeverity } from "@/lib/metrics";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

// ---------------------------------------------------------------------------------------------
// Statuses and roles
// ---------------------------------------------------------------------------------------------

export const SUBMISSION_STATUS_META: Record<SubmissionStatus, { label: string; tone: Tone; description: string }> = {
  draft: { label: "Not submitted", tone: "neutral", description: "Numbers not yet submitted" },
  submitted: { label: "Submitted", tone: "info", description: "Awaiting ScaleUp review" },
  changes_requested: { label: "Changes requested", tone: "warning", description: "ScaleUp asked for changes" },
  approved: { label: "Approved", tone: "success", description: "Approved and locked" },
};

export const OVERDUE_META = { label: "Overdue", tone: "danger" as Tone, description: "Past the due date" };

/** Tracker: overdue for longer than `platform_settings.escalation_days` (escalated to the partner-in-charge). */
export const ESCALATED_META = {
  label: "Escalated",
  tone: "danger" as Tone,
  description: "Overdue for longer than the escalation period",
};

/** Tracker: no submission exists for the month (before the reporting start or not opened yet). */
export const MISSING_META = { label: "Missing", tone: "neutral" as Tone, description: "No update for this month" };

/**
 * A company without a reporting start month (`companies.reporting_start_month` null, BRD B16): loaded on
 * the platform but not reporting yet. No months are opened for it and nothing is overdue; ScaleUp sets
 * the start month to onboard it. Show it on company lists, the company page and the tracker.
 */
export const NOT_YET_REPORTING_META = {
  label: "Not yet reporting",
  tone: "neutral" as Tone,
  description: "No reporting start month set yet: no monthly updates are requested",
};

/**
 * ScaleUp on the company side (BRD B28): people are named "<full name> (ScaleUp)", e.g. "Renuka Sena
 * (ScaleUp)" — names from `getStaffDisplayNames` (src/lib/data), never an email or role. `SCALEUP_LABEL`
 * is what to show when no person can be named (system actions, e.g. `actor_name ?? SCALEUP_LABEL`).
 */
export const SCALEUP_LABEL = "ScaleUp";
export const SCALEUP_STAFF_SUFFIX = " (ScaleUp)";

export const SCALEUP_ROLE_LABELS: Record<ScaleupRole, string> = {
  super_admin: "Super Admin",
  fund_admin: "Fund Admin",
  partner: "Partner",
  viewer: "Viewer",
};

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  owner: "Company Owner",
  contributor: "Contributor",
};

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  active: "Active",
  exited: "Exited",
  written_off: "Written off",
};

export const COMPANY_STATUS_META: Record<CompanyStatus, { label: string; tone: Tone }> = {
  active: { label: COMPANY_STATUS_LABELS.active, tone: "success" },
  exited: { label: COMPANY_STATUS_LABELS.exited, tone: "neutral" },
  written_off: { label: COMPANY_STATUS_LABELS.written_off, tone: "danger" },
};

export const INTERNAL_RATING_META: Record<InternalRating, { label: string; tone: Tone }> = {
  on_track: { label: "On track", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  at_risk: { label: "At risk", tone: "danger" },
};

export const KPI_FREQUENCY_LABELS: Record<KpiFrequency, string> = {
  monthly: "Monthly",
  half_yearly: "Half-yearly (Jun and Dec)",
};

export const KPI_VALUE_TYPE_LABELS: Record<KpiValueType, string> = {
  number: "Number",
  integer: "Whole number",
  currency: "Currency",
  percent: "Percentage",
  boolean: "Yes / No",
  text: "Text",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  currency: "Currency",
  number: "Number",
  integer: "Whole number",
  percent: "Percentage",
  text: "Short text",
  long_text: "Long text",
  rating: "Rating",
  picklist: "Picklist",
  tags: "Tags",
  boolean: "Yes / No",
};

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  financials: "Financials (system)",
  headcount: "Headcount (system)",
  kpis: "Company KPIs (system)",
  custom_numbers: "Additional numbers",
  narrative: "Narrative (C4 category)",
  pulse: "Founder pulse",
};

export const TEMPLATE_STATUS_META: Record<TemplateStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "warning" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const COMMENT_VISIBILITY_META: Record<CommentVisibility, { label: string; description: string }> = {
  shared: { label: "Shared", description: "Visible to the company" },
  internal: { label: "Internal", description: "ScaleUp only, never shown to the company" },
};

export const CLOSE_PERIOD_TYPE_LABELS: Record<ClosePeriodType, string> = {
  quarter: "Quarter",
  half: "Half-year",
};

export const PERIOD_CLOSE_STATUS_META: Record<PeriodCloseStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "success" },
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  management_accounts: "Management accounts",
  supporting: "Supporting document",
};

/** Timeline wording for `submission_events.event`. */
export const SUBMISSION_EVENT_LABELS: Record<SubmissionEvent, string> = {
  submitted: "Submitted",
  resubmitted: "Resubmitted",
  changes_requested: "Changes requested",
  approved: "Approved",
  reopened: "Reopened",
  amendment_requested: "Amendment requested",
  deadline_extended: "Deadline extended",
};

// ---------------------------------------------------------------------------------------------
// Template fields and validation
// ---------------------------------------------------------------------------------------------

/** Core monthly numbers — always required, keys fixed (docs/ARCHITECTURE.md §3). */
export const SYSTEM_FIELD_KEYS = [
  "revenue_total",
  "gross_profit",
  "net_profit",
  "cash_in_bank",
  "burn_rate",
  "headcount_ft",
  "headcount_pt",
] as const;
export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

/**
 * The mandatory monthly numbers (financials + headcount), in form order. These are the numeric columns
 * pivoted by `v_submission_financials` and the keys of `MonthlyFinancials` (src/lib/metrics.ts).
 */
export const NUMBER_FIELD_KEYS: readonly SystemFieldKey[] = SYSTEM_FIELD_KEYS;

/** Money system fields (currency). */
export const MONEY_FIELD_KEYS: readonly SystemFieldKey[] = [
  "revenue_total",
  "gross_profit",
  "net_profit",
  "cash_in_bank",
  "burn_rate",
];

/** Headcount system fields: whole numbers, never negative. */
export const HEADCOUNT_FIELD_KEYS: readonly SystemFieldKey[] = ["headcount_ft", "headcount_pt"];

/** Default labels of the system fields (the template may relabel them; prefer the template label). */
export const SYSTEM_FIELD_LABELS: Record<SystemFieldKey, string> = {
  revenue_total: "Total revenue",
  gross_profit: "Gross profit",
  net_profit: "Net profit",
  cash_in_bank: "Cash in bank (month end)",
  burn_rate: "Burn rate (per month)",
  headcount_ft: "Full-time headcount",
  headcount_pt: "Part-time headcount",
};

/** Money fields that may be negative. */
export const NEGATIVE_ALLOWED_KEYS: readonly string[] = ["gross_profit", "net_profit"];

/** System fields that must not be negative (§2.6 rule 3; segment amounts too). */
export const NON_NEGATIVE_FIELD_KEYS: readonly SystemFieldKey[] = [
  "revenue_total",
  "cash_in_bank",
  "burn_rate",
  "headcount_ft",
  "headcount_pt",
];

/** Fields stored in value_number. */
export const NUMBER_FIELD_TYPES: readonly FieldType[] = ["currency", "number", "integer", "percent", "rating"];
/** Fields stored in value_text. */
export const TEXT_FIELD_TYPES: readonly FieldType[] = ["text", "long_text", "picklist"];
/** Fields stored in value_json (tags: string[]; boolean: true/false). */
export const JSON_FIELD_TYPES: readonly FieldType[] = ["tags", "boolean"];

/** KPI value types stored in value_number (boolean → value_bool, text → value_text). */
export const NUMBER_KPI_VALUE_TYPES: readonly KpiValueType[] = ["number", "integer", "currency", "percent"];

/** Section kinds that cannot be deleted from a template. */
export const SYSTEM_SECTION_KINDS: readonly SectionKind[] = ["financials", "headcount", "kpis"];
/** Optional qualitative sections (C4 narrative and founder pulse). */
export const NARRATIVE_SECTION_KINDS: readonly SectionKind[] = ["narrative", "pulse"];

/**
 * `revenue_total` must equal the sum of the active COMPANY revenue segments within this tolerance (§2.6
 * rule 2, BRD B30). ScaleUp revenue lines have no sum rule.
 */
export const REVENUE_SUM_TOLERANCE = 0.01;

// ---------------------------------------------------------------------------------------------
// Revenue segments (BRD B30): two breakdowns per company (`revenue_segments.kind`)
// ---------------------------------------------------------------------------------------------

/**
 * `revenue_segments.kind` (BRD B30):
 * - `company`: the company's own revenue segments, defined by its owner in the portal
 *   (`set_company_revenue_segments`); they add up to total revenue, which is calculated from them, and
 *   carry over every month;
 * - `scaleup`: revenue lines ScaleUp defines per company (Super Admin, Fund Admin); reported every month
 *   but they need not add up to total revenue.
 */
export const REVENUE_SEGMENT_KINDS = ["company", "scaleup"] as const;
export type RevenueSegmentKind = (typeof REVENUE_SEGMENT_KINDS)[number];

export const REVENUE_SEGMENT_KIND_META: Record<
  RevenueSegmentKind,
  { label: string; plural: string; description: string }
> = {
  company: {
    label: "Revenue segment",
    plural: "Revenue segments",
    description: "Defined by the company owner. They add up to total revenue.",
  },
  scaleup: {
    label: "ScaleUp revenue line",
    plural: "ScaleUp revenue lines",
    description: "Defined by ScaleUp for this company. Reported every month; they need not add up to total revenue.",
  },
};

/** Limits of `set_company_revenue_segments` (the form and its zod schema use them too). */
export const REVENUE_SEGMENTS_MAX = 50;
export const REVENUE_SEGMENT_NAME_MAX = 80;

/**
 * The comparability warning to show (and have confirmed) before the company's revenue segments change
 * (adding, renaming, removing or reordering them), BRD B30.
 */
export const REVENUE_SEGMENT_CHANGE_WARNING =
  "Changing your revenue segments may affect reporting standards and comparability with earlier months. " +
  "Months already submitted keep their segment names and figures; months not yet submitted switch to the new segments.";

export const VALIDATION_CODE_LABELS: Record<string, string> = {
  required: "Required",
  negative: "Cannot be negative",
  not_integer: "Must be a whole number",
  sum_mismatch: "Does not add up",
  out_of_range: "Out of range",
  prior_months: "Earlier months not submitted",
};

// ---------------------------------------------------------------------------------------------
// Auto-flags (review) and platform defaults
// ---------------------------------------------------------------------------------------------

export const FLAG_CODE_LABELS: Record<FlagCode, string> = {
  revenue_swing: "Revenue swing",
  low_runway: "Low runway",
  missing_required: "Missing required values",
  negative_cash: "Negative cash",
  segments_exceed_total: "Revenue lines exceed total",
};

export const FLAG_SEVERITY_META: Record<FlagSeverity, { label: string; tone: Tone }> = {
  warning: { label: "Warning", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

/** Defaults mirrored from `platform_settings` (used when a setting is missing). */
export const DEFAULT_DUE_DAY = 15;
export const DEFAULT_ESCALATION_DAYS = 14;
export const DEFAULT_BACKFILL_GRACE_DAYS = 14;
export const DEFAULT_REVENUE_SWING_PCT = 30;
export const DEFAULT_MIN_RUNWAY_MONTHS = 6;
/**
 * `platform_settings.owner_contributor_limit` (BRD B29): the most ACTIVE contributors a company owner can
 * have (pending invitations count); ScaleUp can add more. A Super Admin setting, 0–100.
 */
export const DEFAULT_OWNER_CONTRIBUTOR_LIMIT = 4;
export const OWNER_CONTRIBUTOR_LIMIT_MAX = 100;
/** Runway below this many months is a critical flag regardless of the configured minimum. */
export const CRITICAL_RUNWAY_MONTHS = 3;

export const DEFAULT_CURRENCY = "MYR";
export const TIME_ZONE = "Asia/Kuala_Lumpur";

export const TERMS_VERSION = "2026-09";

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx";
/** MIME types allowed in the `company-documents` bucket (PDF, XLSX, XLS, CSV, DOCX). */
export const DOCUMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
