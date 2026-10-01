// Human labels for comment targets (docs/ARCHITECTURE.md §2.5), e.g. 'field:gross_profit' → "Gross profit",
// 'kpi:<id>:<member>' → "Revenue per outlet (Mont Kiara)". Client-safe and pure.
import { REVENUE_SEGMENT_KIND_META, SYSTEM_FIELD_LABELS, type SystemFieldKey } from "@/lib/constants";
import { GENERAL_TARGET, fieldTarget, kpiTarget, parseTarget, segmentTarget, type ParsedTarget } from "@/lib/targets";
import { isCompanySegment, type RevenueSegmentRow, type SubmissionBundle } from "@/lib/types/domain";

/** Label of the 'general' target (comments about the month as a whole). */
export const GENERAL_TARGET_LABEL = "General";

function isSystemFieldKey(key: string): key is SystemFieldKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_FIELD_LABELS, key);
}

/** 'gross_profit' → "Gross profit" (fallback when a field is not in the template any more). */
export function humaniseKey(key: string): string {
  const words = key.replace(/_+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** A label for a parsed target without any company or template data. */
export function fallbackTargetLabel(parsed: ParsedTarget): string {
  switch (parsed.kind) {
    case "field":
      return isSystemFieldKey(parsed.fieldKey) ? SYSTEM_FIELD_LABELS[parsed.fieldKey] : humaniseKey(parsed.fieldKey);
    case "segment":
      return "Revenue segment";
    case "kpi":
      return "Company KPI";
    default:
      return GENERAL_TARGET_LABEL;
  }
}

/** The label of `target`: from `labels` (see buildTargetLabels) when present, else a generic one. */
export function targetLabelFor(target: string, labels?: Readonly<Record<string, string>> | null): string {
  const known = labels?.[target] ?? labels?.[target.toLowerCase()];
  return known ?? fallbackTargetLabel(parseTarget(target));
}

/**
 * The label of a revenue segment's comment target (BRD B30): the company's own segments read "Revenue: Online",
 * ScaleUp's revenue lines "ScaleUp revenue line: AOnePay" — the two breakdowns may share a name.
 */
export function segmentTargetLabel(segment: Pick<RevenueSegmentRow, "name" | "kind">): string {
  return isCompanySegment(segment)
    ? `Revenue: ${segment.name}`
    : `${REVENUE_SEGMENT_KIND_META.scaleup.label}: ${segment.name}`;
}

/**
 * Labels for every target of a submission, in form order: 'general', then the template's fields (numbers,
 * headcount, additional numbers, narrative and founder pulse, with the template's own labels), the company's
 * own revenue segments ("Revenue: Online"), ScaleUp's revenue lines ("ScaleUp revenue line: AOnePay") and the
 * KPI cells ("App downloads", "Revenue per outlet (Mont Kiara)"). Retired segments and inactive KPIs and
 * members are included so older threads keep a readable label.
 */
export function buildTargetLabels(bundle: Pick<SubmissionBundle, "template" | "config">): Record<string, string> {
  const labels: Record<string, string> = { [GENERAL_TARGET]: GENERAL_TARGET_LABEL };

  for (const section of bundle.template.sections) {
    for (const field of section.fields) {
      if (section.kind === "kpis") continue;
      labels[fieldTarget(field.key)] = field.label.trim() || fallbackTargetLabel({ kind: "field", fieldKey: field.key });
    }
  }

  const segments = bundle.config.segments;
  for (const segment of [...segments.filter(isCompanySegment), ...segments.filter((s) => !isCompanySegment(s))]) {
    labels[segmentTarget(segment.id.toLowerCase())] = segmentTargetLabel(segment);
  }

  const dimensionMembers = new Map(bundle.config.dimensions.map((dimension) => [dimension.id, dimension.members]));
  for (const kpi of bundle.config.kpis) {
    const kpiId = kpi.id.toLowerCase();
    labels[kpiTarget(kpiId)] = kpi.name;
    if (kpi.dimension_id === null) continue;
    const members = dimensionMembers.get(kpi.dimension_id) ?? kpi.members;
    for (const member of members) {
      labels[kpiTarget(kpiId, member.id.toLowerCase())] = `${kpi.name} (${member.name})`;
    }
  }

  return labels;
}

/** A target offered by the new-thread composer, shown under `group` in its select. */
export type TargetOption = { value: string; label: string; group: string };

/** Groups of the default new-thread target select (targetOptionsFrom), in display order. */
export const TARGET_OPTION_GROUPS = [GENERAL_TARGET_LABEL, "Fields", "Revenue", "Company KPIs"] as const;

/** Target options from a label map (see buildTargetLabels), in map order: General, fields, revenue, KPIs. */
export function targetOptionsFrom(labels: Readonly<Record<string, string>> | undefined): TargetOption[] {
  const options: TargetOption[] = [{ value: GENERAL_TARGET, label: GENERAL_TARGET_LABEL, group: GENERAL_TARGET_LABEL }];
  for (const [value, label] of Object.entries(labels ?? {})) {
    if (value === GENERAL_TARGET) continue;
    const group = value.startsWith("segment:") ? "Revenue" : value.startsWith("kpi:") ? "Company KPIs" : "Fields";
    options.push({ value, label, group });
  }
  return options;
}

/**
 * Options grouped for the select, groups in order of first appearance, each target once and 'General'
 * always first (added when missing). E.g. the review page's options follow its comparison table.
 */
export function groupTargetOptions(options: ReadonlyArray<TargetOption>): { group: string; options: TargetOption[] }[] {
  const general: TargetOption = { value: GENERAL_TARGET, label: GENERAL_TARGET_LABEL, group: GENERAL_TARGET_LABEL };
  const seen = new Set<string>();
  const groups: { group: string; options: TargetOption[] }[] = [];
  for (const option of [general, ...options]) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    let entry = groups.find((candidate) => candidate.group === option.group);
    if (!entry) {
      entry = { group: option.group, options: [] };
      groups.push(entry);
    }
    entry.options.push(option);
  }
  return groups;
}
