/**
 * npm run db:types — generates src/lib/supabase/database.types.ts from supabase/migrations.
 *
 * Builds the schema in PGlite (tests/db/supabase-shim.sql + every migration, no seed), introspects
 * the `public` schema and prints the same structure as the official `supabase gen types typescript`
 * (postgres-meta typegen, prettier-formatted): Tables (Row / Insert / Update / Relationships incl.
 * PostgREST view relationships), Views, Functions (Args / Returns), Enums, CompositeTypes, the
 * `__InternalSupabase.PostgrestVersion` marker, the Tables / TablesInsert / TablesUpdate / Enums /
 * CompositeTypes helpers and the `Constants` object.
 *
 * Options:
 *   --check                  exit 1 if the file on disk is out of date (for CI)
 *   --out <path>             write somewhere else
 *   POSTGREST_VERSION=14     value of __InternalSupabase.PostgrestVersion (default "14": the hosted
 *                            project runs PostgREST 14; postgrest-js treats 13 and 14 alike)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDatabase, ROOT_DIR } from "../tests/db/schema";

const SCHEMA = "public";
const PRINT_WIDTH = 80;
const DEFAULT_OUT = path.join(ROOT_DIR, "src", "lib", "supabase", "database.types.ts");

// ---------------------------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------------------------
type PgType = {
  id: number;
  name: string;
  schema: string;
  typtype: string; // b base, c composite, d domain, e enum, p pseudo, r range
  category: string; // A = array
  elem: number; // element type for arrays
  base: number; // base type for domains
  relid: number; // composite: pg_class oid
};

type Relation = { id: number; name: string; kind: "table" | "view"; isUpdatable: boolean };

type Column = {
  tableId: number;
  name: string;
  typeId: number;
  isNullable: boolean;
  identity: string; // '' | 'a' (always) | 'd' (by default)
  generated: string; // '' | 's'
  hasDefault: boolean;
  isUpdatable: boolean;
};

type FnArg = { name: string; typeId: number; mode: string; hasDefault: boolean };

type Fn = {
  name: string;
  args: FnArg[];
  returnTypeId: number;
  returnsSet: boolean;
  /** RETURNS TABLE (...) columns. */
  tableColumns: { name: string; typeId: number }[];
};

type Rel = {
  foreignKeyName: string;
  schema: string;
  relation: string;
  columns: string[];
  isOneToOne: boolean;
  referencedSchema: string;
  referencedRelation: string;
  referencedColumns: string[];
};

type Introspection = {
  types: Map<number, PgType>;
  relations: Relation[];
  columns: Column[];
  enums: { name: string; values: string[] }[];
  composites: { name: string; attributes: { name: string; typeId: number }[] }[];
  functions: Fn[];
  relationships: Rel[];
};

const TABLE_RELATIONSHIPS_SQL = String.raw`
with pks_uniques_cols as (
  select connamespace, conrelid, jsonb_agg(column_info.cols) as cols
  from pg_constraint
  join lateral (
    select array_agg(cols.attname order by cols.attnum) as cols
    from (select unnest(conkey) as col) _
    join pg_attribute cols on cols.attrelid = conrelid and cols.attnum = col
  ) column_info on true
  where contype in ('p', 'u') and connamespace::regnamespace::text <> 'pg_catalog'
  group by connamespace, conrelid
)
select
  traint.conname as foreign_key_name,
  ns1.nspname as schema,
  tab.relname as relation,
  column_info.cols as columns,
  ns2.nspname as referenced_schema,
  other.relname as referenced_relation,
  column_info.refs as referenced_columns,
  (column_info.cols in (select * from jsonb_array_elements(pks_uqs.cols))) as is_one_to_one
from pg_constraint traint
join lateral (
  select
    jsonb_agg(cols.attname order by ord) as cols,
    jsonb_agg(refs.attname order by ord) as refs
  from unnest(traint.conkey, traint.confkey) with ordinality as _(col, ref, ord)
  join pg_attribute cols on cols.attrelid = traint.conrelid and cols.attnum = col
  join pg_attribute refs on refs.attrelid = traint.confrelid and refs.attnum = ref
) as column_info on true
join pg_namespace ns1 on ns1.oid = traint.connamespace
join pg_class tab on tab.oid = traint.conrelid
join pg_class other on other.oid = traint.confrelid
join pg_namespace ns2 on ns2.oid = other.relnamespace
left join pks_uniques_cols pks_uqs on pks_uqs.connamespace = traint.connamespace and pks_uqs.conrelid = traint.conrelid
where traint.contype = 'f' and traint.conparentid = 0
order by traint.conrelid, traint.conname`;

