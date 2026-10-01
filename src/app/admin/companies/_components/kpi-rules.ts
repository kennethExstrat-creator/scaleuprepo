// Rules for editing a company KPI once companies have reported figures for it. The value type decides
// which column a figure is stored in (number → value_number, Yes/No → value_bool, text → value_text), and
// the dimension decides which cells exist (one per member). Changing either after figures exist would
// strand those figures, so only changes between the number types are allowed then; the admin creates a
// new KPI (and deactivates the old one) instead. Pure; unit-tested in tests/features/m1/kpi-rules.test.ts.
import type { KpiValueType } from "@/lib/types/enums";

export type KpiStorage = "number" | "boolean" | "text";

/** Where a KPI value of each type is stored (docs/ARCHITECTURE.md §2.2 submission_kpi_values). */
export const KPI_VALUE_STORAGE: Record<KpiValueType, KpiStorage> = {
  number: "number",
  integer: "number",
  currency: "number",
  percent: "number",
  boolean: "boolean",
  text: "text",
};

export type LockedKpiChange = { field: "valueType" | "dimensionId"; message: string };

export const KPI_TYPE_LOCKED_MESSAGE =
  "This KPI already has figures, so its type can only change between number types. Create a new KPI instead.";
export const KPI_DIMENSION_LOCKED_MESSAGE =
  "This KPI already has figures, so its dimension can't change. Create a new KPI instead.";

/** The value types a KPI may switch to (all of them when it has no figures yet). */
export function allowedKpiValueTypes(
  current: KpiValueType,
  hasValues: boolean,
  all: readonly KpiValueType[],
): KpiValueType[] {
  if (!hasValues) return [...all];
  return all.filter((type) => KPI_VALUE_STORAGE[type] === KPI_VALUE_STORAGE[current]);
}

/** The first change that is not allowed for a KPI with figures, or null. */
export function lockedKpiChange(
  current: { value_type: KpiValueType; dimension_id: string | null },
  next: { valueType: KpiValueType; dimensionId: string | null },
  hasValues: boolean,
): LockedKpiChange | null {
  if (!hasValues) return null;
  if (KPI_VALUE_STORAGE[current.value_type] !== KPI_VALUE_STORAGE[next.valueType]) {
    return { field: "valueType", message: KPI_TYPE_LOCKED_MESSAGE };
  }
  if ((current.dimension_id ?? null) !== (next.dimensionId ?? null)) {
    return { field: "dimensionId", message: KPI_DIMENSION_LOCKED_MESSAGE };
  }
  return null;
}
