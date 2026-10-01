import "server-only";

// Typed data access (docs/ARCHITECTURE.md §5.5). Server-only: every function takes the RLS-scoped client
// (`await createClient()` from @/lib/supabase/server) as its first argument, so Row Level Security decides
// what the caller sees. Getters return null (or [] / empty maps) for rows that do not exist or are not
// visible; functions whose contract returns a row throw a not-found DataError instead (isNotFoundError).
// Query failures throw a DataError naming the function, with the Postgres/PostgREST code kept for
// toActionError(). Client Components import the types from @/lib/types/domain.

export { getCompany, getCompanyConfig, getCompanyInternal } from "./companies";
export { DataError, isNotFoundError } from "./errors";
export { getFinancialSeries } from "./financials";
export { setCompanyRevenueSegments } from "./segments";
export { getClientSettings, getPlatformSettings } from "./settings";
export { getStaffDisplayNames } from "./staff";
export {
  getSubmission,
  getSubmissionBundle,
  getSubmissionBundleByMonth,
  getSubmissionByMonth,
  getSubmissionValidation,
  getSubmissionValues,
  listCompanySubmissions,
  listSubmissionEvents,
} from "./submissions";
export { getCurrentTemplateVersion, getTemplateVersion } from "./templates";

// Keys of SubmissionValues.kpis (kpiCellKey(kpiId, memberId) → '<kpiId>:<memberId or ->').
export { kpiCellKey, parseKpiCellKey } from "@/lib/targets";

// Pure helpers, re-exported for server code (Client Components import them from @/lib/types/domain).
export {
  companySegmentListError,
  diffCompanySegments,
  emptySubmissionValues,
  flattenTemplateFields,
  isCompanySegment,
  normaliseSegmentName,
  parseFieldOptions,
  parseFieldValidation,
  partitionRevenueSegments,
  segmentKind,
  segmentsForMonth,
  sumSegmentAmounts,
  toMonthlyFinancials,
  toValidationInput,
} from "@/lib/types/domain";

export type {
  AccessLinkRow,
  AuditLogRow,
  ClientSettings,
  CommentRow,
  CompanyConfig,
  CompanySegmentChanges,
  CompanySegmentInput,
  CompanyInternalRow,
  CompanyInternalWithPartner,
  CompanyKpiRow,
  CompanyMemberRow,
  CompanyRow,
  DocumentRow,
  EventActor,
  FieldOptions,
  FieldValidation,
  FinancialSeriesPoint,
  FundInvestmentRow,
  FundRow,
  FxRateRow,
  KpiDefinition,
  KpiDimensionMemberRow,
  KpiDimensionRow,
  KpiDimensionWithMembers,
  MemberProfile,
  MemberWithProfile,
  MonthSegments,
  PartnerProfile,
  PeriodCloseRow,
  PlatformSettingsRow,
  ProfileRow,
  ReportingPeriodRow,
  RevenueSegmentKind,
  RevenueSegmentRow,
  SubmissionBundle,
  SubmissionEventRow,
  SubmissionEventWithActor,
  SubmissionFinancialsRow,
  SubmissionKpiValueRow,
  SubmissionOverviewRow,
  SubmissionRow,
  SubmissionSegmentValueRow,
  SubmissionSnapshot,
  SubmissionValidation,
  SubmissionValueRow,
  SubmissionValues,
  SubmissionValuesInput,
  TemplateFieldRow,
  TemplateFieldWithSection,
  TemplateRow,
  TemplateSectionFull,
  TemplateSectionRow,
  TemplateVersionFull,
  TemplateVersionRow,
} from "@/lib/types/domain";
