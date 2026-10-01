"use server";

// Template builder actions (BRD A3; docs/ARCHITECTURE.md §2.2, §2.4). Super Admins and Fund Admins
// only. Every action re-checks the role, validates its input (zod + the builder rules in
// ./_lib/rules.ts), then writes through the RLS-scoped client: the database re-checks everything
// (RLS, the template guard triggers, create_template_draft / publish_template_version) and audits
// each row change. Rows are always loaded by id, so a version id sent by the browser is never trusted.
// Sections and fields change only while their version is a draft; a published version refuses writes
// (RLS hides its rows from updates), so writes check that a row came back.

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { loadLockedFields } from "./_lib/queries";
import {
  blockingMessage,
  buildFieldOptions,
  buildFieldValidation,
  checkPublishReadiness,
  isSystemSectionKind,
  moveId,
  placeAfter,
  planSortOrders,
  sectionAcceptsFields,
  sortByTemplateOrder,
  suggestSectionKey,
  validateFieldDraft,
  type FieldDraft,
  type FieldErrors,
} from "./_lib/rules";
import {
  addFieldSchema,
  addSectionSchema,
  fieldIdSchema,
  moveSchema,
  publishSchema,
  sectionIdSchema,
  templateIdSchema,
  updateFieldSchema,
  updateSectionSchema,
  versionIdSchema,
  type AddFieldInput,
  type AddSectionInput,
  type FieldIdInput,
  type MoveInput,
  type PublishInput,
  type SectionIdInput,
  type TemplateIdInput,
  type UpdateFieldInput,
  type UpdateSectionInput,
  type VersionIdInput,
} from "./_lib/schemas";
import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { assertScaleUp } from "@/lib/auth/session";
import { getTemplateVersion } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { TemplateFieldRow, TemplateSectionRow, TemplateVersionRow } from "@/lib/types/domain";

type Sb = SupabaseClient<Database>;

/** Who may edit templates (docs/ARCHITECTURE.md §1: canManageTemplates). */
const TEMPLATE_MANAGERS = ["super_admin", "fund_admin"] as const;

const STALE_MESSAGE =
  "That change could not be saved: the draft may have been published or discarded in the meantime. Please reload the page.";
const KEY_TAKEN_MESSAGE = "Another field in this version already uses this key.";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type VersionRef = Pick<TemplateVersionRow, "id" | "template_id" | "version_no" | "status">;
type SectionRef = Pick<TemplateSectionRow, "id" | "template_version_id" | "key" | "title" | "kind" | "sort_order">;
type FieldRef = Pick<
  TemplateFieldRow,
  "id" | "template_version_id" | "section_id" | "key" | "label" | "field_type" | "is_system" | "sort_order"
>;
type OrderRow = { id: string; key: string; sort_order: number };

/** The version, which must still be a draft. */
async function requireDraft(sb: Sb, versionId: string): Promise<VersionRef> {
  const { data, error } = await sb
    .from("template_versions")
    .select("id, template_id, version_no, status")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  const version: VersionRef | null = data;
  if (!version) throw new ActionError(MESSAGES.notFound);
  if (version.status !== "draft") {
    throw new ActionError(
      `Version ${version.version_no} is ${version.status}, so it can no longer be changed. Create a new draft instead.`,
    );
  }
  return version;
}

async function loadSection(sb: Sb, sectionId: string): Promise<SectionRef> {
  const { data, error } = await sb
    .from("template_sections")
    .select("id, template_version_id, key, title, kind, sort_order")
    .eq("id", sectionId)
    .maybeSingle();
  if (error) throw error;
  const section: SectionRef | null = data;
  if (!section) throw new ActionError(MESSAGES.notFound);
  return section;
}

async function loadField(sb: Sb, fieldId: string): Promise<FieldRef> {
  const { data, error } = await sb
    .from("template_fields")
    .select("id, template_version_id, section_id, key, label, field_type, is_system, sort_order")
    .eq("id", fieldId)
    .maybeSingle();
  if (error) throw error;
  const field: FieldRef | null = data;
  if (!field) throw new ActionError(MESSAGES.notFound);
  return field;
}

async function loadSectionOrder(sb: Sb, versionId: string): Promise<OrderRow[]> {
  const { data, error } = await sb
    .from("template_sections")
    .select("id, key, sort_order")
    .eq("template_version_id", versionId);
  if (error) throw error;
  const rows: OrderRow[] = data ?? [];
  return sortByTemplateOrder(rows);
}

