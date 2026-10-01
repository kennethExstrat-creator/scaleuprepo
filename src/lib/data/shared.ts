import "server-only";

// Internal helpers of the data layer: id checks, deterministic sorting and row → domain shaping.
// Not re-exported from src/lib/data/index.ts.

import { toFiniteNumber } from "@/lib/format";
import { parseInstant } from "@/lib/periods";
import { kpiCellKey } from "@/lib/targets";
import {
  emptySubmissionValues,
  type MemberWithProfile,
  type SubmissionEventWithActor,
  type SubmissionFinancialsRow,
  type SubmissionFinancialsViewRow,
  type SubmissionKpiValueRow,
  type SubmissionOverviewRow,
  type SubmissionOverviewViewRow,
  type SubmissionSegmentValueRow,
  type SubmissionValueRow,
  type SubmissionValues,
} from "@/lib/types/domain";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a UUID. Ids that are not UUIDs can never match a row, and PostgREST would reject them with an
 * error (22P02), so the getters treat them as "not found" without querying.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------------------------------------------------------------------------------------
// Sorting (always with a final tie-break on the id, so the order never depends on the database)
// ---------------------------------------------------------------------------------------------

type Comparator<T> = (a: T, b: T) => number;

/** A sorted copy of `items`; each comparator breaks the ties of the previous ones. */
export function sortBy<T>(items: readonly T[], ...comparators: Comparator<T>[]): T[] {
  return [...items].sort((a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  });
}

/** Code-point order (ids, keys). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Human order for names: case- and accent-insensitive, numbers by value ("Outlet 2" < "Outlet 10"). */
function compareNames(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "en-GB", { sensitivity: "base", numeric: true });
}

const activeFirst: Comparator<{ is_active: boolean }> = (a, b) => Number(b.is_active) - Number(a.is_active);
const bySortOrder: Comparator<{ sort_order: number }> = (a, b) => a.sort_order - b.sort_order;
const byName: Comparator<{ name: string }> = (a, b) => compareNames(a.name, b.name);
const byKey: Comparator<{ key: string }> = (a, b) => compareStrings(a.key, b.key);
const byId: Comparator<{ id: string }> = (a, b) => compareStrings(a.id, b.id);

type Configurable = { id: string; name: string; sort_order: number; is_active: boolean };

/** Revenue segments, KPIs and dimension members: active first, then `sort_order`, then name. */
export function sortConfigRows<T extends Configurable>(rows: readonly T[]): T[] {
  return sortBy(rows, activeFirst, bySortOrder, byName, byId);
}

/** KPI dimensions by name. */
export function sortDimensions<T extends { id: string; name: string }>(rows: readonly T[]): T[] {
  return sortBy(rows, byName, byId);
}

/** Template sections and fields: `sort_order`, then key (the order `private.validate_submission()` uses). */
export function sortTemplateRows<T extends { id: string; key: string; sort_order: number }>(rows: readonly T[]): T[] {
  return sortBy(rows, bySortOrder, byKey, byId);
}

/** The name shown for a person: full name, else email; null when unknown. */
export function displayName(
  profile: { full_name: string | null; email: string | null } | null | undefined,
): string | null {
  if (!profile) return null;
  const name = profile.full_name?.trim();
  if (name) return name;
  const email = profile.email?.trim();
  return email ? email : null;
}

/**
 * Company members: active first, owners before contributors, then by name (or email); members whose
 * profile is not visible come after the named ones of their group.
 */
export function sortCompanyMembers(rows: readonly MemberWithProfile[]): MemberWithProfile[] {
  return sortBy(
    rows,
    activeFirst,
    (a, b) => Number(a.role !== "owner") - Number(b.role !== "owner"),
    (a, b) => Number(displayName(a.profile) === null) - Number(displayName(b.profile) === null),
    (a, b) => compareNames(displayName(a.profile), displayName(b.profile)),
    (a, b) => compareStrings(a.user_id, b.user_id),
  );
}

/** Timeline events: oldest first (ties in the same millisecond by id, i.e. insertion order). */
export function sortEvents(rows: readonly SubmissionEventWithActor[]): SubmissionEventWithActor[] {
  return sortBy(
    rows,
    (a, b) => (parseInstant(a.created_at) ?? 0) - (parseInstant(b.created_at) ?? 0),
    (a, b) => a.id - b.id,
  );
}

/** Newest month first (months are 'YYYY-MM-DD', so string order is date order). */
export function sortByMonthDesc<T extends { month: string }>(rows: readonly T[]): T[] {
  return sortBy(rows, (a, b) => compareStrings(b.month, a.month));
}

/** Oldest month first. */
export function sortByMonthAsc<T extends { month: string }>(rows: readonly T[]): T[] {
  return sortBy(rows, (a, b) => compareStrings(a.month, b.month));
}

// ---------------------------------------------------------------------------------------------
// Shaping rows
// ---------------------------------------------------------------------------------------------

/** Indexes a submission's stored rows by field key, segment id and KPI cell key. */
export function buildSubmissionValues(
  values: readonly SubmissionValueRow[],
  segments: readonly SubmissionSegmentValueRow[],
  kpis: readonly SubmissionKpiValueRow[],
): SubmissionValues {
  const result = emptySubmissionValues();
  for (const row of values) result.values[row.field_key] = row;
  for (const row of segments) result.segments[row.segment_id] = toFiniteNumber(row.amount);
  for (const row of kpis) result.kpis[kpiCellKey(row.kpi_id, row.dimension_member_id)] = row;
  return result;
}

/** A v_submission_overview row with its never-null columns checked; null if the identity is missing. */
export function toOverviewRow(row: SubmissionOverviewViewRow): SubmissionOverviewRow | null {
  const { id, company_id, month, status, due_date } = row;
  if (!id || !company_id || !month || !status || !due_date) return null;
  return {
    ...row,
    id,
    company_id,
    month,
    status,
    due_date,
    revision: row.revision ?? 0,
    is_overdue: row.is_overdue ?? false,
    days_overdue: row.days_overdue ?? 0,
    has_narrative: row.has_narrative ?? false,
    open_threads: row.open_threads ?? 0,
  };
}

/** A v_submission_financials row with its never-null columns checked; null if the identity is missing. */
export function toFinancialsRow(row: SubmissionFinancialsViewRow): SubmissionFinancialsRow | null {
  const { submission_id, company_id, month, status, due_date, currency } = row;
  if (!submission_id || !company_id || !month || !status || !due_date || !currency) return null;
  return { ...row, submission_id, company_id, month, status, due_date, currency: currency.trim() };
}
