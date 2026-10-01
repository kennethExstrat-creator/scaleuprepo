import { describe, expect, it } from "vitest";

import { buildNarrativeSections, narrativeDisplay, splitNarrativeSections } from "@/components/review/narrative";

import { buildBundle } from "./fixtures";

const row = (value_number: number | null, value_text: string | null, value_json: unknown) => ({
  value_number,
  value_text,
  value_json: value_json as never,
});

describe("narrativeDisplay", () => {
  it("reads each field type from its column and treats blanks as empty", () => {
    expect(narrativeDisplay({ field_type: "long_text", options: null }, row(null, "  Opened a store. ", null))).toEqual({
      kind: "text",
      text: "Opened a store.",
    });
    expect(narrativeDisplay({ field_type: "long_text", options: null }, row(null, "   ", null))).toEqual({ kind: "empty" });
    expect(narrativeDisplay({ field_type: "picklist", options: null }, row(null, "Actively raising", null))).toEqual({
      kind: "text",
      text: "Actively raising",
    });
    expect(narrativeDisplay({ field_type: "tags", options: null }, row(null, null, ["Hiring", " ", 3, "Finance"]))).toEqual({
      kind: "tags",
      tags: ["Hiring", "Finance"],
    });
    expect(narrativeDisplay({ field_type: "tags", options: null }, row(null, null, []))).toEqual({ kind: "empty" });
    expect(narrativeDisplay({ field_type: "boolean", options: null }, row(null, null, false))).toEqual({ kind: "boolean", value: false });
    expect(narrativeDisplay({ field_type: "number", options: null }, row(12.5, null, null))).toEqual({ kind: "number", value: 12.5 });
    expect(narrativeDisplay({ field_type: "text", options: null }, undefined)).toEqual({ kind: "empty" });
  });

  it("shows ratings on their scale with the scale's label", () => {
    const options = { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } };
    expect(narrativeDisplay({ field_type: "rating", options }, row(5, null, null))).toEqual({
      kind: "rating",
      value: 5,
      min: 1,
      max: 5,
      label: "Very high",
    });
    expect(narrativeDisplay({ field_type: "rating", options: null }, row(3, null, null))).toEqual({
      kind: "rating",
      value: 3,
      min: 1,
      max: 5,
      label: null,
    });
    expect(narrativeDisplay({ field_type: "rating", options }, row(null, null, null))).toEqual({ kind: "empty" });
  });
});

describe("buildNarrativeSections", () => {
  it("lists narrative and pulse sections in template order with this month and last month", () => {
    const sections = buildNarrativeSections(buildBundle());
    expect(sections.map((s) => [s.title, s.kind, s.currentFilled, s.previousFilled])).toEqual([
      ["Company Summary", "narrative", 1, 1],
      ["Investment", "narrative", 1, 0],
      ["Compliance and Regulation", "narrative", 0, 0],
      ["Founder Pulse", "pulse", 3, 1],
    ]);
    const summary = sections[0].fields[0];
    expect(summary).toMatchObject({
      key: "key_milestones",
      label: "Key milestones",
      helpText: "What happened this month?",
      target: "field:key_milestones",
      current: { kind: "text", text: "Opened a new outlet in Mont Kiara." },
      previous: { kind: "text", text: "Signed the lease." },
    });
    const investment = sections[1].fields;
    expect(investment.map((f) => f.current.kind)).toEqual(["text", "empty"]);
    const pulse = sections[3].fields;
    expect(pulse.map((f) => [f.key, f.current.kind, f.previous.kind])).toEqual([
      ["team_morale", "rating", "rating"],
      ["help_tags", "tags", "empty"],
      ["needs_intro", "boolean", "empty"],
    ]);
  });

  it("shows every entry of last month as empty when there is no prior month", () => {
    const sections = buildNarrativeSections(buildBundle({ previous: false }));
    expect(sections.every((s) => s.previousFilled === 0)).toBe(true);
    expect(sections.flatMap((s) => s.fields).every((f) => f.previous.kind === "empty")).toBe(true);
  });
});

describe("splitNarrativeSections", () => {
  const sections = buildNarrativeSections(buildBundle());

  it("separates sections blank in both months and counts the comment threads on their fields", () => {
    const { filled, blank, blankThreads } = splitNarrativeSections(sections, {
      // Threads on a blank field (e.g. asking the company to fill it in) and on filled ones.
      "field:compliance_updates": { total: 2, unresolved: 1 },
      "field:key_milestones": { total: 3, unresolved: 3 },
      general: { total: 1, unresolved: 1 },
    });
    expect(filled.map((s) => s.key)).toEqual(["company_summary", "investment", "founder_pulse"]);
    expect(blank.map((s) => s.key)).toEqual(["compliance_regulation"]);
    expect(blank[0].fields.map((f) => f.target)).toEqual(["field:compliance_updates"]);
    expect(blankThreads).toEqual({ total: 2, unresolved: 1 });
  });

  it("counts no threads when the blank fields have none", () => {
    expect(splitNarrativeSections(sections, {}).blankThreads).toEqual({ total: 0, unresolved: 0 });
    // Without a prior month, the sections with no entry this month are the blank ones.
    const noPrevious = splitNarrativeSections(buildNarrativeSections(buildBundle({ previous: false })), {});
    expect(noPrevious.blank.map((s) => s.key)).toEqual(["compliance_regulation"]);
  });
});