async function loadVersionFields(
  sb: Sb,
  versionId: string,
): Promise<{ id: string; key: string; section_id: string; sort_order: number }[]> {
  const { data, error } = await sb
    .from("template_fields")
    .select("id, key, section_id, sort_order")
    .eq("template_version_id", versionId);
  if (error) throw error;
  const rows: { id: string; key: string; section_id: string; sort_order: number }[] = data ?? [];
  return rows;
}

/** Throws a STALE error unless the write returned a row (RLS hides rows of versions that are no longer drafts). */
function expectRow(data: { id: string }[] | null): void {
  if (!data || data.length === 0) throw new ActionError(STALE_MESSAGE);
}

async function applySectionOrder(sb: Sb, versionId: string, updates: { id: string; sort_order: number }[]) {
  const results = await Promise.all(
    updates.map((update) =>
      sb
        .from("template_sections")
        .update({ sort_order: update.sort_order })
        .eq("id", update.id)
        .eq("template_version_id", versionId)
        .select("id"),
    ),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    expectRow(data);
  }
}

async function applyFieldOrder(sb: Sb, versionId: string, updates: { id: string; sort_order: number }[]) {
  const results = await Promise.all(
    updates.map((update) =>
      sb
        .from("template_fields")
        .update({ sort_order: update.sort_order })
        .eq("id", update.id)
        .eq("template_version_id", versionId)
        .select("id"),
    ),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    expectRow(data);
  }
}

function fieldErrorsOrNull(errors: FieldErrors): Record<string, string> | null {
  const entries = Object.entries(errors).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function revalidateTemplates(versionId?: string) {
  revalidatePath("/admin/templates");
  if (versionId) revalidatePath(`/admin/templates/${versionId}`);
}

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

/**
 * Starts a draft of a template: a copy of its published version (create_template_draft), or its
 * existing draft when there is one. Returns the draft's id.
 */
export async function createDraftAction(input: TemplateIdInput): Promise<ActionResult<{ versionId: string }>> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { templateId } = templateIdSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb.rpc("create_template_draft", { p_template_id: templateId });
    if (error) throw error;
    if (!data) throw new ActionError(MESSAGES.generic);
    revalidateTemplates(data);
    return ok({ versionId: data });
  } catch (e) {
    return toActionError(e);
  }
}

/** Deletes a draft with its sections and fields. Published and archived versions stay (database rule). */
export async function discardDraftAction(input: VersionIdInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { versionId } = versionIdSchema.parse(input);
    const sb = await createClient();
    await requireDraft(sb, versionId);
    const { data, error } = await sb
      .from("template_versions")
      .delete()
      .eq("id", versionId)
      .eq("status", "draft")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new ActionError("This draft could not be discarded: it may have been published or discarded in the meantime.");
    }
    revalidateTemplates();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Publishes a draft with its release notes (publish_template_version): months opened from now on use
 * it, months already opened keep their version, and the previous published version is archived.
 */
export async function publishVersionAction(input: PublishInput): Promise<ActionResult<{ versionNo: number }>> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { versionId, notes } = publishSchema.parse(input);
    const sb = await createClient();
    const version = await getTemplateVersion(sb, versionId);
    if (version.status !== "draft") {
      throw new ActionError(`Only drafts can be published. Version ${version.version_no} is ${version.status}.`);
    }
    const blocking = blockingMessage(checkPublishReadiness(version));
    if (blocking) throw new ActionError(blocking);

    const { data: noted, error: notesError } = await sb
      .from("template_versions")
      .update({ notes })
      .eq("id", versionId)
      .eq("status", "draft")
      .select("id");
    if (notesError) throw notesError;
    expectRow(noted);

    const { error } = await sb.rpc("publish_template_version", { p_version_id: versionId });
    if (error) throw error;
    revalidateTemplates(versionId);
    return ok({ versionNo: version.version_no });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Makes a template the default one (new months open with its published version). One update: the
 * database switches the previous default off in the same statement and refuses a template without a
 * published version.
 */
