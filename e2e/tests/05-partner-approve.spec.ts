import { expect, test } from "@playwright/test";

import { ACCOUNTS, E2E_COMPANY } from "../helpers/accounts";
import { expectNoErrorPage, MONTH_URL } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { fieldInput } from "../helpers/form";
import { ensureJulySubmitted, JULY, submissionStatus } from "../helpers/preconditions";
import { adminClient, must } from "../helpers/supabase";

test("Flow 5 - partner-in-charge approves July 2026; owner sees it locked and August 2026 next", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const julyId = state.company.submissions[JULY];
  if ((await submissionStatus(JULY)) !== "approved") await ensureJulySubmitted(flow);

  const partner = await flow.as("partner");
  const page = partner.page;

  if ((await submissionStatus(JULY)) === "submitted") {
    await flow.step("Partner opens the July 2026 review", 'Review page with an enabled "Approve Jul 2026" button', async () => {
      await partner.goto(`/admin/review/${julyId}`);
      await expectNoErrorPage(page, flow, "partner");
      await expect(page.getByRole("heading", { name: "Auto-flags" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve Jul 2026" }).first()).toBeEnabled();
    });

    await flow.step("Approve July 2026", 'Dialog "Approve July 2026?" → "Approve and lock" → toast "July 2026 approved"', async () => {
      await page.getByRole("button", { name: "Approve Jul 2026" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Approve July 2026?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Approve and lock" }).click();
      await expect(page.getByText("July 2026 approved")).toBeVisible({ timeout: 60_000 });
    });
  } else {
    flow.note("July 2026 was already approved (earlier attempt): checking the result only");
  }

  await flow.step("July 2026 is approved by the partner", 'Status "approved", approved_by = the partner-in-charge', async () => {
    await expect.poll(() => submissionStatus(JULY), { timeout: 20_000 }).toBe("approved");
    const row = must(
      await adminClient().from("submissions").select("approved_by, approved_at").eq("id", julyId).single(),
      "read approval",
    ) as { approved_by: string | null; approved_at: string | null };
    expect(row.approved_by).toBe(state.users.partner.id);
  });
  await partner.save();

  const owner = await flow.as("owner");
  const ownerPage = owner.page;
  await flow.step(
    "Owner sees July 2026 approved and locked",
    'Banner "July 2026 is approved and locked", no editable inputs, "Request amendment" offered; approver named "E2E Partner (ScaleUp)"',
    async () => {
      await owner.goto(MONTH_URL(cid, JULY));
      await expectNoErrorPage(ownerPage, flow, "owner");
      await expect(ownerPage.getByText("July 2026 is approved and locked").first()).toBeVisible();
      await expect(fieldInput(ownerPage, "gross_profit")).toHaveCount(0);
      await expect(ownerPage.getByRole("button", { name: "Review and submit" })).toHaveCount(0);
      await expect(ownerPage.getByRole("button", { name: /Request amendment/ }).first()).toBeVisible();
      // BRD B28: the approver is named "<full name> (ScaleUp)"; never an email or role.
      await expect(ownerPage.getByText(`by ${ACCOUNTS.partner.fullName} (ScaleUp)`).first()).toBeVisible();
      await expect(ownerPage.getByText(ACCOUNTS.partner.email)).toHaveCount(0);
    },
  );

  await flow.step("Owner home shows August 2026 next", 'Focus card "Your next monthly update": August 2026', async () => {
    await owner.goto(`/portal/${cid}`);
    await expectNoErrorPage(ownerPage, flow, "owner");
    await expect(ownerPage.getByRole("heading", { name: E2E_COMPANY.name, level: 1 })).toBeVisible();
    await expect(ownerPage.getByText("Your next monthly update")).toBeVisible();
    await expect(ownerPage.getByRole("heading", { name: "August 2026", level: 2 })).toBeVisible();
    await expect(ownerPage.getByRole("link", { name: /^(Start|Continue) update/ })).toHaveAttribute(
      "href",
      `/portal/${cid}/updates/2026-08`,
    );
  });
  await owner.save();
}),
);
