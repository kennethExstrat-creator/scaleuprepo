import { describe, expect, it } from "vitest";
import { kpiCellKey } from "@/lib/targets";
import {
  groupIssuesByTarget,
  isEmptyValue,
  isHalfYearMonth,
  isKpiDueInMonth,
  kpiCellsForMonth,
  requiredKpiCells,
  toFieldErrors,
  validateSubmissionDraft,
  type ValidationInput,
} from "@/lib/validation";

type Field = ValidationInput["fields"][number];
type Kpi = ValidationInput["kpis"][number];

const SYSTEM_FIELDS: Field[] = [
  { key: "revenue_total", label: "Total revenue", field_type: "currency", is_required: true, section_kind: "financials" },
  {
    key: "gross_profit",
    label: "Gross profit",
    field_type: "currency",
    is_required: true,
    section_kind: "financials",
    validation: { allow_negative: true },
  },
  {
    key: "net_profit",
    label: "Net profit",
    field_type: "currency",
    is_required: true,
    section_kind: "financials",
    validation: { allow_negative: true },
  },
  { key: "cash_in_bank", label: "Cash in bank (month end)", field_type: "currency", is_required: true, section_kind: "financials" },
  { key: "burn_rate", label: "Burn rate (per month)", field_type: "currency", is_required: true, section_kind: "financials" },
  { key: "headcount_ft", label: "Full-time headcount", field_type: "integer", is_required: true, section_kind: "headcount" },
  { key: "headcount_pt", label: "Part-time headcount", field_type: "integer", is_required: true, section_kind: "headcount" },
];

const NARRATIVE_FIELDS: Field[] = [
  { key: "key_milestones", label: "Key milestones", field_type: "long_text", is_required: false, section_kind: "narrative" },
  { key: "fundraising_status", label: "Fundraising status", field_type: "picklist", is_required: false, section_kind: "narrative" },
  {
    key: "team_morale",
    label: "Team morale",
    field_type: "rating",
    is_required: false,
    section_kind: "pulse",
    validation: { min: 1, max: 5 },
  },
  { key: "help_tags", label: "Help needed (tags)", field_type: "tags", is_required: false, section_kind: "pulse" },
];

const FIELDS = [...SYSTEM_FIELDS, ...NARRATIVE_FIELDS];

const num = (value_number: number | null) => ({ value_number, value_text: null, value_json: null });
const text = (value_text: string | null) => ({ value_number: null, value_text, value_json: null });
const json = (value_json: unknown) => ({ value_number: null, value_text: null, value_json });

const COMPLETE = {
  revenue_total: num(100_000),
  gross_profit: num(-5_000),
  net_profit: num(-20_000),
  cash_in_bank: num(500_000),
  burn_rate: num(0),
  headcount_ft: num(10),
  headcount_pt: num(0),
};

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    month: "2026-09-01",
    fields: FIELDS,
    segments: [],
    kpis: [],
    values: { ...COMPLETE },
    segmentValues: {},
    kpiValues: {},
    ...overrides,
  };
}

function withValues(values: ValidationInput["values"], overrides: Partial<ValidationInput> = {}) {
  return validateSubmissionDraft(input({ values: { ...COMPLETE, ...values }, ...overrides }));
}

