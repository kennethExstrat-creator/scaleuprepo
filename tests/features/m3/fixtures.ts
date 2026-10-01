// The seeded "Portfolio Update" v1 (docs/ARCHITECTURE.md §3, supabase/seed.sql) as a TemplateVersionFull,
// for the template builder tests. Ids follow the seed (b2… sections, b3… fields).
import type { Json } from "@/lib/supabase/database.types";
import type { TemplateFieldRow, TemplateSectionFull, TemplateVersionFull } from "@/lib/types/domain";
import type { FieldType, SectionKind } from "@/lib/types/enums";

export const TEMPLATE_ID = "b0000000-0000-4000-8000-000000000001";
export const V1_ID = "b1000000-0000-4000-8000-000000000001";
export const V2_ID = "b1000000-0000-4000-8000-000000000002";

const pad = (n: number) => String(n).padStart(2, "0");
export const sectionId = (n: number, version = 1) => `b2000000-0000-4000-8${version}00-0000000000${pad(n)}`;
export const fieldId = (n: number, version = 1) => `b3000000-0000-4000-8${version}00-0000000000${pad(n)}`;

type FieldSpec = [
  key: string,
  label: string,
  type: FieldType,
  flags?: { required?: boolean; system?: boolean; help?: string; options?: Json; validation?: Json },
];

const SECTIONS: [key: string, title: string, kind: SectionKind, fields: FieldSpec[]][] = [
  [
    "financials",
    "Financials",
    "financials",
    [
      ["revenue_total", "Total revenue", "currency", { required: true, system: true, validation: { min: 0 } }],
      ["gross_profit", "Gross profit", "currency", { required: true, system: true, validation: { allow_negative: true } }],
      ["net_profit", "Net profit", "currency", { required: true, system: true, validation: { allow_negative: true } }],
      ["cash_in_bank", "Cash in bank (month end)", "currency", { required: true, system: true, validation: { min: 0 } }],
      [
        "burn_rate",
        "Burn rate (per month)",
        "currency",
        { required: true, system: true, help: "Enter 0 if cash-flow positive", validation: { min: 0 } },
      ],
    ],
  ],
  [
    "headcount",
    "Headcount",
    "headcount",
    [
      ["headcount_ft", "Full-time headcount", "integer", { required: true, system: true, validation: { min: 0 } }],
      ["headcount_pt", "Part-time headcount", "integer", { required: true, system: true, validation: { min: 0 } }],
    ],
  ],
  ["kpis", "Company KPIs", "kpis", []],
  ["company_summary", "Company Summary", "narrative", [["key_milestones", "Key milestones", "long_text"]]],
  [
    "revenue_financial",
    "Revenue and Financial Metrics",
    "narrative",
    [["financial_commentary", "Commentary on the month's numbers", "long_text"]],
  ],
  [
    "partnerships_market",
    "Partnerships and Market Updates",
    "narrative",
    [["partnerships", "Partnerships and market updates", "long_text"]],
  ],
  [
    "operation",
    "Operation",
    "narrative",
    [
      ["operations_highlights", "Operations highlights", "long_text"],
      ["team_highlights", "Team highlights", "long_text"],
    ],
  ],
  ["product_development", "Product Development", "narrative", [["product_highlights", "Product highlights", "long_text"]]],
  [
    "customer_acquisition",
    "Customer Acquisition Strategies",
    "narrative",
    [
      ["sales_highlights", "Sales highlights", "long_text"],
      ["marketing_highlights", "Marketing highlights", "long_text"],
    ],
  ],
  [
    "investment",
    "Investment",
    "narrative",
    [
      [
        "fundraising_status",
        "Fundraising status",
        "picklist",
        {
          options: {
            options: [
              "Not raising",
              "Preparing to raise",
              "Actively raising",
              "Term sheet received",
              "Closing round",
              "Round closed",
            ],
          },
        },
      ],
      ["fundraising_commentary", "Fundraising commentary", "long_text"],
    ],
  ],
  [
    "compliance_regulation",
    "Compliance and Regulation",
    "narrative",
    [["compliance_updates", "Licences and regulatory matters", "long_text"]],
  ],
  ["other_mentionables", "Other Mentionables", "narrative", [["other_updates", "Anything else", "long_text"]]],
  [
    "founder_pulse",
    "Founder Pulse",
    "pulse",
    [
      ["team_morale", "Team morale", "rating", { options: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } } }],
      ["next_month_goals", "Next month goals", "long_text"],
      ["help_needed", "Help needed from ScaleUp", "long_text"],
      [
        "help_tags",
        "Help needed (tags)",
        "tags",
        {
          options: {
            options: [
              "Fundraising",
              "Hiring",
              "Sales introductions",
              "Partnerships",
              "Legal and regulatory",
              "Finance",
              "Product and technology",
              "Marketing",
              "Other",
            ],
          },
        },
      ],
    ],
  ],
];

/** The seeded v1 (published). `version` 2 gives the same content with other ids, as a draft copy. */
export function seedVersion(version = 1): TemplateVersionFull {
  const versionId = version === 1 ? V1_ID : V2_ID;
  let fieldNo = 0;
  const sections: TemplateSectionFull[] = SECTIONS.map(([key, title, kind, fields], index) => {
    const id = sectionId(index + 1, version);
    return {
      id,
      template_version_id: versionId,
      key,
      title,
      description: null,
      kind,
      sort_order: index + 1,
      created_at: "2026-09-30T00:00:00Z",
      fields: fields.map(([fieldKey, label, type, flags = {}], fieldIndex): TemplateFieldRow => {
        fieldNo += 1;
        return {
          id: fieldId(fieldNo, version),
          template_version_id: versionId,
          section_id: id,
          key: fieldKey,
          label,
          help_text: flags.help ?? null,
          field_type: type,
          is_required: flags.required ?? false,
          is_system: flags.system ?? false,
          options: flags.options ?? null,
          validation: flags.validation ?? null,
          sort_order: fieldIndex + 1,
          created_at: "2026-09-30T00:00:00Z",
        };
      }),
    };
  });
  return {
    id: versionId,
    template_id: TEMPLATE_ID,
    version_no: version,
    status: version === 1 ? "published" : "draft",
    notes: version === 1 ? "Initial version" : null,
    created_by: null,
    created_at: "2026-09-30T00:00:00Z",
    published_at: version === 1 ? "2026-09-30T00:00:00Z" : null,
    published_by: null,
    template: {
      id: TEMPLATE_ID,
      name: "Portfolio Update",
      description: "Monthly portfolio update based on the C4 template: numbers every month, narrative optional.",
      is_default: true,
      created_at: "2026-09-30T00:00:00Z",
    },
    sections,
  };
}

/** A deep copy that tests may change freely. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function sectionByKey(version: TemplateVersionFull, key: string): TemplateSectionFull {
  const section = version.sections.find((item) => item.key === key);
  if (!section) throw new Error(`No section ${key}`);
  return section;
}

export function fieldByKey(version: TemplateVersionFull, key: string): TemplateFieldRow {
  const field = version.sections.flatMap((section) => section.fields).find((item) => item.key === key);
  if (!field) throw new Error(`No field ${key}`);
  return field;
}
