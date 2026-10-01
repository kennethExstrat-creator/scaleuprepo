import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { ActionError, MESSAGES } from "@/lib/actions/result";
import { AuthUnavailableError } from "@/lib/auth/session";
import { DataError } from "@/lib/data";
import { filenameFromContentDisposition } from "@/lib/exports/download";
import {
  ExportHttpError,
  contentDisposition,
  exportErrorMessage,
  exportErrorPage,
  exportErrorResponse,
  exportErrorStatus,
  fileResponse,
  isPageNavigation,
  safeFileName,
} from "@/lib/exports/http";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

describe("file names", () => {
  it("removes path separators, quotes and control characters", () => {
    expect(safeFileName('Docspe / Plexis.ai "C4"\n.xlsx')).toBe("Docspe Plexis.ai C4 .xlsx");
    expect(safeFileName("..")).toBe("export");
    expect(safeFileName(`${"a".repeat(200)}.xlsx`)).toBe(`${"a".repeat(145)}.xlsx`);
  });

  it("sends an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("E.R.T.H C4 workbook 2026-09-30.xlsx")).toBe(
      "attachment; filename=\"E.R.T.H C4 workbook 2026-09-30.xlsx\"; filename*=UTF-8''E.R.T.H%20C4%20workbook%202026-09-30.xlsx",
    );
    const header = contentDisposition("Café (Sdn Bhd) 100%.csv");
    expect(header).toBe(
      "attachment; filename=\"Cafe (Sdn Bhd) 100 .csv\"; filename*=UTF-8''Caf%C3%A9%20%28Sdn%20Bhd%29%20100%25.csv",
    );
    // The browser helper reads it back.
    expect(filenameFromContentDisposition(header)).toBe("Café (Sdn Bhd) 100%.csv");
  });
});

describe("error responses", () => {
  it("maps errors to HTTP statuses", () => {
    expect(exportErrorStatus(new ExportHttpError(413, "Too large"))).toBe(413);
    expect(exportErrorStatus(new ActionError(MESSAGES.session))).toBe(401);
    expect(exportErrorStatus(new ActionError(MESSAGES.notFound))).toBe(404);
    expect(exportErrorStatus(new ActionError(MESSAGES.permission))).toBe(403);
    expect(exportErrorStatus(new ActionError("You don't have access to this company."))).toBe(403);
    expect(exportErrorStatus(new AuthUnavailableError())).toBe(503);
    expect(exportErrorStatus(new z.ZodError([]))).toBe(400);
    expect(exportErrorStatus({ code: "42501", message: "new row violates row-level security policy" })).toBe(403);
    expect(exportErrorStatus(new DataError("x", "missing", { code: "PGRST116", notFound: true }))).toBe(404);
    expect(exportErrorStatus({ code: "PGRST303", message: "JWT expired" })).toBe(401);
    expect(exportErrorStatus(new Error("boom"))).toBe(500);
  });

  it("never leaks database text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = exportErrorResponse({ code: "XX000", message: "relation public.secret does not exist" });
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: MESSAGES.generic });
    const rls = exportErrorResponse({ code: "42501", message: "permission denied for table audit_log" });
    expect(await rls.json()).toEqual({ error: MESSAGES.permission });
  });

  it("uses the first zod issue as the message and adds Retry-After for 503", async () => {
    const schema = z.object({ include: z.enum(["approved", "all"], { error: "include must be approved or all." }) });
    const result = schema.safeParse({ include: "draft" });
    if (result.success) throw new Error("expected a failure");
    expect(exportErrorMessage(result.error)).toBe("include must be approved or all.");
    const response = exportErrorResponse(new AuthUnavailableError());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});

describe("errors of followed links", () => {
  const page = (headers: Record<string, string>) => new Request("https://reports.example/api/exports/c4/x", { headers });

  it("recognises a page navigation, not a fetch() from the exports page", () => {
    expect(isPageNavigation(page({ "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(isPageNavigation(page({ "sec-fetch-mode": "cors", accept: "text/html" }))).toBe(false);
    expect(isPageNavigation(page({ accept: "text/html,application/xhtml+xml;q=0.9" }))).toBe(true);
    expect(isPageNavigation(page({ accept: "*/*" }))).toBe(false);
    expect(isPageNavigation(undefined)).toBe(false);
  });

  it("answers a navigation with an HTML page: escaped message, same status, same-origin way back", async () => {
    const response = exportErrorResponse(
      new ExportHttpError(404, "No documents have been uploaded for <Q3 2026> yet."),
      page({ "sec-fetch-mode": "navigate", referer: "https://reports.example/portal/abc/documents?close=1" }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const html = await response.text();
    expect(html).toContain("<title>Nothing to download · ScaleUp Portfolio Reporting</title>");
    expect(html).toContain("No documents have been uploaded for &lt;Q3 2026&gt; yet.");
    expect(html).toContain('<a href="/portal/abc/documents?close=1">Go back</a>');
    expect(html).not.toContain("<script");

    const foreign = exportErrorResponse(
      new ExportHttpError(403, "Not yours."),
      page({ "sec-fetch-mode": "navigate", referer: "https://elsewhere.example/page" }),
    );
    expect(await foreign.text()).toContain('<a href="/">Go back</a>');
    // fetch() callers still get JSON.
    const json = exportErrorResponse(new ExportHttpError(403, "Not yours."), page({ "sec-fetch-mode": "cors" }));
    expect(await json.json()).toEqual({ error: "Not yours." });
  });

  it("offers to sign in again when the session has ended", () => {
    const html = exportErrorPage(MESSAGES.session, 401, "/admin/exports");
    expect(html).toContain("Please sign in again");
    expect(html).toContain('<a href="/login">Sign in</a>');
  });
});

describe("fileResponse", () => {
  it("sends a private attachment with its length", async () => {
    const response = fileResponse("a,b\r\n", { filename: "x.csv", contentType: "text/csv; charset=utf-8" });
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain('attachment; filename="x.csv"');
    expect(response.headers.get("Content-Length")).toBe("5");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.text()).toBe("a,b\r\n");
  });

  it("streams without a length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("zip"));
        controller.close();
      },
    });
    const response = fileResponse(stream, { filename: "pack.zip", contentType: "application/zip" });
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(await response.text()).toBe("zip");
  });
});
