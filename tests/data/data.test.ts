// src/lib/data/* against a fake PostgREST (tests/data/fake-postgrest.ts) with the real supabase-js
// client: request shapes, sorting, shaping and error handling. RLS itself is tested in tests/db.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DataError,
  getClientSettings,
  getCompany,
  getCompanyConfig,
  getCompanyInternal,
  getCurrentTemplateVersion,
  getFinancialSeries,
  getPlatformSettings,
  getStaffDisplayNames,
  getSubmission,
  getSubmissionBundle,
  getSubmissionBundleByMonth,
  getSubmissionByMonth,
  getSubmissionValidation,
  getSubmissionValues,
  getTemplateVersion,
  isNotFoundError,
  kpiCellKey,
  listCompanySubmissions,
  listSubmissionEvents,
  setCompanyRevenueSegments,
} from "@/lib/data";
import { flattenTemplateFields, segmentsForMonth, toValidationInput } from "@/lib/types/domain";
import { validateSubmissionDraft } from "@/lib/validation";

import { createFakeClient, type FakeOptions, type Row, type TableData } from "./fake-postgrest";
import { CLIENT_SETTINGS, IDS, seed } from "./fixtures";

/** `staff_display_names` as the database answers it: "<name> (ScaleUp)" for ScaleUp staff ids only. */
function staffDisplayNames(staff: Row[], ids: unknown): { id: unknown; display_name: string }[] {
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  return staff
    .filter((profile) => wanted.has(profile.id))
    .map((profile) => {
      const name = typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      return { id: profile.id, display_name: name ? `${name} (ScaleUp)` : "ScaleUp" };
    });
}

/**
 * A fake client over the seed rows (optionally changed first). The RPCs answer like the database:
 * `get_client_settings` one row for every signed-in user, whether or not platform_settings is visible;
 * `staff_display_names` (security definer) the ScaleUp staff among every profile, whatever RLS hides.
 */
function fake(mutate?: (data: TableData) => void, options: FakeOptions = {}) {
  const data = seed();
  const staff = data.profiles.filter((profile) => profile.scaleup_role !== null);
  mutate?.(data);
  return createFakeClient(data, {
    ...options,
    rpc: {
      get_client_settings: () => ({ body: [{ ...CLIENT_SETTINGS }] }),
      staff_display_names: (args) => ({ body: staffDisplayNames(staff, args.p_ids) }),
      ...options.rpc,
    },
  });
}

/**
 * What a company user sees: RLS hides the full settings, the ScaleUp-internal rows and every ScaleUp
 * staff profile (BRD B24/B28: no email or role, and whoever approved a month must not reveal the
 * partner-in-charge assignment); ScaleUp people are named only through staff_display_names.
 */
function asCompanyUser(d: TableData): void {
  d.platform_settings = [];
  d.company_internal = [];
  d.profiles = d.profiles.filter((profile) => profile.scaleup_role === null);
}

describe("getCompany", () => {
  it("returns the row, null when missing, and never queries for a non-uuid", async () => {
    const { sb, requests } = fake();
    expect((await getCompany(sb, IDS.batik))?.name).toBe("Batik Boutique");
    expect(await getCompany(sb, "c0000000-0000-4000-8000-00000000abcd")).toBeNull();
    const before = requests.length;
    expect(await getCompany(sb, "not-a-uuid")).toBeNull();
    expect(requests.length).toBe(before);
    expect(requests[0].params.get("id")).toBe(`eq.${IDS.batik}`);
  });
});

