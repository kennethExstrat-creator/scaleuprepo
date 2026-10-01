// A minimal stand-in for the supabase-js client used by the M4 actions and the /admin/cycles loader: records
// every table call (select / insert / update / delete with filters, range and options) and RPC, and answers
// from handlers. Only what M4 calls is implemented.

export type Filter = { op: "eq" | "in" | "not"; column: string; value: unknown };

export type TableCall = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns: string | null;
  options: { count?: string } | null;
  values: unknown;
  filters: Filter[];
  returning: string | null;
  range: [number, number] | null;
  single: "one" | "maybe" | null;
};

export type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

export type Handler = (call: TableCall) => Result | undefined;

export function pgError(code: string, message: string) {
  return { code, message, details: "", hint: "" };
}

/** The value of an `eq` / `in` filter on `column`, e.g. `filterValue(call, "currency")`. */
export function filterValue(call: TableCall, column: string): unknown {
  return call.filters.find((filter) => filter.column === column)?.value;
}

/** Rows answered page by page for `.range()` reads, with the exact count. */
export function paged(rows: unknown[], call: TableCall): Result {
  const [from, to] = call.range ?? [0, rows.length - 1];
  return { data: rows.slice(from, to + 1), error: null, count: rows.length };
}

export function fakeSupabase(
  options: { tables?: Handler; rpc?: (fn: string, args: unknown) => Result | undefined } = {},
) {
  const calls: TableCall[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  function from(table: string) {
    const call: TableCall = {
      table,
      op: "select",
      columns: null,
      options: null,
      values: undefined,
      filters: [],
      returning: null,
      range: null,
      single: null,
    };
    const builder = {
      select(columns?: string, selectOptions?: { count?: string }) {
        if (call.op === "select") {
          call.columns = columns ?? "*";
          call.options = selectOptions ?? null;
        } else {
          call.returning = columns ?? "*";
        }
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
      range(start: number, end: number) {
        call.range = [start, end];
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
  if (call.op === "select") return { data: call.single ? null : [], error: null, count: 0 };
  const row = { id: 1, currency: "USD" };
  return { data: call.single ? row : [row], error: null };
}