describe("validateSubmissionDraft — system numbers (rules 1 and 3)", () => {
  it("accepts a complete month: negative GP/NP, zero burn and zero part-timers, blank narrative", () => {
    expect(validateSubmissionDraft(input())).toEqual([]);
  });

  it("requires all seven system numbers, in their fixed order, with the template labels", () => {
    const issues = validateSubmissionDraft(input({ values: {} }));
    expect(issues).toEqual([
      { target: "field:revenue_total", code: "required", message: "Total revenue is required." },
      { target: "field:gross_profit", code: "required", message: "Gross profit is required." },
      { target: "field:net_profit", code: "required", message: "Net profit is required." },
      { target: "field:cash_in_bank", code: "required", message: "Cash in bank (month end) is required." },
      { target: "field:burn_rate", code: "required", message: "Burn rate (per month) is required." },
      { target: "field:headcount_ft", code: "required", message: "Full-time headcount is required." },
      { target: "field:headcount_pt", code: "required", message: "Part-time headcount is required." },
    ]);
  });

  it("treats null, NaN and text in the wrong column as missing numbers", () => {
    const issues = withValues({ gross_profit: num(Number.NaN), net_profit: text("-20000"), cash_in_bank: num(null) });
    expect(issues.map((i) => i.target)).toEqual(["field:gross_profit", "field:net_profit", "field:cash_in_bank"]);
    expect(issues.every((i) => i.code === "required")).toBe(true);
  });

  it("requires system numbers even when the template marks them optional or omits them (SQL label fallback)", () => {
    const relabelled = SYSTEM_FIELDS.map((f) =>
      f.key === "gross_profit" ? { ...f, label: "Gross profit (RM)", is_required: false } : f,
    ).filter((f) => f.key !== "burn_rate");
    const issues = validateSubmissionDraft(
      input({ fields: relabelled, values: { ...COMPLETE, gross_profit: num(null), burn_rate: num(null) } }),
    );
    // Like private.validate_submission(): fixed system order; initcap(key) when the template lacks the field.
    expect(issues).toEqual([
      { target: "field:gross_profit", code: "required", message: "Gross profit (RM) is required." },
      { target: "field:burn_rate", code: "required", message: "Burn Rate is required." },
    ]);
  });

  it("lists the system numbers first, whatever the template order", () => {
    const fields: Field[] = [
      { key: "key_milestones", label: "Key milestones", field_type: "long_text", is_required: true, section_kind: "narrative" },
      ...[...SYSTEM_FIELDS].reverse(),
    ];
    const issues = validateSubmissionDraft(input({ fields, values: {} }));
    expect(issues.map((i) => i.target)).toEqual([
      "field:revenue_total",
      "field:gross_profit",
      "field:net_profit",
      "field:cash_in_bank",
      "field:burn_rate",
      "field:headcount_ft",
      "field:headcount_pt",
      "field:key_milestones",
    ]);
  });

  it("allows negatives only for gross and net profit", () => {
    const issues = withValues({
      revenue_total: num(-1),
      gross_profit: num(-1),
      net_profit: num(-1),
      cash_in_bank: num(-1),
      burn_rate: num(-1),
      headcount_ft: num(-1),
      headcount_pt: num(-1),
    });
    expect(issues).toEqual([
      { target: "field:revenue_total", code: "negative", message: "Total revenue cannot be negative." },
      { target: "field:cash_in_bank", code: "negative", message: "Cash in bank (month end) cannot be negative." },
      { target: "field:burn_rate", code: "negative", message: "Burn rate (per month) cannot be negative." },
      { target: "field:headcount_ft", code: "negative", message: "Full-time headcount cannot be negative." },
      { target: "field:headcount_pt", code: "negative", message: "Part-time headcount cannot be negative." },
    ]);
  });

  it("keeps the non-negative figures non-negative and applies allow_negative: false / min: 0 to GP and NP", () => {
    const fields = SYSTEM_FIELDS.map((f) =>
      f.key === "revenue_total"
        ? { ...f, validation: { allow_negative: true } }
        : f.key === "gross_profit"
          ? { ...f, validation: { min: 0 } }
          : f.key === "net_profit"
            ? { ...f, validation: { allow_negative: false } }
            : f,
    );
    const issues = validateSubmissionDraft(
      input({ fields, values: { ...COMPLETE, revenue_total: num(-10), gross_profit: num(-10), net_profit: num(-10) } }),
    );
    expect(issues).toEqual([
      { target: "field:revenue_total", code: "negative", message: "Total revenue cannot be negative." },
      { target: "field:gross_profit", code: "negative", message: "Gross profit cannot be negative." },
      { target: "field:net_profit", code: "negative", message: "Net profit cannot be negative." },
    ]);
  });

  it("applies a system field's min/max settings (out_of_range, not repeated after negative)", () => {
    const fields = SYSTEM_FIELDS.map((f) => (f.key === "headcount_ft" ? { ...f, validation: { min: 0, max: 500 } } : f));
    expect(validateSubmissionDraft(input({ fields, values: { ...COMPLETE, headcount_ft: num(501) } }))).toEqual([
      { target: "field:headcount_ft", code: "out_of_range", message: "Full-time headcount must be between 0 and 500." },
    ]);
    expect(validateSubmissionDraft(input({ fields, values: { ...COMPLETE, headcount_ft: num(-1) } }))).toEqual([
      { target: "field:headcount_ft", code: "negative", message: "Full-time headcount cannot be negative." },
    ]);
  });

  it("requires whole-number headcounts", () => {
    expect(withValues({ headcount_ft: num(10.5) })).toEqual([
      { target: "field:headcount_ft", code: "not_integer", message: "Full-time headcount must be a whole number." },
    ]);
    expect(withValues({ headcount_pt: num(-0.5) }).map((i) => i.code)).toEqual(["negative", "not_integer"]);
    expect(withValues({ headcount_ft: num(12) })).toEqual([]);
  });

  it("allows a zero revenue month", () => {
    expect(withValues({ revenue_total: num(0), gross_profit: num(-100) })).toEqual([]);
  });
});

