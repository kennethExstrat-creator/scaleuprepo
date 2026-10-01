import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MESSAGES, toActionError } from "@/lib/actions/result";
import { DataError, getCompanyConfig, getSubmission } from "@/lib/data";

import { createFakeClient } from "./fake-postgrest";
import { IDS, seed } from "./fixtures";

describe("DataError through toActionError", () => {
  it("maps permission, not-found, expired-session and network failures to the friendly messages", async () => {
    const denied = createFakeClient(seed(), {
      intercept: (r) => (r.path === "company_kpis" ? { status: 403, body: { code: "42501", message: "permission denied for table company_kpis", details: null, hint: null } } : undefined),
    });
    const e1 = await getCompanyConfig(denied.sb, IDS.batik).catch((e: unknown) => e);
    expect(toActionError(e1)).toEqual({ ok: false, error: MESSAGES.permission });

    const e2 = await getCompanyConfig(denied.sb, "c0000000-0000-4000-8000-00000000abcd").catch((e: unknown) => e);
    expect(toActionError(e2)).toEqual({ ok: false, error: MESSAGES.notFound });

    const expired = createFakeClient(seed(), {
      intercept: () => ({ status: 401, body: { code: "PGRST303", message: "JWT expired", details: null, hint: null } }),
    });
    const e3 = await getSubmission(expired.sb, IDS.subSep).catch((e: unknown) => e);
    expect(e3).toBeInstanceOf(DataError);
    expect(toActionError(e3)).toEqual({ ok: false, error: MESSAGES.session });

    // a fetch failure: supabase-js reports it as { message: 'TypeError: fetch failed', code: '' }
    const offline = createFakeClient(seed(), {
      intercept: () => {
        throw new TypeError("fetch failed");
      },
    });
    const e4 = await getSubmission(offline.sb, IDS.subSep).catch((e: unknown) => e);
    expect(e4).toBeInstanceOf(DataError);
    expect((e4 as DataError).message).toMatch(/^getSubmission: could not load monthly update .*fetch failed/);
    expect(toActionError(e4)).toEqual({ ok: false, error: MESSAGES.network });
  });
});
