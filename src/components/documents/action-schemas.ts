// Input schemas of the document and period-close Server Actions (src/lib/actions/documents.ts). Kept in a
// plain module (a "use server" file may only export async functions) so they can be unit-tested.

import { z } from "zod";

import { DOCUMENT_MAX_BYTES } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { DOCUMENT_TYPES } from "@/lib/types/enums";

import { ALLOWED_FILE_TYPES_TEXT, cleanDisplayFileName, documentExtension, DOCUMENT_MAX_SIZE_TEXT } from "./document-rules";
import { EDITABLE_FIGURE_KEYS, figureIssue, REASON_MAX_LENGTH, type EditableFigureKey } from "./totals";

export { REASON_MAX_LENGTH };

/** Any 8-4-4-4-12 hex id, normalised to lower case (the form the database and storage paths use). */
const id = (message: string) =>
  z
    .guid({ error: message })
    .transform((value) => value.toLowerCase());

const companyId = id("That company was not found. Please reload the page.");
const closeId = id("That period close was not found. Please reload the page.");

const fileName = z
  .string({ error: "Choose a file to upload." })
  .transform((value) => cleanDisplayFileName(value))
  .refine((value) => value !== "", { error: "Choose a file to upload." })
  .refine((value) => documentExtension(value) !== null, { error: `Upload a ${ALLOWED_FILE_TYPES_TEXT} file.` });

const sizeBytes = z
  .number({ error: "The file size is missing. Please choose the file again." })
  .int()
  .min(1, { error: "This file is empty. Choose another file." })
  .max(DOCUMENT_MAX_BYTES, { error: `Files can be up to ${DOCUMENT_MAX_SIZE_TEXT}.` });

const docType = z.enum(DOCUMENT_TYPES, { error: "Choose the type of document." });

/** prepareDocumentUpload: where the file goes (the path itself is built on the server). */
export const prepareUploadSchema = z.object({
  companyId,
  periodCloseId: closeId.nullable(),
  docType,
  fileName,
  sizeBytes,
});
export type PrepareUploadInput = z.input<typeof prepareUploadSchema>;

/** saveDocument: the uploaded object to record as a `documents` row. */
export const saveDocumentSchema = z.object({
  companyId,
  periodCloseId: closeId.nullable(),
  docType,
  fileName,
  sizeBytes,
  path: z.string().min(1).max(1024),
});
export type SaveDocumentInput = z.input<typeof saveDocumentSchema>;

/** One restated figure: a finite number within the figure's rules (not negative, whole headcounts). */
function figure(key: EditableFigureKey) {
  return z
    .number({ error: "Enter a number." })
    .superRefine((value, ctx) => {
      const issue = figureIssue(key, value);
      if (issue) ctx.addIssue({ code: "custom", message: issue });
    })
    .nullable()
    .optional();
}

const restatedShape = {
  revenue_total: figure("revenue_total"),
  gross_profit: figure("gross_profit"),
  net_profit: figure("net_profit"),
  cash_in_bank: figure("cash_in_bank"),
  avg_burn_rate: figure("avg_burn_rate"),
  headcount_ft: figure("headcount_ft"),
  headcount_pt: figure("headcount_pt"),
} satisfies Record<(typeof EDITABLE_FIGURE_KEYS)[number], unknown>;

/**
 * The figures restated in the confirm dialog (amounts and headcounts; margins are derived on the server).
 * Unknown keys are refused.
 */
export const restatedFiguresSchema = z.strictObject(restatedShape, {
  error: "Only the listed figures can be restated.",
});

const reason = z
  .string()
  .trim()
  .max(REASON_MAX_LENGTH, { error: `Keep the reason under ${formatNumber(REASON_MAX_LENGTH)} characters.` });

/** confirmPeriodClose. The reason is required when something is restated (checked after deriving it). */
export const confirmCloseSchema = z.object({
  companyId,
  closeId,
  restated: restatedFiguresSchema.nullable().optional(),
  reason: reason.optional(),
});
export type ConfirmCloseInput = z.input<typeof confirmCloseSchema>;

/** reopenPeriodClose: the reason is required. */
export const reopenCloseSchema = z.object({
  companyId,
  closeId,
  reason: reason.min(1, { error: "Please give a reason for reopening this period." }),
});
export type ReopenCloseInput = z.input<typeof reopenCloseSchema>;
