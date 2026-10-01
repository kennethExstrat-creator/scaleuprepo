// A tiny PostgREST emulator for exercising src/lib/data/* with the real supabase-js client (no
// network, no database; tests/db covers the SQL and RLS). Row Level Security is simulated by leaving
// rows out of the table data (e.g. platform_settings: [] for a company user).
// Supports: select trees with `alias:relation!hint!inner(sub)`, `*` and plain columns; many-to-one
// (object | null) and one-to-many (array) embeds resolved through the FK list below; top-level
// filters eq / in / gte / lte; embedded filters `relation.column=eq.x` (with !inner semantics);
// order=col.asc|desc[,...]. RPCs go to `rpc` handlers. Everything else is a test failure.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type Row = Record<string, unknown>;
export type TableData = Record<string, Row[]>;

type Fk = { name: string; table: string; column: string; refTable: string; refColumn: string };

const FKS: Fk[] = [
  ["submission_events_actor_id_fkey", "submission_events", "actor_id", "profiles"],
  ["submission_events_submission_id_fkey", "submission_events", "submission_id", "submissions"],
  ["company_members_user_id_fkey", "company_members", "user_id", "profiles"],
  ["company_members_invited_by_fkey", "company_members", "invited_by", "profiles"],
  ["company_members_company_id_fkey", "company_members", "company_id", "companies"],
  ["kpi_dimension_members_dimension_id_fkey", "kpi_dimension_members", "dimension_id", "kpi_dimensions"],
  ["template_versions_template_id_fkey", "template_versions", "template_id", "templates"],
  ["template_sections_template_version_id_fkey", "template_sections", "template_version_id", "template_versions"],
  ["template_fields_section_id_fkey", "template_fields", "section_id", "template_sections"],
  ["template_fields_template_version_id_fkey", "template_fields", "template_version_id", "template_versions"],
  ["submission_values_submission_id_fkey", "submission_values", "submission_id", "submissions"],
  ["submission_segment_values_submission_id_fkey", "submission_segment_values", "submission_id", "submissions"],
  ["submission_kpi_values_submission_id_fkey", "submission_kpi_values", "submission_id", "submissions"],
  ["company_internal_company_id_fkey", "company_internal", "company_id", "companies"],
  ["company_internal_partner_in_charge_id_fkey", "company_internal", "partner_in_charge_id", "profiles"],
].map(([name, table, column, refTable]) => ({ name, table, column, refTable, refColumn: "id" }));

type SelectNode =
  | { kind: "star" }
  | { kind: "column"; name: string }
  | { kind: "embed"; alias: string; relation: string; hint: string | null; inner: boolean; children: SelectNode[] };

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current !== "") parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

export function parseSelect(select: string): SelectNode[] {
  return splitTopLevel(select).map((item): SelectNode => {
    if (item === "*") return { kind: "star" };
    const m = /^(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_]+)((?:![A-Za-z0-9_]+)*)(?:\(([\s\S]*)\))?$/.exec(item);
    if (!m) throw new Error(`fake-postgrest: cannot parse select item ${item}`);
    const [, alias, name, bangs, sub] = m;
    if (sub === undefined) {
      if (bangs) throw new Error(`fake-postgrest: hint without embed in ${item}`);
      return { kind: "column", name };
    }
    const tokens = bangs.split("!").filter(Boolean);
    const inner = tokens.includes("inner");
    const hints = tokens.filter((t) => t !== "inner" && t !== "left");
    if (hints.length > 1) throw new Error(`fake-postgrest: several hints in ${item}`);
    return { kind: "embed", alias: alias ?? name, relation: name, hint: hints[0] ?? null, inner, children: parseSelect(sub) };
  });
}

function findFk(from: string, to: string, hint: string | null): { fk: Fk; direction: "many-to-one" | "one-to-many" } {
  const candidates = FKS.filter(
    (fk) => (fk.table === from && fk.refTable === to) || (fk.table === to && fk.refTable === from),
  ).filter((fk) => hint === null || fk.name === hint || fk.column === hint);
  if (candidates.length !== 1) {
    throw new Error(`fake-postgrest: ${candidates.length} relationships between ${from} and ${to} (hint ${hint})`);
  }
  const fk = candidates[0];
  return { fk, direction: fk.table === from ? "many-to-one" : "one-to-many" };
}

type Filter = { path: string[]; column: string; op: string; value: string };

