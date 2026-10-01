import { expect, test } from "@playwright/test";

import { E2E_COMPANY } from "../helpers/accounts";
import { expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";

const COMPANY_TABS = ["overview", "funds", "revenue", "kpis", "team", "internal", "updates"] as const;

test("Flow 8 - admin pages load without errors", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const admin = await flow.as("admin");
  const page = admin.page;

  const targets: { path: string; heading: string | RegExp }[] = [
    { path: "/admin/companies", heading: "Companies" },
    ...COMPANY_TABS.map((tab) => ({
      path: tab === "overview" ? `/admin/companies/${cid}` : `/admin/companies/${cid}?tab=${tab}`,
      heading: E2E_COMPANY.name,
    })),
    { path: "/admin/funds", heading: "Funds" },
    { path: "/admin/templates", heading: "Templates" },
    { path: "/admin/cycles", heading: /cycle/i },
    { path: "/admin/settings", heading: "Settings" },
    { path: "/admin/users", heading: "Users" },
    { path: "/admin/documents", heading: "Documents" },
  ];

  const failed: string[] = [];
  for (const target of targets) {
    try {
      await flow.step(
        `Load ${target.path}`,
        "HTTP < 400, the page heading, no error boundary / overlay, no console or page errors while loading",
        async () => {
          const before = flow.observer.items.filter((o) => o.kind === "console-error" || o.kind === "page-error").length;
          const response = await page.goto(target.path);
          if (new URL(page.url()).pathname.startsWith("/login")) await admin.goto(target.path);
          expect(response?.status() ?? 0, `HTTP status of ${target.path}`).toBeLessThan(400);
          await expect(page.getByRole("heading", { level: 1, name: target.heading }).first()).toBeVisible();
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
          await expectNoErrorPage(page, flow, "admin");
          const errors = flow.observer.items
            .filter((o) => o.kind === "console-error" || o.kind === "page-error")
            .slice(before)
            .map((o) => o.text);
          expect(errors, `console/page errors on ${target.path}`).toEqual([]);
        },
      );
    } catch {
      failed.push(target.path);
    }
  }
  await admin.save();
  expect(failed, "admin pages that failed to load cleanly").toEqual([]);
}),
);
