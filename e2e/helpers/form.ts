/** Helpers for the monthly form (src/components/submission-form). */
import { expect, type Page } from "@playwright/test";

import { adminClient, must } from "./supabase";

/** DOM id of a form target (targetDomId in src/components/submission-form/presentation.ts). */
export const domId = (target: string) => `#sf-${target.replace(/[^A-Za-z0-9_-]/g, "-")}`;
export const fieldInput = (page: Page, key: string) => page.locator(domId(`field:${key}`));
export const segmentInput = (page: Page, segmentId: string) => page.locator(domId(`segment:${segmentId}`));
export const kpiInput = (page: Page, kpiId: string) => page.locator(domId(`kpi:${kpiId}`));

export async function typeNumber(page: Page, selector: ReturnType<Page["locator"]>, value: string) {
  await selector.scrollIntoViewIfNeeded();
  await selector.click();
  await selector.fill(value);
  await selector.blur();
}

/** "Saved 14:05" (or "Saved 1 Oct 2026") in the form's save indicator. */
export async function expectSaved(page: Page, timeout = 45_000) {
  await expect(page.getByRole("status").filter({ hasText: /^Saved \d{1,2}:\d{2}$|^Saved \d{1,2} \w{3} \d{4}$/ })).toBeVisible({
    timeout,
  });
}

export type StoredValues = {
  values: Record<string, number | null>;
  segments: Record<string, number | null>;
  kpis: Record<string, number | null>;
};

export async function storedValues(submissionId: string): Promise<StoredValues> {
  const sb = adminClient();
  const values = must(
    await sb.from("submission_values").select("field_key, value_number").eq("submission_id", submissionId),
    "read values",
  ) as { field_key: string; value_number: number | string | null }[];
  const segments = must(
    await sb.from("submission_segment_values").select("segment_id, amount").eq("submission_id", submissionId),
    "read segment values",
  ) as { segment_id: string; amount: number | string | null }[];
  const kpis = must(
    await sb.from("submission_kpi_values").select("kpi_id, value_number").eq("submission_id", submissionId),
    "read kpi values",
  ) as { kpi_id: string; value_number: number | string | null }[];
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return {
    values: Object.fromEntries(values.map((v) => [v.field_key, num(v.value_number)])),
    segments: Object.fromEntries(segments.map((v) => [v.segment_id, num(v.amount)])),
    kpis: Object.fromEntries(kpis.map((v) => [v.kpi_id, num(v.value_number)])),
  };
}

/** Opens "Review and submit", ticks the declaration and submits; returns once the app confirms. */
export async function reviewAndSubmit(page: Page, monthLong: string) {
  // The sticky bar and the checklist at the bottom both offer it.
  await page.getByRole("button", { name: "Review and submit" }).first().click();
  const dialog = page.getByRole("dialog", { name: `Review and submit ${monthLong}` });
  await expect(dialog).toBeVisible();
  const declaration = dialog.getByRole("checkbox", { name: /I confirm that the figures submitted are accurate/ });
  await expect(declaration, "declaration shown once the server check passed").toBeVisible({ timeout: 60_000 });
  const submit = dialog.getByRole("button", { name: `Submit ${monthLong}` });
  await expect(submit).toBeDisabled();
  await declaration.check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(`${monthLong} submitted`)).toBeVisible({ timeout: 60_000 });
}
