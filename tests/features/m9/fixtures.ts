// Fixture data for the M9 export builders (C4 workbook, portfolio extract). Shapes follow what the
// loaders (src/lib/exports/*-data.ts) produce from the database.
import type {
  C4Kpi,
  C4Month,
  C4Segment,
  C4StoredKpiValue,
  C4StoredValue,
  C4Template,
  C4TemplateField,
  C4WorkbookInput,
} from "@/lib/exports/c4-workbook";
import type { Json } from "@/lib/supabase/database.types";
import { kpiCellKey } from "@/lib/targets";
import type { FieldType, SubmissionStatus } from "@/lib/types/enums";

export const IDS = {
  template: "b1000000-0000-4000-8000-000000000001",
  templateV0: "b1000000-0000-4000-8000-000000000000",
  retail: "a1000000-0000-4000-8000-000000000001",
  online: "a1000000-0000-4000-8000-000000000002",
  wholesale: "a1000000-0000-4000-8000-000000000003",
  gifting: "a1000000-0000-4000-8000-000000000004",
  events: "a1000000-0000-4000-8000-000000000005",
  revenuePerOutlet: "e1000000-0000-4000-8000-000000000001",
  profitable: "e1000000-0000-4000-8000-000000000002",
  downloads: "e1000000-0000-4000-8000-000000000003",
  legacyKpi: "e1000000-0000-4000-8000-000000000004",
  montKiara: "d1000000-0000-4000-8000-000000000001",
  theRow: "d1000000-0000-4000-8000-000000000002",
  oldTown: "d1000000-0000-4000-8000-000000000003",
} as const;

function field(key: string, label: string, field_type: FieldType, extra: Partial<C4TemplateField> = {}): C4TemplateField {
  return { key, label, field_type, options: null, is_system: false, ...extra };
}

const system = (key: string, label: string, type: FieldType) => field(key, label, type, { is_system: true });

/** The seeded "Portfolio Update" v1 (docs/ARCHITECTURE.md §3), trimmed, plus an "Additional numbers" section. */
export function template(id: string = IDS.template): C4Template {
  return {
    id,
    sections: [
      {
        key: "financials",
        title: "Financials",
        kind: "financials",
        fields: [
          system("revenue_total", "Total revenue", "currency"),
          system("gross_profit", "Gross profit", "currency"),
          system("net_profit", "Net profit", "currency"),
          system("cash_in_bank", "Cash in bank (month end)", "currency"),
          system("burn_rate", "Burn rate (per month)", "currency"),
        ],
      },
      {
        key: "headcount",
        title: "Headcount",
        kind: "headcount",
        fields: [
          system("headcount_ft", "Full-time headcount", "integer"),
          system("headcount_pt", "Part-time headcount", "integer"),
        ],
      },
      { key: "kpis", title: "Company KPIs", kind: "kpis", fields: [] },
      {
        key: "extra_numbers",
        title: "Additional numbers",
        kind: "custom_numbers",
        fields: [field("customers", "Active customers", "integer")],
      },
      {
        key: "company_summary",
        title: "Company Summary",
        kind: "narrative",
        fields: [field("key_milestones", "Key milestones", "long_text")],
      },
      {
        key: "revenue_financial",
        title: "Revenue and Financial Metrics",
        kind: "narrative",
        fields: [field("financial_commentary", "Commentary on the month's numbers", "long_text")],
      },
      {
        key: "operation",
        title: "Operation",
        kind: "narrative",
        fields: [
          field("operations_highlights", "Operations highlights", "long_text"),
          field("team_highlights", "Team highlights", "long_text"),
        ],
      },
      {
        key: "investment",
        title: "Investment",
        kind: "narrative",
        fields: [
          field("fundraising_status", "Fundraising status", "picklist", {
            options: { options: ["Not raising", "Actively raising"] },
          }),
          field("fundraising_commentary", "Fundraising commentary", "long_text"),
        ],
      },
      {
        key: "founder_pulse",
        title: "Founder Pulse",
        kind: "pulse",
        fields: [
          field("team_morale", "Team morale", "rating", {
            options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } },
          }),
          field("next_month_goals", "Next month goals", "long_text"),
          field("help_tags", "Help needed (tags)", "tags"),
        ],
      },
    ],
  };
}

export function num(value: number): C4StoredValue {
  return { value_number: value, value_text: null, value_json: null };
}

export function text(value: string): C4StoredValue {
  return { value_number: null, value_text: value, value_json: null };
}

export function json(value: Json): C4StoredValue {
  return { value_number: null, value_text: null, value_json: value };
}

export function kpiNum(value: number): C4StoredKpiValue {
  return { value_number: value, value_text: null, value_bool: null };
}

export function kpiBool(value: boolean): C4StoredKpiValue {
  return { value_number: null, value_text: null, value_bool: value };
}

type Figures = { revenue: number; gp: number; np: number; cash: number; burn: number; ft: number; pt: number };

export function figures(f: Figures): Record<string, C4StoredValue> {
  return {
    revenue_total: num(f.revenue),
    gross_profit: num(f.gp),
    net_profit: num(f.np),
    cash_in_bank: num(f.cash),
    burn_rate: num(f.burn),
    headcount_ft: num(f.ft),
    headcount_pt: num(f.pt),
  };
}

export function month(
  key: string,
  status: SubmissionStatus,
  overrides: Partial<C4Month> = {},
): C4Month {
  return {
    month: `${key}-01`,
    status,
    template_version_id: IDS.template,
    submitted_at: status === "draft" ? null : `${key}-20T02:00:00Z`,
    approved_at: null,
    last_saved_at: `${key}-18T02:00:00Z`,
    fx_rate_to_myr: 1,
    values: {},
    segments: {},
    kpis: {},
    ...overrides,
  };
}

