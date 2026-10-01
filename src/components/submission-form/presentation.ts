// Pure display helpers of the monthly form and the monthly updates list (client-safe, unit-tested in
// tests/features/m5): DOM ids for jump links, timeline wording (ScaleUp staff named "<full name>
// (ScaleUp)" on the company side, BRD B28), comment counts and labels per target, which numbers may be
// negative, the KPI grid layout and the list's next action.

import { buildTargetLabels } from "@/components/comments/target-labels";
import { NON_NEGATIVE_FIELD_KEYS, SCALEUP_LABEL } from "@/lib/constants";
import {
  parseFieldValidation,
  type KpiDefinition,
  type SubmissionBundle,
  type SubmissionEventWithActor,
  type SubmissionRow,
  type TemplateFieldRow,
} from "@/lib/types/domain";
import type { SubmissionEvent, SubmissionStatus } from "@/lib/types/enums";
import type { KpiCell } from "@/lib/validation";

// ---------------------------------------------------------------------------------------------
// Targets and DOM ids
// ---------------------------------------------------------------------------------------------

/** Element id of the input for a target ('field:gross_profit' → 'sf-field-gross_profit'). */
export function targetDomId(target: string): string {
  return `sf-${target.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** Statuses in which the numbers can still be edited. */
export const EDITABLE_STATUSES: ReadonlyArray<SubmissionStatus> = ["draft", "changes_requested"];

export function isEditableStatus(status: SubmissionStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------

/** The latest event of the given kinds (events are oldest first), or null. */
export function latestEvent(
  events: ReadonlyArray<SubmissionEventWithActor>,
  kinds: ReadonlyArray<SubmissionEvent | string>,
): SubmissionEventWithActor | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (kinds.includes(events[i].event)) return events[i];
  }
  return null;
}

/**
 * An amendment request made after the month was last approved (still waiting for ScaleUp), or null.
 */
export function pendingAmendment(events: ReadonlyArray<SubmissionEventWithActor>): SubmissionEventWithActor | null {
  const amendment = latestEvent(events, ["amendment_requested"]);
  if (!amendment) return null;
  const approved = latestEvent(events, ["approved"]);
  return approved && events.indexOf(approved) > events.indexOf(amendment) ? null : amendment;
}

/** Timeline events recorded by the company owner (submit, resubmit, request an amendment). */
const COMPANY_EVENTS = new Set<string>(["submitted", "resubmitted", "amendment_requested"]);

/**
 * Who did something (BRD B28). The data layer already names the actor for the viewer: company users see
 * ScaleUp staff as "<full name> (ScaleUp)", e.g. "Renuka Sena (ScaleUp)", and ScaleUp staff see plain
 * names (`SubmissionEventWithActor.actor_name`). Without a name, ScaleUp actions read "ScaleUp" (system
 * actions) and company actions (submitting, requesting an amendment) "Company owner" (e.g. someone who
 * has since left the company).
 */
export function actorLabel(event: Pick<SubmissionEventWithActor, "event" | "actor_name">): string {
  return event.actor_name ?? (COMPANY_EVENTS.has(event.event) ? "Company owner" : SCALEUP_LABEL);
}

// ---------------------------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------------------------

/**
 * Overdue like `v_submission_overview.is_overdue`: not submitted yet, past the due date, for an active
 * company that reports from a month on or before this one.
 */
export function isOverdueSubmission(
  submission: Pick<SubmissionRow, "status" | "due_date" | "month">,
  company: { status: string; reporting_start_month: string | null },
  today: string,
): boolean {
  if (!isEditableStatus(submission.status)) return false;
  if (company.status !== "active" || company.reporting_start_month === null) return false;
  if (submission.month < company.reporting_start_month) return false;
  return submission.due_date < today;
}

// ---------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------

export type CommentCounts = Record<string, { total: number; unresolved: number }>;

/** Thread counts per target from the root comments the viewer can see (`parent_id is null`). */
export function countCommentThreads(
  roots: ReadonlyArray<{ target: string; resolved_at: string | null }>,
): CommentCounts {
  const counts: CommentCounts = {};
  for (const root of roots) {
    const target = root.target || "general";
    const entry = (counts[target] ??= { total: 0, unresolved: 0 });
    entry.total += 1;
    if (root.resolved_at === null) entry.unresolved += 1;
  }
  return counts;
}

/** Sum of the counts of several targets (e.g. all fields of a narrative section). */
export function sumCommentCounts(
  counts: CommentCounts | undefined,
  targets: ReadonlyArray<string>,
): { total: number; unresolved: number } {
  let total = 0;
  let unresolved = 0;
  for (const target of targets) {
    total += counts?.[target]?.total ?? 0;
    unresolved += counts?.[target]?.unresolved ?? 0;
  }
  return { total, unresolved };
}

/** Unresolved threads of the whole month. */
export function totalUnresolved(counts: CommentCounts | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, entry) => sum + entry.unresolved, 0);
}

/**
 * Labels of the comment targets (thread labels, the new-thread target choices and the field buttons' names):
 * M6's `buildTargetLabels`, as on the review page, plus the form's own label of any target it lacks (fields
 * of the KPI section, which the form shows with comment buttons too).
 */
export function commentTargetLabels(
  bundle: Pick<SubmissionBundle, "template" | "config">,
  formLabels: Iterable<[target: string, label: string]>,
): Record<string, string> {
  const labels = buildTargetLabels(bundle);
  for (const [target, label] of formLabels) {
    if (!(target in labels)) labels[target] = label;
  }
  return labels;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

const NON_NEGATIVE_KEYS = new Set<string>(NON_NEGATIVE_FIELD_KEYS);

/**
 * Whether a number field of the template may hold a negative value (§2.6 rule 3): not the non-negative
 * system figures (revenue, cash, burn rate, headcounts), nor a field whose validation sets
 * `allow_negative: false` or a minimum of 0 or more; gross and net profit and other numbers may.
 */
export function allowsNegative(field: Pick<TemplateFieldRow, "key" | "validation">): boolean {
  if (NON_NEGATIVE_KEYS.has(field.key)) return false;
  const rule = parseFieldValidation(field.validation);
  if (rule?.allow_negative === false) return false;
  return rule?.min === undefined || rule.min < 0;
}

// ---------------------------------------------------------------------------------------------
// KPI grid
// ---------------------------------------------------------------------------------------------

export type KpiColumn = {
  kpiId: string;
  name: string;
  unit: string | null;
  description: string | null;
  required: boolean;
  valueType: KpiCell["valueType"];
};

/**
 * KPI cells laid out for the form: KPIs without a dimension as a list (`single`), and each dimension as a
 * table (`dimension`: rows = active members, columns = that dimension's KPIs; `cells` by
 * `${kpiId}:${memberId}`). Order follows the cells (KPIs by sort order, members by sort order).
 */
export type KpiGroup =
  | { kind: "single"; cells: KpiCell[] }
  | {
      kind: "dimension";
      dimensionId: string;
      dimensionName: string;
      columns: KpiColumn[];
      rows: { memberId: string; memberName: string }[];
      cells: Record<string, KpiCell>;
    };

export function groupKpiCells(cells: ReadonlyArray<KpiCell>, kpis: ReadonlyArray<KpiDefinition>): KpiGroup[] {
  const byId = new Map(kpis.map((kpi) => [kpi.id, kpi]));
  const groups: KpiGroup[] = [];
  const dimensionGroups = new Map<string, Extract<KpiGroup, { kind: "dimension" }>>();
  let single: Extract<KpiGroup, { kind: "single" }> | null = null;

  for (const cell of cells) {
    const kpi = byId.get(cell.kpiId);
    if (cell.memberId === null || !kpi?.dimension_id) {
      if (!single) {
        single = { kind: "single", cells: [] };
        groups.push(single);
      }
      single.cells.push(cell);
      continue;
    }
    const dimensionId = kpi.dimension_id;
    let group = dimensionGroups.get(dimensionId);
    if (!group) {
      group = {
        kind: "dimension",
        dimensionId,
        dimensionName: kpi.dimension?.name ?? "Dimension",
        columns: [],
        rows: [],
        cells: {},
      };
      dimensionGroups.set(dimensionId, group);
      groups.push(group);
    }
    if (!group.columns.some((column) => column.kpiId === cell.kpiId)) {
      group.columns.push({
        kpiId: cell.kpiId,
        name: cell.kpiName,
        unit: kpi.unit,
        description: kpi.description,
        required: cell.required,
        valueType: cell.valueType,
      });
    }
    if (!group.rows.some((row) => row.memberId === cell.memberId)) {
      group.rows.push({ memberId: cell.memberId, memberName: cell.memberName ?? "" });
    }
    group.cells[`${cell.kpiId}:${cell.memberId}`] = cell;
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// Monthly updates list
// ---------------------------------------------------------------------------------------------

/**
 * The month to work on next: the earliest month that is not submitted yet (draft or changes requested),
 * since months are submitted in order (BRD B5). Rows may come in any order.
 */
export function nextActionMonth<T extends { month: string; status: SubmissionStatus }>(
  rows: ReadonlyArray<T>,
): T | null {
  let found: T | null = null;
  for (const row of rows) {
    if (!isEditableStatus(row.status)) continue;
    if (found === null || row.month < found.month) found = row;
  }
  return found;
}

/** Wording of the call to action for a month that needs work. */
export function actionLabel(row: { status: SubmissionStatus; last_saved_at: string | null }): string {
  if (row.status === "changes_requested") return "Make changes";
  return row.last_saved_at ? "Continue" : "Start";
}
