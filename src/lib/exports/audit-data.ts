import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { AuditLogRow } from "@/lib/types/domain";

import {
  AUDIT_CSV_HEADER,
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_TIME_BUDGET_MS,
  AUDIT_PAGE_SIZE,
  auditCsvRow,
  auditIncompleteMessage,
  auditIncompleteRecord,
  auditTimeBounds,
  containsPattern,
  type AuditExportStop,
  type AuditFilters,
} from "./audit";
import { CSV_BOM, csvLines } from "./csv";
import { EXPORT_PAGE_SIZE, exportQueryError } from "./fetch-all";

// Reads the audit log with the caller's RLS-scoped client (SELECT: Super Admin, Fund Admin, Partner).
// The log is append-only; entries are listed newest first.

const OP = "auditLog";

/** audit_log filtered by `filters`; "count" adds an exact count, "head" returns only the count. */
function auditQuery(sb: SupabaseClient<Database>, filters: AuditFilters, mode: "rows" | "count" | "head") {
  let query =
    mode === "head"
      ? sb.from("audit_log").select("*", { count: "exact", head: true })
      : mode === "count"
        ? sb.from("audit_log").select("*", { count: "exact" })
        : sb.from("audit_log").select("*");
  if (filters.company) query = query.eq("company_id", filters.company);
  if (filters.actor) query = query.ilike("actor_email", containsPattern(filters.actor));
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entity) query = query.eq("entity", filters.entity);
  const bounds = auditTimeBounds(filters);
  if (bounds.gte) query = query.gte("occurred_at", bounds.gte);
  if (bounds.lt) query = query.lt("occurred_at", bounds.lt);
  return query;
}

/**
 * One page (AUDIT_PAGE_SIZE entries, newest first) and the number of matching entries. A page past the
 * end returns no rows (and `total` null when the database could not count it).
 */
export async function listAuditPage(
  sb: SupabaseClient<Database>,
  filters: AuditFilters,
  page: number,
): Promise<{ rows: AuditLogRow[]; total: number | null }> {
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await auditQuery(sb, filters, "count")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1);
  if (error) {
    // PostgREST answers 416 (PGRST103) when the offset is past the last entry.
    if (error.code === "PGRST103") return { rows: [], total: await countAuditEntries(sb, filters) };
    throw exportQueryError(OP, "load the audit log", error);
  }
  const rows: AuditLogRow[] = data;
  return { rows, total: count };
}

/** How many entries match the filters. */
export async function countAuditEntries(sb: SupabaseClient<Database>, filters: AuditFilters): Promise<number> {
  const { count, error } = await auditQuery(sb, filters, "head");
  if (error) throw exportQueryError(OP, "count the audit log entries", error);
  return count ?? 0;
}

/**
 * The newest entry's number (0 when the log is empty): an export reads the entries up to it, so it holds
 * exactly the entries that existed when it started — not its own `export` entry, logged just after.
 */
export async function latestAuditEntryId(sb: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await sb.from("audit_log").select("id").order("id", { ascending: false }).limit(1);
  if (error) throw exportQueryError(OP, "read the newest audit log entry", error);
  const rows: { id: number }[] = data;
  return rows.length > 0 ? rows[0].id : 0;
}

