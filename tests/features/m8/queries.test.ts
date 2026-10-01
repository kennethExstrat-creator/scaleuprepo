// loadCompanyDocuments with the real data layer and supabase-js over a stub fetch (no network): on the
// company side it asks staff_display_names once for the uploaders and confirmers whose profiles company
// users cannot read, and names ScaleUp staff "<full name> (ScaleUp)" (BRD B28) and anyone else hidden a
// former team member; if that lookup fails the page still loads and shows "ScaleUp". The ScaleUp side
// never asks: it reads the profiles.
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadCompanyDocuments } from "@/components/documents/queries";
import type { CloseRecord, CompanyDocumentsView, DocumentRecord, PersonProfile } from "@/components/documents/view-model";
import type { Database } from "@/lib/supabase/database.types";
import type { CompanyRow } from "@/lib/types/domain";

const COMPANY: CompanyRow = {
  id: "c0000000-0000-4000-8000-000000000001",
  name: "Batik Boutique",
  legal_name: null,
  registration_no: null,
  sector: null,
  country: "Malaysia",
  website: null,
  description: null,
  reporting_currency: "MYR",
  status: "active",
  status_changed_at: null,
  status_reason: null,
  reporting_start_month: "2026-07-01",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const OWNER_ID = "b0000000-0000-4000-8000-000000000001";
const FUND_ADMIN_ID = "f0000000-0000-4000-8000-0000000000fa";
const SUPER_ADMIN_ID = "e0000000-0000-4000-8000-0000000000ea";
/** A contributor since removed from the team: company users can no longer read their profile. */
const FORMER_ID = "a0000000-0000-4000-8000-0000000000af";

const OWNER: PersonProfile = { full_name: "Bea Batik", email: "owner@batik.test", scaleup_role: null };
const FUND_ADMIN: PersonProfile = { full_name: "Fay Fund", email: "fund@scaleup.test", scaleup_role: "fund_admin" };
const SUPER_ADMIN: PersonProfile = { full_name: "Sam Super", email: "super@scaleup.test", scaleup_role: "super_admin" };
const FORMER: PersonProfile = { full_name: "Fred Former", email: "fred@batik.test", scaleup_role: null };

/** staff_display_names: "<full name> (ScaleUp)" for ScaleUp staff ids, nothing for anyone else. */
const DISPLAY_NAMES: Record<string, string> = {
  [FUND_ADMIN_ID]: "Fay Fund (ScaleUp)",
  [SUPER_ADMIN_ID]: "Sam Super (ScaleUp)",
};

type RpcHandler = (args: Record<string, unknown>) => { status?: number; body: unknown };
type Recorded = { path: string; body: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** supabase-js whose requests are answered from `tables` (rows as PostgREST returns them) and `rpc`. */
function fakeClient(tables: Record<string, unknown[]>, rpc: Record<string, RpcHandler> = {}) {
  const requests: Recorded[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    const json = (status: number, payload: unknown) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (path.startsWith("rpc/")) {
      const handler = rpc[path.slice(4)];
      if (!handler) {
        return json(404, { code: "PGRST202", message: `Could not find the function public.${path.slice(4)}`, details: null, hint: null });
      }
      const res = handler(isRecord(body) ? body : {});
      return json(res.status ?? 200, res.body);
    }
    if (!(path in tables)) throw new Error(`unexpected request to ${path}`);
    return json(200, tables[path]);
  };
  const sb = createClient<Database>("http://fake.local", "fake-publishable-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sb, requests };
}

const staffDisplayNames: RpcHandler = (args) => {
  const ids = Array.isArray(args.p_ids) ? args.p_ids.filter((id): id is string => typeof id === "string") : [];
  return { body: ids.flatMap((id) => (DISPLAY_NAMES[id] ? [{ id, display_name: DISPLAY_NAMES[id] }] : [])) };
};

type Tables = {
  period_closes: CloseRecord[];
  documents: DocumentRecord[];
  v_submission_overview: unknown[];
  v_submission_financials: unknown[];
};

/**
 * Q2 confirmed by the Super Admin, Q3 open, and documents uploaded by the Fund Admin (on behalf), the
 * owner, a contributor since removed and the system. `hidden`: the caller is a company user, so the
 * ScaleUp staff and former member profile embeds are null (RLS).
 */
function tables(hidden: boolean): Tables {
  const staff = (profile: PersonProfile) => (hidden ? null : profile);
  const closes: CloseRecord[] = [
    {
      id: "d0000000-0000-4000-8000-000000000003",
      period_type: "quarter",
      period_start: "2026-07-01",
      period_end: "2026-09-30",
      label: "Q3 2026",
      status: "open",
      confirmed_at: null,
      confirmed_by: null,
      computed_totals: null,
      restated_totals: null,
      restatement_reason: null,
      confirmer: null,
    },
    {
      id: "d0000000-0000-4000-8000-000000000002",
      period_type: "quarter",
      period_start: "2026-04-01",
      period_end: "2026-06-30",
      label: "Q2 2026",
      status: "confirmed",
      confirmed_at: "2026-07-10T02:00:00Z",
      // As stored: ids may come back in any case; names are looked up in lower case.
      confirmed_by: SUPER_ADMIN_ID.toUpperCase(),
      computed_totals: { months_count: 3, revenue_total: 600 },
      restated_totals: null,
      restatement_reason: null,
      confirmer: staff(SUPER_ADMIN),
    },
  ];
  const doc = (id: string, uploadedBy: string | null, uploader: PersonProfile | null): DocumentRecord => ({
    id,
    period_close_id: "d0000000-0000-4000-8000-000000000003",
    doc_type: "supporting",
    file_name: `${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 2048,
    version: 1,
    uploaded_at: "2026-10-05T06:00:00Z",
    uploaded_by: uploadedBy,
    uploader,
  });
  const documents: DocumentRecord[] = [
    doc("by-fund-admin", FUND_ADMIN_ID, staff(FUND_ADMIN)),
    doc("by-fund-admin-again", FUND_ADMIN_ID, staff(FUND_ADMIN)),
    doc("by-owner", OWNER_ID, OWNER),
    doc("by-former-member", FORMER_ID, staff(FORMER)),
    doc("by-system", null, null),
  ];
  return { period_closes: closes, documents, v_submission_overview: [], v_submission_financials: [] };
}

function uploaders(view: CompanyDocumentsView): Record<string, string> {
  const items = view.closes.flatMap((close) => [...close.managementAccounts, ...close.supporting]);
  return Object.fromEntries(items.map((item) => [item.id, item.uploadedBy]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadCompanyDocuments: who uploaded and confirmed (BRD B28)", () => {
  it("company side: names ScaleUp staff '<full name> (ScaleUp)' with one staff_display_names request", async () => {
    const { sb, requests } = fakeClient(tables(true), { staff_display_names: staffDisplayNames });
    const view = await loadCompanyDocuments(sb, COMPANY, "company");

    const lookups = requests.filter((request) => request.path === "rpc/staff_display_names");
    expect(lookups).toHaveLength(1);
    // Only the people the caller cannot read, once each, in lower case (never the owner or the system).
    expect(lookups[0].body).toEqual({ p_ids: [SUPER_ADMIN_ID, FUND_ADMIN_ID, FORMER_ID].sort() });

    expect(uploaders(view)).toEqual({
      "by-fund-admin": "Fay Fund (ScaleUp)",
      "by-fund-admin-again": "Fay Fund (ScaleUp)",
      "by-owner": "Bea Batik",
      // Hidden but not ScaleUp staff (no display name): removed from the team, not "ScaleUp".
      "by-former-member": "Former team member",
      "by-system": "ScaleUp",
    });
    const q2 = view.closes.find((close) => close.label === "Q2 2026");
    expect(q2?.confirmedBy).toBe("Sam Super (ScaleUp)");
    expect(JSON.stringify(view)).not.toMatch(/@scaleup\.test|Fund Admin|Super Admin/);
  });

  it("company side: falls back to 'ScaleUp' when the names cannot be loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No handler: the function is missing (PGRST202), e.g. before its migration is deployed.
    const { sb, requests } = fakeClient(tables(true));
    const view = await loadCompanyDocuments(sb, COMPANY, "company");

    expect(requests.filter((request) => request.path === "rpc/staff_display_names")).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[documents] could not load the names of ScaleUp staff", expect.stringContaining("PGRST202"));
    // Without the names, nobody hidden can be told apart: "ScaleUp".
    expect(uploaders(view)).toEqual({
      "by-fund-admin": "ScaleUp",
      "by-fund-admin-again": "ScaleUp",
      "by-owner": "Bea Batik",
      "by-former-member": "ScaleUp",
      "by-system": "ScaleUp",
    });
    expect(view.closes.find((close) => close.label === "Q2 2026")?.confirmedBy).toBe("ScaleUp");
  });

  it("company side: asks nothing when every person is a co-member", async () => {
    const data = tables(true);
    const { sb, requests } = fakeClient(
      {
        ...data,
        period_closes: data.period_closes.filter((close) => close.status === "open"),
        documents: data.documents.filter((doc) => doc.uploaded_by === OWNER_ID),
      },
      { staff_display_names: staffDisplayNames },
    );
    const view = await loadCompanyDocuments(sb, COMPANY, "company");
    expect(requests.some((request) => request.path.startsWith("rpc/"))).toBe(false);
    expect(uploaders(view)).toEqual({ "by-owner": "Bea Batik" });
  });

  it("ScaleUp side: names people with their ScaleUp role from the profiles, without the lookup", async () => {
    const { sb, requests } = fakeClient(tables(false), { staff_display_names: staffDisplayNames });
    const view = await loadCompanyDocuments(sb, COMPANY, "scaleup");

    expect(requests.some((request) => request.path.startsWith("rpc/"))).toBe(false);
    expect(uploaders(view)).toEqual({
      "by-fund-admin": "Fay Fund (Fund Admin)",
      "by-fund-admin-again": "Fay Fund (Fund Admin)",
      "by-owner": "Bea Batik",
      "by-former-member": "Fred Former",
      "by-system": "System",
    });
    expect(view.closes.find((close) => close.label === "Q2 2026")?.confirmedBy).toBe("Sam Super (Super Admin)");
  });
});
