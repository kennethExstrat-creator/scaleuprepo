import { expect, test } from "@playwright/test";

import { E2E_COMPANY } from "../helpers/accounts";
import { withApiUser } from "../helpers/api-user";
import { expectNoErrorPage, MONTH_URL } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { AUGUST } from "../helpers/preconditions";
import { adminClient, must } from "../helpers/supabase";

// Extra (BRD B21): runs last, after the ten requested flows. Marks the E2E company exited (it is deleted in
// teardown) and checks that its owner can no longer change anything, in the portal and in the database.
test("Flow 11 (extra, BRD B21) - an exited company is read-only for its owner", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
    const cid = state.company.id;
    const readOnly = `${E2E_COMPANY.name} is no longer an active portfolio company, so its records are read-only.`;

    await flow.step("Mark the E2E company exited", "set_company_status(exited) succeeds", async () => {
      must(
        await adminClient().rpc("set_company_status", {
          p_company_id: cid,
          p_status: "exited",
          p_reason: "E2E: read-only check (BRD B21)",
        }),
        "set_company_status",
      );
    });

    const owner = await flow.as("owner");
    const page = owner.page;

    await flow.step("Owner home is read-only", "Home says the records are read-only; no month to start", async () => {
      await owner.goto(`/portal/${cid}`);
      await expectNoErrorPage(page, flow, "owner");
      await expect(page.getByText(/is no longer an active portfolio company, so its records are read-only/).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^(Start|Continue) update/ })).toHaveCount(0);
    });

    await flow.step(
      "August 2026 form is read-only",
      'Read-only banner; no number inputs; no "Review and submit"',
      async () => {
        await owner.goto(MONTH_URL(cid, AUGUST));
        await expectNoErrorPage(page, flow, "owner");
        await expect(page.getByText(readOnly).first()).toBeVisible();
        await expect(page.locator("#sf-field-gross_profit")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Review and submit" })).toHaveCount(0);
      },
    );

    await flow.step("Revenue segments are read-only", "No editor, a read-only notice", async () => {
      await owner.goto(`/portal/${cid}/segments`);
      await expectNoErrorPage(page, flow, "owner");
      await expect(page.getByText(/no longer an active portfolio company/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^Save (segments|changes)$/ })).toHaveCount(0);
    });
    await owner.save();

    await flow.step(
      "The database refuses the owner's save",
      `save_submission_values as the owner fails with P0001 "${readOnly}"`,
      async () => {
        const result = await withApiUser(state.users.owner, async (sb) =>
          sb.rpc("save_submission_values", {
            p_submission_id: state.company.submissions[AUGUST],
            p_values: [{ key: "gross_profit", value_number: 1 }],
          }),
        );
        expect(result.error, "save refused").not.toBeNull();
        expect(result.error?.code).toBe("P0001");
        expect(result.error?.message).toBe(readOnly);
      },
    );
  }),
);
