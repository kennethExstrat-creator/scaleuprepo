// Input schemas of the template builder's Server Actions (../actions.ts). Client-safe, so the dialogs
// share the input types. Shape and size only: the builder's rules (types per section kind, keys,
// options, limits) are checked by validateFieldDraft in ./rules.ts, and the database has the last word.
import { z } from "zod";

import {
  ADDABLE_SECTION_KINDS,
  MAX_CHOICES,
  MAX_CHOICE_LENGTH,
  MAX_HELP_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_RATING_LABEL_LENGTH,
  MAX_SECTION_DESCRIPTION_LENGTH,
  MAX_SECTION_TITLE_LENGTH,
} from "./rules";
import { FIELD_TYPES } from "@/lib/types/enums";

/** Any 8-4-4-4-12 hex id (as `isUuid` in src/lib/auth/session.ts); the database checks the rest. */
const id = z.guid({ error: "This item could not be identified. Please reload the page." });

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .transform((value) => (value === "" ? null : value));

export const templateIdSchema = z.object({ templateId: id });
export type TemplateIdInput = z.input<typeof templateIdSchema>;

export const versionIdSchema = z.object({ versionId: id });
export type VersionIdInput = z.input<typeof versionIdSchema>;

export const publishSchema = z.object({
  versionId: id,
  notes: z
    .string()
    .trim()
    .min(1, { error: "Add release notes: what changed in this version?" })
    .max(MAX_NOTES_LENGTH, { error: `Keep the release notes to ${MAX_NOTES_LENGTH} characters or fewer.` }),
});
export type PublishInput = z.input<typeof publishSchema>;

const sectionTitle = z
  .string()
  .trim()
  .min(1, { error: "Enter a title." })
  .max(MAX_SECTION_TITLE_LENGTH, { error: `Keep the title to ${MAX_SECTION_TITLE_LENGTH} characters or fewer.` });

const sectionDescription = optionalText(
  MAX_SECTION_DESCRIPTION_LENGTH,
  `Keep the description to ${MAX_SECTION_DESCRIPTION_LENGTH} characters or fewer.`,
);

export const addSectionSchema = z.object({
  versionId: id,
  title: sectionTitle,
  description: sectionDescription,
  kind: z.enum(ADDABLE_SECTION_KINDS, { error: "Choose what kind of section this is." }),
  /** Place the new section after this one; null = at the top; omitted = at the end. */
  afterSectionId: id.nullable().optional(),
});
export type AddSectionInput = z.input<typeof addSectionSchema>;

export const updateSectionSchema = z.object({
  sectionId: id,
  title: sectionTitle,
  description: sectionDescription,
});
export type UpdateSectionInput = z.input<typeof updateSectionSchema>;

export const sectionIdSchema = z.object({ sectionId: id });
export type SectionIdInput = z.input<typeof sectionIdSchema>;

export const fieldIdSchema = z.object({ fieldId: id });
export type FieldIdInput = z.input<typeof fieldIdSchema>;

export const moveSchema = z.object({ id, direction: z.enum(["up", "down"]) });
export type MoveInput = z.input<typeof moveSchema>;

const optionalNumber = z.number({ error: "Enter a number." }).nullable();

/** A field as the field dialog sends it (see FieldDraft in ./rules.ts). */
export const fieldDraftSchema = z.object({
  label: z.string().trim().max(MAX_LABEL_LENGTH, { error: `Keep the label to ${MAX_LABEL_LENGTH} characters or fewer.` }),
  key: z.string().trim().max(200, { error: "Keys can be at most 63 characters." }),
  field_type: z.enum(FIELD_TYPES, { error: "Choose a field type." }),
  is_required: z.boolean(),
  help_text: z.string().trim().max(MAX_HELP_LENGTH, { error: `Keep the help text to ${MAX_HELP_LENGTH} characters or fewer.` }),
  choices: z
    .array(z.string().trim().max(MAX_CHOICE_LENGTH, { error: `Keep each option to ${MAX_CHOICE_LENGTH} characters or fewer.` }))
    .max(MAX_CHOICES, { error: `Use at most ${MAX_CHOICES} options.` })
    .transform((choices) => choices.filter((choice) => choice !== "")),
  rating: z
    .object({
      min: z.number({ error: "Enter a whole number." }),
      max: z.number({ error: "Enter a whole number." }),
      labels: z.record(
        z.string().regex(/^\d{1,2}$/),
        z.string().trim().max(MAX_RATING_LABEL_LENGTH, { error: `Keep each label to ${MAX_RATING_LABEL_LENGTH} characters or fewer.` }),
      ),
    })
    .nullable(),
  validation: z.object({
    allow_negative: z.boolean(),
    min: optionalNumber,
    max: optionalNumber,
    max_length: optionalNumber,
  }),
});
export type FieldDraftInput = z.input<typeof fieldDraftSchema>;

// Flat, so validation errors are keyed like the dialog's inputs ("label", "validation.min", …).
export const addFieldSchema = fieldDraftSchema.extend({ sectionId: id });
export type AddFieldInput = z.input<typeof addFieldSchema>;

export const updateFieldSchema = fieldDraftSchema.extend({ fieldId: id });
export type UpdateFieldInput = z.input<typeof updateFieldSchema>;