describe("validateSubmissionDraft — revenue segments (rule 2, BRD B30)", () => {
  // The company's own segments add up to total revenue; ScaleUp's revenue lines need not.
  const segments: ValidationInput["segments"] = [
    { id: "seg-retail", name: "Retail", is_active: true, kind: "company" },
    { id: "seg-online", name: "Online", is_active: true, kind: "company" },
    { id: "seg-wholesale", name: "Wholesale", is_active: false, kind: "company" },
  ];
  const lines: ValidationInput["segments"] = [
    { id: "line-saas", name: "AOne SaaS", is_active: true, kind: "scaleup" },
    { id: "line-pay", name: "AOnePay", is_active: true, kind: "scaleup" },
    { id: "line-old", name: "Legacy", is_active: false, kind: "scaleup" },
  ];

  it("accepts a total equal to the sum of the active company segments (inactive ignored)", () => {
    const issues = withValues(
      { revenue_total: num(10_000) },
      { segments, segmentValues: { "seg-retail": 6_000, "seg-online": 4_000, "seg-wholesale": 999 } },
    );
    expect(issues).toEqual([]);
  });

  it("reports a sum mismatch against the total, naming the company's own segments", () => {
    const issues = withValues(
      { revenue_total: num(10_000) },
      { segments, segmentValues: { "seg-retail": 6_000, "seg-online": 3_500 } },
    );
    expect(issues).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (10,000.00) must equal the sum of your revenue segments (9,500.00).",
      },
    ]);
  });

  it("allows a difference of up to 0.01 (amounts shown with two decimals, as in SQL)", () => {
    const at = (total: number) =>
      withValues({ revenue_total: num(total) }, { segments, segmentValues: { "seg-retail": 6_000, "seg-online": 4_000 } });
    expect(at(10_000.01)).toEqual([]);
    expect(at(9_999.99)).toEqual([]);
    expect(at(10_000.02)).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (10,000.02) must equal the sum of your revenue segments (10,000.00).",
      },
    ]);
    const floaty = withValues(
      { revenue_total: num(0.3) },
      { segments, segmentValues: { "seg-retail": 0.1, "seg-online": 0.2 } },
    );
    expect(floaty).toEqual([]);
  });

  it("requires every active company segment and skips the sum check until all are entered", () => {
    const issues = withValues(
      { revenue_total: num(10_000) },
      { segments, segmentValues: { "seg-retail": 6_000, "seg-online": null } },
    );
    expect(issues).toEqual([{ target: "segment:seg-online", code: "required", message: "Revenue for Online is required." }]);
  });

  it("rejects negative segment amounts", () => {
    const issues = withValues(
      { revenue_total: num(5_000) },
      { segments, segmentValues: { "seg-retail": 6_000, "seg-online": -1_000 } },
    );
    expect(issues).toEqual([{ target: "segment:seg-online", code: "negative", message: "Revenue for Online cannot be negative." }]);
  });

  it("still requires total revenue when company segments are active", () => {
    const issues = withValues(
      { revenue_total: num(null) },
      { segments, segmentValues: { "seg-retail": 6_000, "seg-online": 4_000 } },
    );
    expect(issues).toEqual([{ target: "field:revenue_total", code: "required", message: "Total revenue is required." }]);
  });

  it("treats a company whose segments are all inactive as having none", () => {
    const inactive = segments.map((s) => ({ ...s, is_active: false }));
    expect(withValues({ revenue_total: num(123) }, { segments: inactive, segmentValues: {} })).toEqual([]);
  });

  it("requires every active ScaleUp revenue line, never negative, without any sum rule", () => {
    // More than total revenue, less than total revenue: both fine.
    expect(withValues({ revenue_total: num(100) }, { segments: lines, segmentValues: { "line-saas": 900, "line-pay": 0 } })).toEqual([]);
    expect(withValues({ revenue_total: num(100) }, { segments: lines, segmentValues: { "line-saas": 1, "line-pay": 2 } })).toEqual([]);
    expect(withValues({ revenue_total: num(100) }, { segments: lines, segmentValues: { "line-saas": -1 } })).toEqual([
      { target: "segment:line-saas", code: "negative", message: "Revenue for AOne SaaS cannot be negative." },
      { target: "segment:line-pay", code: "required", message: "Revenue for AOnePay is required." },
    ]);
  });

  it("counts only company segments in the sum when the company has both kinds", () => {
    const both = [...segments, ...lines];
    const amounts = { "seg-retail": 6_000, "seg-online": 4_000, "line-saas": 2_500, "line-pay": 500 };
    expect(withValues({ revenue_total: num(10_000) }, { segments: both, segmentValues: amounts })).toEqual([]);
    expect(withValues({ revenue_total: num(13_000) }, { segments: both, segmentValues: amounts })).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (13,000.00) must equal the sum of your revenue segments (10,000.00).",
      },
    ]);
  });

  it("treats a segment without a kind as a ScaleUp line (the database default)", () => {
    const legacy = [{ id: "seg-x", name: "Retail", is_active: true }] as unknown as ValidationInput["segments"];
    expect(withValues({ revenue_total: num(1) }, { segments: legacy, segmentValues: { "seg-x": 50 } })).toEqual([]);
  });

  it("lists company segments, then the sum check, then ScaleUp lines, then the other fields (SQL order)", () => {
    const both = [...lines, ...segments]; // input order across kinds does not matter
    const blank = validateSubmissionDraft(input({ values: {}, segments: both, segmentValues: {} }));
    expect(blank.slice(6).map((i) => i.target)).toEqual([
      "field:headcount_pt",
      "segment:seg-retail",
      "segment:seg-online",
      "segment:line-saas",
      "segment:line-pay",
    ]);

    const fields = FIELDS.map((f) => (f.key === "key_milestones" ? { ...f, is_required: true } : f));
    const issues = withValues(
      { revenue_total: num(-1), headcount_ft: num(1.5) },
      { fields, segments: both, segmentValues: { "seg-retail": -5, "seg-online": 10, "line-saas": -2, "line-pay": 1 } },
    );
    expect(issues.map((i) => [i.target, i.code])).toEqual([
      ["field:revenue_total", "negative"],
      ["field:headcount_ft", "not_integer"],
      ["segment:seg-retail", "negative"],
      ["field:revenue_total", "sum_mismatch"],
      ["segment:line-saas", "negative"],
      ["field:key_milestones", "required"],
    ]);
    expect(issues[3].message).toBe("Total revenue (-1.00) must equal the sum of your revenue segments (5.00).");
  });

  it("shows plain grouped amounts without a currency, like the database", () => {
    const issues = withValues(
      { revenue_total: num(999) },
      { segments, segmentValues: { "seg-retail": 5, "seg-online": 1_234_572.5 } },
    );
    expect(issues).toEqual([
      {
        target: "field:revenue_total",
        code: "sum_mismatch",
        message: "Total revenue (999.00) must equal the sum of your revenue segments (1,234,577.50).",
      },
    ]);
  });
});