/** Company names by id (every company the caller can see), for the company column. */
export async function loadCompanyNames(sb: SupabaseClient<Database>): Promise<Map<string, string>> {
  const { data, error } = await sb.from("companies").select("id, name").order("name");
  if (error) throw exportQueryError(OP, "load the companies", error);
  const rows: { id: string; name: string }[] = data;
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The parts joined into one chunk (`size` = their total length). */
function concatBytes(parts: readonly Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

export type AuditCsvStreamOptions = {
  /** Only entries up to this number (latestAuditEntryId): the entries that existed when the export started. */
  upToId?: number;
  /** How many entries match (countAuditEntries), for the final record of a file cut short. */
  total?: number;
  /** Most bytes the file may hold (default AUDIT_EXPORT_MAX_BYTES). */
  maxBytes?: number;
  /** How long the stream keeps reading entries, in ms from its creation (default AUDIT_EXPORT_TIME_BUDGET_MS). */
  timeBudgetMs?: number;
  /** The clock (milliseconds), for tests. */
  now?: () => number;
};

/**
 * The filtered log as a CSV stream (UTF-8 BOM, CRLF), newest entry first, read 1000 entries at a time by
 * entry number so entries logged meanwhile never shift or repeat rows. `upToId` (latestAuditEntryId)
 * leaves out entries logged after the export started.
 *
 * The file is bounded by entries (`maxRows`), size (`maxBytes`: an entry holds its old and new values in
 * full, so a few thousand long narrative autosaves can be many megabytes) and time (`timeBudgetMs`, so it
 * ends cleanly before the route's time limit instead of being cut off mid-row). When it stops with
 * matching entries left, its final record says so (auditIncompleteMessage, beginning with
 * AUDIT_EXPORT_INCOMPLETE_MARKER): how many entries it holds, where it stops and to narrow the filters.
 */
export function auditCsvStream(
  sb: SupabaseClient<Database>,
  filters: AuditFilters,
  companyNames: ReadonlyMap<string, string>,
  maxRows: number,
  options: AuditCsvStreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const maxBytes = options.maxBytes ?? AUDIT_EXPORT_MAX_BYTES;
  const timeBudgetMs = options.timeBudgetMs ?? AUDIT_EXPORT_TIME_BUDGET_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  // Entries are read with `id < cursor`.
  let cursor: number | null = options.upToId === undefined ? null : options.upToId + 1;
  let written = 0;
  let bytes = 0;
  let lastEntry: AuditLogRow | null = null;
  let headerSent = false;

  const page = (limit: number) => {
    let query = auditQuery(sb, filters, "rows");
    if (cursor !== null) query = query.lt("id", cursor);
    return query.order("id", { ascending: false }).limit(limit);
  };

  /** True when a matching entry is left after the last one written. */
  const moreLeft = async (): Promise<boolean> => {
    const { data, error } = await page(1);
    if (error) throw exportQueryError(OP, "export the audit log", error);
    const rows: AuditLogRow[] = data;
    return rows.length > 0;
  };

  const incompleteRecord = (stop: AuditExportStop): Uint8Array => {
    const message = auditIncompleteMessage(stop, { written, total: options.total, lastEntry, maxRows, maxBytes });
    return encoder.encode(csvLines([auditIncompleteRecord(message)]));
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          const header = encoder.encode(CSV_BOM + csvLines([AUDIT_CSV_HEADER]));
          bytes += header.byteLength;
          controller.enqueue(header);
          return;
        }
        const remaining = maxRows - written;
        const outOfTime = now() - startedAt >= timeBudgetMs;
        if (remaining <= 0 || outOfTime) {
          // Stop here; when entries are left, the final record says so.
          if (await moreLeft()) controller.enqueue(incompleteRecord(outOfTime ? "time" : "rows"));
          controller.close();
          return;
        }
        const { data, error } = await page(Math.min(EXPORT_PAGE_SIZE, remaining));
        if (error) throw exportQueryError(OP, "export the audit log", error);
        const rows: AuditLogRow[] = data;
        if (rows.length === 0) {
          controller.close();
          return;
        }
        const lines: Uint8Array[] = [];
        let chunkBytes = 0;
        let full = false;
        for (const row of rows) {
          const companyName = row.company_id ? (companyNames.get(row.company_id) ?? null) : null;
          const line = encoder.encode(csvLines([auditCsvRow(row, companyName)]));
          if (bytes + line.byteLength > maxBytes) {
            full = true;
            break;
          }
          lines.push(line);
          chunkBytes += line.byteLength;
          bytes += line.byteLength;
          written += 1;
          lastEntry = row;
          cursor = row.id;
        }
        if (lines.length > 0) controller.enqueue(concatBytes(lines, chunkBytes));
        if (full) {
          // The entry that did not fit is still to come, so the file is incomplete.
          controller.enqueue(incompleteRecord("size"));
          controller.close();
        }
      } catch (error) {
        console.error("[exports] audit CSV stream failed", error);
        controller.error(error);
      }
    },
  });
}
