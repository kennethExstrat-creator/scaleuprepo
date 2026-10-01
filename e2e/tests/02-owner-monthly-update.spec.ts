import { expect, test } from "@playwright/test";

import { COMPANY_SEGMENTS, E2E_COMPANY } from "../helpers/accounts";
import { expectNoErrorPage, MONTH_URL } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import {
  expectSaved,
  fieldInput,
  kpiInput,
  reviewAndSubmit,
  segmentInput,
  storedValues,
  typeNumber,
} from "../helpers/form";
import { activeCompanySegments, JULY, JULY_FIGURES, submissionStatus } from "../helpers/preconditions";

test("Flow 2 - owner creates revenue segments, fills July 2026 (autosave) and submits it", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const julyId = state.company.submissions[JULY];
  const owner = await flow.as("owner");
  const page = owner.page;

  await flow.step("Open the Revenue segments page", "Owner sees the segment editor", async () => {
    await owner.goto(`/portal/${cid}/segments`);
    await expect(page.getByRole("heading", { name: "Revenue segments", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "owner");
  });

  const existing = await activeCompanySegments();
  if (existing.length === 0) {
    await flow.step(
      "Create two company segments and save",
      'Both segments listed; "Save segments" saves them (toast "Revenue segments saved", status "All changes saved.")',
      async () => {
        await expect(page.getByRole("heading", { name: "Set up your revenue segments" })).toBeVisible();
        const add = page.getByLabel("Add a segment");
        for (const name of COMPANY_SEGMENTS) {
          await add.fill(name);
          await page.getByRole("button", { name: "Add segment" }).click();
        }
        const list = page.getByRole("list", { name: "Revenue segments, in order" });
        await expect(list.getByRole("listitem")).toHaveCount(COMPANY_SEGMENTS.length);
        await page.getByRole("button", { name: /^Save (segments|changes)$/ }).click();
        // A first set-up saves directly; any other change asks to confirm the comparability warning.
        const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog", { name: "Change your revenue segments?" }));
        if (await confirm.isVisible().catch(() => false)) {
          flow.note("segments save asked for the comparability confirmation");
          await confirm.getByRole("button", { name: "Save changes" }).click();
        }
        await expect(page.getByText(/Revenue segments (saved|updated)/).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText("All changes saved.")).toBeVisible({ timeout: 30_000 });
      },
    );
  } else {
    flow.note(`segments already existed from an earlier attempt: ${existing.map((s) => s.name).join(", ")}`);
  }

  const segments = await flow.step(
    "Company segments stored",
    `Exactly ${COMPANY_SEGMENTS.join(", ")} are the company's active segments, in order`,
    async () => {
      const rows = await activeCompanySegments();
      expect(rows.map((s) => s.name)).toEqual([...COMPANY_SEGMENTS]);
      return rows;
    },
  );

  if ((await submissionStatus(JULY)) !== "draft") {
    flow.note(`July 2026 was already "${await submissionStatus(JULY)}" (earlier attempt): checking the read-only view only`);
    await flow.step("July 2026 shows as submitted", "The form is read-only with the submitted banner", async () => {
      await owner.goto(MONTH_URL(cid, JULY));
      await expect(page.getByText("Submitted: awaiting review by ScaleUp")).toBeVisible();
    });
    return;
  }

  await flow.step(
    "Open the July 2026 monthly form",
    "Editable form: company segments, calculated total, ScaleUp line, financials, headcount, KPI",
    async () => {
      await owner.goto(MONTH_URL(cid, JULY));
      await expect(page.getByRole("heading", { name: "July 2026", level: 2 })).toBeVisible();
      await expectNoErrorPage(page, flow, "owner");
      for (const s of segments) await expect(page.getByLabel(s.name, { exact: true })).toBeEditable();
      await expect(page.locator("#sf-field-revenue_total")).toBeVisible();
      // The ScaleUp line block (its heading copy is still being reworded, so only the line itself is checked).
      await expect(page.getByLabel("ScaleUp line A", { exact: true })).toBeEditable();
      await expect(segmentInput(page, state.company.scaleupLineId)).toBeEditable();
      await expect(kpiInput(page, state.company.kpiId)).toBeEditable();
      await expect(page.getByRole("button", { name: "Review and submit" }).first()).toBeVisible();
    },
  );

  await flow.step(
    "Enter company segment amounts; total revenue updates live",
    "Total revenue (calculated) shows RM 60,000 after the first segment and RM 100,000 after the second",
    async () => {
      const total = page.locator("#sf-field-revenue_total");
      await typeNumber(page, segmentInput(page, segments[0].id), String(JULY_FIGURES.segments[segments[0].name]));
      await expect(total).toHaveText(/RM\s?60,000/);
      await typeNumber(page, segmentInput(page, segments[1].id), String(JULY_FIGURES.segments[segments[1].name]));
      await expect(total).toHaveText(/RM\s?100,000/);
    },
  );

  await flow.step(
    "Enter the ScaleUp line, GP, NP, cash, burn, headcount and the KPI",
    "Every value is accepted without inline errors",
    async () => {
      await typeNumber(page, segmentInput(page, state.company.scaleupLineId), String(JULY_FIGURES.scaleupLine));
      // BRD B30: ScaleUp revenue lines are not part of total revenue.
      await expect(page.locator("#sf-field-revenue_total")).toHaveText(/RM\s?100,000/);
      await typeNumber(page, fieldInput(page, "gross_profit"), String(JULY_FIGURES.gross_profit));
      await typeNumber(page, fieldInput(page, "net_profit"), String(JULY_FIGURES.net_profit));
      await typeNumber(page, fieldInput(page, "cash_in_bank"), String(JULY_FIGURES.cash_in_bank));
      await typeNumber(page, fieldInput(page, "burn_rate"), String(JULY_FIGURES.burn_rate));
      await typeNumber(page, fieldInput(page, "headcount_ft"), String(JULY_FIGURES.headcount_ft));
      await typeNumber(page, fieldInput(page, "headcount_pt"), String(JULY_FIGURES.headcount_pt));
      await typeNumber(page, kpiInput(page, state.company.kpiId), String(JULY_FIGURES.customers));
      await expect(page.locator('[data-invalid="true"]')).toHaveCount(0);
    },
  );

  await flow.step(
    "Autosave",
    'The save indicator shows "Saved HH:MM" and the database holds every value',
    async () => {
      await expectSaved(page);
      await expect
        .poll(async () => {
          const stored = await storedValues(julyId);
          return {
            revenue_total: stored.values.revenue_total,
            gross_profit: stored.values.gross_profit,
            net_profit: stored.values.net_profit,
            cash_in_bank: stored.values.cash_in_bank,
            burn_rate: stored.values.burn_rate,
            headcount_ft: stored.values.headcount_ft,
            headcount_pt: stored.values.headcount_pt,
            seg0: stored.segments[segments[0].id],
            seg1: stored.segments[segments[1].id],
            line: stored.segments[state.company.scaleupLineId],
            kpi: stored.kpis[state.company.kpiId],
          };
        }, { timeout: 30_000 })
        .toEqual({
          revenue_total: JULY_FIGURES.revenueTotal,
          gross_profit: JULY_FIGURES.gross_profit,
          net_profit: JULY_FIGURES.net_profit,
          cash_in_bank: JULY_FIGURES.cash_in_bank,
          burn_rate: JULY_FIGURES.burn_rate,
          headcount_ft: JULY_FIGURES.headcount_ft,
          headcount_pt: JULY_FIGURES.headcount_pt,
          seg0: JULY_FIGURES.segments[segments[0].name],
          seg1: JULY_FIGURES.segments[segments[1].name],
          line: JULY_FIGURES.scaleupLine,
          kpi: JULY_FIGURES.customers,
        });
    },
  );

  await flow.step(
    "Review and submit with the declaration",
    'Server check passes, the declaration must be ticked, "Submit July 2026" confirms with a toast',
    async () => {
      await reviewAndSubmit(page, "July 2026");
      await page.waitForURL(new RegExp(`/portal/${cid}/updates$`), { timeout: 60_000 });
      await expectNoErrorPage(page, flow, "owner");
    },
  );

  await flow.step("July 2026 is submitted", 'Status "submitted" (revision 1) in the database and "Submitted" on the list', async () => {
    expect(await submissionStatus(JULY)).toBe("submitted");
    await expect(page.getByRole("heading", { name: "Monthly updates", level: 1 })).toBeVisible();
    await expect(page.getByText("Submitted").first()).toBeVisible();
    await expect(page.getByText(E2E_COMPANY.name).first()).toBeVisible();
  });
  await owner.save();
}),
);
