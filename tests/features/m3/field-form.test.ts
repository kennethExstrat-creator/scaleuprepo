import { describe, expect, it } from "vitest";

import { fieldByKey, seedVersion } from "./fixtures";
import { personName, plural } from "@/app/admin/templates/_lib/display";
import {
  fieldFormToDraft,
  initialFieldFormState,
  ratingValues,
  type FieldFormState,
} from "@/app/admin/templates/_lib/field-form";
import { buildFieldOptions, buildFieldValidation } from "@/app/admin/templates/_lib/rules";

describe("initialFieldFormState", () => {
  it("starts new fields with the section kind's first type and negatives refused", () => {
    expect(initialFieldFormState("narrative", null)).toMatchObject({
      label: "",
      key: "",
      keyTouched: false,
      fieldType: "long_text",
      isRequired: false,
      allowNegative: false,
      ratingMin: "1",
      ratingMax: "5",
    });
    expect(initialFieldFormState("custom_numbers", null).fieldType).toBe("currency");
    expect(initialFieldFormState("pulse", null).fieldType).toBe("rating");
  });

  it("loads a stored field", () => {
    const seed = seedVersion();
    expect(initialFieldFormState("pulse", fieldByKey(seed, "team_morale"))).toMatchObject({
      label: "Team morale",
      key: "team_morale",
      keyTouched: true,
      fieldType: "rating",
      ratingMin: "1",
      ratingMax: "5",
      ratingLabels: { "1": "Very low", "5": "Very high" },
    });
    expect(initialFieldFormState("narrative", fieldByKey(seed, "fundraising_status")).choicesText).toBe(
      "Not raising\nPreparing to raise\nActively raising\nTerm sheet received\nClosing round\nRound closed",
    );
    expect(initialFieldFormState("financials", fieldByKey(seed, "burn_rate"))).toMatchObject({
      isRequired: true,
      helpText: "Enter 0 if cash-flow positive",
      allowNegative: false,
      min: "0",
      max: "",
    });
    expect(initialFieldFormState("financials", fieldByKey(seed, "net_profit"))).toMatchObject({ allowNegative: true, min: "" });
  });

  it("round-trips every seeded field without changing it", () => {
    for (const section of seedVersion().sections) {
      for (const field of section.fields) {
        const { draft, errors } = fieldFormToDraft(initialFieldFormState(section.kind, field));
        expect(errors).toEqual({});
        expect(draft.label).toBe(field.label);
        expect(buildFieldOptions(draft.field_type, draft)).toEqual(field.options);
        expect(buildFieldValidation(field.key, draft.field_type, draft.validation)).toEqual(field.validation);
      }
    }
  });
});

describe("fieldFormToDraft", () => {
  const state = (patch: Partial<FieldFormState>): FieldFormState => ({ ...initialFieldFormState("custom_numbers", null), ...patch });

  it("parses limits typed as text", () => {
    const { draft, errors } = fieldFormToDraft(
      state({ label: " Customers ", key: " customers ", fieldType: "integer", min: "1,000", max: "RM 2,500.5", allowNegative: true }),
    );
    expect(errors).toEqual({});
    expect(draft).toMatchObject({
      label: "Customers",
      key: "customers",
      field_type: "integer",
      validation: { allow_negative: true, min: 1000, max: 2500.5, max_length: null },
    });
  });

  it("flags text that is not a number", () => {
    expect(fieldFormToDraft(state({ min: "ten", max: "1e3" })).errors).toEqual({
      "validation.min": "Enter a number, for example 0 or 1,000.",
      "validation.max": "Enter a number, for example 0 or 1,000.",
    });
    expect(fieldFormToDraft(state({ fieldType: "text", maxLength: "4,000" })).draft.validation.max_length).toBe(4000);
    expect(fieldFormToDraft(state({ fieldType: "text", maxLength: "40.5" })).errors).toEqual({
      "validation.max_length": "Enter a whole number.",
    });
    expect(fieldFormToDraft(state({ fieldType: "rating", ratingMin: "one", ratingMax: "" })).errors).toEqual({
      "rating.min": "Enter a whole number.",
      "rating.max": "Enter a whole number.",
    });
  });

  it("sends only the settings of the chosen type", () => {
    const { draft } = fieldFormToDraft(
      state({ fieldType: "picklist", choicesText: "Seed\n\n Series A ", min: "5", maxLength: "10", ratingMin: "x" }),
    );
    expect(draft.choices).toEqual(["Seed", "Series A"]);
    expect(draft.rating).toBeNull();
    expect(draft.validation).toEqual({ allow_negative: false, min: null, max: null, max_length: null });
    expect(fieldFormToDraft(state({ fieldType: "boolean", choicesText: "x" })).draft.choices).toEqual([]);
  });

  it("keeps rating labels inside the scale", () => {
    const { draft, errors } = fieldFormToDraft(
      state({ fieldType: "rating", ratingMin: "0", ratingMax: "3", ratingLabels: { "0": " Poor ", "2": " ", "3": "Great", "9": "Out" } }),
    );
    expect(errors).toEqual({});
    expect(draft.rating).toEqual({ min: 0, max: 3, labels: { "0": "Poor", "3": "Great" } });
  });
});

describe("ratingValues", () => {
  it("lists the values of a usable scale (up to 11)", () => {
    expect(ratingValues("1", "5")).toEqual([1, 2, 3, 4, 5]);
    expect(ratingValues("0", "10")).toHaveLength(11);
    expect(ratingValues("5", "1")).toEqual([]);
    expect(ratingValues("1", "x")).toEqual([]);
    expect(ratingValues("0", "20")).toEqual([]);
  });
});

describe("display helpers", () => {
  it("names people without leaking ids", () => {
    expect(personName({ u1: "Aisha Rahman" }, "u1")).toBe("Aisha Rahman");
    expect(personName({}, null)).toBe("System");
    expect(personName({}, "u2")).toBe("A former user");
  });

  it("pluralises counts", () => {
    expect(plural(1, "field")).toBe("1 field");
    expect(plural(3, "field")).toBe("3 fields");
    expect(plural(0, "change")).toBe("0 changes");
  });
});
