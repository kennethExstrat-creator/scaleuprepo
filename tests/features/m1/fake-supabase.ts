// A minimal stand-in for the supabase-js client used by the M1 Server Actions: records every table call
// (select / insert / update / delete with its filters) and RPC, and answers from a handler. Storage has
// the list/remove methods the company deletion uses. Only what the actions call is implemented.

export type Filter = { op: "eq" | "in" | "or" | "not"; column: string; value: unknown };

export type TableCall = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns: string | null;
  values: unknown;
  filters: Filter[];
  returning: string | null;
  single: "one" | "maybe" | null;
};

export type Result = { data: unknown; error: { code?: string; message: string } | null };

export type Handler = (call: TableCall) => Result | undefined;

export function pgError(code: string, message: string) {
  return { code, message, details: "", hint: "" };
}

/** The filter value of `column` in a recorded call (eq/in), e.g. `filterValue(call, "id")`. */
export function filterValue(call: TableCall, column: string): unknown {
  return call.filters.find((filter) => filter.column === column)?.value;
}

export function fakeSupabase(options: { tables?: Handler; rpc?: (fn: string, args: unknown) => Result | undefined } = {}) {
  const calls: TableCall[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  function from(table: string) {
    const call: TableCall = {
      table,
      op: "select",
      columns: null,
      values: undefined,
      filters: [],
      returning: null,
      single: null,
    };
    const builder = {
      select(columns?: string) {
        if (call.op === "select") call.columns = columns ?? "*";
        else call.returning = columns ?? "*";
        return builder;
      },
      insert(values: unknown) {
        call.op = "insert";
        call.values = values;
        return builder;
      },
      update(values: unknown) {
        call.op = "update";
        call.values = values;
        return builder;
      },
      delete() {
        call.op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ op: "eq", column, value });
        return builder;
      },
      in(column: string, value: unknown) {
        call.filters.push({ op: "in", column, value });
        return builder;
      },
      or(expression: string) {
        call.filters.push({ op: "or", column: "", value: expression });
        return builder;
      },
      not(column: string, _operator: string, value: unknown) {
        call.filters.push({ op: "not", column, value });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      range() {
        return builder;
      },
      single() {
        call.single = "one";
        return builder;
      },
      maybeSingle() {
        call.single = "maybe";
        return builder;
      },
      then<T1 = Result, T2 = never>(
        resolve?: ((value: Result) => T1 | PromiseLike<T1>) | null,
        reject?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
      ): Promise<T1 | T2> {
        calls.push(call);
        const answer = options.tables?.(call) ?? defaultAnswer(call);
        return Promise.resolve(answer).then(resolve, reject);
      },
    };
    return builder;
  }

  function rpc(fn: string, args?: unknown): Promise<Result> {
    rpcCalls.push({ fn, args });
    return Promise.resolve(options.rpc?.(fn, args) ?? { data: null, error: null });
  }

  return { client: { from, rpc }, calls, rpcCalls };
}

/** Writes succeed and return one row; reads return nothing. */
function defaultAnswer(call: TableCall): Result {
  if (call.op === "select") return { data: call.single ? null : [], error: null };
  const row = { id: "00000000-0000-4000-8000-00000000abcd", company_id: "row" };
  return { data: call.single ? row : [row], error: null };
}

/** A fake storage bucket over object paths (lists one folder level at a time, like Supabase Storage). */
export function fakeStorage(paths: string[], failRemove = false) {
  const objects = new Set(paths);
  const removed: string[] = [];
  const bucketsUsed: string[] = [];
  const bucket = {
    async list(path: string, { limit, offset }: { limit: number; offset: number }) {
      const prefix = `${path}/`;
      const entries = new Map<string, { name: string; id: string | null }>();
      for (const object of objects) {
        if (!object.startsWith(prefix)) continue;
        const [first, ...rest] = object.slice(prefix.length).split("/");
        entries.set(first, { name: first, id: rest.length > 0 ? null : `id-${object}` });
      }
      return { data: [...entries.values()].slice(offset, offset + limit), error: null };
    },
    async remove(batch: string[]) {
      if (failRemove) return { data: null, error: { message: "storage unavailable" } };
      removed.push(...batch);
      for (const path of batch) objects.delete(path);
      return { data: [], error: null };
    },
  };
  return {
    client: {
      storage: {
        from(name: string) {
          bucketsUsed.push(name);
          return bucket;
        },
      },
    },
    objects,
    removed,
    bucketsUsed,
  };
}
