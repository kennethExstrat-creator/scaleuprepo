// Audit log viewing and export (BRD A14, §11 Audit; docs/ARCHITECTURE.md §2.2 audit_log). Client-safe
// and pure: labels, filters as query strings and time bounds, the changed-fields view of an entry and
// CSV rows. Parsing searchParams: audit-params.ts; queries: audit-data.ts (server-only).
import { COMPANY_ROLE_LABELS, SCALEUP_ROLE_LABELS, type Tone } from "@/lib/constants";
import { formatDateTime, formatFileSize, formatNumber } from "@/lib/format";
import { addDays, mytParts, parseInstant } from "@/lib/periods";
import type { Json } from "@/lib/supabase/database.types";
import type { AuditLogRow } from "@/lib/types/domain";

import type { CsvValue } from "./csv";

/** Entries per page on /admin/audit. */
export const AUDIT_PAGE_SIZE = 50;
/** Most entries one CSV export may contain (narrow the filters for more). */
export const AUDIT_EXPORT_MAX_ROWS = 50_000;
/**
 * Largest CSV one export writes (bytes). Entries carry the old and new values in full, and a narrative
 * autosave can hold up to 20,000 characters on each side, so the row limit alone does not bound the file.
 */
export const AUDIT_EXPORT_MAX_BYTES = 50 * 1024 * 1024;
/** How long one export keeps reading entries (ms), well inside the route's 60-second limit. */
export const AUDIT_EXPORT_TIME_BUDGET_MS = 45_000;
/** Longest value shown in the expanded row (the CSV export keeps everything). */
export const AUDIT_VALUE_PREVIEW_CHARS = 2_000;

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

export type AuditActionMeta = { label: string; tone: Tone };

/**
 * Every action the database writes (row triggers, RPCs) and the app events allowed by
 * `log_audit_event` (export, download, invite, invite_revoke, sign_in_link, mfa_reset).
 */
export const AUDIT_ACTION_META: Record<string, AuditActionMeta> = {
  insert: { label: "Created", tone: "neutral" },
  update: { label: "Updated", tone: "neutral" },
  delete: { label: "Deleted", tone: "danger" },
  submit: { label: "Submitted", tone: "info" },
  request_changes: { label: "Changes requested", tone: "warning" },
  approve: { label: "Approved", tone: "success" },
  reopen: { label: "Reopened", tone: "warning" },
  request_amendment: { label: "Amendment requested", tone: "warning" },
  extend_due_date: { label: "Due date extended", tone: "neutral" },
  confirm: { label: "Period close confirmed", tone: "success" },
  resolve: { label: "Thread resolved", tone: "neutral" },
  unresolve: { label: "Thread reopened", tone: "neutral" },
  open_period: { label: "Month opened early", tone: "neutral" },
  // scripts/import-history.ts: months before the reporting start month, from the historical workbooks (BRD B3).
  import: { label: "Imported (history)", tone: "neutral" },
  publish: { label: "Template published", tone: "neutral" },
  status_change: { label: "Company status changed", tone: "warning" },
  accept_terms: { label: "Terms accepted", tone: "neutral" },
  invite: { label: "Invitation issued", tone: "neutral" },
  invite_revoke: { label: "Invitation revoked", tone: "neutral" },
  sign_in_link: { label: "Sign-in link issued", tone: "neutral" },
  mfa_reset: { label: "2FA reset", tone: "warning" },
  export: { label: "Exported", tone: "info" },
  download: { label: "Downloaded", tone: "info" },
};

/** Groups for the action filter. */
export const AUDIT_ACTION_GROUPS: readonly { label: string; actions: readonly string[] }[] = [
  { label: "Record changes", actions: ["insert", "update", "delete"] },
  {
    label: "Monthly updates",
    actions: [
      "submit",
      "request_changes",
      "approve",
      "reopen",
      "request_amendment",
      "extend_due_date",
      "open_period",
      "import",
    ],
  },
  { label: "Period closes and comments", actions: ["confirm", "resolve", "unresolve"] },
  { label: "Setup", actions: ["publish", "status_change"] },
  { label: "Access", actions: ["accept_terms", "invite", "invite_revoke", "sign_in_link", "mfa_reset"] },
  { label: "Exports and downloads", actions: ["export", "download"] },
];