describe("validateSubmissionDraft — other template fields (rule 4)", () => {
  const required = (key: string) => FIELDS.map((f) => (f.key === key ? { ...f, is_required: true } : f));

  it("keeps narrative and pulse fields optional unless marked required", () => {
    expect(withValues({ key_milestones: text(""), help_tags: json([]), team_morale: num(null) })).toEqual([]);
  });

  it("requires a marked text field and ignores whitespace-only answers", () => {
    const fields = required("key_milestones");
    expect(withValues({}, { fields })).toEqual([
      { target: "field:key_milestones", code: "required", message: "Key milestones is required." },
    ]);
    expect(withValues({ key_milestones: text("   \n ") }, { fields })[0]?.code).toBe("required");
    expect(withValues({ key_milestones: text("Opened the Merdeka 118 outlet") }, { fields })).toEqual([]);
  });

  it("checks picklist, tags and rating fields by their storage column", () => {
    expect(withValues({ fundraising_status: text("Not raising") }, { fields: required("fundraising_status") })).toEqual([]);
    expect(withValues({ help_tags: json([]) }, { fields: required("help_tags") })[0]).toEqual({
      target: "field:help_tags",
      code: "required",
      message: "Help needed (tags) is required.",
    });
    expect(withValues({ help_tags: json(["Hiring"]) }, { fields: required("help_tags") })).toEqual([]);
    expect(withValues({ team_morale: num(4) }, { fields: required("team_morale") })).toEqual([]);
    expect(withValues({ team_morale: num(null) }, { fields: required("team_morale") })[0]?.code).toBe("required");
  });

  it("counts boolean false as a value", () => {
    const fields: Field[] = [
      ...FIELDS,
      { key: "is_profitable", label: "Profitable this month", field_type: "boolean", is_required: true, section_kind: "custom_numbers" },
    ];
    expect(withValues({ is_profitable: json(false) }, { fields })).toEqual([]);
    expect(withValues({ is_profitable: json(true) }, { fields })).toEqual([]);
    expect(withValues({ is_profitable: json(null) }, { fields })).toEqual([
      { target: "field:is_profitable", code: "required", message: "Profitable this month is required." },
    ]);
  });

  it("applies a field's min/max and integer settings to values that are present (as the server does)", () => {
    expect(withValues({ team_morale: num(6) })).toEqual([
      { target: "field:team_morale", code: "out_of_range", message: "Team morale must be between 1 and 5." },
    ]);
    expect(withValues({ team_morale: num(0) })[0]?.code).toBe("out_of_range");
    expect(withValues({ team_morale: num(3) })).toEqual([]);

    const fields: Field[] = [
      ...FIELDS,
      { key: "new_customers", label: "New customers", field_type: "integer", is_required: false, section_kind: "custom_numbers" },
      {
        key: "marketing_spend",
        label: "Marketing spend",
        field_type: "currency",
        is_required: false,
        section_kind: "custom_numbers",
        validation: { allow_negative: false, min: 0 },
      },
      { key: "ebitda", label: "EBITDA", field_type: "currency", is_required: false, section_kind: "custom_numbers" },
      {
        key: "nps",
        label: "NPS",
        field_type: "number",
        is_required: false,
        section_kind: "custom_numbers",
        validation: { max: 100 },
      },
      {
        key: "conversion",
        label: "Conversion rate",
        field_type: "percent",
        is_required: false,
        section_kind: "custom_numbers",
        validation: { min: 0.5 },
      },
    ];
    const issues = withValues(
      {
        new_customers: num(2.5),
        marketing_spend: num(-5),
        ebitda: num(-50_000),
        nps: num(101),
        conversion: num(0.25),
      },
      { fields },
    );
    expect(issues).toEqual([
      { target: "field:new_customers", code: "not_integer", message: "New customers must be a whole number." },
      { target: "field:marketing_spend", code: "negative", message: "Marketing spend cannot be negative." },
      { target: "field:nps", code: "out_of_range", message: "NPS must be at most 100." },
      { target: "field:conversion", code: "out_of_range", message: "Conversion rate must be at least 0.5." },
    ]);
  });

  it('treats {"min": 0} as "cannot be negative" and ignores settings that are not numbers, like the server', () => {
    const fields: Field[] = [
      ...FIELDS,
      {
        key: "outlets_open",
        label: "Outlets open",
        field_type: "integer",
        is_required: false,
        section_kind: "custom_numbers",
        validation: { min: 0 },
      },
      {
        key: "ignored",
        label: "Badly configured",
        field_type: "number",
        is_required: false,
        section_kind: "custom_numbers",
        validation: { min: "zero" as unknown as number, max: Number.NaN },
      },
    ];
    expect(withValues({ outlets_open: num(-2), ignored: num(-1e9) }, { fields })).toEqual([
      { target: "field:outlets_open", code: "negative", message: "Outlets open cannot be negative." },
    ]);
    expect(withValues({ outlets_open: num(-2.5) }, { fields }).map((i) => i.code)).toEqual(["negative", "not_integer"]);
  });
});

