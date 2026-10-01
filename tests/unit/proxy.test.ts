// src/proxy.ts → updateSession (src/lib/supabase/proxy.ts) for signed-out visitors: which paths are
// public. `/access/[token]` (module M2) is the accept page of our own invitation and sign-in links
// (BRD B14): it must open without a session, and the proxy leaves its auth cookies alone (its Server
// Action signs the invitee in). None of these requests reaches Supabase: without session cookies
// auth-js answers getClaims() locally.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

const ORIGIN = "http://localhost:3000";
const TOKEN = "2c1f0d4a9b7e4f3aa5d1c0e2b3f4a5d6c7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), { method: init.method ?? "GET", headers: init.headers });
}

/** NextResponse.next() — the request goes on to the page (no redirect, no JSON error). */
function passesThrough(response: Response): boolean {
  return response.status === 200 && response.headers.get("x-middleware-next") === "1" && !response.headers.has("location");
}

describe("proxy: public pages for signed-out visitors", () => {
  it("runs on the access-link accept page (so it gets the security headers)", () => {
    expect(unstable_doesMiddlewareMatch({ config, url: `/access/${TOKEN}` })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: "/login" })).toBe(true);
    expect(unstable_doesMiddlewareMatch({ config, url: "/brand/scaleup-logo.png" })).toBe(false);
  });

  it("lets anyone open /access/[token] without a session, and never touches its auth cookies", async () => {
    for (const path of [`/access/${TOKEN}`, "/access", `/access/${TOKEN}?from=email`]) {
      const response = await proxy(request(path));
      expect(passesThrough(response), path).toBe(true);
      expect(response.headers.get("x-frame-options"), path).toBe("DENY");
      expect(response.headers.get("set-cookie"), path).toBeNull();
    }
    // The accept button posts the page's Server Action.
    const action = await proxy(request(`/access/${TOKEN}`, { method: "POST", headers: { "next-action": "abc123" } }));
    expect(passesThrough(action)).toBe(true);
    // Even an idle-expired visitor is not signed out or redirected there: the action starts a new session.
    const idle = await proxy(request(`/access/${TOKEN}`, { headers: { cookie: "su_last_seen=1" } }));
    expect(passesThrough(idle)).toBe(true);
    expect(idle.headers.get("set-cookie")).toBeNull();
  });

  it("keeps /login and /forgot-password public", async () => {
    for (const path of ["/login", "/login?next=%2Fadmin", "/forgot-password"]) {
      expect(passesThrough(await proxy(request(path))), path).toBe(true);
    }
  });

  it("sends signed-out visitors of any other page to /login (a path merely starting with /access included)", async () => {
    for (const path of ["/admin/tracker", "/accessibility", "/access-denied", "/portal"]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(307);
      const location = new URL(response.headers.get("location") ?? "", ORIGIN);
      expect(location.pathname, path).toBe("/login");
      expect(location.searchParams.get("next"), path).toBe(path);
    }
    const api = await proxy(request("/api/exports/portfolio"));
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ reason: "signed_out" });
  });

  it("answers fetch() calls to /api/* with 401 JSON, but sends a followed download link to /login", async () => {
    const COMPANY = "c0000000-0000-4000-8000-000000000001";
    // The export buttons use fetch(): JSON, whatever the Accept header says.
    for (const mode of ["cors", "same-origin", "no-cors"]) {
      const response = await proxy(
        request(`/api/exports/c4/${COMPANY}`, { headers: { "sec-fetch-mode": mode, accept: "text/html" } }),
      );
      expect(response.status, mode).toBe(401);
      expect(await response.json()).toMatchObject({ reason: "signed_out" });
    }

    // A plain link (e.g. "Download my data" on the history page): back to that page after signing in.
    const history = `/portal/${COMPANY}/history`;
    const link = await proxy(
      request(`/api/exports/c4/${COMPANY}`, {
        headers: { "sec-fetch-mode": "navigate", referer: `${ORIGIN}${history}?tab=all` },
      }),
    );
    expect(link.status).toBe(307);
    const location = new URL(link.headers.get("location") ?? "", ORIGIN);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(`${history}?tab=all`);

    // Without fetch metadata, an HTML Accept header marks a navigation; no usable referrer → no `next`.
    for (const referer of [undefined, "https://evil.example/portal", `${ORIGIN}/login`, "not a url"]) {
      const headers: Record<string, string> = { accept: "text/html,application/xhtml+xml" };
      if (referer) headers.referer = referer;
      const response = await proxy(request("/api/documents/d0000000-0000-4000-8000-000000000001/download", { headers }));
      expect(response.status, referer).toBe(307);
      const target = new URL(response.headers.get("location") ?? "", ORIGIN);
      expect(target.pathname, referer).toBe("/login");
      expect(target.searchParams.has("next"), referer).toBe(false);
    }

    // The keep-alive stays JSON even when navigated to.
    const keepalive = await proxy(request("/auth/keepalive", { headers: { "sec-fetch-mode": "navigate" } }));
    expect(keepalive.status).toBe(401);
  });
});