/** Tables with an audit trigger and the app's export entities, with readable names. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  submissions: "Monthly updates",
  submission_values: "Monthly update values",
  submission_segment_values: "Segment revenue",
  submission_kpi_values: "KPI values",
  submission_events: "Monthly update timeline",
  comments: "Comments",
  period_closes: "Period closes",
  documents: "Documents",
  companies: "Companies",
  company_internal: "Internal company fields",
  company_members: "Company members",
  fund_investments: "Fund investments",
  funds: "Funds",
  revenue_segments: "Revenue segments",
  company_kpis: "Company KPIs",
  kpi_dimensions: "KPI dimensions",
  kpi_dimension_members: "KPI dimension members",
  templates: "Templates",
  template_versions: "Template versions",
  template_sections: "Template sections",
  template_fields: "Template fields",
  reporting_periods: "Reporting months",
  fx_rates: "FX rates",
  profiles: "User profiles",
  platform_settings: "Platform settings",
  c4_workbook: "C4 workbooks",
  portfolio_data: "Portfolio data",
  audit_log: "Audit log",
};

/** Groups for the entity filter. */
export const AUDIT_ENTITY_GROUPS: readonly { label: string; entities: readonly string[] }[] = [
  {
    label: "Reporting",
    entities: [
      "submissions",
      "submission_values",
      "submission_segment_values",
      "submission_kpi_values",
      "submission_events",
      "comments",
      "period_closes",
      "documents",
    ],
  },
  {
    label: "Companies and funds",
    entities: [
      "companies",
      "company_internal",
      "company_members",
      "fund_investments",
      "funds",
      "revenue_segments",
      "company_kpis",
      "kpi_dimensions",
      "kpi_dimension_members",
    ],
  },
  {
    label: "Setup",
    entities: [
      "templates",
      "template_versions",
      "template_sections",
      "template_fields",
      "reporting_periods",
      "fx_rates",
      "profiles",
      "platform_settings",
    ],
  },
  { label: "Exports", entities: ["c4_workbook", "portfolio_data", "audit_log"] },
];

export function auditActionMeta(action: string): AuditActionMeta {
  return AUDIT_ACTION_META[action] ?? { label: humanise(action), tone: "neutral" };
}

export function auditEntityLabel(entity: string): string {
  return AUDIT_ENTITY_LABELS[entity] ?? humanise(entity);
}

const ROLE_LABELS = new Map<string, string>([
  ...Object.entries(SCALEUP_ROLE_LABELS),
  ["company_owner", COMPANY_ROLE_LABELS.owner],
  ["company_contributor", COMPANY_ROLE_LABELS.contributor],
  ["system", "System"],
]);

/** `actor_role` as shown: "Super Admin", "Company Owner", "System", … (null when unknown). */
export function auditRoleLabel(role: string | null): string | null {
  if (!role) return null;
  return ROLE_LABELS.get(role) ?? humanise(role);
}

/**
 * True for entries without a person behind them (months opened automatically, scheduled jobs, trusted
 * scripts): shown as "System".
 */
export function isSystemActor(row: Pick<AuditLogRow, "actor_id" | "actor_email">): boolean {
  return row.actor_id === null && !row.actor_email;
}

