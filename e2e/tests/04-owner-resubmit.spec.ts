import { expect, test } from "@playwright/test";

import { ACCOUNTS } from "../helpers/accounts";
import { expectNoErrorPage, MONTH_URL } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { expectSaved, fieldInput, reviewAndSubmit, segmentInput, storedValues, typeNumber } from "../helpers/form";
import {
  activeCompanySegments,
  CHANGE_REQUEST_MESSAGE,
  ensureJulyChangesRequested,
  JULY,
  submissionStatus,
} from "../helpers/preconditions";
import { adminClient, must } from "../helpers/supabase";

const NEW_CASH = 510000;
const NEW_SECOND_SEGMENT = 45000;

test("Flow 4 - owner sees the change request with its message, edits July 2026 and resubmits", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const julyId = state.company.submissions[JULY];
  await ensureJulyChangesRequested(flow, CHANGE_REQUEST_MESSAGE);
  const segments = await activeCompanySegments();

  const owner = await flow.as("owner");
  const page = owner.page;

  await flow.step(
    "Home shows July 2026 with changes requested",
    'The focus card reads "Changes requested by ScaleUp" for July 2026',
    async () => {
      await owner.goto(`/portal/${cid}`);
      await expectNoErrorPage(page, flow, "owner");
      await expect(page.getByText("Changes requested by ScaleUp").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "July 2026", level: 2 })).toBeVisible();
    },
  );

  await flow.step(
    "July 2026 form shows the request and its message",
    'Banner "E2E Admin (ScaleUp) asked for changes" quoting the message; no ScaleUp email shown (BRD B28)',
    async () => {
      await owner.goto(MONTH_URL(cid, JULY));
      await expectNoErrorPage(page, flow, "owner");
      await expect(page.getByText(/asked for changes/).first()).toBeVisible();
      await expect(page.getByText(CHANGE_REQUEST_MESSAGE).first()).toBeVisible();
      await expect(page.getByText(`${ACCOUNTS.admin.fullName} (ScaleUp)`).first()).toBeVisible();
      await expect(page.getByText(ACCOUNTS.admin.email)).toHaveCount(0);
      await expect(page.getByText(ACCOUNTS.partner.fullName)).toHaveCount(0); // partner-in-charge never shown
    },
  );

  await flow.step(
    "Edit the figures",
    "Cash in bank and a segment change; the total updates live to RM 105,000 and autosave confirms",
    async () => {
      await typeNumber(page, fieldInput(page, "cash_in_bank"), String(NEW_CASH));
      if (segments[1]) {
        await typeNumber(page, segmentInput(page, segments[1].id), String(NEW_SECOND_SEGMENT));
        await expect(page.locator("#sf-field-revenue_total")).toHaveText(/RM\s?105,000/);
      }
      await expectSaved(page);
      await expect
        .poll(async () => (await storedValues(julyId)).values.cash_in_bank, { timeout: 30_000 })
        .toBe(NEW_CASH);
    },
  );

  await flow.step("Resubmit", 'Review and submit → declaration → "July 2026 submitted"', async () => {
    await reviewAndSubmit(page, "July 2026");
    await page.waitForURL(new RegExp(`/portal/${cid}/updates$`), { timeout: 60_000 });
  });

  await flow.step("July 2026 is resubmitted", 'Status "submitted", revision 2 and a "resubmitted" event', async () => {
    await expect.poll(() => submissionStatus(JULY), { timeout: 20_000 }).toBe("submitted");
    const row = must(await adminClient().from("submissions").select("revision").eq("id", julyId).single(), "read revision") as {
      revision: number;
    };
    expect(row.revision).toBeGreaterThanOrEqual(2);
    const events = must(
      await adminClient()
        .from("submission_events")
        .select("event")
        .eq("submission_id", julyId)
        .order("id", { ascending: false })
        .limit(1),
      "read events",
    ) as { event: string }[];
    expect(events[0]?.event).toBe("resubmitted");
  });
  await owner.save();
}),
);
