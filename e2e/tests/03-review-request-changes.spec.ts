import { expect, test } from "@playwright/test";

import { E2E_COMPANY } from "../helpers/accounts";
import { expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { CHANGE_REQUEST_MESSAGE, ensureJulySubmitted, JULY, submissionStatus } from "../helpers/preconditions";
import { adminClient, must } from "../helpers/supabase";

test("Flow 3 - admin finds July 2026 submitted on the tracker, reviews it and requests changes", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const julyId = state.company.submissions[JULY];
  await ensureJulySubmitted(flow);

  const admin = await flow.as("admin");
  const page = admin.page;

  await flow.step("Open the tracker", "The submission tracker loads without errors", async () => {
    await admin.goto("/admin/tracker");
    await expect(page.getByRole("heading", { name: "Submission tracker", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "admin");
  });

  const cell = page.getByRole("link", { name: `${E2E_COMPANY.name}, July 2026: Submitted` });
  await flow.step(
    "Tracker shows the E2E company with July 2026 submitted",
    `A cell link "${E2E_COMPANY.name}, July 2026: Submitted" is on the grid`,
    async () => {
      await expect(page.getByRole("link", { name: E2E_COMPANY.name, exact: true }).first()).toBeVisible();
      await expect(cell).toBeVisible();
      await expect(cell).toHaveAttribute("href", `/admin/review/${julyId}`);
    },
  );

  await flow.step(
    "Open the review page from the tracker cell",
    "Review page with Auto-flags, the comparison (This month / Prior month / Same month last year) and the timeline",
    async () => {
      await cell.click();
      await page.waitForURL(new RegExp(`/admin/review/${julyId}`), { timeout: 120_000 });
      await expectNoErrorPage(page, flow, "admin");
      await expect(page.getByRole("heading", { name: "Auto-flags" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Numbers" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /This month/ }).first()).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Prior month/ }).first()).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Same month last year/ }).first()).toBeVisible();
      await expect(page.getByText("RM 100,000").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    },
  );

  await flow.step(
    "Request changes with a message",
    'Dialog "Request changes to July 2026?" sends the month back (toast "July 2026 sent back to …")',
    async () => {
      await page.getByRole("button", { name: "Request changes" }).first().click();
      const dialog = page.getByRole("dialog", { name: /Request changes to July 2026/ });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("What needs to change?").fill(CHANGE_REQUEST_MESSAGE);
      await dialog.getByRole("button", { name: "Send back for changes" }).click();
      await expect(page.getByText(`July 2026 sent back to ${E2E_COMPANY.name}`)).toBeVisible({ timeout: 60_000 });
    },
  );

  await flow.step(
    "July 2026 is changes requested",
    'Database status "changes_requested" with the message on the timeline event',
    async () => {
      await expect.poll(() => submissionStatus(JULY), { timeout: 20_000 }).toBe("changes_requested");
      const events = must(
        await adminClient()
          .from("submission_events")
          .select("event, message, actor_id")
          .eq("submission_id", julyId)
          .order("id", { ascending: false })
          .limit(1),
        "read events",
      ) as { event: string; message: string | null; actor_id: string | null }[];
      expect(events[0]?.event).toBe("changes_requested");
      expect(events[0]?.message).toBe(CHANGE_REQUEST_MESSAGE);
      expect(events[0]?.actor_id).toBe(state.users.admin.id);
      await page.reload();
      await expect(page.getByText(CHANGE_REQUEST_MESSAGE).first()).toBeVisible();
    },
  );
  await admin.save();
}),
);