function humanise(value: string): string {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

// ---------------------------------------------------------------------------------------------
// Filters (searchParams of /admin/audit and /api/exports/audit)
// ---------------------------------------------------------------------------------------------

export type AuditFilters = {
  /** Company id. */
  company?: string;
  /** Part of the actor's email (case-insensitive). */
  actor?: string;
  action?: string;
  entity?: string;
  /** First day, 'YYYY-MM-DD' (Malaysia time), inclusive. */
  from?: string;
  /** Last day, 'YYYY-MM-DD' (Malaysia time), inclusive. */
  to?: string;
};

export const AUDIT_FILTER_KEYS = ["company", "actor", "action", "entity", "from", "to"] as const;

/** Query string for the filters (and page when above 1), without the leading "?". */
export function auditQueryString(filters: AuditFilters, page = 1): string {
  const params = new URLSearchParams();
  for (const key of AUDIT_FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return AUDIT_FILTER_KEYS.some((key) => Boolean(filters[key]));
}

/** occurred_at bounds for the date filters: [from 00:00 MYT, the day after `to` 00:00 MYT). */
export function auditTimeBounds(filters: Pick<AuditFilters, "from" | "to">): { gte?: string; lt?: string } {
  const bounds: { gte?: string; lt?: string } = {};
  const from = filters.from ? parseInstant(filters.from) : null;
  const to = filters.to ? parseInstant(addDays(filters.to, 1)) : null;
  if (from !== null) bounds.gte = new Date(from).toISOString();
  if (to !== null) bounds.lt = new Date(to).toISOString();
  return bounds;
}

/** A LIKE pattern that matches `text` anywhere, with %, _ and \ taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------------------------
// Entry details
// ---------------------------------------------------------------------------------------------

export type AuditChangeKind = "update" | "insert" | "delete" | "event" | "none";
export type AuditChange = { field: string; before: string | null; after: string | null };

/** A JSON value as text: strings as they are, other values as compact JSON; null stays null. */
export function formatAuditValue(value: Json | undefined, maxLength = Infinity): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}… (shortened)` : text;
}

function jsonObject(value: Json | null): Record<string, Json | undefined> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

/** Actions written by the app through log_audit_event: their `new_data` holds details, not a table row. */
const APP_EVENT_ACTIONS: ReadonlySet<string> = new Set([
  "export",
  "download",
  "invite",
  "invite_revoke",
  "sign_in_link",
  "mfa_reset",
]);

/**
 * What an entry changed: for updates the changed fields (old → new), for inserts the new row, for
 * deletes the removed row, and for app events (exports, invitations, …) their details. Fields sorted
 * by name; `updated_at` is left out (the database ignores it too).
 */
export function auditChanges(
  row: Pick<AuditLogRow, "action" | "old_data" | "new_data">,
  maxLength = Infinity,
): { kind: AuditChangeKind; changes: AuditChange[] } {
  const before = jsonObject(row.old_data);
  const after = jsonObject(row.new_data);
  if (!before && !after) {
    const other = row.new_data ?? row.old_data;
    if (other === null) return { kind: "none", changes: [] };
    return { kind: "event", changes: [{ field: "details", before: null, after: formatAuditValue(other, maxLength) }] };
  }
  const kind: AuditChangeKind = APP_EVENT_ACTIONS.has(row.action)
    ? "event"
    : before && after
      ? "update"
      : after
        ? "insert"
        : "delete";
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((key) => key !== "updated_at")
    .sort((a, b) => a.localeCompare(b));
  return {
    kind,
    changes: keys.map((field) => ({
      field,
      before: before ? formatAuditValue(before[field], maxLength) : null,
      after: after ? formatAuditValue(after[field], maxLength) : null,
    })),
  };
}

/** '2026-09-30 14:05:23' in Malaysia time (sortable; for the CSV and the details panel). */
export function auditTimestamp(iso: string): string {
  const ms = parseInstant(iso);
  if (ms === null) return iso;
  const p = mytParts(ms);
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

/** One audit entry as the /admin/audit table shows it (plain data for a Client Component). */
export type AuditEntryView = {
  id: number;
  occurredAt: string;
  /** '30 Sep 2026, 14:05' (Malaysia time). */
  time: string;
  /** '2026-09-30 14:05:23' (Malaysia time). */
  timestamp: string;
  system: boolean;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  onBehalf: boolean;
  action: string;
  actionLabel: string;
  actionTone: Tone;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  companyId: string | null;
  /** The company's name; null without a company or when it has been deleted. */
  companyName: string | null;
  summary: string | null;
  changeKind: AuditChangeKind;
  changes: AuditChange[];
};

/** Maps an audit_log row for display; long values are shortened (the CSV export keeps them whole). */
export function auditEntryView(
  row: AuditLogRow,
  companyName: string | null,
  maxValueLength = AUDIT_VALUE_PREVIEW_CHARS,
): AuditEntryView {
  const system = isSystemActor(row);
  const meta = auditActionMeta(row.action);
  const { kind, changes } = auditChanges(row, maxValueLength);
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    time: formatDateTime(row.occurred_at),
    timestamp: auditTimestamp(row.occurred_at),
    system,
    actorId: row.actor_id,
    actorEmail: system ? null : row.actor_email,
    actorRole: system ? "System" : auditRoleLabel(row.actor_role),
    onBehalf: row.on_behalf,
    action: row.action,
    actionLabel: meta.label,
    actionTone: meta.tone,
    entity: row.entity,
    entityLabel: auditEntityLabel(row.entity),
    entityId: row.entity_id,
    companyId: row.company_id,
    companyName: row.company_id ? companyName : null,
    summary: row.summary,
    changeKind: kind,
    changes,
  };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

export const AUDIT_CSV_HEADER: readonly string[] = [
  "Entry",
  "Time (Malaysia)",
  "Actor email",
  "Actor role",
  "Actor ID",
  "On behalf",
  "Action",
  "Entity",
  "Entity ID",
  "Company",
  "Company ID",
  "Summary",
  "Old data (JSON)",
  "New data (JSON)",
];

/** One CSV record for an entry. `companyName` resolves the company id (deleted companies keep only the id). */
export function auditCsvRow(row: AuditLogRow, companyName: string | null): CsvValue[] {
  const system = isSystemActor(row);
  return [
    row.id,
    auditTimestamp(row.occurred_at),
    system ? "System" : (row.actor_email ?? ""),
    system ? "System" : (auditRoleLabel(row.actor_role) ?? ""),
    row.actor_id,
    row.on_behalf ? "Yes" : "No",
    row.action,
    row.entity,
    row.entity_id,
    companyName ?? (row.company_id ? "(deleted company)" : ""),
    row.company_id,
    row.summary,
    row.old_data === null ? null : JSON.stringify(row.old_data),
    row.new_data === null ? null : JSON.stringify(row.new_data),
  ];
}

/** Why an export stopped before the last matching entry: file size, time, or the row limit. */
export type AuditExportStop = "size" | "time" | "rows";

/** How the final record of an export cut short begins (the download button looks for it). */
export const AUDIT_EXPORT_INCOMPLETE_MARKER = "Export incomplete:";

/**
 * The text of the final record of an export that stopped before the last matching entry (newest first):
 * how many entries it holds, why it stopped and where, and what to do for the rest.
 */
export function auditIncompleteMessage(
  stop: AuditExportStop,
  progress: {
    written: number;
    total?: number | null;
    lastEntry?: Pick<AuditLogRow, "id" | "occurred_at"> | null;
    /** The limits the export ran with (default AUDIT_EXPORT_MAX_ROWS and AUDIT_EXPORT_MAX_BYTES). */
    maxRows?: number;
    maxBytes?: number;
  },
): string {
  const { written, total, lastEntry } = progress;
  const held =
    typeof total === "number" && total >= written
      ? `the newest ${formatNumber(written)} of the ${formatNumber(total)} matching entries`
      : `the newest ${formatNumber(written)} matching ${written === 1 ? "entry" : "entries"}`;
  const reason =
    stop === "size"
      ? `the file reached the size limit of one export (${formatFileSize(progress.maxBytes ?? AUDIT_EXPORT_MAX_BYTES)})`
      : stop === "time"
        ? "the export reached its time limit"
        : `one export can hold at most ${formatNumber(progress.maxRows ?? AUDIT_EXPORT_MAX_ROWS)} entries`;
  const where = lastEntry
    ? ` Entries numbered below ${formatNumber(lastEntry.id)} (logged up to ${auditTimestamp(lastEntry.occurred_at)}, Malaysia time) are not included.`
    : "";
  return `${AUDIT_EXPORT_INCOMPLETE_MARKER} this file holds ${held} because ${reason}.${where} Narrow the filters, for example to an earlier date range, and export again for the rest.`;
}

/** The final CSV record of an export cut short: the message in the first column, the others empty. */
export function auditIncompleteRecord(message: string): CsvValue[] {
  return [message, ...AUDIT_CSV_HEADER.slice(1).map(() => null)];
}

/** e.g. "Audit log 2026-09-30.csv" (or "Audit log 2026-09-01 to 2026-09-30.csv" for a date range). */
export function auditFileName(filters: AuditFilters, today: string): string {
  if (filters.from || filters.to) return `Audit log ${filters.from ?? "start"} to ${filters.to ?? today}.csv`;
  return `Audit log ${today}.csv`;
}
