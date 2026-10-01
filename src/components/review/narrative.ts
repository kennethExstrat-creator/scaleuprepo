// The review page's narrative comparison: each narrative (C4 category) and founder-pulse field of this
// month next to last month's entry (BRD A7, C3). Pure and client-safe.
import type { CommentCounts } from "@/components/comments/types";
import { toFiniteNumber } from "@/lib/format";
import { fieldTarget } from "@/lib/targets";
import { parseFieldOptions, type SubmissionBundle, type SubmissionValueRow, type TemplateFieldRow } from "@/lib/types/domain";

/** What one narrative field holds in a month. */
export type NarrativeDisplay =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "tags"; tags: string[] }
  | { kind: "rating"; value: number; min: number; max: number; label: string | null }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number };

export type NarrativeField = {
  key: string;
  label: string;
  helpText: string | null;
  /** Comment target (field:<key>). */
  target: string;
  current: NarrativeDisplay;
  previous: NarrativeDisplay;
};

export type NarrativeSection = {
  key: string;
  title: string;
  kind: "narrative" | "pulse";
  fields: NarrativeField[];
  /** Fields with an entry this month / last month. */
  currentFilled: number;
  previousFilled: number;
};

/** A narrative or pulse field's stored value, ready to show (empty for blank text, [] tags, …). */
export function narrativeDisplay(
  field: Pick<TemplateFieldRow, "field_type" | "options">,
  row: Pick<SubmissionValueRow, "value_number" | "value_text" | "value_json"> | undefined,
): NarrativeDisplay {
  if (!row) return { kind: "empty" };
  switch (field.field_type) {
    case "text":
    case "long_text":
    case "picklist": {
      const text = row.value_text?.trim();
      return text ? { kind: "text", text } : { kind: "empty" };
    }
    case "tags": {
      const tags = Array.isArray(row.value_json)
        ? row.value_json.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
        : [];
      return tags.length > 0 ? { kind: "tags", tags } : { kind: "empty" };
    }
    case "boolean":
      return typeof row.value_json === "boolean" ? { kind: "boolean", value: row.value_json } : { kind: "empty" };
    case "rating": {
      const value = toFiniteNumber(row.value_number);
      if (value === null) return { kind: "empty" };
      const scale = parseFieldOptions(field).rating ?? { min: 1, max: 5, labels: {} };
      return { kind: "rating", value, min: scale.min, max: scale.max, label: scale.labels[String(value)] ?? null };
    }
    default: {
      const value = toFiniteNumber(row.value_number);
      return value === null ? { kind: "empty" } : { kind: "number", value };
    }
  }
}

/**
 * The narrative and founder-pulse sections of the submission's template, in template order, each field with
 * this month's and last month's entry (looked up by field key, so last month may use an older template).
 */
export function buildNarrativeSections(input: Pick<SubmissionBundle, "template" | "current" | "previous">): NarrativeSection[] {
  const previousValues = input.previous?.values.values ?? {};
  return input.template.sections
    .filter((section) => section.kind === "narrative" || section.kind === "pulse")
    .map((section): NarrativeSection => {
      const fields = section.fields.map(
        (field): NarrativeField => ({
          key: field.key,
          label: field.label,
          helpText: field.help_text?.trim() || null,
          target: fieldTarget(field.key),
          current: narrativeDisplay(field, input.current.values[field.key]),
          previous: narrativeDisplay(field, previousValues[field.key]),
        }),
      );
      return {
        key: section.key,
        title: section.title,
        kind: section.kind === "pulse" ? "pulse" : "narrative",
        fields,
        currentFilled: fields.filter((field) => field.current.kind !== "empty").length,
        previousFilled: fields.filter((field) => field.previous.kind !== "empty").length,
      };
    })
    .filter((section) => section.fields.length > 0);
}

/**
 * The sections as the review page lays them out: `filled` ones (an entry this month or last month) field by
 * field, next to last month; `blank` ones (no entry in either month) together in one collapsed list. That list
 * opens by itself when a blank field has comment threads (`blankThreads`), so a thread on such a field (e.g.
 * asking the company to fill it in) is never hidden.
 */
export function splitNarrativeSections(
  sections: ReadonlyArray<NarrativeSection>,
  counts: CommentCounts,
): { filled: NarrativeSection[]; blank: NarrativeSection[]; blankThreads: { total: number; unresolved: number } } {
  const filled = sections.filter((section) => section.currentFilled > 0 || section.previousFilled > 0);
  const blank = sections.filter((section) => section.currentFilled === 0 && section.previousFilled === 0);
  const blankThreads = { total: 0, unresolved: 0 };
  for (const field of blank.flatMap((section) => section.fields)) {
    blankThreads.total += counts[field.target]?.total ?? 0;
    blankThreads.unresolved += counts[field.target]?.unresolved ?? 0;
  }
  return { filled, blank, blankThreads };
}
