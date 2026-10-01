import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  confirmCloseSchema,
  prepareUploadSchema,
  REASON_MAX_LENGTH,
  reopenCloseSchema,
  saveDocumentSchema,
} from "@/components/documents/action-schemas";
import { toActionError } from "@/lib/actions/result";
import { DOCUMENT_MAX_BYTES } from "@/lib/constants";

const COMPANY = "C0000000-0000-4000-8000-000000000001";
const CLOSE = "d0000000-0000-4000-8000-00000000000a";

/** The field errors a Server Action returns for this input (toActionError on the ZodError). */
function fieldErrors(schema: z.ZodType, input: unknown): Record<string, string> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  const failure = toActionError(result.error);
  return failure.ok ? undefined : failure.fieldErrors;
}

describe("prepareUploadSchema", () => {
  const valid = { companyId: COMPANY, periodCloseId: CLOSE, docType: "management_accounts", fileName: " Q3 accounts.PDF ", sizeBytes: 2048 };

  it("normalises ids to lower case and cleans the file name", () => {
    expect(prepareUploadSchema.parse(valid)).toEqual({
      companyId: COMPANY.toLowerCase(),
      periodCloseId: CLOSE,
      docType: "management_accounts",
      fileName: "Q3 accounts.PDF",
      sizeBytes: 2048,
    });
    expect(prepareUploadSchema.parse({ ...valid, periodCloseId: null, docType: "supporting" }).periodCloseId).toBeNull();
  });

  it("refuses bad ids, types, sizes and file types with friendly messages", () => {
    expect(fieldErrors(prepareUploadSchema, { ...valid, companyId: "../x" })).toEqual({
      companyId: "That company was not found. Please reload the page.",
    });
    expect(fieldErrors(prepareUploadSchema, { ...valid, docType: "invoice" })).toEqual({ docType: "Choose the type of document." });
    expect(fieldErrors(prepareUploadSchema, { ...valid, fileName: "photo.png" })).toEqual({
      fileName: "Upload a PDF, Excel (XLSX or XLS), CSV or Word (DOCX) file.",
    });
    expect(fieldErrors(prepareUploadSchema, { ...valid, fileName: "   " })).toMatchObject({ fileName: "Choose a file to upload." });
    expect(fieldErrors(prepareUploadSchema, { ...valid, sizeBytes: 0 })).toEqual({ sizeBytes: "This file is empty. Choose another file." });
    expect(fieldErrors(prepareUploadSchema, { ...valid, sizeBytes: DOCUMENT_MAX_BYTES + 1 })).toEqual({
      sizeBytes: "Files can be up to 25 MB.",
    });
  });
});

describe("saveDocumentSchema", () => {
  it("needs the uploaded path", () => {
    const input = { companyId: COMPANY, periodCloseId: null, docType: "supporting", fileName: "pack.docx", sizeBytes: 10 };
    expect(saveDocumentSchema.safeParse(input).success).toBe(false);
    expect(saveDocumentSchema.parse({ ...input, path: "x/general/y-pack.docx" }).path).toBe("x/general/y-pack.docx");
  });
});

describe("confirmCloseSchema", () => {
  it("accepts no restatement, or restated figures within their rules", () => {
    expect(confirmCloseSchema.parse({ companyId: COMPANY, closeId: CLOSE })).toEqual({
      companyId: COMPANY.toLowerCase(),
      closeId: CLOSE,
    });
    expect(
      confirmCloseSchema.parse({
        companyId: COMPANY,
        closeId: CLOSE,
        restated: { revenue_total: 610, net_profit: -20, headcount_ft: 12, cash_in_bank: null },
        reason: "  Accrual  ",
      }),
    ).toMatchObject({ restated: { revenue_total: 610, net_profit: -20, headcount_ft: 12, cash_in_bank: null }, reason: "Accrual" });
  });

  it("refuses unknown or derived figures and invalid values", () => {
    const base = { companyId: COMPANY, closeId: CLOSE, reason: "x" };
    expect(confirmCloseSchema.safeParse({ ...base, restated: { gp_pct: 50 } }).success).toBe(false);
    expect(confirmCloseSchema.safeParse({ ...base, restated: { bogus: 1 } }).success).toBe(false);
    expect(fieldErrors(confirmCloseSchema, { ...base, restated: { revenue_total: -1 } })).toEqual({
      "restated.revenue_total": "Revenue cannot be negative.",
    });
    expect(fieldErrors(confirmCloseSchema, { ...base, restated: { headcount_pt: 2.5 } })).toEqual({
      "restated.headcount_pt": "Part-time headcount must be a whole number.",
    });
    expect(fieldErrors(confirmCloseSchema, { ...base, restated: { revenue_total: "610" } })).toEqual({
      "restated.revenue_total": "Enter a number.",
    });
    expect(fieldErrors(confirmCloseSchema, { ...base, reason: "x".repeat(REASON_MAX_LENGTH + 1) })).toEqual({
      reason: "Keep the reason under 2,000 characters.",
    });
  });
});

describe("reopenCloseSchema", () => {
  it("needs a reason", () => {
    expect(fieldErrors(reopenCloseSchema, { companyId: COMPANY, closeId: CLOSE, reason: "   " })).toEqual({
      reason: "Please give a reason for reopening this period.",
    });
    expect(reopenCloseSchema.parse({ companyId: COMPANY, closeId: CLOSE, reason: " Audit adjustment " }).reason).toBe(
      "Audit adjustment",
    );
  });
});
