import { describe, expect, it } from "vitest";
import {
  CLOSE_PERIOD_TYPE_LABELS,
  COMMENT_VISIBILITY_META,
  COMPANY_ROLE_LABELS,
  COMPANY_STATUS_LABELS,
  DEFAULT_OWNER_CONTRIBUTOR_LIMIT,
  DOCUMENT_TYPE_LABELS,
  FIELD_TYPE_LABELS,
  FLAG_CODE_LABELS,
  HEADCOUNT_FIELD_KEYS,
  INTERNAL_RATING_META,
  KPI_FREQUENCY_LABELS,
  KPI_VALUE_TYPE_LABELS,
  MONEY_FIELD_KEYS,
  NEGATIVE_ALLOWED_KEYS,
  NON_NEGATIVE_FIELD_KEYS,
  NOT_YET_REPORTING_META,
  NUMBER_FIELD_KEYS,
  OWNER_CONTRIBUTOR_LIMIT_MAX,
  PERIOD_CLOSE_STATUS_META,
  REVENUE_SEGMENT_CHANGE_WARNING,
  REVENUE_SEGMENT_KIND_META,
  REVENUE_SEGMENT_KINDS,
  REVENUE_SEGMENT_NAME_MAX,
  REVENUE_SEGMENTS_MAX,
  REVENUE_SUM_TOLERANCE,
  SCALEUP_LABEL,
  SCALEUP_ROLE_LABELS,
  SCALEUP_STAFF_SUFFIX,
  SECTION_KIND_LABELS,
  SUBMISSION_EVENT_LABELS,
  SUBMISSION_STATUS_META,
  SYSTEM_FIELD_KEYS,
  SYSTEM_FIELD_LABELS,
  TEMPLATE_STATUS_META,
  TERMS_VERSION,
} from "@/lib/constants";
import {
  CLOSE_PERIOD_TYPES,
  COMMENT_VISIBILITIES,
  COMPANY_ROLES,
  COMPANY_STATUSES,
  DOCUMENT_TYPES,
  FIELD_TYPES,
  INTERNAL_RATINGS,
  KPI_FREQUENCIES,
  KPI_VALUE_TYPES,
  PERIOD_CLOSE_STATUSES,
  SCALEUP_ROLES,
  SECTION_KINDS,
  SUBMISSION_EVENTS,
  SUBMISSION_STATUSES,
  TEMPLATE_STATUSES,
} from "@/lib/types/enums";

const labelOf = (v: string | { label: string }) => (typeof v === "string" ? v : v.label);

describe("constants", () => {
  it("has a non-empty label for every enum value", () => {
    const pairs: [readonly string[], Record<string, string | { label: string }>][] = [
      [SUBMISSION_STATUSES, SUBMISSION_STATUS_META],
      [SCALEUP_ROLES, SCALEUP_ROLE_LABELS],
      [COMPANY_ROLES, COMPANY_ROLE_LABELS],
      [COMPANY_STATUSES, COMPANY_STATUS_LABELS],
      [INTERNAL_RATINGS, INTERNAL_RATING_META],
      [KPI_FREQUENCIES, KPI_FREQUENCY_LABELS],
      [KPI_VALUE_TYPES, KPI_VALUE_TYPE_LABELS],
      [FIELD_TYPES, FIELD_TYPE_LABELS],
      [SECTION_KINDS, SECTION_KIND_LABELS],
      [TEMPLATE_STATUSES, TEMPLATE_STATUS_META],
      [COMMENT_VISIBILITIES, COMMENT_VISIBILITY_META],
      [CLOSE_PERIOD_TYPES, CLOSE_PERIOD_TYPE_LABELS],
      [PERIOD_CLOSE_STATUSES, PERIOD_CLOSE_STATUS_META],
      [DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS],
      [SUBMISSION_EVENTS, SUBMISSION_EVENT_LABELS],
    ];
    for (const [values, labels] of pairs) {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const value of values) expect(labelOf(labels[value]).length).toBeGreaterThan(0);
    }
    expect(Object.keys(FLAG_CODE_LABELS).sort()).toEqual([
      "low_runway",
      "missing_required",
      "negative_cash",
      "revenue_swing",
      "segments_exceed_total",
    ]);
  });

  it("describes the system fields consistently", () => {
    expect(SYSTEM_FIELD_KEYS).toEqual([
      "revenue_total",
      "gross_profit",
      "net_profit",
      "cash_in_bank",
      "burn_rate",
      "headcount_ft",
      "headcount_pt",
    ]);
    expect(NUMBER_FIELD_KEYS).toEqual(SYSTEM_FIELD_KEYS);
    expect([...MONEY_FIELD_KEYS, ...HEADCOUNT_FIELD_KEYS]).toEqual([...SYSTEM_FIELD_KEYS]);
    expect([...NEGATIVE_ALLOWED_KEYS, ...NON_NEGATIVE_FIELD_KEYS].sort()).toEqual([...SYSTEM_FIELD_KEYS].sort());
    expect(Object.keys(SYSTEM_FIELD_LABELS)).toEqual([...SYSTEM_FIELD_KEYS]);
    expect(TERMS_VERSION).toBe("2026-09");
  });

  it("labels companies without a reporting start month as not yet reporting (BRD B16)", () => {
    expect(NOT_YET_REPORTING_META).toEqual({
      label: "Not yet reporting",
      tone: "neutral",
      description: "No reporting start month set yet: no monthly updates are requested",
    });
  });

  it("names ScaleUp on the company side and defaults the owners' contributor limit (BRD B28, B29)", () => {
    expect(SCALEUP_LABEL).toBe("ScaleUp");
    expect(`Renuka Sena${SCALEUP_STAFF_SUFFIX}`).toBe("Renuka Sena (ScaleUp)");
    // platform_settings.owner_contributor_limit: default 4, check (between 0 and 100)
    expect(DEFAULT_OWNER_CONTRIBUTOR_LIMIT).toBe(4);
    expect(OWNER_CONTRIBUTOR_LIMIT_MAX).toBe(100);
  });

  it("describes the two revenue breakdowns and the limits of set_company_revenue_segments (BRD B30)", () => {
    // revenue_segments.kind check (kind in ('scaleup', 'company'))
    expect([...REVENUE_SEGMENT_KINDS].sort()).toEqual(["company", "scaleup"]);
    expect(Object.keys(REVENUE_SEGMENT_KIND_META).sort()).toEqual(["company", "scaleup"]);
    for (const kind of REVENUE_SEGMENT_KINDS) {
      const meta = REVENUE_SEGMENT_KIND_META[kind];
      expect(meta.label.length * meta.plural.length * meta.description.length).toBeGreaterThan(0);
    }
    expect(REVENUE_SEGMENT_KIND_META.company.description).toContain("add up to total revenue");
    expect(REVENUE_SEGMENT_KIND_META.scaleup.description).toContain("need not add up");
    // set_company_revenue_segments: 0–50 items, names 1–80 characters
    expect(REVENUE_SEGMENTS_MAX).toBe(50);
    expect(REVENUE_SEGMENT_NAME_MAX).toBe(80);
    expect(REVENUE_SUM_TOLERANCE).toBe(0.01);
    expect(REVENUE_SEGMENT_CHANGE_WARNING).toMatch(/comparability/);
    expect(REVENUE_SEGMENT_CHANGE_WARNING).toMatch(/submitted keep their segment names and figures/);
  });
});