// Adapted from PostgREST's schema cache (as used by postgres-meta): which view columns expose
// which table key columns, so embedding works through views.
const VIEWS_KEY_DEPENDENCIES_SQL = String.raw`
with recursive
pks_fks as (
  select contype::text as contype, conname, array_length(conkey, 1) as ncol, conrelid as resorigtbl, col as resorigcol, ord
  from pg_constraint
  left join lateral unnest(conkey) with ordinality as _(col, ord) on true
  where contype in ('p', 'f')
  union
  select concat(contype, '_ref') as contype, conname, array_length(confkey, 1) as ncol, confrelid, col, ord
  from pg_constraint
  left join lateral unnest(confkey) with ordinality as _(col, ord) on true
  where contype = 'f'
),
views as (
  select c.oid as view_id, n.nspname as view_schema, c.relname as view_name, r.ev_action as view_definition
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_rewrite r on r.ev_class = c.oid
  where c.relkind in ('v', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
),
transform_json as (
  select view_id, view_schema, view_name,
    replace(replace(replace(replace(replace(replace(replace(
    regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      view_definition::text,
      '<>', '()'),
      ',', ''),
      E'\\{', ''),
      E'\\}', ''),
      ' :targetList ', ',"targetList":'),
      ' :resno ', ',"resno":'),
      ' :resorigtbl ', ',"resorigtbl":'),
      ' :resorigcol ', ',"resorigcol":'),
      '{', '{ :'),
      '((', '{(('),
      '({', '{({'),
    ' :[^}{,]+', ',"":', 'g'),
      ',"":}', '}'),
      ',"":,', ','),
      '{(', '('),
      '{,', '{'),
      '(', '['),
      ')', ']'),
      ' ', ',')::json as view_definition
  from views
),
target_entries as (
  select view_id, view_schema, view_name, json_array_elements(view_definition->0->'targetList') as entry
  from transform_json
),
results as (
  select view_id, view_schema, view_name,
    (entry->>'resno')::int as view_column,
    (entry->>'resorigtbl')::oid as resorigtbl,
    (entry->>'resorigcol')::int as resorigcol
  from target_entries
),
recursion(view_id, view_schema, view_name, view_column, resorigtbl, resorigcol, is_cycle, path) as (
  select r.*, false, array[resorigtbl] from results r
  union all
  select view.view_id, view.view_schema, view.view_name, view.view_column, tab.resorigtbl, tab.resorigcol,
    tab.resorigtbl = any(path), path || tab.resorigtbl
  from recursion view
  join results tab on view.resorigtbl = tab.view_id and view.resorigcol = tab.view_column
  where not is_cycle
),
repeated_references as (
  select view_id, view_schema, view_name, resorigtbl, resorigcol, array_agg(attname) as view_columns
  from recursion
  join pg_attribute vcol on vcol.attrelid = view_id and vcol.attnum = view_column
  group by view_id, view_schema, view_name, resorigtbl, resorigcol
)
select
  sch.nspname as table_schema,
  tbl.relname as table_name,
  rep.view_schema,
  rep.view_name,
  pks_fks.conname as constraint_name,
  pks_fks.contype as constraint_type,
  jsonb_agg(jsonb_build_object('table_column', col.attname, 'view_columns', view_columns) order by pks_fks.ord) as column_dependencies
from repeated_references rep
join pks_fks using (resorigtbl, resorigcol)
join pg_class tbl on tbl.oid = rep.resorigtbl
join pg_attribute col on col.attrelid = tbl.oid and col.attnum = rep.resorigcol
join pg_namespace sch on sch.oid = tbl.relnamespace
group by sch.nspname, tbl.relname, rep.view_schema, rep.view_name, pks_fks.conname, pks_fks.contype, pks_fks.ncol
having ncol = array_length(array_agg(row(col.attname, view_columns) order by pks_fks.ord), 1)`;

