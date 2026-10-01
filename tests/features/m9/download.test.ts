import { afterEach, describe, expect, it, vi } from "vitest";

import { AUDIT_EXPORT_INCOMPLETE_MARKER } from "@/lib/exports/audit";
import {
  BROWSER_DOWNLOAD_MIN_BYTES,
  downloadErrorMessage,
  downloadFile,
  filenameFromContentDisposition,
  lastLineStartsWith,
} from "@/lib/exports/download";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A minimal browser for downloadFile: fetch answers `response`; saved file names are collected. */
function stubBrowser(response: Response): string[] {
  const saved: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async () => response));
  vi.stubGlobal("window", { setTimeout: () => 0 });
  vi.stubGlobal("document", {
    body: { appendChild: () => undefined },
    createElement: () => {
      const link = {
        href: "",
        download: "",
        rel: "",
        style: { display: "" },
        click: (): void => {
          saved.push(link.download);
        },
        remove: (): void => undefined,
      };
      return link;
    },
  });
  return saved;
}

describe("downloadFile", () => {
  const disposition = { "Content-Disposition": 'attachment; filename="Audit log 2026-09-30.csv"' };

  it("saves the file under its own name and reports an export cut short", async () => {
    const csv = `﻿Entry,Summary\r\n2,Saved\r\n"Export incomplete: this file holds the newest 1, and more",\r\n`;
    const saved = stubBrowser(new Response(csv, { headers: disposition }));
    const result = await downloadFile("/api/exports/audit", "Audit log.csv", {
      incompleteMarker: AUDIT_EXPORT_INCOMPLETE_MARKER,
    });
    expect(result).toEqual({ ok: true, filename: "Audit log 2026-09-30.csv", incomplete: true });
    expect(saved).toEqual(["Audit log 2026-09-30.csv"]);
  });

  it("reports a complete file as complete, and never looks without a marker", async () => {
    stubBrowser(new Response("﻿Entry,Summary\r\n2,Saved\r\n", { headers: disposition }));
    expect(await downloadFile("/x", "x.csv", { incompleteMarker: AUDIT_EXPORT_INCOMPLETE_MARKER })).toMatchObject({
      ok: true,
      incomplete: false,
    });
    stubBrowser(new Response('"Export incomplete: …"\r\n', { headers: disposition }));
    expect(await downloadFile("/x", "x.csv")).toMatchObject({ ok: true, incomplete: false });
  });

  it("shows the route's message when the export fails", async () => {
    const saved = stubBrowser(Response.json({ error: "That fund was not found." }, { status: 404 }));
    expect(await downloadFile("/x", "x.csv")).toEqual({ ok: false, error: "That fund was not found." });
    expect(saved).toEqual([]);
  });
});

describe("lastLineStartsWith", () => {
  it("finds the final record of an export cut short, quoted or not", () => {
    expect(lastLineStartsWith('a,b\r\n"Export incomplete: x, y",,\r\n', "Export incomplete:")).toBe(true);
    expect(lastLineStartsWith("a,b\r\nExport incomplete: x\r\n", "Export incomplete:")).toBe(true);
    expect(lastLineStartsWith('a,b\r\n"Export incomplete: x"', "Export incomplete:")).toBe(true);
    expect(lastLineStartsWith('"Export incomplete: x"\r\n12,Saved\r\n', "Export incomplete:")).toBe(false);
    expect(lastLineStartsWith("", "Export incomplete:")).toBe(false);
    expect(lastLineStartsWith("anything", "")).toBe(false);
  });

  it("leaves large files to the browser's own download", () => {
    expect(BROWSER_DOWNLOAD_MIN_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("filenameFromContentDisposition", () => {
  it("prefers the UTF-8 name", () => {
    expect(
      filenameFromContentDisposition("attachment; filename=\"Cafe.csv\"; filename*=UTF-8''Caf%C3%A9%20data.csv"),
    ).toBe("Café data.csv");
  });

  it("reads quoted and bare names", () => {
    expect(filenameFromContentDisposition('attachment; filename="Audit log 2026-09-30.csv"')).toBe(
      "Audit log 2026-09-30.csv",
    );
    expect(filenameFromContentDisposition("attachment; filename=report.xlsx")).toBe("report.xlsx");
    expect(filenameFromContentDisposition('attachment; filename="say \\"hi\\".txt"')).toBe('say "hi".txt');
  });

  it("returns null without a name", () => {
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition("attachment")).toBeNull();
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBeNull();
  });
});

describe("downloadErrorMessage", () => {
  it("shows the route's message", async () => {
    const response = Response.json({ error: "That fund was not found." }, { status: 404 });
    expect(await downloadErrorMessage(response)).toBe("That fund was not found.");
  });

  it("explains an ended session and non-JSON failures", async () => {
    const signedOut = Response.json({ error: "You're not signed in.", reason: "signed_out" }, { status: 401 });
    expect(await downloadErrorMessage(signedOut)).toBe(
      "Your session has ended. Please sign in again, then download the file.",
    );
    const gateway = new Response("<html>Bad gateway</html>", { status: 502 });
    expect(await downloadErrorMessage(gateway)).toBe("The download failed (error 502). Please try again.");
  });
});
