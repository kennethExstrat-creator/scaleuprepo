// The document pack card's derived state (src/app/admin/exports/_components/document-pack-view.ts): the
// pack the choices make, the size limit, how large packs are downloaded and the retry after a failure.
import { describe, expect, it } from "vitest";

import {
  ALL_DOCUMENTS,
  documentPackView,
  filesText,
  type DocumentPackLoadState,
} from "@/app/admin/exports/_components/document-pack-view";
import type { ExportCompanyOption } from "@/app/admin/exports/_components/types";
import type { DocumentPackOptions } from "@/lib/exports/documents-zip";

const BATIK = "c0000000-0000-4000-8000-000000000001";
const HUDDLE = "c0000000-0000-4000-8000-000000000011";
const Q3 = "a0000000-0000-4000-8000-000000000003";
const H2 = "a0000000-0000-4000-8000-000000000012";
const MB = 1024 * 1024;

const COMPANIES: ExportCompanyOption[] = [
  { id: BATIK, name: "Batik Boutique", status: "active", notYetReporting: false, hasMonths: true },
  { id: HUDDLE, name: "Huddle", status: "active", notYetReporting: true, hasMonths: false },
];

function options(overrides: Partial<DocumentPackOptions> = {}): DocumentPackOptions {
  return {
    closes: [
      { id: H2, label: "H2 2026", status: "open", count: 3, bytes: 90 * MB },
      { id: Q3, label: "Q3 2026", status: "confirmed", count: 2, bytes: 4 * MB },
    ],
    generalCount: 1,
    totalCount: 6,
    totalBytes: 120 * MB,
    ...overrides,
  };
}

const ready = (companyId: string, data: DocumentPackOptions = options()): DocumentPackLoadState => ({
  status: "ready",
  companyId,
  options: data,
});

describe("documentPackView", () => {
  it("offers nothing to download before a company is chosen", () => {
    const view = documentPackView(COMPANIES, "", ALL_DOCUMENTS, { status: "idle" });
    expect([view.company, view.href, view.failed, view.browserDownload]).toEqual([null, null, false, false]);
    expect(view.closePlaceholder).toBe("Choose a company first");
    expect(view.hint).toBe("Pick one quarter or half-year, or everything the company has uploaded.");
  });

  it("links the chosen period close and leaves large packs to the browser", () => {
    const small = documentPackView(COMPANIES, BATIK, Q3, ready(BATIK));
    expect(small.href).toBe(`/api/exports/documents/${BATIK}?closeId=${Q3}`);
    expect([small.count, small.bytes, small.tooLarge, small.browserDownload]).toEqual([2, 4 * MB, false, false]);
    expect(small.hint).toBe("All documents also includes 1 file not linked to a period close.");

    const large = documentPackView(COMPANIES, BATIK, H2, ready(BATIK));
    expect(large.href).toBe(`/api/exports/documents/${BATIK}?closeId=${H2}`);
    expect(large.browserDownload).toBe(true);
  });

  it("explains a pack above the limit instead of linking it", () => {
    const all = documentPackView(COMPANIES, BATIK, ALL_DOCUMENTS, ready(BATIK));
    expect([all.tooLarge, all.href, all.browserDownload]).toEqual([true, null, false]);
    expect(all.hint).toBe(
      "This document pack is too large to download in one go (120 MB; the limit is 100 MB). Download one period close at a time instead.",
    );
    const close = documentPackView(
      COMPANIES,
      BATIK,
      H2,
      ready(BATIK, options({ closes: [{ id: H2, label: "H2 2026", status: "open", count: 9, bytes: 110 * MB }] })),
    );
    expect(close.hint).toBe(
      "The documents of H2 2026 are too large to download as one pack (110 MB; the limit is 100 MB). Download the files one at a time instead.",
    );
  });

  it("says when the company has no documents", () => {
    const view = documentPackView(COMPANIES, HUDDLE, ALL_DOCUMENTS, ready(HUDDLE, options({ closes: [], generalCount: 0, totalCount: 0, totalBytes: 0 })));
    expect([view.href, view.tooLarge]).toEqual([null, false]);
    expect(view.closePlaceholder).toBe("No documents yet");
    expect(view.hint).toBe("No documents have been uploaded for Huddle yet.");
  });

  it("reports a failed load for the chosen company only, so it can be tried again", () => {
    const error: DocumentPackLoadState = { status: "error", companyId: BATIK, error: "Couldn't reach the server. Please try again." };
    const failed = documentPackView(COMPANIES, BATIK, ALL_DOCUMENTS, error);
    expect([failed.failed, failed.href, failed.options]).toEqual([true, null, null]);
    expect(failed.closePlaceholder).toBe("The documents could not be loaded");
    // An answer for another company (an earlier choice) is not shown.
    expect(documentPackView(COMPANIES, HUDDLE, ALL_DOCUMENTS, error).failed).toBe(false);
    expect(documentPackView(COMPANIES, HUDDLE, ALL_DOCUMENTS, ready(BATIK)).options).toBeNull();
  });

  it("counts files", () => {
    expect([filesText(0), filesText(1), filesText(1_234)]).toEqual(["no files", "1 file", "1,234 files"]);
  });
});
