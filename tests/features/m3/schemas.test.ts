import { describe, expect, it } from "vitest";

import {
  addFieldSchema,
  addSectionSchema,
  moveSchema,
  publishSchema,
  updateSectionSchema,
} from "@/app/admin/templates/_lib/schemas";
import { toActionError } from "@/lib/actions/result";

const ID = "b1000000-0000-4000-8000-000000000001";

const field = {
  label: "Customers",
  key: "customers",
  field_type: "integer",
  is_required: true,
  help_text: "",
  choices: [],
  rating: null,
  validation: { allow_negative: false, min: 0, max: null, max_length: null },
} as const;

function fieldErrors(run: () => unknown): Record<string, string> | undefined {
  try {
    run();
  } catch (e) {
    const result = toActionError(e);
    return result.ok ? undefined : result.fieldErrors;
  }
  return undefined;
}

describe("action input schemas", () => {
  it("parse section input: trimmed title, blank description → null, optional position", () => {
    expect(addSectionSchema.parse({ versionId: ID, title: "  Unit economics ", description: "  ", kind: "custom_numbers" })).toEqual({
      versionId: ID,
      title: "Unit economics",
      description: null,
      kind: "custom_numbers",
    });
    expect(addSectionSchema.parse({ versionId: ID, title: "X", description: "", kind: "pulse", afterSectionId: null }).afterSectionId).toBeNull();
    expect(fieldErrors(() => addSectionSchema.parse({ versionId: ID, title: " ", description: "", kind: "financials" }))).toEqual({
      title: "Enter a title.",
      kind: "Choose what kind of section this is.",
    });
    expect(fieldErrors(() => updateSectionSchema.parse({ sectionId: "nope", title: "x".repeat(121), description: "" }))).toEqual({
      sectionId: "This item could not be identified. Please reload the page.",
      title: "Keep the title to 120 characters or fewer.",
    });
  });

  it("key field errors like the dialog's inputs", () => {
    expect(addFieldSchema.parse({ ...field, sectionId: ID })).toMatchObject({ key: "customers", sectionId: ID });
    expect(
      fieldErrors(() =>
        addFieldSchema.parse({
          ...field,
          sectionId: ID,
          field_type: "date",
          validation: { ...field.validation, min: Number.NaN },
          rating: { min: 1, max: "5", labels: {} },
        }),
      ),
    ).toEqual({
      field_type: "Choose a field type.",
      "rating.max": "Enter a whole number.",
      "validation.min": "Enter a number.",
    });
    // Blank options are dropped; too many are refused.
    expect(addFieldSchema.parse({ ...field, sectionId: ID, choices: ["A", " ", "B "] }).choices).toEqual(["A", "B"]);
    expect(fieldErrors(() => addFieldSchema.parse({ ...field, sectionId: ID, choices: Array(101).fill("x") }))).toEqual({
      choices: "Use at most 100 options.",
    });
  });

  it("require release notes to publish", () => {
    expect(publishSchema.parse({ versionId: ID, notes: " Adds CAC " })).toEqual({ versionId: ID, notes: "Adds CAC" });
    expect(fieldErrors(() => publishSchema.parse({ versionId: ID, notes: "  " }))).toEqual({
      notes: "Add release notes: what changed in this version?",
    });
    expect(fieldErrors(() => publishSchema.parse({ versionId: ID, notes: "x".repeat(2001) }))).toEqual({
      notes: "Keep the release notes to 2000 characters or fewer.",
    });
  });

  it("accept only up and down moves", () => {
    expect(moveSchema.parse({ id: ID, direction: "up" })).toEqual({ id: ID, direction: "up" });
    expect(() => moveSchema.parse({ id: ID, direction: "left" })).toThrow();
  });
});
