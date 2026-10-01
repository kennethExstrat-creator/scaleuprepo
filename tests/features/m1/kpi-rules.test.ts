import { describe, expect, it } from "vitest";

import {
  allowedKpiValueTypes,
  KPI_DIMENSION_LOCKED_MESSAGE,
  KPI_TYPE_LOCKED_MESSAGE,
  KPI_VALUE_STORAGE,
  lockedKpiChange,
} from "@/app/admin/companies/_components/kpi-rules";
import { NUMBER_KPI_VALUE_TYPES } from "@/lib/constants";
import { KPI_VALUE_TYPES } from "@/lib/types/enums";

describe("KPI_VALUE_STORAGE", () => {
  it("agrees with the number types of the constants", () => {
    const numberTypes = KPI_VALUE_TYPES.filter((type) => KPI_VALUE_STORAGE[type] === "number");
    expect([...numberTypes].sort()).toEqual([...NUMBER_KPI_VALUE_TYPES].sort());
    expect(KPI_VALUE_STORAGE.boolean).toBe("boolean");
    expect(KPI_VALUE_STORAGE.text).toBe("text");
  });
});

describe("allowedKpiValueTypes", () => {
  it("allows every type while the KPI has no figures", () => {
    expect(allowedKpiValueTypes("boolean", false, KPI_VALUE_TYPES)).toEqual([...KPI_VALUE_TYPES]);
  });

  it("keeps a KPI with figures within its storage group", () => {
    expect(allowedKpiValueTypes("integer", true, KPI_VALUE_TYPES)).toEqual(["number", "integer", "currency", "percent"]);
    expect(allowedKpiValueTypes("boolean", true, KPI_VALUE_TYPES)).toEqual(["boolean"]);
    expect(allowedKpiValueTypes("text", true, KPI_VALUE_TYPES)).toEqual(["text"]);
  });
});

describe("lockedKpiChange", () => {
  const current = { value_type: "currency" as const, dimension_id: "dim-1" };

  it("allows anything when there are no figures", () => {
    expect(lockedKpiChange(current, { valueType: "text", dimensionId: null }, false)).toBeNull();
  });

  it("allows changes between number types and keeping the dimension", () => {
    expect(lockedKpiChange(current, { valueType: "number", dimensionId: "dim-1" }, true)).toBeNull();
  });

  it("refuses a change of storage or dimension once figures exist", () => {
    expect(lockedKpiChange(current, { valueType: "boolean", dimensionId: "dim-1" }, true)).toEqual({
      field: "valueType",
      message: KPI_TYPE_LOCKED_MESSAGE,
    });
    expect(lockedKpiChange(current, { valueType: "currency", dimensionId: null }, true)).toEqual({
      field: "dimensionId",
      message: KPI_DIMENSION_LOCKED_MESSAGE,
    });
    expect(
      lockedKpiChange({ value_type: "integer", dimension_id: null }, { valueType: "integer", dimensionId: "dim-2" }, true),
    ).toEqual({ field: "dimensionId", message: KPI_DIMENSION_LOCKED_MESSAGE });
  });
});