export async function setDefaultTemplateAction(input: TemplateIdInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { templateId } = templateIdSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb.from("templates").update({ is_default: true }).eq("id", templateId).select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new ActionError(MESSAGES.notFound);
    revalidateTemplates();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/** Adds a narrative, additional-numbers or founder-pulse section (key from the title, unique in the version). */
export async function addSectionAction(input: AddSectionInput): Promise<ActionResult<{ id: string }>> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const parsed = addSectionSchema.parse(input);
    const sb = await createClient();
    const version = await requireDraft(sb, parsed.versionId);
    const sections = await loadSectionOrder(sb, version.id);
    const sortOrder = Math.max(0, ...sections.map((section) => section.sort_order)) + 1;

    const { data, error } = await sb
      .from("template_sections")
      .insert({
        template_version_id: version.id,
        key: suggestSectionKey(parsed.title, sections.map((section) => section.key)),
        title: parsed.title,
        description: parsed.description,
        kind: parsed.kind,
        sort_order: sortOrder,
      })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new ActionError("A section was just added with the same title. Please reload the page.");
      throw error;
    }

    if (parsed.afterSectionId !== undefined) {
      const ordered = [...sections.map((section) => section.id), data.id];
      const desired = placeAfter(ordered, data.id, parsed.afterSectionId);
      await applySectionOrder(
        sb,
        version.id,
        planSortOrders([...sections, { id: data.id, sort_order: sortOrder }], desired),
      );
    }
    revalidateTemplates(version.id);
    return ok({ id: data.id });
  } catch (e) {
    return toActionError(e);
  }
}