function parseFilters(params: URLSearchParams): Filter[] {
  const filters: Filter[] = [];
  for (const [key, raw] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "offset") continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    const parts = key.split(".");
    filters.push({ path: parts.slice(0, -1), column: parts[parts.length - 1], op, value });
  }
  return filters;
}

function matches(row: Row, filter: Filter): boolean {
  const cell = row[filter.column];
  const text = cell === null || cell === undefined ? null : String(cell);
  switch (filter.op) {
    case "eq":
      return text !== null && text === filter.value;
    case "in": {
      const list = filter.value.replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      return text !== null && list.includes(text);
    }
    case "gte":
      return text !== null && text >= filter.value;
    case "lte":
      return text !== null && text <= filter.value;
    default:
      throw new Error(`fake-postgrest: unsupported operator ${filter.op}`);
  }
}

function project(
  data: TableData,
  table: string,
  rows: Row[],
  nodes: SelectNode[],
  filters: Filter[],
  path: string[],
): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const result: Row = {};
    let keep = true;
    for (const node of nodes) {
      if (node.kind === "star") Object.assign(result, structuredClone(row));
      else if (node.kind === "column") result[node.name] = structuredClone(row[node.name]);
      else {
        const { fk, direction } = findFk(table, node.relation, node.hint);
        const childPath = [...path, node.alias];
        const childFilters = filters.filter(
          (f) => f.path.length === childPath.length && f.path.every((p, i) => p === childPath[i] || (i === childPath.length - 1 && p === node.relation)),
        );
        const source = data[node.relation] ?? [];
        const related =
          direction === "many-to-one"
            ? source.filter((r) => r[fk.refColumn] === row[fk.column])
            : source.filter((r) => r[fk.column] === row[fk.refColumn]);
        const filtered = related.filter((r) => childFilters.every((f) => matches(r, f)));
        const projected = project(data, node.relation, filtered, node.children, filters, childPath);
        if (direction === "many-to-one") {
          result[node.alias] = projected[0] ?? null;
          if (node.inner && projected.length === 0) keep = false;
        } else {
          result[node.alias] = projected;
          if (node.inner && projected.length === 0) keep = false;
        }
      }
    }
    if (keep) out.push(result);
  }
  return out;
}

export type RecordedRequest = { method: string; path: string; params: URLSearchParams; body: unknown };

export type FakeOptions = {
  rpc?: Record<string, (args: Record<string, unknown>) => { status?: number; body: unknown }>;
  /** Return a response to short-circuit (e.g. an error) for a request. */
  intercept?: (request: RecordedRequest) => { status: number; body: unknown } | undefined;
};

export function createFakeClient(data: TableData, options: FakeOptions = {}) {
  const requests: RecordedRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const request: RecordedRequest = { method, path, params: url.searchParams, body };
    requests.push(request);
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    const intercepted = options.intercept?.(request);
    if (intercepted) return json(intercepted.status, intercepted.body);

    if (path.startsWith("rpc/")) {
      const fn = options.rpc?.[path.slice(4)];
      if (!fn) throw new Error(`fake-postgrest: no rpc handler for ${path}`);
      const res = fn((body ?? {}) as Record<string, unknown>);
      return json(res.status ?? 200, res.body);
    }
    if (method !== "GET") throw new Error(`fake-postgrest: unexpected ${method} ${path}`);
    const table = path;
    if (!(table in data)) throw new Error(`fake-postgrest: unknown table ${table}`);
    const nodes = parseSelect(url.searchParams.get("select") ?? "*");
    const filters = parseFilters(url.searchParams);
    const top = filters.filter((f) => f.path.length === 0);
    let rows = data[table].filter((row) => top.every((f) => matches(row, f)));
    const order = url.searchParams.get("order");
    if (order) {
      const keys = order.split(",").map((part) => {
        const [column, dir] = part.split(".");
        return { column, desc: dir === "desc" };
      });
      rows = [...rows].sort((a, b) => {
        for (const { column, desc } of keys) {
          const x = a[column] as string | number;
          const y = b[column] as string | number;
          if (x < y) return desc ? 1 : -1;
          if (x > y) return desc ? -1 : 1;
        }
        return 0;
      });
    }
    return json(200, project(data, table, rows, nodes, filters, []));
  };

  const sb: SupabaseClient<Database> = createClient<Database>("http://fake.local", "fake-publishable-key", {
    global: { fetch: fakeFetch as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sb, requests };
}
