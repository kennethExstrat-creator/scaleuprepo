// Shared fixtures of the M4 tests: a small portfolio on 1 Oct 2026 (Malaysia time) with the pilot reporting
// from July 2026, a USD company reporting from August, i-Motorbike (USD, not yet reporting) and a written-off
// company.
import type {
  CloseInput,
  CompanyInput,
  ExtensionEventInput,
  ExtensionInput,
  FxRateInput,
  OverviewInput,
  PeriodInput,
} from "@/app/admin/cycles/_lib/cycles-model";
import type { PlatformSettingsRow } from "@/lib/types/domain";

export const TODAY = "2026-10-01";
/** 1 Oct 2026, 12:00 in Malaysia. */
export const NOW = new Date("2026-10-01T04:00:00Z");

export const BATIK = "c0000000-0000-4000-8000-000000000001";
export const RECQA = "c0000000-0000-4000-8000-000000000002";
export const KIDDO = "c0000000-0000-4000-8000-000000000003";
export const STAYHERE = "c0000000-0000-4000-8000-000000000013";
export const IMOTOR = "c0000000-0000-4000-8000-000000000016";
export const ACME = "c0000000-0000-4000-8000-000000000020";

export const ADMIN = "a1000000-0000-4000-8000-000000000001";
export const FUND_ADMIN = "a1000000-0000-4000-8000-000000000002";

export const NAMES = { [ADMIN]: "Kenneth Lim", [FUND_ADMIN]: "Aisha Rahman" };

export const COMPANIES: CompanyInput[] = [
  { id: ACME, name: "Acme Pte Ltd", status: "active", reporting_start_month: "2026-08-01", reporting_currency: "USD" },
  { id: BATIK, name: "Batik Boutique", status: "active", reporting_start_month: "2026-07-01", reporting_currency: "MYR" },
  { id: IMOTOR, name: "i-Motorbike", status: "active", reporting_start_month: null, reporting_currency: "USD" },
  { id: KIDDO, name: "Kiddocare", status: "active", reporting_start_month: "2026-07-01", reporting_currency: "MYR" },
  { id: RECQA, name: "RECQA", status: "active", reporting_start_month: "2026-07-01", reporting_currency: "MYR" },
  { id: STAYHERE, name: "StayHere", status: "written_off", reporting_start_month: "2026-07-01", reporting_currency: "MYR" },
];

