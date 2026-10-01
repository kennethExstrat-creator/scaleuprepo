import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DOCUMENT_PACK_MAX_BYTES, documentPackTooLargeMessage } from "@/lib/exports/document-pack-limits";
import {
  buildDocumentPackZip,
  documentPackFileName,
  documentPackManifest,
  planDocumentPack,
  safePathSegment,
  shouldCompress,
  uploaderName,
  zipToStream,
  type PackClose,
  type PackDocument,
} from "@/lib/exports/documents-zip";

const Q3 = "p0000000-0000-4000-8000-000000000003".replace("p", "a");
const H2 = "a0000000-0000-4000-8000-000000000012";
const Q4 = "a0000000-0000-4000-8000-000000000004";

const CLOSES: PackClose[] = [
  { id: H2, label: "H2 2026", period_start: "2026-07-01", period_end: "2026-12-31", period_type: "half" },
  { id: Q4, label: "Q4 2026", period_start: "2026-10-01", period_end: "2026-12-31", period_type: "quarter" },
  { id: Q3, label: "Q3 2026", period_start: "2026-07-01", period_end: "2026-09-30", period_type: "quarter" },
];

function doc(id: string, overrides: Partial<PackDocument> = {}): PackDocument {
  return {
    id,
    period_close_id: Q3,
    doc_type: "management_accounts",
    file_name: "accounts.pdf",
    storage_path: `c0000000-0000-4000-8000-000000000001/${Q3}/${id}-accounts.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    version: 1,
    uploaded_at: "2026-10-05T02:00:00Z",
    uploaded_by_name: "Aisha Rahman",
    ...overrides,
  };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("planDocumentPack", () => {
  it("files documents by period close (by period end, quarters first), then General", () => {
    const plan = planDocumentPack(
      "Batik Boutique",
      [
        doc("d1", { period_close_id: null, doc_type: "supporting", file_name: "bank letter.pdf" }),
        doc("d2", { period_close_id: H2, file_name: "H2 accounts.xlsx", mime_type: null }),
        doc("d3", { version: 2, file_name: "accounts restated.pdf" }),
        doc("d4"),
        doc("d5", { doc_type: "supporting", file_name: "notes.csv" }),
        doc("d6", { period_close_id: Q4 }),
      ],
      CLOSES,
    );
    expect(plan.root).toBe("Batik Boutique documents");
    expect(plan.entries.map((e) => e.zipPath)).toEqual([
      "Batik Boutique documents/Q3 2026/Management accounts v1 - accounts.pdf",
      "Batik Boutique documents/Q3 2026/Management accounts v2 - accounts restated.pdf",
      "Batik Boutique documents/Q3 2026/Supporting document v1 - notes.csv",
      "Batik Boutique documents/Q4 2026/Management accounts v1 - accounts.pdf",
      "Batik Boutique documents/H2 2026/Management accounts v1 - H2 accounts.xlsx",
      "Batik Boutique documents/General/Supporting document v1 - bank letter.pdf",
    ]);
  });

  it("keeps names safe and unique", () => {
    const plan = planDocumentPack(
      "Docspe / Plexis.ai",
      [doc("d1", { file_name: "../../etc/passwd" }), doc("d2", { file_name: "..\\..\\etc/passwd" })],
      CLOSES,
    );
    expect(plan.root).toBe("Docspe Plexis.ai documents");
    const names = plan.entries.map((e) => e.zipPath);
    expect(names[0]).toBe("Docspe Plexis.ai documents/Q3 2026/Management accounts v1 - .. .. etc passwd");
    expect(names[1]).toBe("Docspe Plexis.ai documents/Q3 2026/Management accounts v1 - .. .. etc passwd (2)");
    for (const name of names) expect(name.split("/")).toHaveLength(3);
  });

  it("cleans path segments", () => {
    expect(safePathSegment("  Q3: 2026?  ", "x")).toBe("Q3 2026");
    expect(safePathSegment("...", "fallback")).toBe("fallback");
    expect(safePathSegment(`${"a".repeat(200)}.pdf`, "x", 20)).toBe(`${"a".repeat(16)}.pdf`);
  });
});

describe("documentPackManifest", () => {
  it("lists every document, who uploaded it and whether it was included", () => {
    const plan = planDocumentPack(
      "Batik Boutique",
      [doc("d1"), doc("d2", { version: 2, uploaded_by_name: "Aisha Rahman (ScaleUp)" })],
      CLOSES,
    );
    const manifest = documentPackManifest(plan.entries, new Set(["d1"]));
    const lines = manifest.split("\r\n");
    expect(lines[0]).toBe(
      "﻿Folder,File in pack,Document type,Version,Original file name,Size (bytes),Uploaded (Malaysia time),Uploaded by,Status",
    );
    expect(lines[1]).toBe(
      'Q3 2026,Management accounts v1 - accounts.pdf,Management accounts,1,accounts.pdf,1024,"5 Oct 2026, 10:00",Aisha Rahman,Included',
    );
    expect(lines[2]).toBe(
      'Q3 2026,Management accounts v2 - accounts.pdf,Management accounts,2,accounts.pdf,1024,"5 Oct 2026, 10:00",Aisha Rahman (ScaleUp),Not available (the file could not be read)',
    );
  });
});

describe("uploaderName (BRD B28)", () => {
  const STAFF = { full_name: "Aisha Rahman", email: "aisha@scaleup.my", scaleup_role: "fund_admin" as const };
  const MEMBER = { full_name: "Farid Ismail", email: "farid@batik.my", scaleup_role: null };

  it("names people with their ScaleUp role for ScaleUp staff, and the system", () => {
    expect(uploaderName("u1", { profile: STAFF }, "scaleup")).toBe("Aisha Rahman (Fund Admin)");
    expect(uploaderName("u2", { profile: MEMBER }, "scaleup")).toBe("Farid Ismail");
    expect(uploaderName("u2", { profile: { ...MEMBER, full_name: "  " } }, "scaleup")).toBe("farid@batik.my");
    expect(uploaderName(null, {}, "scaleup")).toBe("System");
    expect(uploaderName("u3", {}, "scaleup")).toBe("Unknown user");
  });

  it("shows company owners ScaleUp staff as “<name> (ScaleUp)”, never an email or role", () => {
    expect(uploaderName("u1", { staffName: "Aisha Rahman (ScaleUp)" }, "company")).toBe("Aisha Rahman (ScaleUp)");
    expect(uploaderName("u2", { profile: MEMBER }, "company")).toBe("Farid Ismail");
    expect(uploaderName("u2", { profile: { ...MEMBER, full_name: null } }, "company")).toBe("farid@batik.my");
    // A staff profile that somehow reached the company side is still named only by its display name.
    expect(uploaderName("u1", { profile: STAFF, staffName: "Aisha Rahman (ScaleUp)" }, "company")).toBe(
      "Aisha Rahman (ScaleUp)",
    );
    expect(uploaderName("u1", { profile: STAFF }, "company")).toBe("");
    expect(uploaderName(null, {}, "company")).toBe("ScaleUp");
    expect(uploaderName("u3", {}, "company")).toBe("");
  });
});

describe("zip", () => {
  it("builds a zip with the files and Contents.csv, streamed", async () => {
    const plan = planDocumentPack("RECQA", [doc("d1"), doc("d2", { file_name: "notes.csv", mime_type: "text/csv" })], CLOSES);
    const files = plan.entries.map((entry, index) => ({
      zipPath: entry.zipPath,
      data: new TextEncoder().encode(`file ${index + 1}`),
      compress: shouldCompress(entry.document.file_name, entry.document.mime_type),
    }));
    const zip = buildDocumentPackZip(plan.root, files, "Folder\r\n");
    const bytes = await collect(zipToStream(zip));
    const loaded = await JSZip.loadAsync(bytes);
    const names = Object.keys(loaded.files).filter((name) => !loaded.files[name].dir).sort();
    expect(names).toEqual([
      "RECQA documents/Contents.csv",
      "RECQA documents/Q3 2026/Management accounts v1 - accounts.pdf",
      "RECQA documents/Q3 2026/Management accounts v1 - notes.csv",
    ]);
    expect(await loaded.file("RECQA documents/Q3 2026/Management accounts v1 - notes.csv")?.async("string")).toBe("file 2");
    expect(await loaded.file("RECQA documents/Contents.csv")?.async("string")).toBe("Folder\r\n");
  });

  it("stores formats that are already compressed", () => {
    expect(shouldCompress("accounts.pdf", "application/pdf")).toBe(false);
    expect(shouldCompress("model.xlsx", null)).toBe(false);
    expect(shouldCompress("notes.csv", "text/csv")).toBe(true);
    expect(shouldCompress("old.xls", "application/vnd.ms-excel")).toBe(true);
  });

  it("names the pack", () => {
    expect(documentPackFileName("Batik Boutique", "Q3 2026", "2026-10-05")).toBe(
      "Batik Boutique documents Q3 2026 2026-10-05.zip",
    );
    expect(documentPackFileName("Batik Boutique", null, "2026-10-05")).toBe("Batik Boutique documents 2026-10-05.zip");
  });

  it("keeps packs to a size that downloads within the time limit, and says what to do instead", () => {
    expect(DOCUMENT_PACK_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(documentPackTooLargeMessage(150 * 1024 * 1024, null)).toBe(
      "This document pack is too large to download in one go (150 MB; the limit is 100 MB). Download one period close at a time instead.",
    );
    expect(documentPackTooLargeMessage(101 * 1024 * 1024, "H2 2026")).toBe(
      "The documents of H2 2026 are too large to download as one pack (101 MB; the limit is 100 MB). Download the files one at a time instead.",
    );
  });
});