describe("validateSubmissionDraft — company KPIs (rule 5)", () => {
  const outlets = [
    { id: "m-mk", name: "Mont Kiara", is_active: true },
    { id: "m-row", name: "The Row", is_active: true },
    { id: "m-closed", name: "Closed outlet", is_active: false },
  ];
  const kpis: Kpi[] = [
    { id: "k-rev", name: "Revenue per outlet", is_active: true, is_required: true, frequency: "monthly", value_type: "currency", members: outlets },
    { id: "k-prof", name: "Profitable", is_active: true, is_required: true, frequency: "monthly", value_type: "boolean", members: outlets },
    { id: "k-dl", name: "App downloads", is_active: true, is_required: true, frequency: "monthly", value_type: "integer", members: null },
    { id: "k-nps", name: "Customer NPS", is_active: true, is_required: true, frequency: "half_yearly", value_type: "number", members: null },
    { id: "k-note", name: "Pipeline note", is_active: true, is_required: true, frequency: "monthly", value_type: "text", members: null },
    { id: "k-opt", name: "Optional metric", is_active: true, is_required: false, frequency: "monthly", value_type: "number", members: null },
    { id: "k-old", name: "Retired metric", is_active: false, is_required: true, frequency: "monthly", value_type: "number", members: null },
    { id: "k-none", name: "No active outlets", is_active: true, is_required: true, frequency: "monthly", value_type: "number", members: [] },
  ];
  const kpiRow = (over: Partial<{ value_number: number | null; value_text: string | null; value_bool: boolean | null }>) => ({
    value_number: null,
    value_text: null,
    value_bool: null,
    ...over,
  });

  it("requires monthly KPIs per active member and skips half-yearly ones outside June and December", () => {
    const issues = validateSubmissionDraft(input({ kpis }));
    expect(issues).toEqual([
      { target: "kpi:k-rev:m-mk", code: "required", message: "Revenue per outlet (Mont Kiara) is required." },
      { target: "kpi:k-rev:m-row", code: "required", message: "Revenue per outlet (The Row) is required." },
      { target: "kpi:k-prof:m-mk", code: "required", message: "Profitable (Mont Kiara) is required." },
      { target: "kpi:k-prof:m-row", code: "required", message: "Profitable (The Row) is required." },
      { target: "kpi:k-dl", code: "required", message: "App downloads is required." },
      { target: "kpi:k-note", code: "required", message: "Pipeline note is required." },
    ]);
  });

  it("requires half-yearly KPIs in June and December", () => {
    for (const month of ["2026-12-01", "2027-06", "2026-06-01"]) {
      const targets = validateSubmissionDraft(input({ month, kpis })).map((i) => i.target);
      expect(targets).toContain("kpi:k-nps");
    }
    expect(validateSubmissionDraft(input({ month: "2027-03-01", kpis })).map((i) => i.target)).not.toContain("kpi:k-nps");
  });

  it("accepts complete KPI values, with boolean false as a value", () => {
    const kpiValues: ValidationInput["kpiValues"] = {
      [kpiCellKey("k-rev", "m-mk")]: kpiRow({ value_number: 52_000 }),
      [kpiCellKey("k-rev", "m-row")]: kpiRow({ value_number: 0 }),
      [kpiCellKey("k-prof", "m-mk")]: kpiRow({ value_bool: true }),
      [kpiCellKey("k-prof", "m-row")]: kpiRow({ value_bool: false }),
      [kpiCellKey("k-dl")]: kpiRow({ value_number: 1_250 }),
      [kpiCellKey("k-note")]: kpiRow({ value_text: "Three enterprise pilots" }),
      [kpiCellKey("k-rev", "m-closed")]: kpiRow({ value_number: -1 }), // inactive member: ignored
    };
    expect(validateSubmissionDraft(input({ kpis, kpiValues }))).toEqual([]);
  });

  it("treats blank text as missing and checks integer KPIs for whole numbers", () => {
    const kpiValues: ValidationInput["kpiValues"] = {
      [kpiCellKey("k-rev", "m-mk")]: kpiRow({ value_number: 1 }),
      [kpiCellKey("k-rev", "m-row")]: kpiRow({ value_number: 1 }),
      [kpiCellKey("k-prof", "m-mk")]: kpiRow({ value_bool: false }),
      [kpiCellKey("k-prof", "m-row")]: kpiRow({ value_bool: false }),
      [kpiCellKey("k-dl")]: kpiRow({ value_number: 12.5 }),
      [kpiCellKey("k-note")]: kpiRow({ value_text: "  " }),
      [kpiCellKey("k-opt")]: kpiRow({ value_number: 3.14 }),
    };
    expect(validateSubmissionDraft(input({ kpis, kpiValues }))).toEqual([
      { target: "kpi:k-dl", code: "not_integer", message: "App downloads must be a whole number." },
      { target: "kpi:k-note", code: "required", message: "Pipeline note is required." },
    ]);
  });

  it("lists the required KPI cells for a month", () => {
    const cells = requiredKpiCells({ month: "2026-09", kpis });
    expect(cells.map(({ kpiId, memberId, label }) => ({ kpiId, memberId, label }))).toEqual([
      { kpiId: "k-rev", memberId: "m-mk", label: "Revenue per outlet (Mont Kiara)" },
      { kpiId: "k-rev", memberId: "m-row", label: "Revenue per outlet (The Row)" },
      { kpiId: "k-prof", memberId: "m-mk", label: "Profitable (Mont Kiara)" },
      { kpiId: "k-prof", memberId: "m-row", label: "Profitable (The Row)" },
      { kpiId: "k-dl", memberId: null, label: "App downloads" },
      { kpiId: "k-note", memberId: null, label: "Pipeline note" },
    ]);
    expect(cells[0]).toMatchObject({ cellKey: "k-rev:m-mk", target: "kpi:k-rev:m-mk", required: true, valueType: "currency" });
    expect(cells[4]).toMatchObject({ cellKey: "k-dl:-", target: "kpi:k-dl" });
    expect(requiredKpiCells({ month: "2026-12", kpis }).map((c) => c.kpiId)).toContain("k-nps");
    expect(kpiCellsForMonth({ month: "2026-09", kpis }).map((c) => c.kpiId)).toContain("k-opt");
  });
});

