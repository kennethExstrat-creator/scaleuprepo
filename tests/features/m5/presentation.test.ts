import { describe, expect, it } from "vitest";

import {
  actionLabel,
  actorLabel,
  allowsNegative,
  commentTargetLabels,
  countCommentThreads,
  groupKpiCells,
  isEditableStatus,
  isOverdueSubmission,
  latestEvent,
  nextActionMonth,
  pendingAmendment,
  sumCommentCounts,
  targetDomId,
  totalUnresolved,
} from "@/components/submission-form/presentation";
import type { Json, KpiDefinition, SubmissionEventWithActor } from "@/lib/types/domain";
import type { SubmissionStatus } from "@/lib/types/enums";
import { kpiCellsForMonth, type ValidationInput } from "@/lib/validation";

import { IDS, SECTIONS, field, makeBundle } from "./fixtures";

const SUB = "90000000-0000-4000-8000-000000000009";
const COMPANY = "c0000000-0000-4000-8000-000000000001";

let nextId = 1;
function event(kind: string, extra: Partial<SubmissionEventWithActor> = {}): SubmissionEventWithActor {
  return {
    id: nextId++,
    submission_id: SUB,
    event: kind,
    actor_id: null,
    message: null,
    created_at: `2026-10-0${nextId % 9 || 1}T02:00:00Z`,
    actor: null,
    actor_name: null,
    ...extra,
  };
}

describe("targetDomId", () => {
  it("makes element ids from targets", () => {
    expect(targetDomId("field:gross_profit")).toBe("sf-field-gross_profit");
    expect(targetDomId("kpi:e1:d2")).toBe("sf-kpi-e1-d2");
    expect(targetDomId("segment:f0000000-0000-4000-8000-000000000001")).toBe(
      "sf-segment-f0000000-0000-4000-8000-000000000001",
    );
  });
});

describe("statuses", () => {
  it("only drafts and months sent back can be edited", () => {
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("changes_requested")).toBe(true);
    expect(isEditableStatus("submitted")).toBe(false);
    expect(isEditableStatus("approved")).toBe(false);
  });
});

describe("timeline", () => {
  const submitted = event("submitted", { actor_name: "Aisha Rahman" });
  const changes = event("changes_requested", { message: "Please split revenue by outlet." });
  const resubmitted = event("resubmitted", { actor_name: "Aisha Rahman" });
  const approved = event("approved", { actor_name: "Renuka Sena" });
  const amendment = event("amendment_requested", { message: "Audit adjustment", actor_name: "Aisha Rahman" });

  it("finds the latest event of the given kinds", () => {
    const events = [submitted, changes, resubmitted];
    expect(latestEvent(events, ["submitted", "resubmitted"])).toBe(resubmitted);
    expect(latestEvent(events, ["changes_requested", "reopened"])).toBe(changes);
    expect(latestEvent(events, ["approved"])).toBeNull();
  });

  it("finds an amendment request made after the last approval", () => {
    expect(pendingAmendment([submitted, approved])).toBeNull();
    expect(pendingAmendment([submitted, approved, amendment])).toBe(amendment);
    const reapproved = event("approved");
    expect(
      pendingAmendment([submitted, approved, amendment, event("reopened"), event("resubmitted"), reapproved]),
    ).toBeNull();
  });

  it("names ScaleUp staff as the data layer gives them (BRD B28)", () => {
    // Company users: the data layer's "<full name> (ScaleUp)" (staff_display_names).
    expect(actorLabel(event("approved", { actor_name: "Renuka Sena (ScaleUp)" }))).toBe("Renuka Sena (ScaleUp)");
    expect(actorLabel(event("changes_requested", { actor_name: "Renuka Sena (ScaleUp)" }))).toBe(
      "Renuka Sena (ScaleUp)",
    );
    // ScaleUp staff: plain names from the profiles.
    expect(actorLabel(approved)).toBe("Renuka Sena");
  });

  it("shows 'ScaleUp' only when nobody can be named (system actions)", () => {
    expect(actorLabel(event("deadline_extended"))).toBe("ScaleUp");
    expect(actorLabel(event("reopened"))).toBe("ScaleUp");
    expect(actorLabel(changes)).toBe("ScaleUp");
  });

  it("shows the company owner's name for company actions", () => {
    expect(actorLabel(submitted)).toBe("Aisha Rahman");
    expect(actorLabel(amendment)).toBe("Aisha Rahman");
    expect(actorLabel(event("submitted"))).toBe("Company owner");
    expect(actorLabel(event("amendment_requested"))).toBe("Company owner");
  });
});

