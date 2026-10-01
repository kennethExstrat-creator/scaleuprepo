// Enum contract shared by the database (supabase/migrations) and the app.
// Keep in sync with docs/ARCHITECTURE.md §2.1.

export const SCALEUP_ROLES = ["super_admin", "fund_admin", "partner", "viewer"] as const;
export type ScaleupRole = (typeof SCALEUP_ROLES)[number];

export const COMPANY_ROLES = ["owner", "contributor"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_STATUSES = ["active", "exited", "written_off"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const SUBMISSION_STATUSES = ["draft", "submitted", "changes_requested", "approved"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const INTERNAL_RATINGS = ["on_track", "watch", "at_risk"] as const;
export type InternalRating = (typeof INTERNAL_RATINGS)[number];

export const KPI_FREQUENCIES = ["monthly", "half_yearly"] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];

export const KPI_VALUE_TYPES = ["number", "integer", "currency", "percent", "boolean", "text"] as const;
export type KpiValueType = (typeof KPI_VALUE_TYPES)[number];

export const FIELD_TYPES = [
  "currency",
  "number",
  "integer",
  "percent",
  "text",
  "long_text",
  "rating",
  "picklist",
  "tags",
  "boolean",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SECTION_KINDS = ["financials", "headcount", "kpis", "custom_numbers", "narrative", "pulse"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const COMMENT_VISIBILITIES = ["shared", "internal"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const CLOSE_PERIOD_TYPES = ["quarter", "half"] as const;
export type ClosePeriodType = (typeof CLOSE_PERIOD_TYPES)[number];

export const PERIOD_CLOSE_STATUSES = ["open", "confirmed"] as const;
export type PeriodCloseStatus = (typeof PERIOD_CLOSE_STATUSES)[number];

export const DOCUMENT_TYPES = ["management_accounts", "supporting"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SUBMISSION_EVENTS = [
  "submitted",
  "resubmitted",
  "changes_requested",
  "approved",
  "reopened",
  "amendment_requested",
  "deadline_extended",
] as const;
export type SubmissionEvent = (typeof SUBMISSION_EVENTS)[number];