export const KPIS: C4Kpi[] = [
  {
    id: IDS.revenuePerOutlet,
    name: "Revenue per outlet",
    unit: "RM",
    value_type: "currency",
    frequency: "monthly",
    is_active: true,
    dimension: { name: "Outlet" },
    members: [
      { id: IDS.montKiara, name: "Mont Kiara", is_active: true },
      { id: IDS.theRow, name: "The Row", is_active: true },
      { id: IDS.oldTown, name: "Old Town", is_active: false },
    ],
  },
  {
    id: IDS.profitable,
    name: "Profitable",
    unit: null,
    value_type: "boolean",
    frequency: "monthly",
    is_active: true,
    dimension: { name: "Outlet" },
    members: [
      { id: IDS.montKiara, name: "Mont Kiara", is_active: true },
      { id: IDS.theRow, name: "The Row", is_active: true },
      { id: IDS.oldTown, name: "Old Town", is_active: false },
    ],
  },
  {
    id: IDS.downloads,
    name: "App downloads",
    unit: "downloads",
    value_type: "integer",
    frequency: "monthly",
    is_active: true,
    dimension: null,
    members: [],
  },
  {
    id: IDS.legacyKpi,
    name: "Legacy KPI",
    unit: null,
    value_type: "number",
    frequency: "half_yearly",
    is_active: false,
    dimension: null,
    members: [],
  },
];

/**
 * Revenue segments of both kinds (BRD B30): the company's own Retail and Online (in use) and Wholesale
 * (no longer used), and ScaleUp's revenue lines Corporate gifting (in use) and Events (no longer used).
 */
export const SEGMENTS: C4Segment[] = [
  { id: IDS.wholesale, name: "Wholesale", is_active: false, kind: "company", sort_order: 1 },
  { id: IDS.online, name: "Online", is_active: true, kind: "company", sort_order: 2 },
  { id: IDS.retail, name: "Retail", is_active: true, kind: "company", sort_order: 1 },
  { id: IDS.events, name: "Events", is_active: false, kind: "scaleup", sort_order: 2 },
  { id: IDS.gifting, name: "Corporate gifting", is_active: true, kind: "scaleup", sort_order: 1 },
];

/**
 * Batik-like company reporting May–Sep 2026 on 30 Sep 2026: May and Jun approved (H1 2026), Jul approved,
 * Aug submitted, Sep draft (H2 2026, in progress). The company's own segments add up to total revenue
 * (Wholesale only in May, before it was retired); Corporate gifting is a ScaleUp line that need not add
 * up. The Sep draft still holds figures on the two retired segments, which it no longer shows.
 */
export function batikInput(overrides: Partial<C4WorkbookInput> = {}): C4WorkbookInput {
  return {
    company: { name: "Batik Boutique", legal_name: "Batik Boutique Sdn Bhd", reporting_currency: "MYR" },
    include: "approved",
    generatedAt: "2026-09-30T06:05:00Z",
    today: "2026-09-30",
    fxVisible: true,
    currentTemplate: template(),
    templates: [template()],
    segments: SEGMENTS,
    kpis: KPIS,
    months: [
      month("2026-05", "approved", {
        approved_at: "2026-06-19T03:00:00Z",
        values: {
          ...figures({ revenue: 100_000, gp: 40_000, np: -10_000, cash: 600_000, burn: 50_000, ft: 10, pt: 2 }),
          customers: num(120),
          key_milestones: text("Opened Mont Kiara."),
          team_morale: num(4),
        },
        segments: { [IDS.retail]: 60_000, [IDS.online]: 30_000, [IDS.wholesale]: 10_000, [IDS.gifting]: 100.1 },
        kpis: {
          [kpiCellKey(IDS.revenuePerOutlet, IDS.montKiara)]: kpiNum(25_000),
          [kpiCellKey(IDS.profitable, IDS.montKiara)]: kpiBool(true),
          [kpiCellKey(IDS.downloads, null)]: kpiNum(1_500),
        },
      }),
      month("2026-06", "approved", {
        approved_at: "2026-07-20T02:00:00Z",
        values: figures({ revenue: 110_000, gp: 44_000, np: -5_000, cash: 560_000, burn: 40_000, ft: 11, pt: 2 }),
        segments: { [IDS.retail]: 70_000, [IDS.online]: 40_000, [IDS.gifting]: 200.2 },
      }),
      month("2026-07", "approved", {
        approved_at: "2026-08-18T03:00:00Z",
        values: {
          ...figures({ revenue: 120_000, gp: 48_000, np: 0, cash: 540_000, burn: 0, ft: 12, pt: 3 }),
          operations_highlights: text("Opened The Row."),
          team_highlights: text("Hired a head of retail."),
          fundraising_status: text("Actively raising"),
          help_tags: json(["Fundraising", "Hiring"]),
        },
        segments: { [IDS.retail]: 80_000, [IDS.online]: 40_000, [IDS.gifting]: 7_000 },
      }),
      month("2026-08", "submitted", {
        values: {
          ...figures({ revenue: 130_000, gp: 50_000, np: 5_000, cash: 520_000, burn: 20_000, ft: 12, pt: 3 }),
          key_milestones: text("Signed the Merdeka 118 lease."),
        },
        segments: { [IDS.retail]: 90_000, [IDS.online]: 40_000 },
      }),
      month("2026-09", "draft", {
        values: { revenue_total: num(90_000) },
        segments: { [IDS.retail]: 50_000, [IDS.wholesale]: 40_000, [IDS.events]: 1_000, [IDS.online]: null },
      }),
    ],
    ...overrides,
  };
}
