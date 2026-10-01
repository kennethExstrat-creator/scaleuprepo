import { describe, expect, it } from "vitest";

import { clone, fieldByKey, sectionByKey, seedVersion } from "./fixtures";
import {
  ADDABLE_SECTION_KINDS,
  FIELD_TYPES_BY_SECTION_KIND,
  NEW_FIELD_RULES,
  SYSTEM_FIELD_RULES,
  allowedFieldTypes,
  blockingMessage,
  buildFieldOptions,
  buildFieldValidation,
  c4RowName,
  c4TitleHint,
  checkPublishReadiness,
  choicesError,
  defaultPlacement,
  diffTemplateVersions,
  fieldSettingsSummary,
  isC4RowKind,
  isSystemSectionKind,
  keyFormatError,
  moveId,
  numberRuleErrors,
  parseChoiceLines,
  placeAfter,
  planSortOrders,
  ratingErrors,
  refusesNegatives,
  renamedC4Sections,
  rulesFromField,
  sectionAcceptsFields,
  slugifyKey,
  sortByTemplateOrder,
  suggestFieldKey,
  suggestSectionKey,
  summariseMonths,
  uniqueKey,
  validateFieldDraft,
  type FieldDraft,
  type FieldDraftContext,
  type LockedField,
} from "@/app/admin/templates/_lib/rules";
import { SYSTEM_FIELD_KEYS } from "@/lib/constants";
import { FIELD_TYPES } from "@/lib/types/enums";

describe("section kinds and field types", () => {
  it("admins add narrative, additional-number and pulse sections with their own field types", () => {
    expect(ADDABLE_SECTION_KINDS).toEqual(["narrative", "custom_numbers", "pulse"]);
    expect(allowedFieldTypes("narrative")).toEqual(["long_text", "text", "picklist", "tags", "boolean", "rating"]);
    expect(allowedFieldTypes("custom_numbers")).toEqual(["currency", "number", "integer", "percent"]);
    expect(allowedFieldTypes("pulse")).toEqual(["rating", "long_text", "tags", "picklist"]);
  });

  it("system sections take no new fields and cannot be deleted", () => {
    for (const kind of ["financials", "headcount", "kpis"] as const) {
      expect(sectionAcceptsFields(kind)).toBe(false);
      expect(isSystemSectionKind(kind)).toBe(true);
    }
    for (const kind of ADDABLE_SECTION_KINDS) {
      expect(sectionAcceptsFields(kind)).toBe(true);
      expect(isSystemSectionKind(kind)).toBe(false);
    }
  });

  it("only uses real field types", () => {
    for (const types of Object.values(FIELD_TYPES_BY_SECTION_KIND)) {
      for (const type of types) expect(FIELD_TYPES).toContain(type);
    }
  });

  it("mirrors private.system_fields()", () => {
    expect(Object.keys(SYSTEM_FIELD_RULES)).toEqual([...SYSTEM_FIELD_KEYS]);
    expect(SYSTEM_FIELD_RULES.headcount_ft).toEqual({ type: "integer", sectionKind: "headcount", nonNegative: true });
    expect(SYSTEM_FIELD_RULES.gross_profit.nonNegative).toBe(false);
    expect(SYSTEM_FIELD_RULES.net_profit.nonNegative).toBe(false);
    expect(SYSTEM_FIELD_RULES.revenue_total.nonNegative).toBe(true);
  });
});