type KeyDep = {
  table_schema: string;
  table_name: string;
  view_schema: string;
  view_name: string;
  constraint_name: string;
  constraint_type: string;
  column_dependencies: { table_column: string; view_columns: string[] }[];
};

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}

/** Table relationships plus PostgREST-style relationships through views (as postgres-meta lists them). */
function withViewRelationships(tableRels: Rel[], keyDeps: KeyDep[]): Rel[] {
  const expand = (deps: KeyDep["column_dependencies"]) => cartesian(deps.map((d) => d.view_columns));
  const viewRels = tableRels.flatMap((r) => {
    const viewToTable = keyDeps.filter(
      (d) => d.table_schema === r.schema && d.table_name === r.relation && d.constraint_name === r.foreignKeyName && d.constraint_type === "f",
    );
    const tableToView = keyDeps.filter(
      (d) =>
        d.table_schema === r.referencedSchema &&
        d.table_name === r.referencedRelation &&
        d.constraint_name === r.foreignKeyName &&
        d.constraint_type === "f_ref",
    );
    const v2t = viewToTable.flatMap((d) =>
      expand(d.column_dependencies).map((viewColumns) => ({ ...r, schema: d.view_schema, relation: d.view_name, columns: viewColumns })),
    );
    const t2v = tableToView.flatMap((d) =>
      expand(d.column_dependencies).map((viewColumns) => ({
        ...r,
        referencedSchema: d.view_schema,
        referencedRelation: d.view_name,
        referencedColumns: viewColumns,
      })),
    );
    const v2v = viewToTable.flatMap((from) =>
      tableToView.flatMap((to) =>
        expand(from.column_dependencies).flatMap((fromColumns) =>
          expand(to.column_dependencies).map((toColumns) => ({
            ...r,
            schema: from.view_schema,
            relation: from.view_name,
            columns: fromColumns,
            referencedSchema: to.view_schema,
            referencedRelation: to.view_name,
            referencedColumns: toColumns,
          })),
        ),
      ),
    );
    return [...v2t, ...t2v, ...v2v];
  });
  return [...tableRels, ...viewRels];
}

