import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { E2E_COMPANY } from "../helpers/accounts";
import { expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { JULY, submissionStatus } from "../helpers/preconditions";

test("Flow 7 - admin downloads the C4 workbook of the E2E company; the audit log lists recent entries", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const admin = await flow.as("admin");
  const page = admin.page;
  const julyApproved = (await submissionStatus(JULY)) === "approved";
  if (!julyApproved) flow.note('July 2026 is not approved: exporting with "Include months not yet approved" on');

  await flow.step("Open /admin/exports", "The exports page with the C4 workbook card", async () => {
    await admin.goto("/admin/exports");
    await expect(page.getByRole("heading", { name: "Exports", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "admin");
    await expect(page.getByText("C4 workbook", { exact: true }).first()).toBeVisible();
  });

  await flow.step(
    "Download the C4 workbook for the E2E company",
    "GET /api/exports/c4/<id> answers 200 with an xlsx content type and a non-empty zip body",
    async () => {
      await page.getByRole("combobox", { name: "Company" }).first().click();
      await page.getByRole("option", { name: new RegExp(E2E_COMPANY.name.replace(/[()]/g, "\\$&")) }).click();
      if (!julyApproved) await page.getByRole("switch", { name: "Include months not yet approved" }).click();
      const responsePromise = page.waitForResponse((r) => r.url().includes(`/api/exports/c4/${cid}`), { timeout: 120_000 });
      const download = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
      // A real link once a company is chosen (a disabled button before that).
      const downloadLink = page.getByRole("link", { name: "Download workbook" });
      await expect(downloadLink).toHaveAttribute("href", new RegExp(`/api/exports/c4/${cid}\\?include=`));
      await downloadLink.click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"] ?? "").toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      // What the browser saved (the page fetches the file and saves it through a blob link).
      const file = await download;
      expect(file, "the browser saved a file").not.toBeNull();
      const saved = readFileSync((await file!.path())!);
      flow.note(`C4 workbook saved as "${file!.suggestedFilename()}" (${saved.length} bytes)`);
      expect(saved.length).toBeGreaterThan(0);
      expect(saved.subarray(0, 2).toString("latin1"), "xlsx is a zip").toBe("PK");
      expect(file!.suggestedFilename()).toMatch(/\.xlsx$/);
      await expect(page.getByText("C4 workbook downloaded")).toBeVisible({ timeout: 30_000 });
    },
  );

  await flow.step(
    "The export route answers directly",
    "An authenticated GET of /api/exports/c4/<id> returns 200, an xlsx content type and a non-empty zip",
    async () => {
      const res = await page.request.get(`/api/exports/c4/${cid}?include=all`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"] ?? "").toContain("spreadsheetml.sheet");
      const body = await res.body();
      expect(body.length).toBeGreaterThan(0);
      expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    },
  );

  await flow.step("Open /admin/audit", "The audit log lists recent entries, including ones for the E2E company", async () => {
    await admin.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: "Audit log", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "admin");
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.getByText(/E2E (Admin|Owner|Partner)|e2e\.(admin|owner|partner)@example\.com/).first()).toBeVisible();
  });
  await admin.save();
}),
);
