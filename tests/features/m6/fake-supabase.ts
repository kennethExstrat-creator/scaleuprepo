// A minimal chainable stand-in for the Supabase client, for testing server actions without a database:
// every query is recorded and answered by the test's handler. Supports from().select/insert, eq, is,
// in, lte, gte, order and the maybeSingle / single / await terminals, plus rpc().
import type { AccessContext, CompanyViewContext, ScaleUpAccessContext } from "@/lib/auth/types";
import type { CompanyRole, CompanyStatus, ScaleupRole } from "@/lib/types/enums";

export type RecordedQuery = {
  table: string;
  op: "select" | "insert";
  columns: string | null;
  filters: Array<{ column: string; op: string; value: unknown }>;
  payload: unknown;
};

export type Answer = { data: unknown; error: unknown };

export function fakeSupabase(
  handler: (query: RecordedQuery) => Answer = () => ({ data: null, error: null }),
  rpcHandler: (name: string, args: unknown) => Answer = () => ({ data: null, error: null }),
) {
  const queries: RecordedQuery[] = [];
  const rpcs: Array<{ name: string; args: unknown }> = [];

  function from(table: string) {
    const query: RecordedQuery = { table, op: "select", columns: null, filters: [], payload: null };
    const run = () => {
      queries.push(query);
      return Promise.resolve(handler(query));
    };
    const filter = (op: string) => (column: string, value: unknown) => {
      query.filters.push({ column, op, value });
      return api;
    };
    const api = {
      select(columns: string) {
        query.columns = columns;
        return api;
      },
      insert(payload: unknown) {
        query.op = "insert";
        query.payload = payload;
        return api;
      },
      eq: filter("eq"),
      is: filter("is"),
      in: filter("in"),
      lte: filter("lte"),
      gte: filter("gte"),
      order() {
        return api;
      },
      maybeSingle: run,
      single: run,
      then(resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) {
        return run().then(resolve, reject);
      },
    };
    return api;
  }

  function rpc(name: string, args: unknown) {
    rpcs.push({ name, args });
    return Promise.resolve(rpcHandler(name, args));
  }

  return { client: { from, rpc }, queries, rpcs };
}

/** The value of an `eq` filter of a recorded query. */
export function eqValue(query: RecordedQuery, column: string): unknown {
  return query.filters.find((f) => f.op === "eq" && f.column === column)?.value;
}

const BASE: Omit<AccessContext, "userId" | "scaleupRole" | "memberships"> = {
  email: "someone@example.test",
  fullName: "Someone",
  isActive: true,
  aal: "aal2",
  mfaRequired: true,
  termsAccepted: true,
};

export function scaleUpCtx(role: ScaleupRole, userId: string): ScaleUpAccessContext & CompanyViewContext {
  return { ...BASE, userId, scaleupRole: role, memberships: [], companyRole: null };
}

export function companyCtx(
  userId: string,
  companyId: string,
  role: CompanyRole,
  companyStatus: CompanyStatus = "active",
): CompanyViewContext {
  return {
    ...BASE,
    userId,
    scaleupRole: null,
    memberships: [{ companyId, companyName: "Batik Boutique", companyStatus, role }],
    companyRole: role,
  };
}
