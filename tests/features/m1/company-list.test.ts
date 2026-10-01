import { describe, expect, it } from "vitest";

import {
  compareCompanyNames,
  filterCompanies,
  filtersToQueryString,
  hasActiveFilters,
  latestMonthByCompany,
  NO_FILTERS,
  normaliseForSearch,
  parseCompanyFilters,
  sanitiseFilters,
  summariseCompanies,
  UNASSIGNED_PARTNER,
  type CompanyListRow,
} from "@/app/admin/companies/_components/company-list";

const PARTNER_A = "a1000000-0000-4000-8000-000000000001";
const PARTNER_B = "a1000000-0000-4000-8000-000000000002";

function row(overrides: Partial<CompanyListRow> & Pick<CompanyListRow, "id" | "name">): CompanyListRow {
  return {
    legalName: null,
    sector: null,
    country: "Malaysia",
    status: "active",
    reportingStartMonth: null,
    reportingCurrency: "MYR",
    funds: [],
    partner: null,
    latest: null,
    ...overrides,
  };
}

const SV1 = { id: "f1", code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd" };
const SFF = { id: "f2", code: "SFF", name: "ScaleUp Founders Fund LP" };

const ROWS: CompanyListRow[] = [
  row({
    id: "c1",
    name: "Batik Boutique",
    legalName: "Batik Boutique Sdn Bhd",
    reportingStartMonth: "2026-07-01",
    funds: [SV1],
    partner: { id: PARTNER_A, name: "Renuka Sena", isActive: true },
  }),
  row({ id: "c2", name: "Kiddocare", reportingStartMonth: "2026-07-01", funds: [SFF, SV1] }),
  row({ id: "c3", name: "StayHere", status: "written_off", funds: [SFF] }),
  row({
    id: "c4",
    name: "i-Motorbike",
    legalName: "iMotorbike Pte Ltd",
    reportingCurrency: "USD",
    funds: [SFF],
    partner: { id: PARTNER_B, name: "Aaron Sarma", isActive: true },
  }),
  row({ id: "c5", name: "Café Ölé", status: "exited" }),
];

describe("parseCompanyFilters", () => {
  it("reads every filter from a search params record", () => {
    expect(
      parseCompanyFilters({ q: "  batik ", fund: "sv1", status: "active", partner: PARTNER_A.toUpperCase(), reporting: "yes" }),
    ).toEqual({ q: "batik", fund: "SV1", status: "active", partner: PARTNER_A, reporting: "yes" });
  });

  it("reads URLSearchParams and the first value of repeated params", () => {
    expect(parseCompanyFilters(new URLSearchParams("fund=SFF&reporting=no&partner=none"))).toEqual({
      ...NO_FILTERS,
      fund: "SFF",
      partner: UNASSIGNED_PARTNER,
      reporting: "no",
    });
    expect(parseCompanyFilters({ status: ["exited", "active"] }).status).toBe("exited");
  });

  it("ignores unknown or malformed values", () => {
    expect(
      parseCompanyFilters({ fund: "SV 1!", status: "closed", partner: "someone", reporting: "maybe" }),
    ).toEqual(NO_FILTERS);
    expect(parseCompanyFilters({}).q).toBe("");
    expect(parseCompanyFilters({ q: "x".repeat(150) }).q).toHaveLength(100);
  });
});

describe("sanitiseFilters", () => {
  it("drops a fund or partner that is not on the page", () => {
    const filters = { ...NO_FILTERS, fund: "SV2", partner: PARTNER_B };
    expect(sanitiseFilters(filters, { fundCodes: ["SV1", "SFF"], partnerIds: [PARTNER_A] })).toEqual(NO_FILTERS);
  });

  it("keeps known values and the unassigned partner filter", () => {
    const filters = { ...NO_FILTERS, fund: "SFF", partner: UNASSIGNED_PARTNER };
    expect(sanitiseFilters(filters, { fundCodes: ["sv1", "sff"], partnerIds: [] })).toEqual(filters);
  });
});

describe("filtersToQueryString / hasActiveFilters", () => {
  it("omits empty filters", () => {
    expect(filtersToQueryString(NO_FILTERS)).toBe("");
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, q: "   " })).toBe(false);
  });

  it("round-trips through parseCompanyFilters", () => {
    const filters = { q: "batik boutique", fund: "SV1", status: "active" as const, partner: PARTNER_A, reporting: "yes" as const };
    const query = filtersToQueryString(filters);
    expect(query).toBe(`?q=batik+boutique&fund=SV1&status=active&partner=${PARTNER_A}&reporting=yes`);
    expect(parseCompanyFilters(new URLSearchParams(query.slice(1)))).toEqual(filters);
    expect(hasActiveFilters(filters)).toBe(true);
  });
});

