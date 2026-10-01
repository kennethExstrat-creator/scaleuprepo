import { describe, expect, it } from "vitest";

import {
  ALLOWED_FILE_TYPES_TEXT,
  buildDocumentPath,
  checkDocumentFile,
  cleanDisplayFileName,
  DOCUMENT_EXTENSION_MIME,
  documentExtension,
  documentMimeType,
  FILE_NAME_MAX_LENGTH,
  isDocumentPathFor,
  rawExtension,
  safeDownloadName,
  storageErrorMessage,
  storageSafeFileName,
} from "@/components/documents/document-rules";
import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES } from "@/lib/constants";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const CLOSE = "d0000000-0000-4000-8000-00000000000a";
const OBJECT = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

// private.is_document_path() (supabase/migrations/20260930000200_helpers.sql), in JavaScript.
const DB_DOCUMENT_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(general|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/\u0000-\u001f\u007f]+$/;
// Supabase Storage's object key rule (storage-api isValidKey).
const STORAGE_KEY_RE = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

function dbAccepts(path: string): boolean {
  const name = path.split("/")[2];
  return DB_DOCUMENT_PATH_RE.test(path) && name !== "." && name !== "..";
}

describe("allowed file types", () => {
  it("covers exactly the extensions and MIME types of the bucket", () => {
    const accept = DOCUMENT_ACCEPT.split(",").map((ext) => ext.replace(/^\./, ""));
    expect(Object.keys(DOCUMENT_EXTENSION_MIME).sort()).toEqual([...accept].sort());
    expect(Object.values(DOCUMENT_EXTENSION_MIME).sort()).toEqual([...DOCUMENT_MIME_TYPES].sort());
  });

  it("reads extensions case-insensitively", () => {
    expect(rawExtension("Q3 Accounts.PDF")).toBe("pdf");
    expect(rawExtension("archive.tar.gz")).toBe("gz");
    expect(rawExtension("README")).toBeNull();
    expect(documentExtension("Board pack.XLSX")).toBe("xlsx");
    expect(documentExtension("photo.png")).toBeNull();
    expect(documentMimeType("data.csv")).toBe("text/csv");
    expect(documentMimeType("old.xls")).toBe("application/vnd.ms-excel");
    expect(documentMimeType("notes.txt")).toBeNull();
  });
});

describe("checkDocumentFile", () => {
  it("accepts allowed files up to 25 MB", () => {
    expect(checkDocumentFile({ name: "accounts.pdf", size: 1024 })).toBeNull();
    expect(checkDocumentFile({ name: "accounts.pdf", size: DOCUMENT_MAX_BYTES })).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(checkDocumentFile(null)).toBe("Choose a file to upload.");
    expect(checkDocumentFile({ name: "   ", size: 10 })).toBe("Choose a file to upload.");
    expect(checkDocumentFile({ name: "photo.jpg", size: 10 })).toBe(`Upload a ${ALLOWED_FILE_TYPES_TEXT} file.`);
    expect(checkDocumentFile({ name: "empty.pdf", size: 0 })).toBe("This file is empty. Choose another file.");
    expect(checkDocumentFile({ name: "big.pdf", size: DOCUMENT_MAX_BYTES + 1 })).toBe(
      "This file is 25 MB. Files can be up to 25 MB.",
    );
    expect(checkDocumentFile({ name: "huge.pdf", size: 40 * 1024 * 1024 })).toBe(
      "This file is 40 MB. Files can be up to 25 MB.",
    );
  });
});

describe("cleanDisplayFileName", () => {
  it("keeps the last path segment without control characters", () => {
    expect(cleanDisplayFileName("C:\\Users\\me\\Q3 accounts.pdf")).toBe("Q3 accounts.pdf");
    expect(cleanDisplayFileName("  folder/Q3\u0000  accounts\t.pdf ")).toBe("Q3 accounts .pdf");
  });

  it("shortens long names to 255 characters and keeps the extension", () => {
    const long = `${"a".repeat(300)}.xlsx`;
    const clean = cleanDisplayFileName(long);
    expect(clean).toHaveLength(FILE_NAME_MAX_LENGTH);
    expect(clean.endsWith(".xlsx")).toBe(true);
  });
});

describe("storageSafeFileName", () => {
  it("keeps only characters Storage accepts", () => {
    expect(storageSafeFileName("Q3 Accounts (final).PDF")).toBe("Q3-Accounts-final.pdf");
    expect(storageSafeFileName("Relatório de gestão.xlsx")).toBe("Relatorio-de-gestao.xlsx");
    expect(storageSafeFileName("管理账目.pdf")).toBe("document.pdf");
    expect(storageSafeFileName("...hidden.csv")).toBe("hidden.csv");
    expect(storageSafeFileName("a__b--c..d.docx")).toBe("a__b-c..d.docx");
  });

  it("limits the length", () => {
    const safe = storageSafeFileName(`${"x".repeat(250)}.pdf`);
    expect(safe).toBe(`${"x".repeat(100)}.pdf`);
  });
});