describe("getCompanyConfig", () => {
  it("loads company, segments, KPIs, dimensions and members in one parallel round", async () => {
    const { sb, requests } = fake();
    const config = await getCompanyConfig(sb, IDS.batik);
    expect(requests.map((r) => r.path).sort()).toEqual(
      ["companies", "company_kpis", "company_members", "kpi_dimensions", "revenue_segments"].sort(),
    );
    for (const r of requests.filter((r) => r.path !== "companies")) {
      expect(r.params.get("company_id")).toBe(`eq.${IDS.batik}`);
    }
    expect(config.company.id).toBe(IDS.batik);
    // active first, then sort_order, then name; other companies' segments never included
    expect(config.segments.map((s) => s.name)).toEqual(["Corporate", "Online", "Retail", "Wholesale"]);
    expect(config.kpis.map((k) => k.name)).toEqual([
      "Revenue per outlet",
      "Monthly break-even",
      "Profitable",
      "Customer NPS",
      "Old KPI",
    ]);
    const revenue = config.kpis[0];
    expect(revenue.dimension).toEqual({ id: IDS.outlet, company_id: IDS.batik, name: "Outlet", created_at: expect.any(String) });
    expect(revenue.members.map((m) => m.name)).toEqual(["Mont Kiara", "The Row", "IOI City Mall", "Merdeka 118"]);
    const nps = config.kpis.find((k) => k.id === IDS.kpiHalfYearly)!;
    expect(nps.dimension).toBeNull();
    expect(nps.members).toEqual([]);
    expect(config.dimensions.map((d) => d.name)).toEqual(["Outlet", "Product"]);
    expect(config.dimensions[0].members.map((m) => m.name)).toEqual([
      "Mont Kiara",
      "The Row",
      "IOI City Mall",
      "Merdeka 118",
      "Westin Desaru",
    ]);
    expect(config.dimensions[1].members).toEqual([]);
    // active first, owner first, then name/email, hidden profiles (null) after named ones; inactive last
    expect(config.members.map((m) => [m.user_id, m.role, m.is_active, m.profile?.email ?? null])).toEqual([
      [IDS.owner, "owner", true, "aisyah@batik.example"],
      [IDS.contributor, "contributor", true, "ben@batik.example"],
      [IDS.hiddenUser, "contributor", true, null],
      [IDS.formerContributor, "contributor", false, "chen@batik.example"],
    ]);
    expect(Object.keys(config.members[0].profile!).sort()).toEqual(
      ["email", "full_name", "id", "is_active", "job_title", "terms_accepted_at"].sort(),
    );
  });

  it("throws a not-found DataError for a missing or malformed company", async () => {
    const { sb } = fake();
    const error = await getCompanyConfig(sb, "c0000000-0000-4000-8000-00000000abcd").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    expect(isNotFoundError(error)).toBe(true);
    expect((error as DataError).code).toBe("PGRST116");
    expect((error as DataError).message).toMatch(/^getCompanyConfig: company c0000000-.* was not found/);
    await expect(getCompanyConfig(sb, "nope")).rejects.toSatisfy(isNotFoundError);
  });

  it("wraps query errors with the operation and keeps the code", async () => {
    const { sb } = fake(undefined, {
      intercept: (r) =>
        r.path === "revenue_segments"
          ? { status: 403, body: { code: "42501", message: "permission denied for table revenue_segments", details: null, hint: null } }
          : undefined,
    });
    const error = (await getCompanyConfig(sb, IDS.batik).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe("42501");
    expect(error.operation).toBe("getCompanyConfig");
    expect(error.notFound).toBe(false);
    expect(error.message).toBe(
      `getCompanyConfig: could not load the revenue segments of company ${IDS.batik}: permission denied for table revenue_segments (42501)`,
    );
  });
});

describe("revenue segments (BRD B30)", () => {
  const LINE_FEES = "f1000000-0000-4000-8000-000000000001";
  const LINE_CONSIGNMENT = "f1000000-0000-4000-8000-000000000002";
  const LINE_OLD = "f1000000-0000-4000-8000-000000000003";
  const SEG_RETIRED_LATER = "f1000000-0000-4000-8000-000000000004";
  const withLines = (data: TableData) => {
    const row = (id: string, kind: string, name: string, sort_order: number, retired_at: string | null) => ({
      id,
      company_id: IDS.batik,
      kind,
      name,
      sort_order,
      is_active: retired_at === null,
      retired_at,
      created_at: "2026-09-30T06:00:00.000000+00:00",
    });
    data.revenue_segments.push(
      row(LINE_FEES, "scaleup", "Marketplace fees", 2, null),
      row(LINE_CONSIGNMENT, "scaleup", "Consignment", 1, null),
      row(LINE_OLD, "scaleup", "Old line", 3, "2026-08-01T00:00:00+00:00"),
      row(SEG_RETIRED_LATER, "company", "E-commerce", 0, "2026-10-01T00:00:00+00:00"),
    );
    data.submission_segment_values.push(
      { submission_id: IDS.subSep, segment_id: LINE_FEES, amount: 900, created_at: "", updated_at: "", updated_by: IDS.owner },
      { submission_id: IDS.subAug, segment_id: SEG_RETIRED_LATER, amount: 12, created_at: "", updated_at: "", updated_by: IDS.owner },
    );
  };

  it("getCompanyConfig keeps every segment and splits the company's own from ScaleUp's lines", async () => {
    const { sb } = fake(withLines);
    const config = await getCompanyConfig(sb, IDS.batik);
    // active first, then sort_order, then name — both kinds
    expect(config.segments.map((s) => s.name)).toEqual([
      "Consignment",
      "Corporate",
      "Online",
      "Marketplace fees",
      "Retail",
      "E-commerce",
      "Wholesale",
      "Old line",
    ]);
    expect(config.companySegments.map((s) => s.name)).toEqual(["Corporate", "Online", "Retail"]);
    expect(config.scaleupSegments.map((s) => s.name)).toEqual(["Consignment", "Marketplace fees"]);
    // retired company segments, most recently retired first (ScaleUp lines are not listed here)
    expect(config.retiredCompanySegments.map((s) => [s.name, s.retired_at])).toEqual([
      ["E-commerce", "2026-10-01T00:00:00+00:00"],
      ["Wholesale", "2026-09-30T06:00:00.000000+00:00"],
    ]);
  });

  it("feeds the kind to validation and picks the segments a month shows", async () => {
    const { sb } = fake(withLines);
    const bundle = (await getSubmissionBundle(sb, IDS.subSep))!;
    const input = toValidationInput(bundle);
    expect(input.segments.map((s) => [s.name, s.kind, s.is_active])).toEqual([
      ["Consignment", "scaleup", true],
      ["Corporate", "company", true],
      ["Online", "company", true],
      ["Marketplace fees", "scaleup", true],
      ["Retail", "company", true],
      ["E-commerce", "company", false],
      ["Wholesale", "company", false],
      ["Old line", "scaleup", false],
    ]);
    // Company segments add up (300.25 vs 300); the ScaleUp lines are only required (900 is fine).
    expect(validateSubmissionDraft(input).filter((i) => i.target.startsWith("segment:") || i.code === "sum_mismatch")).toEqual([
      { target: "field:revenue_total", code: "sum_mismatch", message: "Total revenue (300.00) must equal the sum of your revenue segments (300.25)." },
      { target: `segment:${LINE_CONSIGNMENT}`, code: "required", message: "Revenue for Consignment is required." },
    ]);
    // September (sent back for changes) is open: the current segments. August (submitted) shows what it
    // has figures for, a retired segment included.
    const open = segmentsForMonth(bundle.config, bundle.current, true);
    expect(open.company.map((s) => s.name)).toEqual(["Corporate", "Online", "Retail"]);
    expect(open.scaleup.map((s) => s.name)).toEqual(["Consignment", "Marketplace fees"]);
    const august = segmentsForMonth(bundle.config, bundle.previous!.values, false);
    expect(august.company.map((s) => s.name)).toEqual(["E-commerce", "Online"]);
    expect(august.scaleup).toEqual([]);
  });

  it("setCompanyRevenueSegments sends the list to set_company_revenue_segments and returns the rows in order", async () => {
    let received: Record<string, unknown> | null = null;
    const rows = [
      { id: "f2000000-0000-4000-8000-000000000002", company_id: IDS.batik, kind: "company", name: "Retail", sort_order: 2, is_active: true, retired_at: null, created_at: "" },
      { id: "f2000000-0000-4000-8000-000000000001", company_id: IDS.batik, kind: "company", name: "Web", sort_order: 1, is_active: true, retired_at: null, created_at: "" },
    ];
    const { sb, requests } = fake(undefined, {
      rpc: {
        set_company_revenue_segments: (args) => {
          received = args;
          return { body: rows };
        },
      },
    });
    const saved = await setCompanyRevenueSegments(sb, IDS.batik, [{ id: IDS.segOnline, name: "Web" }, { id: null, name: "Retail" }]);
    expect(received).toEqual({
      p_company_id: IDS.batik,
      p_segments: [{ id: IDS.segOnline, name: "Web" }, { name: "Retail" }],
    });
    expect(saved.map((s) => s.name)).toEqual(["Web", "Retail"]);
    expect(requests.map((r) => [r.method, r.path])).toEqual([["POST", "rpc/set_company_revenue_segments"]]);
  });

  it("setCompanyRevenueSegments keeps the database's code and message for toActionError", async () => {
    for (const [status, code, message] of [
      [403, "42501", "Only the company owner can change its revenue segments."],
      [400, "P0001", "The revenue segments have changed since this page was opened. Reload the page and try again."],
    ] as const) {
      const { sb } = fake(undefined, {
        rpc: { set_company_revenue_segments: () => ({ status, body: { code, message, details: null, hint: null } }) },
      });
      const error = (await setCompanyRevenueSegments(sb, IDS.batik, []).catch((e: unknown) => e)) as DataError;
      expect(error).toBeInstanceOf(DataError);
      expect([error.operation, error.code, (error.cause as { message?: string }).message]).toEqual([
        "setCompanyRevenueSegments",
        code,
        message,
      ]);
    }
    const { sb, requests } = fake();
    await expect(setCompanyRevenueSegments(sb, "nope", [])).rejects.toSatisfy(isNotFoundError);
    expect(requests).toEqual([]);
  });
});

describe("templates", () => {
  it("getTemplateVersion sorts sections and fields and attaches the template", async () => {
    const { sb, requests } = fake();
    const version = await getTemplateVersion(sb, IDS.v1);
    expect(requests).toHaveLength(1);
    expect(requests[0].params.get("select")).toBe(
      "*,templates!inner(*),sections:template_sections!template_sections_template_version_id_fkey(*,fields:template_fields!template_fields_section_id_fkey(*))",
    );
    expect(version.id).toBe(IDS.v1);
    expect(version.template.name).toBe("Portfolio Update");
    expect("templates" in version).toBe(false);
    expect(version.sections.map((s) => s.key)).toEqual([
      "financials",
      "headcount",
      "kpis",
      "company_summary",
      "compliance_regulation",
      "investment",
      "founder_pulse",
    ]);
    expect(version.sections[0].fields.map((f) => f.key)).toEqual([
      "revenue_total",
      "gross_profit",
      "net_profit",
      "cash_in_bank",
      "burn_rate",
    ]);
    expect(version.sections[3].fields.map((f) => f.key)).toEqual(["another_note", "key_milestones"]);
    expect(version.sections[2].fields).toEqual([]);
    expect(flattenTemplateFields(version).map((f) => `${f.section_kind}/${f.key}`)).toEqual([
      "financials/revenue_total",
      "financials/gross_profit",
      "financials/net_profit",
      "financials/cash_in_bank",
      "financials/burn_rate",
      "headcount/headcount_ft",
      "headcount/headcount_pt",
      "narrative/another_note",
      "narrative/key_milestones",
      "narrative/compliance_updates",
      "narrative/fundraising_status",
      "pulse/team_morale",
      "pulse/help_tags",
    ]);
    await expect(getTemplateVersion(sb, "b1000000-0000-4000-8000-00000000abcd")).rejects.toSatisfy(isNotFoundError);
    await expect(getTemplateVersion(sb, "bad")).rejects.toSatisfy(isNotFoundError);
  });

  it("getCurrentTemplateVersion returns the published version of the default template", async () => {
    const { sb, requests } = fake();
    const current = await getCurrentTemplateVersion(sb);
    expect(current?.id).toBe(IDS.v1);
    expect(requests[0].params.get("status")).toBe("eq.published");
    expect(requests[0].params.get("templates.is_default")).toBe("eq.true");

    const none = fake((d) => {
      for (const t of d.templates) t.is_default = false;
    });
    expect(await getCurrentTemplateVersion(none.sb)).toBeNull();
  });
});

describe("submissions", () => {
  it("getSubmission and getSubmissionByMonth", async () => {
    const { sb, requests } = fake();
    expect((await getSubmission(sb, IDS.subSep))?.month).toBe("2026-09-01");
    expect(await getSubmission(sb, "x")).toBeNull();
    expect((await getSubmissionByMonth(sb, IDS.batik, "2026-09"))?.id).toBe(IDS.subSep);
    expect((await getSubmissionByMonth(sb, IDS.batik, "2026-09-17"))?.id).toBe(IDS.subSep);
    const last = requests[requests.length - 1];
    expect(last.params.get("month")).toBe("eq.2026-09-01");
    expect(last.params.get("company_id")).toBe(`eq.${IDS.batik}`);
    const count = requests.length;
    expect(await getSubmissionByMonth(sb, IDS.batik, "2026-13")).toBeNull();
    expect(await getSubmissionByMonth(sb, "x", "2026-09")).toBeNull();
    expect(requests.length).toBe(count);
    expect(await getSubmissionByMonth(sb, IDS.batik, "2026-10")).toBeNull();
  });

  it("getSubmissionValues indexes values, segments and KPI cells", async () => {
    const { sb, requests } = fake();
    const values = await getSubmissionValues(sb, IDS.subSep);
    expect(requests).toHaveLength(3);
    expect(Object.keys(values.values).sort()).toEqual(
      ["burn_rate", "cash_in_bank", "gross_profit", "headcount_ft", "headcount_pt", "help_tags", "key_milestones", "net_profit", "revenue_total"].sort(),
    );
    expect(values.values.net_profit.value_number).toBe(-10.5);
    expect(values.values.help_tags.value_json).toEqual(["Hiring"]);
    expect(values.segments).toEqual({ [IDS.segOnline]: 100, [IDS.segRetail]: 150, [IDS.segCorporate]: 50.25 });
    expect(Object.keys(values.kpis).sort()).toEqual(
      [kpiCellKey(IDS.kpiRevenuePerOutlet, IDS.montKiara), kpiCellKey(IDS.kpiProfitable, IDS.theRow)].sort(),
    );
    expect(values.kpis[kpiCellKey(IDS.kpiProfitable, IDS.theRow)].value_bool).toBe(false);
    expect(await getSubmissionValues(sb, "nope")).toEqual({ values: {}, segments: {}, kpis: {} });
  });

  it("listSubmissionEvents orders the timeline and names the actors", async () => {
    const { sb, requests } = fake();
    const events = await listSubmissionEvents(sb, IDS.subSep);
    expect(requests[0].params.get("order")).toBe("created_at.asc,id.asc");
    // ScaleUp staff read every profile: plain names (no "(ScaleUp)"), roles included.
    expect(events.map((e) => [e.id, e.event, e.actor_name])).toEqual([
      [11, "submitted", "Aisyah Rahman"],
      [12, "changes_requested", "Priya Nair"],
      [13, "resubmitted", null],
      [14, "deadline_extended", null],
    ]);
    expect(events[1].actor).toEqual({ id: IDS.partner, full_name: "Priya Nair", email: "priya@scaleup.example", scaleup_role: "partner" });
    expect(events[2].actor).toBeNull();
    // The one actor whose profile is hidden (13) is looked up once — not ScaleUp staff, so it stays unnamed.
    expect(requests.map((r) => r.path)).toEqual(["submission_events", "rpc/staff_display_names"]);
    expect(requests[1].body).toEqual({ p_ids: [IDS.hiddenUser] });
  });

  it("listSubmissionEvents makes no extra request when every actor's profile is readable", async () => {
    const { sb, requests } = fake((d) => {
      d.submission_events = d.submission_events.filter((e) => e.actor_id !== IDS.hiddenUser);
    });
    const events = await listSubmissionEvents(sb, IDS.subSep);
    expect(events.map((e) => [e.id, e.actor_name])).toEqual([
      [11, "Aisyah Rahman"],
      [12, "Priya Nair"],
      [14, null],
    ]);
    expect(requests.map((r) => r.path)).toEqual(["submission_events"]);
  });

  it("listSubmissionEvents names ScaleUp actors 'Name (ScaleUp)' for company users (BRD B28)", async () => {
    const { sb, requests } = fake(asCompanyUser);
    const events = await listSubmissionEvents(sb, IDS.subSep);
    expect(events.map((e) => [e.id, e.event, e.actor_name, e.actor])).toEqual([
      [11, "submitted", "Aisyah Rahman", { id: IDS.owner, full_name: "Aisyah Rahman", email: "aisyah@batik.example", scaleup_role: null }],
      [12, "changes_requested", "Priya Nair (ScaleUp)", null],
      [13, "resubmitted", null, null],
      [14, "deadline_extended", null, null],
    ]);
    // One lookup for every hidden actor (deduplicated, in timeline order).
    expect(requests.filter((r) => r.path === "rpc/staff_display_names").map((r) => r.body)).toEqual([
      { p_ids: [IDS.partner, IDS.hiddenUser] },
    ]);
    const failing = fake(asCompanyUser, {
      rpc: {
        staff_display_names: () => ({
          status: 403,
          body: { code: "42501", message: "Please sign in first.", details: null, hint: null },
        }),
      },
    });
    const error = (await listSubmissionEvents(failing.sb, IDS.subSep).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe("42501");
    expect(error.operation).toBe("getStaffDisplayNames");
  });

  it("getSubmissionBundle assembles the bundle in two rounds", async () => {
    const { sb, requests } = fake();
    const bundle = await getSubmissionBundle(sb, IDS.subSep);
    expect(bundle).not.toBeNull();
    if (!bundle) return;
    // Two rounds (11 requests), plus the name lookup for the timeline's one hidden actor (fixtures).
    expect(requests).toHaveLength(12);
    expect(requests.filter((r) => r.path === "rpc/staff_display_names")).toHaveLength(1);
    expect(requests.filter((r) => r.path === "rpc/get_client_settings")).toHaveLength(1);
    expect(requests.filter((r) => r.path === "platform_settings")).toHaveLength(1);
    expect(requests[0].path).toBe("submissions");
    expect(requests[0].params.get("id")).toBe(`eq.${IDS.subSep}`);
    const siblings = requests.filter((r) => r.path === "submissions" && r.params.has("month"));
    expect(siblings).toHaveLength(1);
    expect(siblings[0].params.get("month")).toBe("in.(2026-08-01,2025-09-01)");
    expect(siblings[0].params.get("company_id")).toBe(`eq.${IDS.batik}`);

    expect(bundle.submission.id).toBe(IDS.subSep);
    expect("field_values" in bundle.submission).toBe(false);
    expect("values" in bundle.submission).toBe(false);
    expect("kpi_values" in bundle.submission).toBe(false);
    expect(bundle.company.id).toBe(IDS.batik);
    expect(bundle.config.company).toBe(bundle.company);
    expect(bundle.template.id).toBe(IDS.v1);
    expect(bundle.current.values.revenue_total.value_number).toBe(300);
    expect(bundle.previous?.submission.id).toBe(IDS.subAug);
    expect(bundle.previous?.values.values.key_milestones.value_text).toBe("August milestones");
    expect(bundle.previous?.values.segments).toEqual({ [IDS.segOnline]: 200 });
    expect(bundle.previous?.financials).toEqual({
      month: "2026-08-01",
      revenue_total: 200,
      gross_profit: 80,
      net_profit: null,
      cash_in_bank: null,
      burn_rate: null,
      headcount_ft: null,
      headcount_pt: null,
    });
    expect(bundle.lastYear?.submission.id).toBe(IDS.subSepLastYear);
    expect(bundle.lastYear?.submission.template_version_id).toBe(IDS.otherV1);
    expect(bundle.lastYear?.financials.revenue_total).toBe(100);
    expect(bundle.financials).toEqual({
      month: "2026-09-01",
      revenue_total: 300,
      gross_profit: 120,
      net_profit: -10.5,
      cash_in_bank: 1000,
      burn_rate: 50,
      headcount_ft: 10,
      headcount_pt: 2,
    });
    expect(bundle.events.map((e) => e.id)).toEqual([11, 12, 13, 14]);
    // ScaleUp staff get the full settings (flag thresholds) and every user the client settings.
    expect(bundle.settings?.revenue_swing_pct).toBe(30);
    expect(bundle.clientSettings).toEqual(CLIENT_SETTINGS);
    // plain data only (RSC-serialisable)
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);

    // validation bridge
    const input = toValidationInput(bundle);
    expect(input.month).toBe("2026-09-01");
    expect(input.fields.find((f) => f.key === "compliance_updates")).toEqual({
      key: "compliance_updates",
      label: "Licences and regulatory matters",
      field_type: "long_text",
      is_required: true,
      section_kind: "narrative",
      validation: { max_length: 4000 },
    });
    expect(input.kpis.find((k) => k.id === IDS.kpiHalfYearly)?.members).toBeNull();
    expect(input.kpis.find((k) => k.id === IDS.kpiRevenuePerOutlet)?.members?.map((m) => m.name)).toEqual([
      "Mont Kiara",
      "The Row",
      "IOI City Mall",
      "Merdeka 118",
    ]);
    const issues = validateSubmissionDraft(input);
    expect(issues.map((i) => `${i.code} ${i.target}`)).toEqual([
      `sum_mismatch field:revenue_total`,
      `required field:compliance_updates`,
      `required kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`,
      `required kpi:${IDS.kpiRevenuePerOutlet}:${IDS.ioi}`,
      `required kpi:${IDS.kpiRevenuePerOutlet}:${IDS.merdeka}`,
      `required kpi:${IDS.kpiBreakEven}:${IDS.montKiara}`,
      `required kpi:${IDS.kpiBreakEven}:${IDS.theRow}`,
      `required kpi:${IDS.kpiBreakEven}:${IDS.ioi}`,
      `required kpi:${IDS.kpiBreakEven}:${IDS.merdeka}`,
      `required kpi:${IDS.kpiProfitable}:${IDS.montKiara}`,
      `required kpi:${IDS.kpiProfitable}:${IDS.ioi}`,
      `required kpi:${IDS.kpiProfitable}:${IDS.merdeka}`,
    ]);
    // live values override the stored ones
    const live = toValidationInput(bundle, {
      values: { ...bundle.current.values, compliance_updates: { value_number: null, value_text: "None", value_json: null } },
      segments: { ...bundle.current.segments, [IDS.segCorporate]: 50 },
      kpis: {},
    });
    const liveIssues = validateSubmissionDraft(live).map((i) => i.target);
    expect(liveIssues).not.toContain("field:revenue_total");
    expect(liveIssues).not.toContain("field:compliance_updates");
    expect(liveIssues).toContain(`kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`);
  });

  it("getSubmissionBundle for a company user: client settings only, nothing ScaleUp-internal", async () => {
    const { sb, requests } = fake(asCompanyUser);
    const bundle = await getSubmissionBundle(sb, IDS.subSep);
    expect(bundle?.settings).toBeNull();
    expect(bundle?.clientSettings).toEqual(CLIENT_SETTINGS);
    expect(bundle?.clientSettings.declaration_text).toMatch(/^I confirm/);
    // The bundle never asks for the internal record, and carries nothing partner-related.
    expect(requests.some((r) => r.path === "company_internal")).toBe(false);
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("partner_in_charge_id");
    expect(json).not.toContain("company_internal");
    expect(json).not.toContain("revenue_swing_pct");
    // ScaleUp actors on the timeline are named "<name> (ScaleUp)" (BRD B28) — no profile, email or role;
    // the company's own people keep their names.
    expect(bundle?.events.map((e) => [e.event, e.actor_name, e.actor?.scaleup_role ?? null])).toEqual([
      ["submitted", "Aisyah Rahman", null],
      ["changes_requested", "Priya Nair (ScaleUp)", null],
      ["resubmitted", null, null],
      ["deadline_extended", null, null],
    ]);
    expect(bundle?.events[1].actor).toBeNull();
    expect(json).not.toContain("priya@scaleup.example");
    expect(json).not.toContain('"scaleup_role":"partner"');
    expect(json.match(/Priya Nair/g)).toEqual(["Priya Nair"]); // only the "(ScaleUp)" display name
    expect(requests.filter((r) => r.path === "rpc/staff_display_names")).toHaveLength(1);
  });

  it("getSubmissionBundle handles missing prior and last-year months and invisible submissions", async () => {
    const { sb, requests } = fake((d) => {
      d.submissions = d.submissions.filter((s) => s.id !== IDS.subAug && s.id !== IDS.subSepLastYear);
    });
    const bundle = await getSubmissionBundle(sb, IDS.subSep);
    expect(bundle?.previous).toBeNull();
    expect(bundle?.lastYear).toBeNull();
    expect(await getSubmissionBundle(sb, "90000000-0000-4000-8000-00000000abcd")).toBeNull();
    const count = requests.length;
    expect(await getSubmissionBundle(sb, "nope")).toBeNull();
    expect(requests.length).toBe(count);
  });

  it("getSubmissionBundleByMonth finds the month without a separate lookup", async () => {
    const { sb, requests } = fake();
    const bundle = await getSubmissionBundleByMonth(sb, IDS.batik, "2026-09");
    expect(bundle?.submission.id).toBe(IDS.subSep);
    expect(bundle?.previous?.submission.id).toBe(IDS.subAug);
    expect(requests).toHaveLength(12); // 11 + the timeline's name lookup (one hidden actor in the fixtures)
    expect(requests[0].params.get("company_id")).toBe(`eq.${IDS.batik}`);
    expect(requests[0].params.get("month")).toBe("eq.2026-09-01");
    expect(await getSubmissionBundleByMonth(sb, IDS.batik, "2026-10")).toBeNull();
    expect(await getSubmissionBundleByMonth(sb, IDS.batik, "garbage")).toBeNull();
  });

  it("listCompanySubmissions returns checked overview rows, newest first", async () => {
    const { sb, requests } = fake();
    const rows = await listCompanySubmissions(sb, IDS.batik);
    expect(requests[0].path).toBe("v_submission_overview");
    expect(requests[0].params.get("order")).toBe("month.desc");
    expect(rows.map((r) => r.month)).toEqual(["2026-09-01", "2026-08-01", "2026-07-01"]);
    expect(rows[2]).toMatchObject({ is_overdue: false, days_overdue: 0, has_narrative: false, open_threads: 0 });
    expect(rows[0].open_threads).toBe(2);
    expect(await listCompanySubmissions(sb, "x")).toEqual([]);
  });

  it("getSubmissionValidation parses the RPC result", async () => {
    const errors = [
      { target: "field:gross_profit", code: "required", message: "Gross profit is required." },
      { target: "general", code: "prior_months", message: "Submit earlier months first: Aug 2026." },
    ];
    const { sb, requests } = fake(undefined, {
      rpc: { get_submission_validation: () => ({ body: { ok: false, errors } }) },
    });
    expect(await getSubmissionValidation(sb, IDS.subSep)).toEqual({ ok: false, errors });
    expect(requests[0].body).toEqual({ p_submission_id: IDS.subSep });

    const okClient = fake(undefined, { rpc: { get_submission_validation: () => ({ body: { ok: true, errors: [] } }) } });
    expect(await getSubmissionValidation(okClient.sb, IDS.subSep)).toEqual({ ok: true, errors: [] });

    const denied = fake(undefined, {
      rpc: {
        get_submission_validation: () => ({
          status: 403,
          body: { code: "42501", message: "This monthly update was not found or you do not have access to it.", details: null, hint: null },
        }),
      },
    });
    const error = (await getSubmissionValidation(denied.sb, IDS.subSep).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe("42501");

    const weird = fake(undefined, { rpc: { get_submission_validation: () => ({ body: [1, 2] }) } });
    await expect(getSubmissionValidation(weird.sb, IDS.subSep)).rejects.toThrow(/unexpected result/);
  });
});

describe("getFinancialSeries", () => {
  it("returns the company's months oldest first, optionally bounded", async () => {
    const { sb, requests } = fake();
    const all = await getFinancialSeries(sb, IDS.batik);
    expect(all.map((p) => p.month)).toEqual(["2025-09-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(all[3]).toEqual({
      month: "2026-09-01",
      revenue_total: 300,
      gross_profit: 120,
      net_profit: -10.5,
      cash_in_bank: 1000,
      burn_rate: 50,
      headcount_ft: 10,
      headcount_pt: 2,
      submission_id: IDS.subSep,
      status: "changes_requested",
      currency: "MYR",
      fx_rate_to_myr: 1,
    });
    const bounded = await getFinancialSeries(sb, IDS.batik, "2026-08", "2026-09-30");
    expect(bounded.map((p) => p.month)).toEqual(["2026-08-01", "2026-09-01"]);
    const last = requests[requests.length - 1];
    expect(last.params.getAll("month")).toEqual(["gte.2026-08-01", "lte.2026-09-01"]);
    expect(last.params.get("order")).toBe("month.asc");
    expect((await getFinancialSeries(sb, IDS.batik, null, "2026-07")).map((p) => p.month)).toEqual([
      "2025-09-01",
      "2026-07-01",
    ]);
    await expect(getFinancialSeries(sb, IDS.batik, "2026-13")).rejects.toThrow(RangeError);
    expect(await getFinancialSeries(sb, "x")).toEqual([]);
  });
});

describe("getPlatformSettings", () => {
  it("returns the singleton (ScaleUp staff) and throws not-found when it is missing or hidden", async () => {
    const { sb, requests } = fake();
    const settings = await getPlatformSettings(sb);
    expect(settings.declaration_text).toMatch(/^I confirm/);
    expect(settings.min_runway_months).toBe(6);
    expect(requests[0].params.get("id")).toBe("eq.1");
    // Company users: RLS hides the row (BRD B27).
    const company = fake(asCompanyUser);
    const error = await getPlatformSettings(company.sb).catch((e: unknown) => e);
    expect(isNotFoundError(error)).toBe(true);
    expect((error as DataError).operation).toBe("getPlatformSettings");
  });
});

describe("getClientSettings", () => {
  it("returns require_mfa, terms_version, declaration_text, due_day and owner_contributor_limit for every user", async () => {
    const { sb, requests } = fake(asCompanyUser);
    expect(await getClientSettings(sb)).toEqual(CLIENT_SETTINGS);
    expect(requests.map((r) => [r.method, r.path])).toEqual([["POST", "rpc/get_client_settings"]]);
  });

  it("throws not-found without a settings row and keeps the code of a failure", async () => {
    const missing = fake(undefined, { rpc: { get_client_settings: () => ({ body: [] }) } });
    await expect(getClientSettings(missing.sb)).rejects.toSatisfy(isNotFoundError);
    const denied = fake(undefined, {
      rpc: {
        get_client_settings: () => ({
          status: 403,
          body: { code: "42501", message: "permission denied for function get_client_settings", details: null, hint: null },
        }),
      },
    });
    const error = (await getClientSettings(denied.sb).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe("42501");
    expect(error.message).toBe(
      "getClientSettings: could not load the platform settings: permission denied for function get_client_settings (42501)",
    );
  });
});

describe("getStaffDisplayNames (BRD B28)", () => {
  it("asks once for the distinct ids, skipping nulls and non-UUIDs, and keys the names by lower-case id", async () => {
    const { sb, requests } = fake(asCompanyUser);
    const names = await getStaffDisplayNames(sb, [
      IDS.partner,
      null,
      IDS.partner.toUpperCase(),
      undefined,
      "not-a-uuid",
      IDS.owner,
      IDS.partner,
    ]);
    expect(names).toEqual({ [IDS.partner]: "Priya Nair (ScaleUp)" });
    expect(requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "rpc/staff_display_names", { p_ids: [IDS.partner, IDS.owner] }],
    ]);
  });

  it("makes no request when there is nothing to ask", async () => {
    const { sb, requests } = fake();
    expect(await getStaffDisplayNames(sb, [])).toEqual({});
    expect(await getStaffDisplayNames(sb, [null, undefined, "", "x"])).toEqual({});
    expect(await getStaffDisplayNames(sb, new Set<string>())).toEqual({});
    expect(requests).toEqual([]);
  });

  it("splits more than 500 ids into batches the database accepts", async () => {
    const { sb, requests } = fake();
    const ids = Array.from({ length: 501 }, (_, i) => `a2000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await getStaffDisplayNames(sb, [...ids, IDS.partner])).toEqual({ [IDS.partner]: "Priya Nair (ScaleUp)" });
    const batches = requests.map((r) => (r.body as { p_ids: string[] }).p_ids);
    expect(batches.map((batch) => batch.length)).toEqual([500, 2]);
    expect(batches.flat()).toEqual([...ids, IDS.partner]);
  });

  it("keeps the database code of a failure", async () => {
    const { sb } = fake(undefined, {
      rpc: {
        staff_display_names: () => ({
          status: 400,
          body: { code: "P0001", message: "Ask for at most 500 names at a time.", details: null, hint: null },
        }),
      },
    });
    const error = (await getStaffDisplayNames(sb, [IDS.partner]).catch((e: unknown) => e)) as DataError;
    expect(error).toBeInstanceOf(DataError);
    expect(error.code).toBe("P0001");
    expect(error.message).toBe(
      "getStaffDisplayNames: could not load the names of ScaleUp staff: Ask for at most 500 names at a time. (P0001)",
    );
  });
});

describe("getCompanyInternal", () => {
  it("returns the ScaleUp-internal record with the partner-in-charge's profile", async () => {
    const { sb, requests } = fake();
    const internal = await getCompanyInternal(sb, IDS.batik);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("company_internal");
    expect(requests[0].params.get("company_id")).toBe(`eq.${IDS.batik}`);
    expect(requests[0].params.get("select")).toBe(
      "*,partner:profiles!company_internal_partner_in_charge_id_fkey(id,full_name,email,scaleup_role,is_active)",
    );
    expect(internal).toMatchObject({
      company_id: IDS.batik,
      partner_in_charge_id: IDS.partner,
      internal_rating: "watch",
      exit_strategy_status: "Trade sale",
      notes: "Keep an eye on churn",
      partner: { id: IDS.partner, full_name: "Priya Nair", email: "priya@scaleup.example", scaleup_role: "partner", is_active: true },
    });
    // No partner assigned yet.
    expect(await getCompanyInternal(sb, IDS.recqa)).toMatchObject({ company_id: IDS.recqa, partner_in_charge_id: null, partner: null });
  });

  it("is null for company users (RLS), for unknown companies and for malformed ids", async () => {
    const company = fake(asCompanyUser);
    expect(await getCompanyInternal(company.sb, IDS.batik)).toBeNull();
    const { sb, requests } = fake();
    expect(await getCompanyInternal(sb, "c0000000-0000-4000-8000-00000000abcd")).toBeNull();
    const count = requests.length;
    expect(await getCompanyInternal(sb, "nope")).toBeNull();
    expect(requests.length).toBe(count);
  });
});
