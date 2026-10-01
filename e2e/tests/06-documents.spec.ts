import { expect, test } from "@playwright/test";

import { expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { makePdf } from "../helpers/pdf";
import { adminClient, must } from "../helpers/supabase";

test("Flow 6 - owner uploads Q3 2026 management accounts (PDF); file, version and download work", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const closeId = state.company.q3CloseId;
  expect(closeId, "Q3 2026 close exists").toBeTruthy();
  const fileName = `E2E-management-accounts-Q3-2026-${state.runId.slice(-8)}.pdf`;
  const pdf = makePdf(["E2E Test Co (automated)", "Management accounts Q3 2026", `Run ${state.runId}`]);

  const before = must(
    await adminClient()
      .from("documents")
      .select("id, version")
      .eq("company_id", cid)
      .eq("period_close_id", closeId!)
      .eq("doc_type", "management_accounts"),
    "count documents",
  ) as { id: string; version: number }[];
  const expectedVersion = before.length + 1;

  const owner = await flow.as("owner");
  const page = owner.page;

  const closeCard = page.locator(`[id="close-${closeId}"]`);

  await flow.step("Open Documents", 'The documents page lists the "Q3 2026" quarter close', async () => {
    await owner.goto(`/portal/${cid}/documents?close=${closeId}`);
    await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "owner");
    await expect(page.getByRole("heading", { name: "Q3 2026", level: 3 })).toBeVisible();
  });

  await flow.step(
    "Upload a PDF as management accounts for Q3 2026",
    'Dialog "Upload a document for Q3 2026": Management accounts + the file → toast "… uploaded" (version N)',
    async () => {
      const show = page.getByRole("button", { name: "Show the details of Q3 2026" });
      if (await show.isVisible().catch(() => false)) await show.click();
      await expect(closeCard).toBeVisible();
      await closeCard.getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload a document for Q3 2026" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("radio", { name: /Management accounts/ }).check();
      await dialog.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
      await expect(dialog.getByText(fileName)).toBeVisible();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(page.getByText(new RegExp(`${fileName.replace(/[.]/g, "\\.")} was saved as version ${expectedVersion}`))).toBeVisible({
        timeout: 90_000,
      });
    },
  );

  const link = page.getByRole("link", { name: `Download ${fileName}, version ${expectedVersion}` });
  await flow.step("The file and its version are listed", `Management accounts table lists ${fileName}, version ${expectedVersion}`, async () => {
    await expect(link).toBeVisible({ timeout: 30_000 });
    const rows = must(
      await adminClient()
        .from("documents")
        .select("file_name, version, size_bytes, mime_type, uploaded_by")
        .eq("company_id", cid)
        .eq("period_close_id", closeId!)
        .eq("file_name", fileName),
      "read document",
    ) as { file_name: string; version: number; size_bytes: number | null; mime_type: string | null; uploaded_by: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(expectedVersion);
    expect(rows[0].uploaded_by).toBe(state.users.owner.id);
    expect(Number(rows[0].size_bytes)).toBe(pdf.length);
  });

  await flow.step("Download works", "GET on the download link ends in 200 with the same PDF bytes", async () => {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/api\/documents\/[0-9a-f-]{36}\/download$/);
    const response = await page.request.get(href!, { maxRedirects: 5 });
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.length).toBe(pdf.length);
  });
  await owner.save();
}),
);
