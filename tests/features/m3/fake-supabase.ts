// A small in-memory stand-in for the RLS-scoped Supabase client, enough for the template builder's
// actions: select / insert / update / delete with eq, neq and in filters, maybeSingle / single, the
// unique (template_version_id, key) constraints, cascades from versions and sections, and RPC handlers.
// Row Level Security is simulated by `writable`: writes to rows it rejects affect nothing (as RLS
// hides the rows of versions that are no longer drafts). The database itself is tested in tests/db.
import type { TemplateVersionFull } from "@/lib/types/domain";

import { seedVersion } from "./fixtures";

export type Row = Record<string, unknown>;
type Filter = { op: "eq" | "neq" | "in"; column: string; value: unknown };
type Operation = "select" | "insert" | "update" | "delete";

export type RecordedCall = { table: string; op: Operation; payload?: unknown; filters: Filter[] };
type Result = { data: unknown; error: { code: string; message: string } | null };

const UNIQUE_KEYS: Record<string, string[]> = {
  template_sections: ["template_version_id", "key"],
  template_fields: ["template_version_id", "key"],
};

let counter = 0;
function newId(): string {
  counter += 1;
  return `f0000000-0000-4000-9000-${String(counter).padStart(12, "0")}`;
}

class FakeQuery implements PromiseLike<Result> {
  private op: Operation = "select";
  private payload: unknown;
  private filters: Filter[] = [];
  private modifier: "single" | "maybeSingle" | null = null;
  /** The select list (not interpreted: every column is returned). */
  columns = "*";

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns?: string) {
    this.columns = columns ?? "*";
    return this;
  }
  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    this.modifier = "maybeSingle";
    return this;
  }
  single() {
    this.modifier = "single";
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onFulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.db.execute(this.table, this.op, this.payload, this.filters, this.modifier))
      .then(onFulfilled, onRejected);
  }
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column];
    if (filter.op === "eq") return value === filter.value;
    if (filter.op === "neq") return value !== filter.value;
    return Array.isArray(filter.value) && filter.value.includes(value);
  });
}

export class FakeSupabase {
  tables: Record<string, Row[]>;
  calls: RecordedCall[] = [];
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  rpcHandlers: Record<string, (args: Record<string, unknown>) => Result> = {};
  /** Simulated RLS for writes (default: sections, fields and notes only while their version is a draft). */
  writable: (table: string, row: Row) => boolean;

  constructor(tables: Record<string, Row[]>) {
    this.tables = tables;
    this.writable = (table, row) => {
      if (table === "template_sections" || table === "template_fields") {
        return this.versionStatus(String(row.template_version_id)) === "draft";
      }
      return true;
    };
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcHandlers[name];
    const result: Result = handler ? handler(args) : { data: null, error: { code: "PGRST202", message: `no rpc ${name}` } };
    return Promise.resolve(result);
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  versionStatus(versionId: string): unknown {
    return this.rows("template_versions").find((row) => row.id === versionId)?.status;
  }

  writes(): RecordedCall[] {
    return this.calls.filter((call) => call.op !== "select");
  }

  execute(
    table: string,
    op: Operation,
    payload: unknown,
    filters: Filter[],
    modifier: "single" | "maybeSingle" | null,
  ): Result {
    this.calls.push({ table, op, payload, filters });
    const rows = this.rows(table);
    let data: Row[] = [];

    if (op === "select") {
      data = rows.filter((row) => matches(row, filters)).map((row) => ({ ...row }));
    } else if (op === "insert") {
      const row: Row = { id: newId(), ...(payload as Row) };
      const unique = UNIQUE_KEYS[table];
      if (unique && rows.some((other) => unique.every((column) => other[column] === row[column]))) {
        return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${table}` } };
      }
      rows.push(row);
      data = [{ ...row }];
    } else if (op === "update") {
      for (const row of rows) {
        if (matches(row, filters) && this.writable(table, row)) {
          Object.assign(row, payload as Row);
          data.push({ ...row });
        }
      }
    } else {
      const removed = rows.filter((row) => matches(row, filters) && this.writable(table, row));
      this.tables[table] = rows.filter((row) => !removed.includes(row));
      for (const row of removed) this.cascade(table, row);
      data = removed.map((row) => ({ ...row }));
    }

    if (modifier === "maybeSingle") return { data: data[0] ?? null, error: null };
    if (modifier === "single") {
      return data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { data, error: null };
  }

  private cascade(table: string, row: Row) {
    if (table === "template_versions") {
      this.tables.template_sections = this.rows("template_sections").filter((s) => s.template_version_id !== row.id);
      this.tables.template_fields = this.rows("template_fields").filter((f) => f.template_version_id !== row.id);
    }
    if (table === "template_sections") {
      this.tables.template_fields = this.rows("template_fields").filter((f) => f.section_id !== row.id);
    }
  }

  /** The version as getTemplateVersion returns it (sections and fields sorted), or null. */
  assemble(versionId: string): TemplateVersionFull | null {
    const version = this.rows("template_versions").find((row) => row.id === versionId);
    if (!version) return null;
    const template = this.rows("templates").find((row) => row.id === version.template_id);
    const byOrder = (a: Row, b: Row) =>
      Number(a.sort_order) - Number(b.sort_order) || String(a.key).localeCompare(String(b.key));
    const sections = this.rows("template_sections")
      .filter((section) => section.template_version_id === versionId)
      .sort(byOrder)
      .map((section) => ({
        ...section,
        fields: this.rows("template_fields")
          .filter((field) => field.section_id === section.id)
          .sort(byOrder)
          .map((field) => ({ ...field })),
      }));
    return structuredClone({ ...version, template, sections }) as TemplateVersionFull;
  }
}

/** The seeded template: v1 published and v2, a draft copy of it. */
export function seededFake(): FakeSupabase {
  const v1 = seedVersion(1);
  const v2 = seedVersion(2);
  const without = (value: object, ...keys: string[]): Row =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const versionRow = (version: TemplateVersionFull) => without(version, "sections", "template");
  const sectionRows = (version: TemplateVersionFull) => version.sections.map((section) => without(section, "fields"));
  const fieldRows = (version: TemplateVersionFull) =>
    version.sections.flatMap((section) => section.fields.map((field) => ({ ...field })));
  return new FakeSupabase({
    templates: [{ ...v1.template }],
    template_versions: [versionRow(v1), versionRow(v2)],
    template_sections: [...sectionRows(v1), ...sectionRows(v2)],
    template_fields: [...fieldRows(v1), ...fieldRows(v2)],
  });
}