let next = 0;
function sid(): string {
  next += 1;
  return `b0000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
}

function row(
  company: string,
  month: string,
  status: OverviewInput["status"],
  due: string,
  extra: Partial<OverviewInput> = {},
): OverviewInput {
  return {
    id: sid(),
    company_id: company,
    month,
    status,
    due_date: due,
    original_due_date: null,
    is_overdue: false,
    days_overdue: 0,
    ...extra,
  };
}

export const OVERVIEW: OverviewInput[] = [
  row(BATIK, "2026-07-01", "approved", "2026-08-15"),
  row(BATIK, "2026-08-01", "submitted", "2026-09-15"),
  row(BATIK, "2026-09-01", "draft", "2026-10-15"),
  row(RECQA, "2026-07-01", "approved", "2026-08-15"),
  row(RECQA, "2026-08-01", "changes_requested", "2026-09-29", {
    original_due_date: "2026-09-15",
    is_overdue: true,
    days_overdue: 2,
  }),
  row(RECQA, "2026-09-01", "draft", "2026-10-15"),
  row(KIDDO, "2026-07-01", "submitted", "2026-08-29", { original_due_date: "2026-08-15" }),
  row(KIDDO, "2026-08-01", "draft", "2026-09-15", { is_overdue: true, days_overdue: 16 }),
  row(KIDDO, "2026-09-01", "draft", "2026-10-15"),
  row(ACME, "2026-08-01", "draft", "2026-09-15", { is_overdue: true, days_overdue: 16 }),
  row(ACME, "2026-09-01", "draft", "2026-10-15"),
  // Written off after July: its months are never overdue and cannot be extended.
  row(STAYHERE, "2026-07-01", "draft", "2026-08-15"),
];

export const overviewId = (company: string, month: string): string =>
  OVERVIEW.find((item) => item.company_id === company && item.month === month)?.id ?? "";

export const PERIODS: PeriodInput[] = [
  {
    month: "2026-07-01",
    due_date: "2026-08-15",
    opened_at: "2026-09-30T08:00:00Z",
    opened_by: null,
    template: { name: "Portfolio Update", versionNo: 1, status: "archived" },
  },
  {
    month: "2026-09-01",
    due_date: "2026-10-15",
    // 1 Oct 2026, 00:05 in Malaysia: opened automatically on time.
    opened_at: "2026-09-30T16:05:00Z",
    opened_by: null,
    template: { name: "Portfolio Update", versionNo: 2, status: "published" },
  },
  {
    month: "2026-08-01",
    due_date: "2026-09-15",
    opened_at: "2026-08-20T03:00:00Z",
    opened_by: ADMIN,
    template: null,
  },
];

export const EXTENSION_ROWS: ExtensionInput[] = [
  {
    id: overviewId(KIDDO, "2026-07-01"),
    company_id: KIDDO,
    month: "2026-07-01",
    status: "submitted",
    due_date: "2026-08-29",
    original_due_date: "2026-08-15",
    extension_reason: "  Auditors finalising the accounts.  ",
  },
  {
    id: overviewId(RECQA, "2026-08-01"),
    company_id: RECQA,
    month: "2026-08-01",
    status: "changes_requested",
    due_date: "2026-09-29",
    original_due_date: "2026-09-15",
    extension_reason: null,
  },
  {
    id: overviewId(STAYHERE, "2026-07-01"),
    company_id: STAYHERE,
    month: "2026-07-01",
    status: "draft",
    due_date: "2026-08-30",
    original_due_date: "2026-08-15",
    extension_reason: "Strike-off paperwork",
  },
];

/** The deadline_extended events (their message names the new due date, as extend_due_date writes it). */
export const EXTENSION_EVENTS: ExtensionEventInput[] = [
  {
    id: 11,
    submission_id: overviewId(KIDDO, "2026-07-01"),
    event: "deadline_extended",
    actor_id: FUND_ADMIN,
    created_at: "2026-08-14T02:00:00Z",
    message: "Due date extended to 22 Aug 2026.",
  },
  {
    id: 14,
    submission_id: overviewId(KIDDO, "2026-07-01"),
    event: "deadline_extended",
    actor_id: ADMIN,
    created_at: "2026-08-20T02:00:00Z",
    message: "Due date extended to 29 Aug 2026. Reason: Auditors finalising the accounts.",
  },
  {
    id: 10,
    submission_id: overviewId(STAYHERE, "2026-07-01"),
    event: "deadline_extended",
    actor_id: null,
    created_at: "2026-08-10T02:00:00Z",
    message: "Due date extended to 30 Aug 2026. Reason: Strike-off paperwork",
  },
];

/** Send-backs: RECQA's August was sent back on 15 Sep (MYT), so it is due 14 days later. */
export const SEND_BACK_EVENTS: ExtensionEventInput[] = [
  {
    id: 20,
    submission_id: overviewId(RECQA, "2026-08-01"),
    event: "changes_requested",
    actor_id: ADMIN,
    created_at: "2026-09-15T03:00:00Z",
  },
  // Kiddocare's July was reopened on 1 Aug (due date unchanged), before its extensions set the due date.
  {
    id: 9,
    submission_id: overviewId(KIDDO, "2026-07-01"),
    event: "reopened",
    actor_id: ADMIN,
    created_at: "2026-08-01T01:00:00Z",
  },
];

export const CLOSES: CloseInput[] = [
  { company_id: BATIK, period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", label: "Q3 2026", status: "confirmed" },
  { company_id: RECQA, period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", label: "Q3 2026", status: "open" },
  { company_id: KIDDO, period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", label: "Q3 2026", status: "open" },
  { company_id: BATIK, period_type: "half", period_start: "2026-01-01", period_end: "2026-06-30", label: "H1 2026", status: "confirmed" },
  { company_id: BATIK, period_type: "quarter", period_start: "2026-04-01", period_end: "2026-06-30", label: "Q2 2026", status: "confirmed" },
];

export const RATES: FxRateInput[] = [
  { currency: "USD", month: "2026-07-01", rate_to_myr: 4.2, updated_at: "2026-08-02T01:00:00Z", updated_by: FUND_ADMIN },
  { currency: "USD", month: "2026-09-01", rate_to_myr: 4.75, updated_at: "2026-10-01T01:00:00Z", updated_by: ADMIN },
  { currency: "SGD", month: "2025-12-01", rate_to_myr: 3.3, updated_at: "2026-01-05T01:00:00Z", updated_by: null },
];

export const SETTINGS: PlatformSettingsRow = {
  id: 1,
  due_day: 15,
  escalation_days: 14,
  backfill_grace_days: 14,
  revenue_swing_pct: 30,
  min_runway_months: 6,
  require_mfa: true,
  default_reporting_start: "2026-07-01",
  declaration_text: "I confirm that the figures submitted are accurate to the best of my knowledge.",
  terms_version: "2026-09",
  owner_contributor_limit: 4,
  updated_by: null,
  created_at: "2026-09-30T08:00:00.123456+00:00",
  updated_at: "2026-09-30T08:00:00.123456+00:00",
};
