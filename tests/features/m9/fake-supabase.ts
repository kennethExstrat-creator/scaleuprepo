// A small PostgREST + Storage fake for the M9 export loaders, used with the real supabase-js client (no
// network). Supports plain `select` columns (or *), filters eq / neq / in / gt / gte / lt / lte / ilike /
// is, `order`, `offset` + `limit` (supabase-js `.range()` / `.limit()`), `Prefer: count=exact` with
// Content-Range (and HEAD), 416 PGRST103 for an offset past the end of a counted read, RPC handlers and
// storage object downloads. Row Level Security is simulated by leaving rows out.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type FakeRequest = { method: string; path: string; params: URLSearchParams; body: unknown };

export type FakeOptions = {
  rpc?: Record<string, (args: Record<string, unknown>) => { status?: number; body: unknown }>;
  /** Storage objects by "<bucket>/<path>"; null = the object is missing. */
  storage?: Record<string, Uint8Array | null>;
  /** Largest page the fake returns (like PostgREST's max_rows). */
  maxRows?: number;
};

function likeToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%" || ch === "*") source += ".*";
    else if (ch === "_") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "is");
}

function compare(a: unknown, b: string): number {
  if (typeof a === "number") return a - Number(b);
  const text = String(a);
  return text < b ? -1 : text > b ? 1 : 0;
}

function matches(row: Row, column: string, op: string, value: string): boolean {
  const cell = row[column];
  switch (op) {
    case "eq":
      return cell !== null && cell !== undefined && String(cell) === value;
    case "neq":
      return cell !== null && cell !== undefined && String(cell) !== value;
    case "in": {
      const list = value
        .replace(/^\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .map((item) => item.replace(/^"|"$/g, ""));
      return cell !== null && cell !== undefined && list.includes(String(cell));
    }
    case "gt":
      return cell !== null && cell !== undefined && compare(cell, value) > 0;
    case "gte":
      return cell !== null && cell !== undefined && compare(cell, value) >= 0;
    case "lt":
      return cell !== null && cell !== undefined && compare(cell, value) < 0;
    case "lte":
      return cell !== null && cell !== undefined && compare(cell, value) <= 0;
    case "ilike":
      return typeof cell === "string" && likeToRegExp(value).test(cell);
    case "is":
      return value === "null" ? cell === null || cell === undefined : String(cell) === value;
    default:
      throw new Error(`fake-supabase: unsupported operator ${op}`);
  }
}

const RESERVED = new Set(["select", "order", "limit", "offset"]);

/** Splits a select list at top-level commas (not inside an embed's parentheses). */
function splitSelect(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function createFakeSupabase(tables: Tables, options: FakeOptions = {}) {
  const requests: FakeRequest[] = [];
  const maxRows = options.maxRows ?? 1000;

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
      new Response(method === "HEAD" || status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json", ...extra },
      });

    if (url.pathname.startsWith("/storage/v1/object/")) {
      const key = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length));
      requests.push({ method, path: `storage/${key}`, params: url.searchParams, body: undefined });
      const object = options.storage?.[key];
      if (!object) {
        return new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(new Blob([new Uint8Array(object)]), { status: 200 });
    }

    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    requests.push({ method, path, params: url.searchParams, body });
    if (path.startsWith("rpc/")) {
      const handler = options.rpc?.[path.slice(4)];
      if (!handler) throw new Error(`fake-supabase: no rpc handler for ${path}`);
      const result = handler((body ?? {}) as Record<string, unknown>);
      return json(result.status ?? 200, result.body);
    }
    if (method !== "GET" && method !== "HEAD") throw new Error(`fake-supabase: unexpected ${method} ${path}`);
    const source = tables[path];
    if (!source) throw new Error(`fake-supabase: unknown table ${path}`);

    let rows = source.filter((row) => {
      for (const [key, raw] of url.searchParams.entries()) {
        // Embedded-resource modifiers (e.g. `submissions.limit=1`) are left to the fixture data.
        if (RESERVED.has(key) || key.includes(".")) continue;
        const dot = raw.indexOf(".");
        if (!matches(row, key, raw.slice(0, dot), raw.slice(dot + 1))) return false;
      }
      return true;
    });
    const order = url.searchParams.get("order");
    if (order) {
      const keys = order.split(",").map((part) => {
        const [column, direction] = part.split(".");
        return { column, desc: direction === "desc" };
      });
      rows = [...rows].sort((a, b) => {
        for (const { column, desc } of keys) {
          const x = a[column];
          const y = b[column];
          if (x === y) continue;
          const result = (x ?? "") < (y ?? "") ? -1 : 1;
          return desc ? -result : result;
        }
        return 0;
      });
    }
    const total = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? maxRows), maxRows);
    const counted = /count=exact/.test(headers.get("Prefer") ?? "");
    if (counted && offset > 0 && offset >= total) {
      return json(416, { code: "PGRST103", message: "Requested range not satisfiable", details: null, hint: null });
    }
    const page = rows.slice(offset, offset + limit);
    const select = url.searchParams.get("select") ?? "*";
    const columns = select === "*" ? null : splitSelect(select);
    // A one-level embed such as `submissions(id)` returns the fixture row's `submissions` value as it is.
    const project = (row: Row, column: string): [string, unknown] => {
      const embed = /^(?:(\w+):)?(\w+)(?:![\w!]+)?\(.*\)$/.exec(column);
      if (embed) return [embed[1] ?? embed[2], row[embed[1] ?? embed[2]] ?? []];
      return [column, row[column] ?? null];
    };
    const projected = columns
      ? page.map((row) => Object.fromEntries(columns.map((column) => project(row, column))))
      : page.map((row) => ({ ...row }));
    const range = page.length > 0 ? `${offset}-${offset + page.length - 1}/${total}` : `*/${total}`;
    return json(200, projected, counted ? { "content-range": range } : {});
  };

  const sb: SupabaseClient<Database> = createClient<Database>("http://fake.local", "fake-publishable-key", {
    global: { fetch: fakeFetch as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sb, requests };
}