describe("helpers", () => {
  it("isEmptyValue: 0 and false are values; blanks, [] and NaN are not", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue("  ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(Number.NaN)).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue("x")).toBe(false);
    expect(isEmptyValue(["Hiring"])).toBe(false);
  });

  it("isEmptyValue on stored rows, with and without a type", () => {
    expect(isEmptyValue({ value_number: null, value_text: null, value_json: null })).toBe(true);
    expect(isEmptyValue({ value_number: 0, value_text: null, value_json: null })).toBe(false);
    expect(isEmptyValue({ value_number: null, value_text: null, value_json: false })).toBe(false);
    expect(isEmptyValue({ value_number: null, value_text: null, value_bool: false })).toBe(false);
    expect(isEmptyValue({ value_number: null, value_text: " ", value_json: [] })).toBe(true);
    expect(isEmptyValue({ value_number: 5, value_text: null, value_json: null }, "long_text")).toBe(true);
    expect(isEmptyValue({ value_number: null, value_text: "5", value_json: null }, "currency")).toBe(true);
    expect(isEmptyValue({ value_number: null, value_text: null, value_bool: false }, "boolean")).toBe(false);
    expect(isEmptyValue({ value_number: null, value_text: null, value_json: true }, "boolean")).toBe(false);
    expect(isEmptyValue({ value_number: null, value_text: null, value_json: "yes" }, "boolean")).toBe(true);
    expect(isEmptyValue({ value_number: null, value_text: null, value_json: ["Finance"] }, "tags")).toBe(false);
  });

  it("isHalfYearMonth and isKpiDueInMonth", () => {
    expect(isHalfYearMonth("2026-06")).toBe(true);
    expect(isHalfYearMonth("2026-12-01")).toBe(true);
    expect(isHalfYearMonth("2026-09-01")).toBe(false);
    expect(isHalfYearMonth("2027-01")).toBe(false);
    expect(() => isHalfYearMonth("June 2026")).toThrow(RangeError);
    expect(isKpiDueInMonth({ frequency: "monthly" }, "2026-09")).toBe(true);
    expect(isKpiDueInMonth({ frequency: "half_yearly" }, "2026-09")).toBe(false);
    expect(isKpiDueInMonth({ frequency: "half_yearly" }, "2026-12")).toBe(true);
  });

  it("groups issues by target and builds field errors", () => {
    const issues = withValues({ headcount_pt: num(-0.5), gross_profit: num(null) });
    expect(Object.keys(groupIssuesByTarget(issues))).toEqual(["field:gross_profit", "field:headcount_pt"]);
    expect(groupIssuesByTarget(issues)["field:headcount_pt"]).toHaveLength(2);
    expect(toFieldErrors(issues)).toEqual({
      "field:gross_profit": "Gross profit is required.",
      "field:headcount_pt": "Part-time headcount cannot be negative.",
    });
  });
});