/** Renames a section and sets its description (system sections too; their kind never changes). */
export async function updateSectionAction(input: UpdateSectionInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const parsed = updateSectionSchema.parse(input);
    const sb = await createClient();
    const section = await loadSection(sb, parsed.sectionId);
    const version = await requireDraft(sb, section.template_version_id);
    const { data, error } = await sb
      .from("template_sections")
      .update({ title: parsed.title, description: parsed.description })
      .eq("id", section.id)
      .eq("template_version_id", version.id)
      .select("id");
    if (error) throw error;
    expectRow(data);
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Deletes a non-system section and its fields. */
export async function deleteSectionAction(input: SectionIdInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { sectionId } = sectionIdSchema.parse(input);
    const sb = await createClient();
    const section = await loadSection(sb, sectionId);
    if (isSystemSectionKind(section.kind)) {
      throw new ActionError(`The “${section.title}” section is a system section and cannot be deleted.`);
    }
    const version = await requireDraft(sb, section.template_version_id);
    const { data, error } = await sb
      .from("template_sections")
      .delete()
      .eq("id", section.id)
      .eq("template_version_id", version.id)
      .select("id");
    if (error) throw error;
    expectRow(data);
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Moves a section one place up or down (sort orders renumbered 1…n where needed). */
export async function moveSectionAction(input: MoveInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { id, direction } = moveSchema.parse(input);
    const sb = await createClient();
    const section = await loadSection(sb, id);
    const version = await requireDraft(sb, section.template_version_id);
    const sections = await loadSectionOrder(sb, version.id);
    const desired = moveId(
      sections.map((row) => row.id),
      section.id,
      direction,
    );
    if (desired) await applySectionOrder(sb, version.id, planSortOrders(sections, desired));
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

function toFieldDraft(parsed: FieldDraft): FieldDraft {
  return {
    label: parsed.label,
    key: parsed.key,
    field_type: parsed.field_type,
    is_required: parsed.is_required,
    help_text: parsed.help_text,
    choices: parsed.choices,
    rating: parsed.rating,
    validation: parsed.validation,
  };
}

/** Adds a field at the end of a narrative, additional-numbers or founder-pulse section. */
export async function addFieldAction(input: AddFieldInput): Promise<ActionResult<{ id: string }>> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { sectionId, ...rest } = addFieldSchema.parse(input);
    const draft = toFieldDraft(rest);
    const sb = await createClient();
    const section = await loadSection(sb, sectionId);
    const version = await requireDraft(sb, section.template_version_id);
    if (!sectionAcceptsFields(section.kind)) {
      throw new ActionError(`Fields can't be added to the “${section.title}” section.`);
    }
    const [fields, lockedFields] = await Promise.all([
      loadVersionFields(sb, version.id),
      loadLockedFields(sb, version.template_id),
    ]);
    const errors = fieldErrorsOrNull(
      validateFieldDraft(draft, {
        sectionKind: section.kind,
        otherKeys: fields.map((field) => field.key),
        lockedFields,
        existing: null,
      }),
    );
    if (errors) throw new ActionError(MESSAGES.invalid, errors);

    const sortOrder =
      Math.max(0, ...fields.filter((field) => field.section_id === section.id).map((field) => field.sort_order)) + 1;
    const { data, error } = await sb
      .from("template_fields")
      .insert({
        template_version_id: version.id,
        section_id: section.id,
        key: draft.key,
        label: draft.label,
        help_text: draft.help_text === "" ? null : draft.help_text,
        field_type: draft.field_type,
        is_required: draft.is_required,
        is_system: false,
        options: buildFieldOptions(draft.field_type, draft),
        validation: buildFieldValidation(draft.key, draft.field_type, draft.validation),
        sort_order: sortOrder,
      })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new ActionError(MESSAGES.invalid, { key: KEY_TAKEN_MESSAGE });
      throw error;
    }
    revalidateTemplates(version.id);
    return ok({ id: data.id });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Saves a field. System fields take only a new label, help text and number limits; other fields also
 * their key and type (unless earlier versions used the key), "required" flag, options and limits.
 */
export async function updateFieldAction(input: UpdateFieldInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { fieldId, ...rest } = updateFieldSchema.parse(input);
    const draft = toFieldDraft(rest);
    const sb = await createClient();
    const field = await loadField(sb, fieldId);
    const version = await requireDraft(sb, field.template_version_id);
    const section = await loadSection(sb, field.section_id);

    let update: Database["public"]["Tables"]["template_fields"]["Update"];
    if (field.is_system) {
      const errors = fieldErrorsOrNull(
        validateFieldDraft(draft, { sectionKind: section.kind, otherKeys: [], lockedFields: {}, existing: field }),
      );
      if (errors) throw new ActionError(MESSAGES.invalid, errors);
      update = {
        label: draft.label,
        help_text: draft.help_text === "" ? null : draft.help_text,
        validation: buildFieldValidation(field.key, field.field_type, draft.validation),
      };
    } else {
      const [fields, lockedFields] = await Promise.all([
        loadVersionFields(sb, version.id),
        loadLockedFields(sb, version.template_id),
      ]);
      const errors = fieldErrorsOrNull(
        validateFieldDraft(draft, {
          sectionKind: section.kind,
          otherKeys: fields.filter((other) => other.id !== field.id).map((other) => other.key),
          lockedFields,
          existing: field,
        }),
      );
      if (errors) throw new ActionError(MESSAGES.invalid, errors);
      update = {
        key: draft.key,
        label: draft.label,
        help_text: draft.help_text === "" ? null : draft.help_text,
        field_type: draft.field_type,
        is_required: draft.is_required,
        options: buildFieldOptions(draft.field_type, draft),
        validation: buildFieldValidation(draft.key, draft.field_type, draft.validation),
      };
    }

    const { data, error } = await sb
      .from("template_fields")
      .update(update)
      .eq("id", field.id)
      .eq("template_version_id", version.id)
      .select("id");
    if (error) {
      if (isUniqueViolation(error)) throw new ActionError(MESSAGES.invalid, { key: KEY_TAKEN_MESSAGE });
      throw error;
    }
    expectRow(data);
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Deletes a non-system field. */
export async function deleteFieldAction(input: FieldIdInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { fieldId } = fieldIdSchema.parse(input);
    const sb = await createClient();
    const field = await loadField(sb, fieldId);
    if (field.is_system) throw new ActionError(`“${field.label}” is a system field and cannot be deleted.`);
    const version = await requireDraft(sb, field.template_version_id);
    const { data, error } = await sb
      .from("template_fields")
      .delete()
      .eq("id", field.id)
      .eq("template_version_id", version.id)
      .select("id");
    if (error) throw error;
    expectRow(data);
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Moves a field one place up or down within its section. */
export async function moveFieldAction(input: MoveInput): Promise<ActionResult> {
  try {
    await assertScaleUp(TEMPLATE_MANAGERS);
    const { id, direction } = moveSchema.parse(input);
    const sb = await createClient();
    const field = await loadField(sb, id);
    const version = await requireDraft(sb, field.template_version_id);
    const fields = sortByTemplateOrder(
      (await loadVersionFields(sb, version.id)).filter((row) => row.section_id === field.section_id),
    );
    const desired = moveId(
      fields.map((row) => row.id),
      field.id,
      direction,
    );
    if (desired) await applyFieldOrder(sb, version.id, planSortOrders(fields, desired));
    revalidateTemplates(version.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