async function introspect(db: PGlite): Promise<Introspection> {
  const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params as never[])).rows;

  const types = new Map<number, PgType>();
  for (const t of await q<PgType>(
    `select t.oid::int as id, t.typname as name, n.nspname as schema, t.typtype::text as typtype, t.typcategory::text as category,
            t.typelem::int as elem, t.typbasetype::int as base, t.typrelid::int as relid
     from pg_type t join pg_namespace n on n.oid = t.typnamespace`,
  )) {
    types.set(t.id, t);
  }

  const relations = await q<Relation>(
    `select c.oid::int as id, c.relname as name,
            case when c.relkind in ('r', 'p') then 'table' else 'view' end as kind,
            case when c.relkind in ('v', 'm') then (pg_relation_is_updatable(c.oid::regclass, false) & 20) = 20 else true end as "isUpdatable"
     from pg_class c
     where c.relnamespace = $1::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     order by c.relname`,
    [SCHEMA],
  );

  const columns = await q<Column>(
    `select a.attrelid::int as "tableId", a.attname as name, a.atttypid::int as "typeId",
            not a.attnotnull as "isNullable", a.attidentity::text as identity, a.attgenerated::text as generated,
            (ad.adbin is not null) as "hasDefault",
            coalesce(ic.is_updatable = 'YES', false) as "isUpdatable"
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     left join information_schema.columns ic
       on ic.table_schema = $1 and ic.table_name = c.relname and ic.column_name = a.attname
     where c.relnamespace = $1::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
     order by a.attrelid, a.attnum`,
    [SCHEMA],
  );

  const enums = await q<{ name: string; values: string[] }>(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as values
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typnamespace = $1::regnamespace
     group by t.typname order by t.typname`,
    [SCHEMA],
  );

  const compositeRows = await q<{ name: string; attributes: { name: string; typeId: number }[] }>(
    `select t.typname as name,
            coalesce(jsonb_agg(jsonb_build_object('name', a.attname, 'typeId', a.atttypid::int) order by a.attnum)
                     filter (where a.attnum > 0), '[]') as attributes
     from pg_type t
     join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
     left join pg_attribute a on a.attrelid = c.oid and not a.attisdropped
     where t.typnamespace = $1::regnamespace and t.typtype = 'c'
     group by t.typname order by t.typname`,
    [SCHEMA],
  );

  type FnRow = {
    name: string;
    arg_types: number[];
    arg_modes: string[] | null;
    arg_names: string[] | null;
    nargs: number;
    ndefaults: number;
    return_type: number;
    returns_set: boolean;
  };
  const fnRows = await q<FnRow>(
    `select p.proname as name,
            coalesce(p.proallargtypes::int[], p.proargtypes::oid[]::int[]) as arg_types,
            p.proargmodes::text[] as arg_modes,
            p.proargnames as arg_names,
            p.pronargs::int as nargs,
            p.pronargdefaults::int as ndefaults,
            p.prorettype::int as return_type,
            p.proretset as returns_set
     from pg_proc p
     where p.pronamespace = $1::regnamespace and p.prokind = 'f'
     order by p.proname, p.oid`,
    [SCHEMA],
  );
  const functions: Fn[] = [];
  for (const f of fnRows) {
    const returnType = types.get(f.return_type);
    if (returnType && ["trigger", "event_trigger"].includes(returnType.name)) continue;
    const modes = f.arg_modes ?? f.arg_types.map(() => "i");
    const names = f.arg_names ?? f.arg_types.map(() => "");
    // Defaults apply to the last `ndefaults` input arguments.
    const inputIndexes = modes.map((m, i) => (["i", "b", "v"].includes(m) ? i : -1)).filter((i) => i >= 0);
    const defaulted = new Set(inputIndexes.slice(inputIndexes.length - f.ndefaults));
    const args: FnArg[] = f.arg_types.map((typeId, i) => ({ name: names[i] ?? "", typeId, mode: modes[i], hasDefault: defaulted.has(i) }));
    const inArgs = args.filter((a) => ["i", "b", "v"].includes(a.mode));
    // Same filter as postgres-meta: PostgREST only exposes these signatures.
    const exposed =
      inArgs.length === 0 ||
      inArgs.every((a) => a.name !== "") ||
      inArgs.every((a) => a.name !== "" || a.hasDefault) ||
      (inArgs.length === 1 && ["json", "jsonb", "text", "varchar", "bytea"].includes(types.get(inArgs[0].typeId)?.name ?? ""));
    if (!exposed) continue;
    functions.push({
      name: f.name,
      args,
      returnTypeId: f.return_type,
      returnsSet: f.returns_set,
      tableColumns: args.filter((a) => a.mode === "t").map((a) => ({ name: a.name, typeId: a.typeId })),
    });
  }

  const tableRels = (
    await q<{
      foreign_key_name: string;
      schema: string;
      relation: string;
      columns: string[];
      referenced_schema: string;
      referenced_relation: string;
      referenced_columns: string[];
      is_one_to_one: boolean;
    }>(TABLE_RELATIONSHIPS_SQL)
  ).map(
    (r): Rel => ({
      foreignKeyName: r.foreign_key_name,
      schema: r.schema,
      relation: r.relation,
      columns: r.columns,
      isOneToOne: r.is_one_to_one,
      referencedSchema: r.referenced_schema,
      referencedRelation: r.referenced_relation,
      referencedColumns: r.referenced_columns,
    }),
  );
  const keyDeps = await q<KeyDep>(VIEWS_KEY_DEPENDENCIES_SQL);

  return {
    types,
    relations,
    columns,
    enums,
    composites: compositeRows,
    functions,
    relationships: withViewRelationships(tableRels, keyDeps),
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering (mirrors postgres-meta's typescript template after prettier)
// ---------------------------------------------------------------------------------------------
const NUMBER_TYPES = new Set(["int2", "int4", "int8", "float4", "float8", "numeric"]);
const STRING_TYPES = new Set([
  "bytea",
  "bpchar",
  "varchar",
  "date",
  "text",
  "citext",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "uuid",
  "vector",
]);

function tsType(ctx: Introspection, typeId: number): string {
  const t = ctx.types.get(typeId);
  if (!t) return "unknown";
  if (t.typtype === "d") return tsType(ctx, t.base);
  if (t.category === "A" && t.elem) {
    const inner = tsType(ctx, t.elem);
    return inner.includes("|") ? `(${inner})[]` : `${inner}[]`;
  }
  if (t.name === "bool") return "boolean";
  if (NUMBER_TYPES.has(t.name)) return "number";
  if (STRING_TYPES.has(t.name)) return "string";
  if (t.name === "json" || t.name === "jsonb") return "Json";
  if (t.name === "void") return "undefined";
  if (t.name === "record") return "Record<string, unknown>";
  if (t.typtype === "e") {
    if (t.schema === SCHEMA) return `Database[${q(SCHEMA)}]["Enums"][${q(t.name)}]`;
    const values = ctx.enums.find((e) => e.name === t.name)?.values ?? [];
    return values.map(q).join(" | ") || "string";
  }
  if (t.typtype === "c" && t.schema === SCHEMA) {
    const relation = ctx.relations.find((r) => r.id === t.relid);
    if (relation?.kind === "table") return `Database[${q(SCHEMA)}]["Tables"][${q(relation.name)}]["Row"]`;
    if (relation?.kind === "view") return `Database[${q(SCHEMA)}]["Views"][${q(relation.name)}]["Row"]`;
    return `Database[${q(SCHEMA)}]["CompositeTypes"][${q(t.name)}]`;
  }
  return "unknown";
}

const q = (s: string) => JSON.stringify(s);
const pad = (n: number) => " ".repeat(n);

/** `key: A | B` — broken into prettier's leading-pipe form when too wide. */
function member(indent: number, key: string, type: string): string[] {
  const line = `${pad(indent)}${key}: ${type}`;
  const parts = splitUnion(type);
  if (line.length <= PRINT_WIDTH || parts.length < 2) return [line];
  return [`${pad(indent)}${key}:`, ...parts.map((part) => `${pad(indent + 2)}| ${part}`)];
}

/** Splits a top-level union (ignores | inside brackets or quotes). */
function splitUnion(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < type.length; i += 1) {
    const ch = type[i];
    if (ch === '"' && type[i - 1] !== "\\") inString = !inString;
    if (!inString) {
      if ("([{<".includes(ch)) depth += 1;
      if (")]}>".includes(ch)) depth -= 1;
      if (ch === "|" && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function objectBlock(indent: number, key: string, lines: string[]): string[] {
  if (lines.length === 0) return [`${pad(indent)}${key}: {`, `${pad(indent + 2)}[_ in never]: never`, `${pad(indent)}}`];
  return [`${pad(indent)}${key}: {`, ...lines, `${pad(indent)}}`];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function renderRelationships(ctx: Introspection, relation: string, indent: number): string[] {
  const rels = ctx.relationships
    .filter((r) => r.schema === SCHEMA && r.referencedSchema === SCHEMA && r.relation === relation)
    .sort(
      (a, b) =>
        a.foreignKeyName.localeCompare(b.foreignKeyName) ||
        a.referencedRelation.localeCompare(b.referencedRelation) ||
        JSON.stringify(a.referencedColumns).localeCompare(JSON.stringify(b.referencedColumns)),
    );
  if (rels.length === 0) return [`${pad(indent)}Relationships: []`];
  const out = [`${pad(indent)}Relationships: [`];
  for (const r of rels) {
    out.push(
      `${pad(indent + 2)}{`,
      `${pad(indent + 4)}foreignKeyName: ${q(r.foreignKeyName)}`,
      `${pad(indent + 4)}columns: ${JSON.stringify(r.columns).replace(/,/g, ", ")}`,
      `${pad(indent + 4)}isOneToOne: ${r.isOneToOne}`,
      `${pad(indent + 4)}referencedRelation: ${q(r.referencedRelation)}`,
      `${pad(indent + 4)}referencedColumns: ${JSON.stringify(r.referencedColumns).replace(/,/g, ", ")}`,
      `${pad(indent + 2)}},`,
    );
  }
  out.push(`${pad(indent)}]`);
  return out;
}

function renderTable(ctx: Introspection, rel: Relation, indent: number): string[] {
  const cols = ctx.columns.filter((c) => c.tableId === rel.id).sort(byName);
  const key = (c: Column) => (/^[A-Za-z_$][\w$]*$/.test(c.name) ? c.name : q(c.name));
  const row = cols.flatMap((c) => member(indent + 4, key(c), tsType(ctx, c.typeId) + (c.isNullable ? " | null" : "")));
  const insert = cols.flatMap((c) => {
    if (c.identity === "a" || c.generated !== "") return [`${pad(indent + 4)}${key(c)}?: never`];
    const optional = c.isNullable || c.identity !== "" || c.hasDefault;
    return member(indent + 4, `${key(c)}${optional ? "?" : ""}`, tsType(ctx, c.typeId) + (c.isNullable ? " | null" : ""));
  });
  const update = cols.flatMap((c) => {
    if (c.identity === "a" || c.generated !== "") return [`${pad(indent + 4)}${key(c)}?: never`];
    return member(indent + 4, `${key(c)}?`, tsType(ctx, c.typeId) + (c.isNullable ? " | null" : ""));
  });
  return [
    `${pad(indent)}${rel.name}: {`,
    ...objectBlock(indent + 2, "Row", row),
    ...objectBlock(indent + 2, "Insert", insert),
    ...objectBlock(indent + 2, "Update", update),
    ...renderRelationships(ctx, rel.name, indent + 2),
    `${pad(indent)}}`,
  ];
}

function renderView(ctx: Introspection, rel: Relation, indent: number): string[] {
  const cols = ctx.columns.filter((c) => c.tableId === rel.id).sort(byName);
  const key = (c: Column) => (/^[A-Za-z_$][\w$]*$/.test(c.name) ? c.name : q(c.name));
  const row = cols.flatMap((c) => member(indent + 4, key(c), tsType(ctx, c.typeId) + (c.isNullable ? " | null" : "")));
  const writable = (c: Column) =>
    c.isUpdatable ? member(indent + 4, `${key(c)}?`, `${tsType(ctx, c.typeId)} | null`) : [`${pad(indent + 4)}${key(c)}?: never`];
  return [
    `${pad(indent)}${rel.name}: {`,
    ...objectBlock(indent + 2, "Row", row),
    ...(rel.isUpdatable ? [...objectBlock(indent + 2, "Insert", cols.flatMap(writable)), ...objectBlock(indent + 2, "Update", cols.flatMap(writable))] : []),
    ...renderRelationships(ctx, rel.name, indent + 2),
    `${pad(indent)}}`,
  ];
}

function renderFunction(ctx: Introspection, fns: Fn[], indent: number): string[] {
  const name = fns[0].name;
  const variants = fns.map((fn) => {
    const inArgs = fn.args.filter((a) => ["i", "b", "v"].includes(a.mode) && a.name !== "").sort(byName);
    const argMembers = inArgs.map((a) => `${a.name}${a.hasDefault ? "?" : ""}: ${tsType(ctx, a.typeId)}`);
    // RETURNS TABLE (...): an array of objects, one member per line (declaration order), like the
    // prettier-formatted official output.
    const tableMembers = fn.tableColumns.map((c) => `${c.name}: ${tsType(ctx, c.typeId)}`);
    const returns = tableMembers.length > 0 ? "" : tsType(ctx, fn.returnTypeId) + (fn.returnsSet ? "[]" : "");
    return { argMembers, returns, tableMembers };
  });
  const out: string[] = [];
  const renderVariant = (v: (typeof variants)[number], at: number): string[] => {
    const lines: string[] = [];
    if (v.argMembers.length === 0) {
      lines.push(`${pad(at)}Args: never`);
    } else {
      const inline = `${pad(at)}Args: { ${v.argMembers.join("; ")} }`;
      if (inline.length <= PRINT_WIDTH) lines.push(inline);
      else lines.push(`${pad(at)}Args: {`, ...v.argMembers.map((m) => `${pad(at + 2)}${m}`), `${pad(at)}}`);
    }
    if (v.tableMembers.length > 0) {
      lines.push(`${pad(at)}Returns: {`, ...v.tableMembers.map((m) => `${pad(at + 2)}${m}`), `${pad(at)}}[]`);
    } else {
      lines.push(...member(at, "Returns", v.returns));
    }
    return lines;
  };
  if (variants.length === 1) {
    out.push(`${pad(indent)}${name}: {`, ...renderVariant(variants[0], indent + 2), `${pad(indent)}}`);
  } else {
    out.push(`${pad(indent)}${name}:`);
    variants.forEach((v) => out.push(`${pad(indent + 2)}| {`, ...renderVariant(v, indent + 6), `${pad(indent + 4)}}`));
  }
  return out;
}

function renderConstants(ctx: Introspection): string[] {
  const out = ["export const Constants = {", `  ${SCHEMA}: {`, "    Enums: {"];
  for (const e of ctx.enums) {
    const inline = `      ${e.name}: [${e.values.map(q).join(", ")}],`;
    if (inline.length <= PRINT_WIDTH) out.push(inline);
    else out.push(`      ${e.name}: [`, ...e.values.map((v) => `        ${q(v)},`), "      ],");
  }
  out.push("    },", "  },", "} as const");
  return out;
}

const HELPERS = `type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never`;

export function render(ctx: Introspection, postgrestVersion: string): string {
  const tables = ctx.relations.filter((r) => r.kind === "table").sort(byName);
  const views = ctx.relations.filter((r) => r.kind === "view").sort(byName);
  const fnGroups = new Map<string, Fn[]>();
  for (const fn of [...ctx.functions].sort(byName)) fnGroups.set(fn.name, [...(fnGroups.get(fn.name) ?? []), fn]);

  const lines: string[] = [
    "export type Json =",
    "  | string",
    "  | number",
    "  | boolean",
    "  | null",
    "  | { [key: string]: Json | undefined }",
    "  | Json[]",
    "",
    "export type Database = {",
    "  // Allows to automatically instantiate createClient with right options",
    "  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)",
    "  __InternalSupabase: {",
    `    PostgrestVersion: ${q(postgrestVersion)}`,
    "  }",
    `  ${SCHEMA}: {`,
    ...objectBlock(4, "Tables", tables.flatMap((t) => renderTable(ctx, t, 6))),
    ...objectBlock(4, "Views", views.flatMap((v) => renderView(ctx, v, 6))),
    ...objectBlock(4, "Functions", [...fnGroups.values()].flatMap((fns) => renderFunction(ctx, fns, 6))),
    ...objectBlock(
      4,
      "Enums",
      ctx.enums.flatMap((e) => member(6, e.name, e.values.map(q).join(" | "))),
    ),
    ...objectBlock(
      4,
      "CompositeTypes",
      ctx.composites.flatMap((c) => [
        `      ${c.name}: {`,
        ...c.attributes.flatMap((a) => member(8, `${a.name}`, `${tsType(ctx, a.typeId)} | null`)),
        "      }",
      ]),
    ),
    "  }",
    "}",
    "",
    HELPERS,
    "",
    ...renderConstants(ctx),
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 && argv[outIndex + 1] ? path.resolve(argv[outIndex + 1]) : DEFAULT_OUT;
  const postgrestVersion = process.env.POSTGREST_VERSION || "14";

  const db = await createMigratedDatabase({ seed: false });
  let source: string;
  try {
    source = render(await introspect(db), postgrestVersion);
  } finally {
    await db.close();
  }

  if (check) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {
      // missing file = out of date
    }
    if (current !== source) {
      console.error(`${path.relative(ROOT_DIR, out)} is out of date. Run: npm run db:types`);
      process.exit(1);
    }
    console.log(`${path.relative(ROOT_DIR, out)} is up to date.`);
    return;
  }
  writeFileSync(out, source);
  console.log(`Wrote ${path.relative(ROOT_DIR, out)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