describe("keys", () => {
  it("slugifies labels into database keys", () => {
    expect(slugifyKey("Customer acquisition cost (CAC)")).toBe("customer_acquisition_cost_cac");
    expect(slugifyKey("Commentary on the month's numbers")).toBe("commentary_on_the_months_numbers");
    expect(slugifyKey("Sales & marketing")).toBe("sales_and_marketing");
    expect(slugifyKey("  Café  crème  ")).toBe("cafe_creme");
    expect(slugifyKey("2027 plan")).toBe("field_2027_plan");
    expect(slugifyKey("2027 plan", "section")).toBe("section_2027_plan");
    expect(slugifyKey("!!!")).toBe("field");
    expect(slugifyKey("")).toBe("field");
    const long = slugifyKey("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    expect(long.endsWith("_")).toBe(false);
  });

  it("makes keys unique with a numeric suffix within 63 characters", () => {
    expect(uniqueKey("notes", [])).toBe("notes");
    expect(uniqueKey("notes", ["notes"])).toBe("notes_2");
    expect(uniqueKey("notes", ["notes", "notes_2", "notes_3"])).toBe("notes_4");
    const base = "a".repeat(63);
    const next = uniqueKey(base, [base]);
    expect(next).toHaveLength(63);
    expect(next.endsWith("_2")).toBe(true);
  });

  it("explains malformed keys", () => {
    expect(keyFormatError("unit_economics_2")).toBeNull();
    expect(keyFormatError("")).toBe("Enter a key.");
    expect(keyFormatError("2nd")).toBe("Start the key with a lower-case letter.");
    expect(keyFormatError("_x")).toBe("Start the key with a lower-case letter.");
    expect(keyFormatError("Bad Key")).toBe("Start the key with a lower-case letter.");
    expect(keyFormatError("bad-key")).toBe("Use only lower-case letters, numbers and underscores.");
    expect(keyFormatError("a".repeat(64))).toBe("Keys can be at most 63 characters.");
  });

  it("suggests field keys that avoid the version's keys, built-in keys and keys earlier versions typed differently", () => {
    const locked: Record<string, LockedField> = {
      partnerships: { field_type: "long_text", label: "Partnerships and market updates", version_no: 1 },
    };
    expect(suggestFieldKey("Revenue total", { versionKeys: [], lockedFields: {}, fieldType: "currency" })).toBe(
      "revenue_total_2",
    );
    expect(suggestFieldKey("Key milestones", { versionKeys: ["key_milestones"], lockedFields: {}, fieldType: "text" })).toBe(
      "key_milestones_2",
    );
    // A key earlier versions used for another type is avoided; the same type may reuse it.
    expect(suggestFieldKey("Partnerships", { versionKeys: [], lockedFields: locked, fieldType: "picklist" })).toBe(
      "partnerships_2",
    );
    expect(suggestFieldKey("Partnerships", { versionKeys: [], lockedFields: locked, fieldType: "long_text" })).toBe(
      "partnerships",
    );
    expect(suggestSectionKey("Operation", ["operation"])).toBe("operation_2");
    expect(suggestSectionKey("Unit economics", [])).toBe("unit_economics");
  });
});

describe("options", () => {
  it("reads options one per line", () => {
    expect(parseChoiceLines("  Seed \n\nSeries A\r\n Series B  \n")).toEqual(["Seed", "Series A", "Series B"]);
    expect(parseChoiceLines("")).toEqual([]);
  });

  it("requires usable, distinct options", () => {
    expect(choicesError(["A", "B"], "picklist")).toBeNull();
    expect(choicesError([], "picklist")).toBe("Add at least one option, one per line.");
    expect(choicesError([], "tags")).toBe("Add at least one tag, one per line.");
    expect(choicesError(["Hiring", "hiring"], "tags")).toBe("“hiring” is listed more than once.");
    expect(choicesError(["x".repeat(201)], "picklist")).toBe("Keep each option to 200 characters or fewer.");
    expect(choicesError(Array.from({ length: 101 }, (_, i) => `Option ${i}`), "picklist")).toBe("Use at most 100 options.");
  });

  it("checks rating scales", () => {
    expect(ratingErrors({ min: 1, max: 5, labels: {} })).toEqual({});
    expect(ratingErrors({ min: 0, max: 10, labels: {} })).toEqual({});
    expect(ratingErrors({ min: 5, max: 5, labels: {} })).toEqual({ "rating.max": "The highest value must be above the lowest." });
    expect(ratingErrors({ min: 3, max: 1, labels: {} })).toEqual({ "rating.max": "The highest value must be above the lowest." });
    expect(ratingErrors({ min: 1.5, max: 5, labels: {} })).toEqual({ "rating.min": "Enter a whole number from 0 to 10." });
    expect(ratingErrors({ min: 1, max: 11, labels: {} })).toEqual({ "rating.max": "Enter a whole number from 0 to 10." });
    expect(ratingErrors({ min: -1, max: 5, labels: {} })).toEqual({ "rating.min": "Enter a whole number from 0 to 10." });
    expect(ratingErrors({ min: 1, max: 5, labels: { "1": "x".repeat(61) } })).toEqual({
      "rating.labels": "Keep each label to 60 characters or fewer.",
    });
  });

  it("builds options JSON in the seeded shapes", () => {
    const seed = seedVersion();
    expect(buildFieldOptions("picklist", { choices: ["Not raising", "Round closed"], rating: null })).toEqual({
      options: ["Not raising", "Round closed"],
    });
    expect(buildFieldOptions("tags", { choices: ["Hiring"], rating: null })).toEqual({ options: ["Hiring"] });
    // The seeded rating round-trips exactly (no spurious change).
    expect(
      buildFieldOptions("rating", { choices: [], rating: { min: 1, max: 5, labels: { "1": "Very low", "5": "Very high" } } }),
    ).toEqual(fieldByKey(seed, "team_morale").options);
    // Labels outside the scale or blank are dropped; no labels → no labels key.
    expect(
      buildFieldOptions("rating", { choices: [], rating: { min: 0, max: 3, labels: { "0": " None ", "2": "", "7": "Out" } } }),
    ).toEqual({ min: 0, max: 3, labels: { "0": "None" } });
    expect(buildFieldOptions("rating", { choices: [], rating: { min: 1, max: 3, labels: {} } })).toEqual({ min: 1, max: 3 });
    for (const type of ["currency", "number", "integer", "percent", "text", "long_text", "boolean"] as const) {
      expect(buildFieldOptions(type, { choices: ["ignored"], rating: null })).toBeNull();
    }
  });
});

describe("limits", () => {
  const rules = (patch: Partial<typeof NEW_FIELD_RULES> = {}) => ({ ...NEW_FIELD_RULES, ...patch });

  it("stores allow_negative for custom number fields, min and max when set", () => {
    expect(buildFieldValidation("cac", "currency", rules())).toEqual({ allow_negative: false });
    expect(buildFieldValidation("growth", "percent", rules({ allow_negative: true, min: -100, max: 1000 }))).toEqual({
      allow_negative: true,
      min: -100,
      max: 1000,
    });
    expect(buildFieldValidation("notes", "long_text", rules({ max_length: 4000, min: 3 }))).toEqual({ max_length: 4000 });
    expect(buildFieldValidation("notes", "text", rules())).toBeNull();
    expect(buildFieldValidation("morale", "rating", rules({ min: 1 }))).toBeNull();
    expect(buildFieldValidation("flag", "boolean", rules())).toBeNull();
  });

  it("round-trips the seeded system limits unchanged (BRD B26)", () => {
    const seed = seedVersion();
    for (const key of SYSTEM_FIELD_KEYS) {
      const field = fieldByKey(seed, key);
      expect(buildFieldValidation(field.key, field.field_type, rulesFromField(field))).toEqual(field.validation);
    }
    // Non-negative figures never store allow_negative; gross and net profit do.
    expect(buildFieldValidation("revenue_total", "currency", rules({ allow_negative: true, min: 0 }))).toEqual({ min: 0 });
    expect(buildFieldValidation("net_profit", "currency", rules({ allow_negative: false }))).toEqual({ allow_negative: false });
  });

  it("reads stored limits as the database does", () => {
    expect(rulesFromField({ key: "x", field_type: "currency", validation: null })).toEqual({
      allow_negative: true,
      min: null,
      max: null,
      max_length: null,
    });
    expect(rulesFromField({ key: "x", field_type: "number", validation: { allow_negative: false, max: 10 } })).toMatchObject({
      allow_negative: false,
      max: 10,
    });
    expect(rulesFromField({ key: "burn_rate", field_type: "currency", validation: { min: 0 } }).allow_negative).toBe(false);
    expect(rulesFromField({ key: "gross_profit", field_type: "currency", validation: { allow_negative: true } }).allow_negative).toBe(
      true,
    );
    expect(rulesFromField({ key: "x", field_type: "long_text", validation: { max_length: 4000 } }).max_length).toBe(4000);
  });

  it("knows which figures refuse negatives", () => {
    expect(refusesNegatives("cash_in_bank", { allow_negative: true, min: null })).toBe(true);
    expect(refusesNegatives("gross_profit", { allow_negative: true, min: null })).toBe(false);
    expect(refusesNegatives("gross_profit", { allow_negative: false, min: null })).toBe(true);
    expect(refusesNegatives("customers", { allow_negative: true, min: 0 })).toBe(true);
    expect(refusesNegatives("customers", { allow_negative: true, min: -5 })).toBe(false);
  });

  it("checks min and max", () => {
    expect(numberRuleErrors({ min: 0, max: 100 }, { nonNegative: true })).toEqual({});
    expect(numberRuleErrors({ min: 10, max: 5 }, { nonNegative: false })).toEqual({
      "validation.max": "The maximum must be at least the minimum.",
    });
    expect(numberRuleErrors({ min: -1, max: null }, { nonNegative: true })).toEqual({
      "validation.min": "The minimum can't be below 0, because negative values aren't allowed.",
    });
    expect(numberRuleErrors({ min: null, max: -1 }, { nonNegative: true })).toEqual({
      "validation.max": "The maximum can't be below 0, because negative values aren't allowed.",
    });
    expect(numberRuleErrors({ min: 1e15, max: null }, { nonNegative: false })).toEqual({ "validation.min": "Enter a smaller number." });
  });
});

describe("validateFieldDraft", () => {
  const draft = (patch: Partial<FieldDraft> = {}): FieldDraft => ({
    label: "Customer acquisition cost",
    key: "cac",
    field_type: "currency",
    is_required: false,
    help_text: "",
    choices: [],
    rating: null,
    validation: { ...NEW_FIELD_RULES },
    ...patch,
  });
  const context = (patch: Partial<FieldDraftContext> = {}): FieldDraftContext => ({
    sectionKind: "custom_numbers",
    otherKeys: ["revenue_total", "key_milestones"],
    lockedFields: {
      key_milestones: { field_type: "long_text", label: "Key milestones", version_no: 1 },
      team_morale: { field_type: "rating", label: "Team morale", version_no: 1 },
    },
    existing: null,
    ...patch,
  });

  it("accepts a valid new field", () => {
    expect(validateFieldDraft(draft(), context())).toEqual({});
  });

  it("requires a label and a well-formed, free, non-reserved key", () => {
    expect(validateFieldDraft(draft({ label: " " }), context())).toEqual({ label: "Enter a label." });
    expect(validateFieldDraft(draft({ key: "Bad key" }), context()).key).toBe("Start the key with a lower-case letter.");
    expect(validateFieldDraft(draft({ key: "burn_rate" }), context()).key).toBe(
      "“burn_rate” is reserved for a built-in field. Choose another key.",
    );
    expect(validateFieldDraft(draft({ key: "key_milestones", field_type: "long_text" }), context({ sectionKind: "narrative" })).key).toBe(
      "Another field in this version already uses this key.",
    );
  });

  it("allows only the section kind's types", () => {
    expect(validateFieldDraft(draft({ field_type: "rating", key: "nps", rating: { min: 0, max: 10, labels: {} } }), context()).field_type).toBe(
      "Rating fields can't be used in additional numbers sections.",
    );
    expect(validateFieldDraft(draft({ field_type: "currency" }), context({ sectionKind: "pulse" })).field_type).toBe(
      "Currency fields can't be used in founder pulse sections.",
    );
    expect(validateFieldDraft(draft(), context({ sectionKind: "financials" })).field_type).toBe(
      "Fields can't be added to this section.",
    );
  });

  it("keeps the type of keys earlier versions used (answers are stored per key)", () => {
    // A new field reusing an old key needs the old type …
    expect(
      validateFieldDraft(draft({ key: "team_morale", field_type: "long_text" }), context({ sectionKind: "pulse", otherKeys: [] })).key,
    ).toBe("Version 1 used this key for “Team morale” (rating). Choose another key or use that type.");
    // … which is fine with the same type.
    expect(
      validateFieldDraft(
        draft({ key: "team_morale", field_type: "rating", rating: { min: 1, max: 5, labels: {} } }),
        context({ sectionKind: "pulse", otherKeys: [] }),
      ),
    ).toEqual({});
    // An existing field whose key earlier versions used keeps key and type.
    const existing = { key: "key_milestones", field_type: "long_text" as const, is_system: false };
    const narrative = context({ sectionKind: "narrative", otherKeys: [], existing });
    expect(validateFieldDraft(draft({ key: "milestones", field_type: "long_text" }), narrative).key).toBe(
      "This key can't change: earlier versions stored answers under it.",
    );
    expect(validateFieldDraft(draft({ key: "key_milestones", field_type: "text" }), narrative).field_type).toBe(
      "Earlier months stored answers to this field as long text, so its type can't change. Add a new field instead.",
    );
    expect(validateFieldDraft(draft({ key: "key_milestones", field_type: "long_text", label: "Milestones" }), narrative)).toEqual({});
    // A field new in this draft may change key and type freely.
    const fresh = context({ sectionKind: "narrative", otherKeys: [], existing: { key: "new_one", field_type: "text", is_system: false } });
    expect(validateFieldDraft(draft({ key: "renamed", field_type: "long_text" }), fresh)).toEqual({});
  });

  it("checks the settings of the chosen type", () => {
    const narrative = context({ sectionKind: "narrative" });
    expect(validateFieldDraft(draft({ key: "stage", field_type: "picklist" }), narrative).choices).toBe(
      "Add at least one option, one per line.",
    );
    expect(validateFieldDraft(draft({ key: "stage", field_type: "picklist", choices: ["Seed"] }), narrative)).toEqual({});
    expect(validateFieldDraft(draft({ key: "mood", field_type: "rating", rating: { min: 2, max: 1, labels: {} } }), narrative)).toEqual({
      "rating.max": "The highest value must be above the lowest.",
    });
    expect(
      validateFieldDraft(draft({ key: "note", field_type: "text", validation: { ...NEW_FIELD_RULES, max_length: 0 } }), narrative),
    ).toEqual({ "validation.max_length": "Enter a whole number from 1 to 20,000." });
    expect(validateFieldDraft(draft({ validation: { allow_negative: false, min: -5, max: null, max_length: null } }), context())).toEqual({
      "validation.min": "The minimum can't be below 0, because negative values aren't allowed.",
    });
    expect(validateFieldDraft(draft({ validation: { allow_negative: true, min: -5, max: null, max_length: null } }), context())).toEqual({});
  });

  it("checks only the label, help text and limits of system fields", () => {
    const existing = { key: "revenue_total", field_type: "currency" as const, is_system: true };
    const financials = context({ sectionKind: "financials", existing });
    // Key, type and section kind are ignored (the action never writes them for system fields).
    expect(validateFieldDraft(draft({ key: "whatever", field_type: "rating", label: "Revenue" }), financials)).toEqual({});
    expect(validateFieldDraft(draft({ label: "" }), financials)).toEqual({ label: "Enter a label." });
    expect(validateFieldDraft(draft({ validation: { allow_negative: true, min: -1, max: null, max_length: null } }), financials)).toEqual({
      "validation.min": "The minimum can't be below 0, because negative values aren't allowed.",
    });
    const profit = context({ sectionKind: "financials", existing: { key: "net_profit", field_type: "currency", is_system: true } });
    expect(validateFieldDraft(draft({ validation: { allow_negative: true, min: -1000, max: null, max_length: null } }), profit)).toEqual({});
    expect(validateFieldDraft(draft({ help_text: "x".repeat(1001) }), financials)).toEqual({
      help_text: "Keep the help text to 1,000 characters or fewer.",
    });
  });
});

describe("ordering", () => {
  const rows = [
    { id: "c", key: "c", sort_order: 2 },
    { id: "a", key: "a", sort_order: 1 },
    { id: "b2", key: "b", sort_order: 2 },
    { id: "b1", key: "b", sort_order: 2 },
  ];

  it("sorts by sort_order, key, id (as the data layer)", () => {
    expect(sortByTemplateOrder(rows).map((row) => row.id)).toEqual(["a", "b1", "b2", "c"]);
  });

  it("moves an id up or down, or reports that it cannot", () => {
    expect(moveId(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", "up")).toBeNull();
    expect(moveId(["a", "b", "c"], "c", "down")).toBeNull();
    expect(moveId(["a", "b", "c"], "x", "up")).toBeNull();
  });

  it("places an id after another (null = first; unknown = last)", () => {
    expect(placeAfter(["a", "b", "c", "n"], "n", "a")).toEqual(["a", "n", "b", "c"]);
    expect(placeAfter(["a", "b", "c", "n"], "n", null)).toEqual(["n", "a", "b", "c"]);
    expect(placeAfter(["a", "b", "c", "n"], "n", "c")).toEqual(["a", "b", "c", "n"]);
    expect(placeAfter(["a", "b", "c", "n"], "n", "zzz")).toEqual(["a", "b", "c", "n"]);
  });

  it("places new sections where they belong by default", () => {
    const seed = seedVersion();
    const id = (key: string) => sectionByKey(seed, key).id;
    expect(defaultPlacement("narrative", seed.sections)).toBe(id("other_mentionables"));
    expect(defaultPlacement("custom_numbers", seed.sections)).toBe(id("kpis"));
    expect(defaultPlacement("pulse", seed.sections)).toBeNull();
    // Without narrative sections, narrative goes after the numbers; with nothing, at the end.
    const numbersOnly = seed.sections.filter((section) => section.kind !== "narrative");
    expect(defaultPlacement("narrative", numbersOnly)).toBe(id("kpis"));
    expect(defaultPlacement("custom_numbers", [])).toBeNull();
  });

  it("plans the fewest sort_order updates", () => {
    const numbered = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ];
    expect(planSortOrders(numbered, ["a", "c", "b"])).toEqual([
      { id: "c", sort_order: 2 },
      { id: "b", sort_order: 3 },
    ]);
    expect(planSortOrders(numbered, ["a", "b", "c"])).toEqual([]);
    // Gaps and duplicates are renumbered 1…n; ids left out keep their place at the end.
    expect(
      planSortOrders(
        [
          { id: "a", sort_order: 0 },
          { id: "b", sort_order: 0 },
          { id: "c", sort_order: 9 },
        ],
        ["b", "a"],
      ),
    ).toEqual([
      { id: "b", sort_order: 1 },
      { id: "a", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ]);
  });
});

describe("checkPublishReadiness", () => {
  it("passes the seeded template", () => {
    expect(checkPublishReadiness(seedVersion())).toEqual([]);
    expect(blockingMessage([])).toBeNull();
  });

  it("requires the system sections and the seven built-in figures (publish_template_version)", () => {
    const version = clone(seedVersion());
    version.sections = version.sections.filter((section) => section.kind !== "kpis" && section.kind !== "headcount");
    const issues = checkPublishReadiness(version);
    expect(issues.filter((issue) => issue.level === "error").map((issue) => issue.message)).toEqual([
      "The Headcount section is missing. Every version needs it.",
      "The Company KPIs section is missing. Every version needs it.",
      "The built-in field “headcount_ft” (whole number) is missing.",
      "The built-in field “headcount_pt” (whole number) is missing.",
    ]);
    expect(blockingMessage(issues)).toBe(
      "Please fix 4 issues before publishing, starting with: The Headcount section is missing. Every version needs it.",
    );
  });

  it("blocks unusable settings and warns about empty sections and misplaced types", () => {
    const version = clone(seedVersion());
    fieldByKey(version, "fundraising_status").options = { options: [] };
    fieldByKey(version, "team_morale").options = { min: 5, max: 5 };
    fieldByKey(version, "gross_profit").validation = { min: 10, max: 5 };
    sectionByKey(version, "other_mentionables").fields = [];
    sectionByKey(version, "operation").fields[0].field_type = "currency";
    const issues = checkPublishReadiness(version);
    expect(issues).toEqual([
      { level: "error", message: "“Gross profit” has a minimum above its maximum." },
      { level: "warning", message: "“Operations highlights” is a currency field in the narrative section “Operation”." },
      { level: "error", message: "“Fundraising status” needs at least one option." },
      { level: "warning", message: "“Other Mentionables” has no fields yet." },
      { level: "error", message: "“Team morale” needs a rating scale whose highest value is above its lowest." },
    ]);
    expect(blockingMessage(issues)).toBe(
      "Please fix 3 issues before publishing, starting with: “Gross profit” has a minimum above its maximum.",
    );
    expect(blockingMessage([issues[1]])).toBeNull();
    expect(blockingMessage([issues[2]])).toBe("“Fundraising status” needs at least one option.");
  });
});

describe("diffTemplateVersions", () => {
  it("finds nothing between a version and its draft copy", () => {
    expect(diffTemplateVersions(seedVersion(1), seedVersion(2))).toEqual([]);
  });

  it("ignores key order and empty objects in the JSON settings", () => {
    const next = clone(seedVersion(2));
    fieldByKey(next, "team_morale").options = { labels: { "5": "Very high", "1": "Very low" }, max: 5, min: 1 };
    fieldByKey(next, "key_milestones").validation = {};
    expect(diffTemplateVersions(seedVersion(1), next)).toEqual([]);
  });

  it("lists section and field changes in form order", () => {
    const next = clone(seedVersion(2));
    // Sections: rename + describe, remove, add, reorder.
    const financials = sectionByKey(next, "financials");
    financials.title = "Financial figures";
    financials.description = "Month-end figures";
    next.sections = next.sections.filter((section) => section.key !== "other_mentionables");
    next.sections.push({
      ...clone(sectionByKey(next, "company_summary")),
      id: "new-section",
      key: "unit_economics",
      title: "Unit economics",
      kind: "custom_numbers",
      sort_order: 20,
      fields: [
        { ...clone(fieldByKey(next, "key_milestones")), id: "cac", key: "cac", label: "CAC", field_type: "currency" },
      ],
    });
    sectionByKey(next, "product_development").sort_order = 5.5;
    // Fields: relabel, change settings, add, remove, reorder.
    fieldByKey(next, "burn_rate").label = "Monthly burn";
    const morale = fieldByKey(next, "team_morale");
    morale.is_required = true;
    morale.help_text = "How is the team feeling?";
    morale.options = { min: 1, max: 10 };
    fieldByKey(next, "fundraising_status").options = { options: ["Not raising", "Raising"] };
    fieldByKey(next, "gross_profit").validation = { allow_negative: false };
    const operation = sectionByKey(next, "operation");
    operation.fields = operation.fields.map((field) =>
      field.key === "team_highlights" ? { ...field, sort_order: 0 } : field,
    );
    const pulse = sectionByKey(next, "founder_pulse");
    pulse.fields = pulse.fields.filter((field) => field.key !== "help_needed");
    pulse.fields.push({ ...clone(pulse.fields[0]), id: "nps", key: "nps", label: "Likely to recommend", sort_order: 9 });

    expect(diffTemplateVersions(seedVersion(1), next)).toEqual([
      { type: "changed", text: "Renamed section “Financials” to “Financial figures”" },
      { type: "changed", text: "Changed the description of “Financial figures”" },
      { type: "added", text: "Added section “Unit economics” (1 field)" },
      { type: "removed", text: "Removed section “Other Mentionables” (1 field)" },
      { type: "reordered", text: "Changed the order of the sections" },
      { type: "changed", text: "Changed “Gross profit”: limits" },
      { type: "changed", text: "Renamed field “Burn rate (per month)” to “Monthly burn”" },
      { type: "reordered", text: "Changed the order of the fields in “Operation”" },
      { type: "changed", text: "Changed “Fundraising status”: options" },
      { type: "changed", text: "Changed “Team morale”: now required, help text, rating scale" },
      { type: "added", text: "Added field “Likely to recommend” to “Founder Pulse”" },
      { type: "removed", text: "Removed field “Help needed from ScaleUp” from “Founder Pulse”" },
    ]);
  });

  it("reports a field moved to another section and type changes", () => {
    const next = clone(seedVersion(2));
    const moved = fieldByKey(next, "partnerships");
    sectionByKey(next, "partnerships_market").fields = [];
    const summary = sectionByKey(next, "company_summary");
    summary.fields.push({ ...moved, section_id: summary.id, sort_order: 2, field_type: "text" });
    expect(diffTemplateVersions(seedVersion(1), next)).toEqual([
      { type: "changed", text: "Moved “Partnerships and market updates” to “Company Summary”" },
      { type: "changed", text: "Changed “Partnerships and market updates”: type (long text to short text)" },
    ]);
  });
});

describe("C4 rows", () => {
  it("are the narrative and founder-pulse sections, matched by title whatever the capitals and spacing", () => {
    expect((["financials", "headcount", "kpis", "custom_numbers", "narrative", "pulse"] as const).filter(isC4RowKind)).toEqual([
      "narrative",
      "pulse",
    ]);
    expect(c4RowName("  Product \t Development ")).toBe("product development");
    expect(c4RowName("PRODUCT DEVELOPMENT")).toBe(c4RowName("Product Development"));
  });

  it("explain under a section's title that a new title starts a separate row", () => {
    expect(c4TitleHint("narrative", "Product Development")).toBe(
      "The C4 export uses this title as its row name. Months already opened stay in the “Product Development” row, so a new title starts a separate row for months opened after you publish.",
    );
    expect(c4TitleHint("pulse", " Founder Pulse ")).toContain("stay in the “Founder Pulse” row");
    // A section new in the draft has no months yet.
    expect(c4TitleHint("narrative", null)).toBe("The C4 export uses this title as its row name.");
    for (const kind of ["financials", "headcount", "kpis", "custom_numbers"] as const) {
      expect(c4TitleHint(kind, "Anything")).toBeNull();
    }
  });

  it("finds the narrative and pulse sections a draft renames", () => {
    const base = clone(seedVersion(1));
    const next = clone(seedVersion(2));
    sectionByKey(next, "operation").title = "Operations";
    sectionByKey(next, "founder_pulse").title = "Founder check-in";
    sectionByKey(next, "product_development").title = "  product   development "; // the same row
    sectionByKey(next, "financials").title = "Financial figures"; // not a C4 row
    next.sections = next.sections.filter((section) => section.key !== "investment"); // removed, not renamed
    const custom = (version: typeof base, title: string) =>
      version.sections.push({
        ...clone(sectionByKey(version, "company_summary")),
        id: `${version.id}-unit-economics`,
        key: "unit_economics",
        title,
        kind: "custom_numbers",
        sort_order: 20,
        fields: [],
      });
    custom(base, "Unit economics");
    custom(next, "Unit metrics"); // additional numbers are not C4 rows
    next.sections.push({ ...clone(sectionByKey(next, "company_summary")), id: "esg", key: "esg", title: "ESG", sort_order: 21, fields: [] }); // new

    expect(renamedC4Sections(base, next)).toEqual([
      { key: "operation", from: "Operation", to: "Operations" },
      { key: "founder_pulse", from: "Founder Pulse", to: "Founder check-in" },
    ]);
    expect(renamedC4Sections(seedVersion(1), seedVersion(2))).toEqual([]);
  });

  it("warns, without blocking, before publishing a draft that renames one", () => {
    const next = clone(seedVersion(2));
    sectionByKey(next, "operation").title = "Operations";
    const issues = checkPublishReadiness(next, seedVersion(1));
    expect(issues).toEqual([
      {
        level: "warning",
        message:
          "Renamed “Operation” to “Operations”: the C4 export will show earlier months and months opened with this version in separate rows.",
      },
    ]);
    expect(blockingMessage(issues)).toBeNull();
    // The publish action checks without the published version: renames never block publishing.
    expect(checkPublishReadiness(next)).toEqual([]);
    // Renamed back to the published title: one row again.
    sectionByKey(next, "operation").title = "Operation";
    expect(checkPublishReadiness(next, seedVersion(1))).toEqual([]);
  });
});

describe("summariseMonths", () => {
  it("shows months as short ranges", () => {
    expect(summariseMonths([])).toBe("");
    expect(summariseMonths(["2026-07-01"])).toBe("Jul 2026");
    expect(summariseMonths(["2026-09-01", "2026-07-01", "2026-08-01"])).toBe("Jul–Sep 2026");
    expect(summariseMonths(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"])).toBe("Nov 2026 – Feb 2027");
    expect(summariseMonths(["2026-01", "2026-02", "2026-03", "2026-10", "2026-10-01"])).toBe("Jan–Mar 2026, Oct 2026");
    expect(summariseMonths(["2026-01", "2026-03", "2026-05", "2026-07", "2026-09"], 3)).toBe(
      "Jan 2026, Mar 2026, May 2026 and 2 more",
    );
    expect(summariseMonths(["not a month", "2026-13-01", "2026-07-01"])).toBe("Jul 2026");
  });
});

describe("fieldSettingsSummary", () => {
  it("summarises options, scales and limits", () => {
    const seed = seedVersion();
    expect(fieldSettingsSummary(fieldByKey(seed, "fundraising_status"))).toEqual(["6 options"]);
    expect(fieldSettingsSummary(fieldByKey(seed, "help_tags"))).toEqual(["9 tags"]);
    expect(fieldSettingsSummary(fieldByKey(seed, "team_morale"))).toEqual(["Scale 1–5"]);
    expect(fieldSettingsSummary(fieldByKey(seed, "revenue_total"))).toEqual(["No negatives"]);
    expect(fieldSettingsSummary(fieldByKey(seed, "gross_profit"))).toEqual([]);
    expect(fieldSettingsSummary(fieldByKey(seed, "key_milestones"))).toEqual([]);
    expect(fieldSettingsSummary({ key: "x", field_type: "percent", options: null, validation: { allow_negative: false, max: 100 } })).toEqual([
      "No negatives",
      "Max 100",
    ]);
    expect(fieldSettingsSummary({ key: "x", field_type: "number", options: null, validation: { allow_negative: true, min: -5, max: 5 } })).toEqual([
      "-5 to 5",
    ]);
    expect(fieldSettingsSummary({ key: "x", field_type: "text", options: null, validation: { max_length: 4000 } })).toEqual([
      "Max 4,000 characters",
    ]);
    expect(fieldSettingsSummary({ key: "x", field_type: "picklist", options: null, validation: null })).toEqual(["No options yet"]);
  });
});