describe("allowsNegative", () => {
  const numberField = (key: string, validation: Json | null = null) => ({ key, validation });

  it("lets gross and net profit and other numbers be negative", () => {
    expect(allowsNegative(numberField("gross_profit", { allow_negative: true }))).toBe(true);
    expect(allowsNegative(numberField("net_profit", { allow_negative: true }))).toBe(true);
    expect(allowsNegative(numberField("net_profit"))).toBe(true);
    expect(allowsNegative(numberField("ebitda_adjustments"))).toBe(true);
    expect(allowsNegative(numberField("fx_gain", { min: -1000 }))).toBe(true);
  });

  it("refuses negatives for the non-negative system figures and validated fields", () => {
    for (const key of ["revenue_total", "cash_in_bank", "burn_rate", "headcount_ft", "headcount_pt"]) {
      expect(allowsNegative(numberField(key, { allow_negative: true }))).toBe(false);
    }
    expect(allowsNegative(numberField("gross_profit", { allow_negative: false }))).toBe(false);
    expect(allowsNegative(numberField("net_profit", { min: 0 }))).toBe(false);
    expect(allowsNegative(numberField("outlets_opened", { min: 1, max: 10 }))).toBe(false);
  });
});

describe("commentTargetLabels", () => {
  it("names fields, segments and KPI cells as the review page does", () => {
    const labels = commentTargetLabels(makeBundle(), []);
    expect(labels.general).toBe("General");
    expect(labels["field:gross_profit"]).toBe("Gross profit");
    expect(labels[`segment:${IDS.segRetail}`]).toBe("Revenue: Retail");
    expect(labels[`kpi:${IDS.kpiRevenue}:${IDS.montKiara}`]).toBe("Revenue per outlet (Mont Kiara)");
    expect(labels[`kpi:${IDS.kpiDownloads}`]).toBe("App downloads");
  });

  it("adds the form's labels for targets the review page does not name", () => {
    const kpiNote = field("b2000000-0000-4000-8000-000000000003", "kpi_commentary", "KPI commentary", "long_text");
    const sections = SECTIONS.map((s) => (s.kind === "kpis" ? { ...s, fields: [kpiNote] } : s));
    const bundle = makeBundle("draft", { sections });
    const labels = commentTargetLabels(bundle, [
      ["field:kpi_commentary", "KPI commentary"],
      ["field:gross_profit", "Should not replace the template label"],
    ]);
    expect(labels["field:kpi_commentary"]).toBe("KPI commentary");
    expect(labels["field:gross_profit"]).toBe("Gross profit");
  });
});

describe("isOverdueSubmission", () => {
  const active = { status: "active", reporting_start_month: "2026-07-01" };
  const draft = { status: "draft" as SubmissionStatus, due_date: "2026-09-15", month: "2026-08-01" };

  it("is overdue after the due date while not submitted", () => {
    expect(isOverdueSubmission(draft, active, "2026-09-16")).toBe(true);
    expect(isOverdueSubmission(draft, active, "2026-09-15")).toBe(false);
    expect(isOverdueSubmission({ ...draft, status: "changes_requested" }, active, "2026-09-30")).toBe(true);
    expect(isOverdueSubmission({ ...draft, status: "submitted" }, active, "2026-09-30")).toBe(false);
  });

  it("is never overdue for inactive or not-reporting companies, or months before the start", () => {
    expect(isOverdueSubmission(draft, { ...active, status: "exited" }, "2026-09-30")).toBe(false);
    expect(isOverdueSubmission(draft, { ...active, reporting_start_month: null }, "2026-09-30")).toBe(false);
    expect(isOverdueSubmission({ ...draft, month: "2026-06-01" }, active, "2026-09-30")).toBe(false);
  });
});

describe("comment counts", () => {
  const counts = countCommentThreads([
    { target: "field:gross_profit", resolved_at: null },
    { target: "field:gross_profit", resolved_at: "2026-09-30T00:00:00Z" },
    { target: "general", resolved_at: null },
    { target: "", resolved_at: null },
    { target: "kpi:e1:d1", resolved_at: "2026-09-30T00:00:00Z" },
  ]);

  it("groups root comments by target", () => {
    expect(counts).toEqual({
      "field:gross_profit": { total: 2, unresolved: 1 },
      general: { total: 2, unresolved: 2 },
      "kpi:e1:d1": { total: 1, unresolved: 0 },
    });
  });

  it("sums targets and totals", () => {
    expect(sumCommentCounts(counts, ["field:gross_profit", "kpi:e1:d1", "field:none"])).toEqual({
      total: 3,
      unresolved: 1,
    });
    expect(sumCommentCounts(undefined, ["general"])).toEqual({ total: 0, unresolved: 0 });
    expect(totalUnresolved(counts)).toBe(3);
    expect(totalUnresolved(undefined)).toBe(0);
  });
});

