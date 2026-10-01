// The template builder's Server Actions against an in-memory Supabase (./fake-supabase.ts): permission
// check first, input validation, the builder rules, the rows they write and the friendly errors. The
// database rules themselves (RLS, guard triggers, RPCs) are covered by tests/db/templates.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { seededFake, type FakeSupabase } from "./fake-supabase";
import { V1_ID, V2_ID } from "./fixtures";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const assertScaleUp = vi.fn();
vi.mock("@/lib/auth/session", () => ({ assertScaleUp: (...args: unknown[]) => assertScaleUp(...args) }));

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fake }));

vi.mock("@/lib/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data")>();
  return {
    ...actual,
    getTemplateVersion: async (_sb: unknown, versionId: string) => {
      const version = fake.assemble(versionId);
      if (!version) throw new actual.DataError("getTemplateVersion", "not found", { code: "PGRST116", notFound: true });
      return version;
    },
  };
});

const {
  addFieldAction,
  addSectionAction,
  createDraftAction,
  deleteFieldAction,
  deleteSectionAction,
  discardDraftAction,
  moveFieldAction,
  moveSectionAction,
  publishVersionAction,
  setDefaultTemplateAction,
  updateFieldAction,
  updateSectionAction,
} = await import("@/app/admin/templates/actions");
const { ActionError } = await import("@/lib/actions/result");

const STALE =
  "That change could not be saved: the draft may have been published or discarded in the meantime. Please reload the page.";

function section(versionId: string, key: string) {
  const row = fake.rows("template_sections").find((item) => item.template_version_id === versionId && item.key === key);
  if (!row) throw new Error(`no section ${key}`);
  return row;
}

function field(versionId: string, key: string) {
  const row = fake.rows("template_fields").find((item) => item.template_version_id === versionId && item.key === key);
  if (!row) throw new Error(`no field ${key}`);
  return row;
}

function sectionOrder(versionId: string): string[] {
  return fake
    .rows("template_sections")
    .filter((row) => row.template_version_id === versionId)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || String(a.key).localeCompare(String(b.key)))
    .map((row) => String(row.key));
}

const newField = {
  label: "Customer acquisition cost",
  key: "cac",
  field_type: "currency" as const,
  is_required: true,
  help_text: " ",
  choices: [],
  rating: null,
  validation: { allow_negative: false, min: 0, max: 50000, max_length: null },
};

beforeEach(() => {
  fake = seededFake();
  revalidatePath.mockClear();
  assertScaleUp.mockReset();
  assertScaleUp.mockResolvedValue({ userId: "u-fund-admin", scaleupRole: "fund_admin", memberships: [] });
});

