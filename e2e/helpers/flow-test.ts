import type { Browser, TestInfo } from "@playwright/test";

import { Flow } from "./browser";
import { loadState, type RunState } from "./state";

/**
 * Runs one user flow (one Playwright test, retried once by the config) with observers and step
 * records: `test("Flow N …", ({ browser }, testInfo) => runFlow(browser, testInfo, async (flow, state) => …))`.
 */
export async function runFlow(
  browser: Browser,
  testInfo: TestInfo,
  body: (flow: Flow, state: RunState) => Promise<void>,
): Promise<void> {
  const flow = new Flow(testInfo, browser);
  try {
    await body(flow, loadState());
  } finally {
    for (const note of flow.notes) testInfo.annotations.push({ type: "note", description: note });
    await flow.close();
  }
}
