import { expect, test } from "@playwright/test";

import { OTHER_COMPANY_NAME } from "../helpers/accounts";
import { withApiUser } from "../helpers/api-user";
import { expectNoErrorPage, MONTH_URL } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { AUGUST, JULY, submissionStatus } from "../helpers/preconditions";

test("Flow 9 - access control: owner kept out of admin and other companies; contributor cannot submit", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const owner = await flow.as("owner");
  const page = owner.page;

  await flow.step("Owner opens /admin/tracker", "Sent away from /admin (to the company portal)", async () => {
    await owner.goto(`/portal/${cid}`);
    await page.goto("/admin/tracker");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).not.toHaveURL(/\/admin(\/|$)/);
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByRole("heading", { name: "Submission tracker" })).toHaveCount(0);
  });

  await flow.step(
    "Owner opens another company's portal URL",
    `A not-found page; nothing of "${OTHER_COMPANY_NAME}" is shown`,
    async () => {
      expect(state.otherCompanyId, `"${OTHER_COMPANY_NAME}" exists`).toBeTruthy();
      const response = await page.goto(`/portal/${state.otherCompanyId}`);
      await expect(page.getByText(/could not be found|not found|404/i).first()).toBeVisible();
      await expect(page.getByText(OTHER_COMPANY_NAME)).toHaveCount(0);
      const status = response?.status();
      if (status !== 404) flow.note(`other company's portal URL showed the not-found page with HTTP ${status} (404 expected)`);
    },
  );
  await owner.save();

  // The contributor: an editable month without the submit action, and a refused submit in the database.
  const month = (await submissionStatus(JULY)) === "approved" ? AUGUST : JULY;
  const monthLong = month === AUGUST ? "August 2026" : "July 2026";
  const contributor = await flow.as("contributor");
  const cpage = contributor.page;

  await flow.step(
    `Contributor opens ${monthLong}`,
    'The form is editable, but there is no "Review and submit" button, only "Only your company owner can submit this month."',
    async () => {
      await contributor.goto(MONTH_URL(cid, month));
      await expectNoErrorPage(cpage, flow, "contributor");
      await expect(cpage.getByRole("heading", { name: monthLong, level: 2 })).toBeVisible();
      await expect(cpage.locator("#sf-field-gross_profit")).toBeEditable();
      await expect(cpage.getByRole("button", { name: "Review and submit" })).toHaveCount(0);
      await expect(cpage.getByText("Only your company owner can submit this month.").first()).toBeVisible();
    },
  );

  await flow.step("Contributor has no Team page in the sidebar", "No link to /team for contributors", async () => {
    await expect(cpage.locator(`a[href="/portal/${cid}/team"]`)).toHaveCount(0);
  });
  await contributor.save();

  await flow.step(
    "Database refuses a contributor's submit",
    'rpc submit_submission as the contributor fails with 42501 "Only the company owner can submit monthly updates."',
    async () => {
      const result = await withApiUser(state.users.contributor, async (sb) =>
        sb.rpc("submit_submission", { p_submission_id: state.company.submissions[month], p_declaration_accepted: true }),
      );
      expect(result.error, "submit refused").not.toBeNull();
      expect(result.error?.code).toBe("42501");
      flow.note(`contributor submit refused: ${result.error?.message}`);
      expect(await submissionStatus(month)).not.toBe("submitted");
    },
  );
}),
);
