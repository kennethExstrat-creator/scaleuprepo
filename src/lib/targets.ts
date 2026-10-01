// Target strings identify a field/segment/KPI cell for validation errors and comments.
// Format contract: docs/ARCHITECTURE.md §2.5:
//   general · field:<field_key> · segment:<segment_id> · kpi:<kpi_id> · kpi:<kpi_id>:<dimension_member_id>

export const GENERAL_TARGET = "general";

export function fieldTarget(fieldKey: string): string {
  return `field:${fieldKey}`;
}

export function segmentTarget(segmentId: string): string {
  return `segment:${segmentId}`;
}

/** `kpi:<kpiId>` or, for a KPI with a dimension, `kpi:<kpiId>:<memberId>`. */
export function kpiTarget(kpiId: string, dimensionMemberId?: string | null): string {
  return dimensionMemberId ? `kpi:${kpiId}:${dimensionMemberId}` : `kpi:${kpiId}`;
}

/** Key used for KPI value maps: `${kpiId}:${memberId ?? '-'}` (an empty member id counts as none). */
export function kpiCellKey(kpiId: string, dimensionMemberId?: string | null): string {
  return `${kpiId}:${dimensionMemberId || "-"}`;
}

/** Inverse of kpiCellKey; null when the key is malformed. */
export function parseKpiCellKey(cellKey: string): { kpiId: string; dimensionMemberId: string | null } | null {
  const parts = cellKey.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { kpiId: parts[0], dimensionMemberId: parts[1] === "-" ? null : parts[1] };
}

export type ParsedTarget =
  | { kind: "general" }
  | { kind: "field"; fieldKey: string }
  | { kind: "segment"; segmentId: string }
  | { kind: "kpi"; kpiId: string; dimensionMemberId: string | null };

/** Parses a target string. Anything malformed (unknown prefix, empty or extra parts) is treated as `general`. */
export function parseTarget(target: string): ParsedTarget {
  const parts = target.split(":");
  const [kind, a, b] = parts;
  if (kind === "field" && a && parts.length === 2) return { kind: "field", fieldKey: a };
  if (kind === "segment" && a && parts.length === 2) return { kind: "segment", segmentId: a };
  if (kind === "kpi" && a && parts.length === 2) return { kind: "kpi", kpiId: a, dimensionMemberId: null };
  if (kind === "kpi" && a && b && parts.length === 3) return { kind: "kpi", kpiId: a, dimensionMemberId: b };
  return { kind: "general" };
}

/** Rebuilds the canonical target string from a parsed target (round-trips with parseTarget). */
export function formatTarget(parsed: ParsedTarget): string {
  switch (parsed.kind) {
    case "field":
      return fieldTarget(parsed.fieldKey);
    case "segment":
      return segmentTarget(parsed.segmentId);
    case "kpi":
      return kpiTarget(parsed.kpiId, parsed.dimensionMemberId);
    default:
      return GENERAL_TARGET;
  }
}