describe("buildDocumentPath", () => {
  it("builds the exact path the database requires, with lower-case ids", () => {
    const path = buildDocumentPath(COMPANY.toUpperCase(), CLOSE.toUpperCase(), OBJECT.toUpperCase(), "Q3 accounts.pdf");
    expect(path).toBe(`${COMPANY}/${CLOSE}/${OBJECT}-Q3-accounts.pdf`);
    expect(dbAccepts(path)).toBe(true);
    expect(STORAGE_KEY_RE.test(path)).toBe(true);
  });

  it("uses the general folder for documents without a close", () => {
    const path = buildDocumentPath(COMPANY, null, OBJECT, "Board pack Oct.docx");
    expect(path).toBe(`${COMPANY}/general/${OBJECT}-Board-pack-Oct.docx`);
    expect(dbAccepts(path)).toBe(true);
  });

  it("always produces a valid key, whatever the file name", () => {
    for (const name of ["..", ".", "管理.pdf", "a/b\\c.pdf", "x".repeat(400), "  "]) {
      const path = buildDocumentPath(COMPANY, CLOSE, OBJECT, name);
      expect(dbAccepts(path)).toBe(true);
      expect(STORAGE_KEY_RE.test(path)).toBe(true);
      expect(isDocumentPathFor(path, COMPANY, CLOSE)).toBe(true);
    }
  });

  it("refuses ids that are not UUIDs", () => {
    expect(() => buildDocumentPath("../etc", CLOSE, OBJECT, "a.pdf")).toThrow(RangeError);
    expect(() => buildDocumentPath(COMPANY, "general", OBJECT, "a.pdf")).toThrow(RangeError);
    expect(() => buildDocumentPath(COMPANY, CLOSE, "not-a-uuid", "a.pdf")).toThrow(RangeError);
  });
});

describe("isDocumentPathFor", () => {
  const path = `${COMPANY}/${CLOSE}/${OBJECT}-accounts.pdf`;

  it("accepts the company's own path for the close", () => {
    expect(isDocumentPathFor(path, COMPANY, CLOSE)).toBe(true);
    expect(isDocumentPathFor(path, COMPANY.toUpperCase(), CLOSE.toUpperCase())).toBe(true);
  });

  it("refuses other companies, other folders and odd names", () => {
    const other = "c0000000-0000-4000-8000-000000000002";
    expect(isDocumentPathFor(path, other, CLOSE)).toBe(false);
    expect(isDocumentPathFor(path, COMPANY, null)).toBe(false);
    expect(isDocumentPathFor(`${COMPANY}/general/${OBJECT}-a.pdf`, COMPANY, null)).toBe(true);
    expect(isDocumentPathFor(`${COMPANY}/${CLOSE}/accounts.pdf`, COMPANY, CLOSE)).toBe(false);
    expect(isDocumentPathFor(`${COMPANY}/${CLOSE}/${OBJECT}-a b.pdf`, COMPANY, CLOSE)).toBe(false);
    expect(isDocumentPathFor(`${COMPANY}/${CLOSE}/${OBJECT}-a/b.pdf`, COMPANY, CLOSE)).toBe(false);
    expect(isDocumentPathFor(path, "general", CLOSE)).toBe(false);
  });
});

describe("safeDownloadName", () => {
  it("keeps readable names and drops characters that would be double-encoded", () => {
    expect(safeDownloadName("Q3 accounts.pdf")).toBe("Q3 accounts.pdf");
    expect(safeDownloadName("Relatório (final) #2.PDF")).toBe("Relatorio final 2.pdf");
    expect(safeDownloadName("管理账目.xlsx")).toBe("document.xlsx");
    expect(safeDownloadName("report_v2-final.csv")).toBe("report_v2-final.csv");
  });
});

describe("storageErrorMessage", () => {
  it("maps Storage errors to friendly wording", () => {
    expect(storageErrorMessage({ status: 413, message: "Payload too large" })).toBe(
      "The file is too large. Files can be up to 25 MB.",
    );
    expect(storageErrorMessage({ status: 400, message: "mime type image/png is not supported" })).toBe(
      `This type of file isn't allowed. Upload a ${ALLOWED_FILE_TYPES_TEXT} file.`,
    );
    expect(storageErrorMessage({ status: 400, statusCode: "403", message: "new row violates row-level security policy" })).toBe(
      "You don't have permission to do that.",
    );
    expect(storageErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Couldn't reach the file storage. Check your connection and try again.",
    );
    expect(storageErrorMessage({ status: 404, message: "Object not found" })).toBe("The file could not be found in storage.");
  });

  it("falls back to the given message", () => {
    expect(storageErrorMessage({ status: 400, message: "jwt expired" })).toBe(
      "The file couldn't be uploaded. Please try again.",
    );
    expect(storageErrorMessage(null, "Nope.")).toBe("Nope.");
  });
});