describe("groupKpiCells", () => {
  const OUTLET = "d0000000-0000-4000-8000-000000000001";
  const MK = "d1000000-0000-4000-8000-000000000001";
  const ROW = "d1000000-0000-4000-8000-000000000002";
  const REV = "e0000000-0000-4000-8000-000000000001";
  const PROFITABLE = "e0000000-0000-4000-8000-000000000003";
  const DOWNLOADS = "e0000000-0000-4000-8000-000000000005";

  const member = (id: string, name: string, sort_order: number) => ({
    id,
    dimension_id: OUTLET,
    name,
    sort_order,
    is_active: true,
    created_at: "2026-09-30T00:00:00Z",
  });
  const dimension = { id: OUTLET, company_id: COMPANY, name: "Outlet", created_at: "2026-09-30T00:00:00Z" };
  const kpi = (
    id: string,
    name: string,
    value_type: KpiDefinition["value_type"],
    withDimension: boolean,
    sort_order: number,
  ): KpiDefinition => ({
    id,
    company_id: COMPANY,
    name,
    description: null,
    unit: value_type === "currency" ? "RM" : null,
    value_type,
    frequency: "monthly",
    dimension_id: withDimension ? OUTLET : null,
    is_required: true,
    sort_order,
    is_active: true,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
    dimension: withDimension ? dimension : null,
    members: withDimension ? [member(MK, "Mont Kiara", 1), member(ROW, "The Row", 2)] : [],
  });
  const kpis = [
    kpi(REV, "Revenue per outlet", "currency", true, 1),
    kpi(DOWNLOADS, "App downloads", "integer", false, 2),
    kpi(PROFITABLE, "Profitable", "boolean", true, 3),
  ];
  const input: Pick<ValidationInput, "month" | "kpis"> = {
    month: "2026-09-01",
    kpis: kpis.map((k) => ({
      id: k.id,
      name: k.name,
      is_active: k.is_active,
      is_required: k.is_required,
      frequency: k.frequency,
      value_type: k.value_type,
      members:
        k.dimension_id === null ? null : k.members.map((m) => ({ id: m.id, name: m.name, is_active: m.is_active })),
    })),
  };

  it("lays out KPIs without a dimension as a list and each dimension as a table", () => {
    const groups = groupKpiCells(kpiCellsForMonth(input), kpis);
    expect(groups).toHaveLength(2);
    const [table, single] = groups;
    expect(table.kind).toBe("dimension");
    if (table.kind !== "dimension") return;
    expect(table.dimensionName).toBe("Outlet");
    expect(table.columns.map((column) => column.name)).toEqual(["Revenue per outlet", "Profitable"]);
    expect(table.columns[0]).toMatchObject({ unit: "RM", valueType: "currency", required: true });
    expect(table.rows).toEqual([
      { memberId: MK, memberName: "Mont Kiara" },
      { memberId: ROW, memberName: "The Row" },
    ]);
    expect(table.cells[`${PROFITABLE}:${ROW}`]).toMatchObject({
      label: "Profitable (The Row)",
      target: `kpi:${PROFITABLE}:${ROW}`,
    });
    expect(single).toMatchObject({ kind: "single" });
    if (single.kind !== "single") return;
    expect(single.cells.map((cell) => cell.label)).toEqual(["App downloads"]);
  });

  it("returns no groups when no KPI is due", () => {
    expect(groupKpiCells([], kpis)).toEqual([]);
  });
});

describe("monthly updates list", () => {
  const row = (month: string, status: SubmissionStatus, last_saved_at: string | null = null) => ({
    month,
    status,
    last_saved_at,
  });

  it("points at the earliest month that still needs work", () => {
    const rows = [row("2026-09-01", "draft"), row("2026-08-01", "changes_requested"), row("2026-07-01", "approved")];
    expect(nextActionMonth(rows)?.month).toBe("2026-08-01");
    expect(nextActionMonth([row("2026-07-01", "submitted"), row("2026-08-01", "approved")])).toBeNull();
    expect(nextActionMonth([])).toBeNull();
  });

  it("words the call to action", () => {
    expect(actionLabel(row("2026-09-01", "draft"))).toBe("Start");
    expect(actionLabel(row("2026-09-01", "draft", "2026-09-30T01:00:00Z"))).toBe("Continue");
    expect(actionLabel(row("2026-09-01", "changes_requested", "2026-09-30T01:00:00Z"))).toBe("Make changes");
  });
});