describe("normaliseForSearch", () => {
  it("ignores case, accents and repeated spaces", () => {
    expect(normaliseForSearch("  Café   ÖLÉ ")).toBe("cafe ole");
  });
});

describe("filterCompanies", () => {
  const ids = (filters: Partial<typeof NO_FILTERS>) => filterCompanies(ROWS, { ...NO_FILTERS, ...filters }).map((r) => r.id);

  it("returns every row without filters, in order", () => {
    expect(ids({})).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("searches the name and the legal name, accent-insensitively", () => {
    expect(ids({ q: "boutique" })).toEqual(["c1"]);
    expect(ids({ q: "imotorbike pte" })).toEqual(["c4"]);
    expect(ids({ q: "cafe" })).toEqual(["c5"]);
    expect(ids({ q: "nothing like this" })).toEqual([]);
  });

  it("filters by fund code (a company can sit in several funds)", () => {
    expect(ids({ fund: "SV1" })).toEqual(["c1", "c2"]);
    expect(ids({ fund: "SFF" })).toEqual(["c2", "c3", "c4"]);
  });

  it("filters by status", () => {
    expect(ids({ status: "active" })).toEqual(["c1", "c2", "c4"]);
    expect(ids({ status: "written_off" })).toEqual(["c3"]);
  });

  it("filters by partner-in-charge, or companies without one", () => {
    expect(ids({ partner: PARTNER_A })).toEqual(["c1"]);
    expect(ids({ partner: UNASSIGNED_PARTNER })).toEqual(["c2", "c3", "c5"]);
  });

  it("filters by reporting or not yet reporting", () => {
    expect(ids({ reporting: "yes" })).toEqual(["c1", "c2"]);
    expect(ids({ reporting: "no" })).toEqual(["c3", "c4", "c5"]);
  });

  it("combines filters", () => {
    expect(ids({ fund: "SFF", status: "active", reporting: "no" })).toEqual(["c4"]);
  });
});

describe("latestMonthByCompany", () => {
  it("keeps each company's newest month and skips incomplete rows", () => {
    const latest = latestMonthByCompany([
      { id: "s1", company_id: "c1", month: "2026-07-01", status: "approved", is_overdue: false, days_overdue: 0 },
      { id: "s2", company_id: "c1", month: "2026-08-01", status: "draft", is_overdue: true, days_overdue: 15 },
      { id: "s3", company_id: "c2", month: "2026-08-01", status: "submitted", is_overdue: null, days_overdue: null },
      { id: "s4", company_id: "c1", month: "2026-06-01", status: "approved", is_overdue: false, days_overdue: 0 },
      { id: null, company_id: "c3", month: "2026-08-01", status: "draft", is_overdue: false, days_overdue: 0 },
    ]);
    expect(latest.get("c1")).toEqual({
      submissionId: "s2",
      month: "2026-08-01",
      status: "draft",
      isOverdue: true,
      daysOverdue: 15,
    });
    expect(latest.get("c2")).toMatchObject({ submissionId: "s3", isOverdue: false, daysOverdue: 0 });
    expect(latest.has("c3")).toBe(false);
  });
});

describe("summariseCompanies / compareCompanyNames", () => {
  it("counts active and reporting companies", () => {
    expect(summariseCompanies(ROWS)).toEqual({ total: 5, active: 3, reporting: 2, notYetReporting: 3 });
  });

  it("orders names case-insensitively with numbers by value", () => {
    expect(["kabel", "Agiliux", "Outlet 10", "Outlet 2"].sort(compareCompanyNames)).toEqual([
      "Agiliux",
      "kabel",
      "Outlet 2",
      "Outlet 10",
    ]);
  });
});