describe("permissions", () => {
  it("checks the role first and writes nothing when it is refused", async () => {
    assertScaleUp.mockRejectedValue(new ActionError("You don't have permission to do that."));
    const results = await Promise.all([
      createDraftAction({ templateId: V1_ID }),
      addSectionAction({ versionId: V2_ID, title: "Unit economics", description: "", kind: "custom_numbers" }),
      deleteFieldAction({ fieldId: String(field(V2_ID, "key_milestones").id) }),
      publishVersionAction({ versionId: V2_ID, notes: "x" }),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(assertScaleUp).toHaveBeenCalledWith(["super_admin", "fund_admin"]);
    expect(fake.writes()).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("validates input before touching the database", async () => {
    const result = await addSectionAction({ versionId: "not-an-id", title: "", description: "", kind: "narrative" });
    expect(result).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: {
        versionId: "This item could not be identified. Please reload the page.",
        title: "Enter a title.",
      },
    });
    expect(fake.calls).toEqual([]);
  });
});

describe("versions", () => {
  it("creates (or reopens) a draft through create_template_draft", async () => {
    fake.rpcHandlers.create_template_draft = () => ({ data: V2_ID, error: null });
    expect(await createDraftAction({ templateId: "b0000000-0000-4000-8000-000000000001" })).toEqual({
      ok: true,
      data: { versionId: V2_ID },
    });
    expect(fake.rpcCalls).toEqual([
      { name: "create_template_draft", args: { p_template_id: "b0000000-0000-4000-8000-000000000001" } },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/templates");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/templates/${V2_ID}`);
  });

  it("surfaces database rule errors as they are", async () => {
    fake.rpcHandlers.create_template_draft = () => ({ data: null, error: { code: "P0001", message: "That template was not found." } });
    expect(await createDraftAction({ templateId: V1_ID })).toEqual({ ok: false, error: "That template was not found." });
  });

  it("discards drafts only", async () => {
    expect(await discardDraftAction({ versionId: V1_ID })).toEqual({
      ok: false,
      error: "Version 1 is published, so it can no longer be changed. Create a new draft instead.",
    });
    expect(await discardDraftAction({ versionId: V2_ID })).toEqual({ ok: true, data: undefined });
    expect(fake.rows("template_versions").map((row) => row.id)).toEqual([V1_ID]);
    expect(fake.rows("template_fields").every((row) => row.template_version_id === V1_ID)).toBe(true);
  });

  it("publishes with release notes after the readiness check", async () => {
    fake.rpcHandlers.publish_template_version = () => ({ data: null, error: null });
    const result = await publishVersionAction({ versionId: V2_ID, notes: "  Adds unit economics  " });
    expect(result).toEqual({ ok: true, data: { versionNo: 2 } });
    const notesUpdate = fake.writes().find((call) => call.table === "template_versions");
    expect(notesUpdate).toMatchObject({ op: "update", payload: { notes: "Adds unit economics" } });
    expect(fake.rpcCalls).toEqual([{ name: "publish_template_version", args: { p_version_id: V2_ID } }]);
  });

  it("refuses to publish a draft the form could not use, before writing anything", async () => {
    field(V2_ID, "fundraising_status").options = { options: [] };
    const result = await publishVersionAction({ versionId: V2_ID, notes: "x" });
    expect(result).toEqual({ ok: false, error: "“Fundraising status” needs at least one option." });
    expect(fake.writes()).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses to publish a version that is not a draft, or without notes", async () => {
    expect(await publishVersionAction({ versionId: V1_ID, notes: "x" })).toEqual({
      ok: false,
      error: "Only drafts can be published. Version 1 is published.",
    });
    expect(await publishVersionAction({ versionId: V2_ID, notes: " " })).toMatchObject({
      ok: false,
      fieldErrors: { notes: "Add release notes: what changed in this version?" },
    });
    expect(await publishVersionAction({ versionId: "b1000000-0000-4000-8000-000000000099", notes: "x" })).toEqual({
      ok: false,
      error: "We couldn't find that item. It may have been removed.",
    });
  });

  it("switches the default template with one update", async () => {
    const templateId = "b0000000-0000-4000-8000-000000000001";
    expect(await setDefaultTemplateAction({ templateId })).toEqual({ ok: true, data: undefined });
    expect(fake.writes()).toEqual([
      { table: "templates", op: "update", payload: { is_default: true }, filters: [{ op: "eq", column: "id", value: templateId }] },
    ]);
  });
});

describe("sections", () => {
  it("adds a section at the end with a unique key from its title", async () => {
    const result = await addSectionAction({ versionId: V2_ID, title: "Operation", description: " Day-to-day ", kind: "narrative" });
    expect(result.ok).toBe(true);
    const inserted = fake.writes().find((call) => call.op === "insert");
    expect(inserted?.payload).toEqual({
      template_version_id: V2_ID,
      key: "operation_2",
      title: "Operation",
      description: "Day-to-day",
      kind: "narrative",
      sort_order: 14,
    });
    expect(sectionOrder(V2_ID).at(-1)).toBe("operation_2");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/templates/${V2_ID}`);
  });

  it("places a new section after another one, renumbering only what moves", async () => {
    const after = String(section(V2_ID, "other_mentionables").id);
    const result = await addSectionAction({
      versionId: V2_ID,
      title: "Unit economics",
      description: "",
      kind: "custom_numbers",
      afterSectionId: after,
    });
    expect(result.ok).toBe(true);
    expect(sectionOrder(V2_ID).slice(-3)).toEqual(["other_mentionables", "unit_economics", "founder_pulse"]);
    const updates = fake.writes().filter((call) => call.op === "update");
    expect(updates.map((call) => call.payload)).toEqual([{ sort_order: 13 }, { sort_order: 14 }]);
    // At the top:
    await addSectionAction({ versionId: V2_ID, title: "Highlights", description: "", kind: "narrative", afterSectionId: null });
    expect(sectionOrder(V2_ID)[0]).toBe("highlights");
  });

  it("refuses sections of kinds admins cannot add, and changes to published versions", async () => {
    expect(await addSectionAction({ versionId: V2_ID, title: "More money", description: "", kind: "financials" as "narrative" })).toMatchObject({
      ok: false,
      fieldErrors: { kind: "Choose what kind of section this is." },
    });
    expect(await addSectionAction({ versionId: V1_ID, title: "Extra", description: "", kind: "narrative" })).toEqual({
      ok: false,
      error: "Version 1 is published, so it can no longer be changed. Create a new draft instead.",
    });
    expect(fake.writes()).toEqual([]);
  });

  it("renames and re-describes sections, system sections included", async () => {
    const financials = section(V2_ID, "financials");
    const result = await updateSectionAction({ sectionId: String(financials.id), title: "Financial figures", description: "" });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(financials).toMatchObject({ title: "Financial figures", description: null, kind: "financials", key: "financials" });
  });

  it("reports a write the database silently refused (version published meanwhile)", async () => {
    fake.writable = () => false;
    const result = await updateSectionAction({ sectionId: String(section(V2_ID, "operation").id), title: "Ops", description: "" });
    expect(result).toEqual({ ok: false, error: STALE });
  });

  it("deletes non-system sections with their fields", async () => {
    expect(await deleteSectionAction({ sectionId: String(section(V2_ID, "kpis").id) })).toEqual({
      ok: false,
      error: "The “Company KPIs” section is a system section and cannot be deleted.",
    });
    expect(await deleteSectionAction({ sectionId: String(section(V2_ID, "operation").id) })).toEqual({ ok: true, data: undefined });
    expect(sectionOrder(V2_ID)).not.toContain("operation");
    expect(fake.rows("template_fields").some((row) => row.template_version_id === V2_ID && row.key === "team_highlights")).toBe(false);
    // v1 is untouched.
    expect(sectionOrder(V1_ID)).toContain("operation");
  });

  it("moves a section by swapping two sort orders", async () => {
    const operation = String(section(V2_ID, "operation").id);
    expect(await moveSectionAction({ id: operation, direction: "up" })).toEqual({ ok: true, data: undefined });
    expect(sectionOrder(V2_ID).slice(4, 7)).toEqual(["revenue_financial", "operation", "partnerships_market"]);
    expect(fake.writes()).toHaveLength(2);
    // The first section cannot move up: nothing is written.
    const before = fake.writes().length;
    await moveSectionAction({ id: String(section(V2_ID, "financials").id), direction: "up" });
    expect(fake.writes()).toHaveLength(before);
  });
});

describe("fields", () => {
  it("adds a field at the end of its section with its options and limits", async () => {
    const unit = await addSectionAction({ versionId: V2_ID, title: "Unit economics", description: "", kind: "custom_numbers" });
    if (!unit.ok) throw new Error(unit.error);
    const result = await addFieldAction({ sectionId: unit.data.id, ...newField });
    expect(result.ok).toBe(true);
    const insert = fake.writes().filter((call) => call.op === "insert").at(-1);
    expect(insert?.payload).toEqual({
      template_version_id: V2_ID,
      section_id: unit.data.id,
      key: "cac",
      label: "Customer acquisition cost",
      help_text: null,
      field_type: "currency",
      is_required: true,
      is_system: false,
      options: null,
      validation: { allow_negative: false, min: 0, max: 50000 },
      sort_order: 1,
    });

    const pulse = String(section(V2_ID, "founder_pulse").id);
    await addFieldAction({
      sectionId: pulse,
      ...newField,
      label: "Confidence",
      key: "confidence",
      field_type: "rating",
      rating: { min: 0, max: 10, labels: { "0": "None", "10": "Full", "11": "ignored" } },
    });
    expect(field(V2_ID, "confidence")).toMatchObject({
      options: { min: 0, max: 10, labels: { "0": "None", "10": "Full" } },
      validation: null,
      sort_order: 5,
    });
  });

  it("returns field errors for the builder rules", async () => {
    const operation = String(section(V2_ID, "operation").id);
    expect(await addFieldAction({ sectionId: operation, ...newField })).toEqual({
      ok: false,
      error: "Please check the highlighted fields.",
      fieldErrors: { field_type: "Currency fields can't be used in narrative sections." },
    });
    expect(
      await addFieldAction({ sectionId: operation, ...newField, field_type: "long_text", key: "team_highlights" }),
    ).toMatchObject({ fieldErrors: { key: "Another field in this version already uses this key." } });
    expect(await addFieldAction({ sectionId: operation, ...newField, field_type: "long_text", key: "net_profit" })).toMatchObject({
      fieldErrors: { key: "“net_profit” is reserved for a built-in field. Choose another key." },
    });
    expect(await addFieldAction({ sectionId: String(section(V2_ID, "kpis").id), ...newField })).toEqual({
      ok: false,
      error: "Fields can't be added to the “Company KPIs” section.",
    });
    expect(fake.writes()).toEqual([]);
  });

  it("keeps the type of keys used by the published version", async () => {
    // help_needed is deleted from the draft, then re-added with another type under the same key.
    await deleteFieldAction({ fieldId: String(field(V2_ID, "help_needed").id) });
    const pulse = String(section(V2_ID, "founder_pulse").id);
    const result = await addFieldAction({
      sectionId: pulse,
      ...newField,
      label: "Help needed",
      key: "help_needed",
      field_type: "picklist",
      choices: ["Yes", "No"],
    });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        key: "Version 1 used this key for “Help needed from ScaleUp” (long text). Choose another key or use that type.",
      },
    });
    expect(
      await addFieldAction({ sectionId: pulse, ...newField, label: "Help needed", key: "help_needed", field_type: "long_text" }),
    ).toMatchObject({ ok: true });

    const milestones = String(field(V2_ID, "key_milestones").id);
    expect(
      await updateFieldAction({ fieldId: milestones, ...newField, label: "Milestones", key: "key_milestones", field_type: "text" }),
    ).toMatchObject({
      fieldErrors: {
        field_type:
          "Earlier months stored answers to this field as long text, so its type can't change. Add a new field instead.",
      },
    });
    expect(
      await updateFieldAction({ fieldId: milestones, ...newField, label: "Milestones", key: "milestones", field_type: "long_text" }),
    ).toMatchObject({ fieldErrors: { key: "This key can't change: earlier versions stored answers under it." } });
    expect(
      await updateFieldAction({
        fieldId: milestones,
        ...newField,
        label: "Milestones",
        key: "key_milestones",
        field_type: "long_text",
        is_required: true,
        validation: { allow_negative: false, min: null, max: null, max_length: 4000 },
      }),
    ).toEqual({ ok: true, data: undefined });
    expect(field(V2_ID, "key_milestones")).toMatchObject({
      label: "Milestones",
      is_required: true,
      validation: { max_length: 4000 },
      field_type: "long_text",
    });
  });

  it("changes only the label, help text and limits of system fields", async () => {
    const netProfit = field(V2_ID, "net_profit");
    const result = await updateFieldAction({
      fieldId: String(netProfit.id),
      ...newField,
      label: "Net profit after tax",
      key: "renamed",
      field_type: "number",
      is_required: false,
      help_text: "After tax",
      validation: { allow_negative: false, min: null, max: null, max_length: null },
    });
    expect(result).toEqual({ ok: true, data: undefined });
    const update = fake.writes().at(-1);
    expect(update?.payload).toEqual({ label: "Net profit after tax", help_text: "After tax", validation: { allow_negative: false } });
    expect(field(V2_ID, "net_profit")).toMatchObject({ key: "net_profit", field_type: "currency", is_required: true, is_system: true });

    expect(
      await updateFieldAction({
        fieldId: String(field(V2_ID, "cash_in_bank").id),
        ...newField,
        label: "Cash",
        validation: { allow_negative: true, min: -5, max: null, max_length: null },
      }),
    ).toMatchObject({
      fieldErrors: { "validation.min": "The minimum can't be below 0, because negative values aren't allowed." },
    });
  });

  it("never deletes system fields", async () => {
    expect(await deleteFieldAction({ fieldId: String(field(V2_ID, "burn_rate").id) })).toEqual({
      ok: false,
      error: "“Burn rate (per month)” is a system field and cannot be deleted.",
    });
    expect(await deleteFieldAction({ fieldId: String(field(V2_ID, "other_updates").id) })).toEqual({ ok: true, data: undefined });
    expect(await deleteFieldAction({ fieldId: String(field(V1_ID, "other_updates").id) })).toEqual({
      ok: false,
      error: "Version 1 is published, so it can no longer be changed. Create a new draft instead.",
    });
  });

  it("moves fields within their section", async () => {
    const team = String(field(V2_ID, "team_highlights").id);
    expect(await moveFieldAction({ id: team, direction: "up" })).toEqual({ ok: true, data: undefined });
    expect(field(V2_ID, "team_highlights").sort_order).toBe(1);
    expect(field(V2_ID, "operations_highlights").sort_order).toBe(2);
    // Other sections keep their numbering.
    expect(field(V2_ID, "key_milestones").sort_order).toBe(1);
  });
});
