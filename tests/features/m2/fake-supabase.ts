// A real supabase-js client whose requests go to a handler instead of the network, for exercising the
// client-injected helpers of src/lib/auth-admin (PostgREST at /rest/v1, Auth admin at /auth/v1).
// Every request is recorded; an unexpected request fails the test.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type FakeRequest = {
  method: string;
  /** e.g. "/rest/v1/access_links" or "/auth/v1/admin/users". */
  path: string;
  params: URLSearchParams;
  body: unknown;
  headers: Headers;
};

export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> };

export function fakeSupabase(handler: (request: FakeRequest) => FakeReply | undefined) {
  const requests: FakeRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    const request: FakeRequest = { method, path: url.pathname, params: url.searchParams, body, headers: new Headers(init?.headers) };
    requests.push(request);
    const reply = handler(request);
    if (!reply) throw new Error(`fake-supabase: unexpected ${method} ${url.pathname}${url.search}`);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  const client: SupabaseClient<Database> = createClient<Database>("http://fake.local", "fake-secret-key", {
    global: { fetch: fakeFetch as typeof fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, requests };
}

/** True when the request asked PostgREST for a single object (`.single()`). */
export function wantsObject(request: FakeRequest): boolean {
  return (request.headers.get("accept") ?? "").includes("vnd.pgrst.object+json");
}

/** A PostgREST error body. */
export function pgError(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

/** A minimal Supabase Auth user as the admin API returns it. */
export function authUser(overrides: Record<string, unknown> & { id: string; email: string }) {
  return {
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}
