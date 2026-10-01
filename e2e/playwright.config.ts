/**
 * End-to-end suite for the ScaleUp Portfolio Reporting Platform (runs against the dev server that is
 * already running; it never starts or stops one).
 *
 *   cd e2e && npx playwright test            # set-up -> flows 01..10 -> teardown
 *   E2E_KEEP=1 npx playwright test           # keep the E2E company and accounts afterwards (debugging)
 *   npx tsx scripts/summarize.ts             # condensed pass/fail report from test-results/
 *
 * Projects: "setup" resets the dedicated E2E accounts and recreates "E2E Test Co (automated)";
 * "flows" runs the ten user flows in file order on one worker (each retried once); "teardown" deletes
 * the E2E company and bans the E2E accounts.
 */
import { defineConfig } from "@playwright/test";

import { BASE_URL } from "./helpers/env";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  // First visits compile routes in the dev server: be generous.
  timeout: 8 * 60_000,
  expect: { timeout: 30_000 },
  outputDir: "./test-results/artifacts",
  // No HTML reporter: it copies JavaScript trace-viewer bundles into the repository tree, which a
  // whole-project `eslint` run would pick up. Traces stay in test-results (npx playwright show-trace <zip>).
  reporter: [["list"], ["json", { outputFile: "./test-results/results.json" }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    locale: "en-GB",
    timezoneId: "Asia/Kuala_Lumpur",
    actionTimeout: 45_000,
    navigationTimeout: 150_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts$/, teardown: "teardown", retries: 1 },
    { name: "teardown", testMatch: /global\.teardown\.ts$/, retries: 0 },
    { name: "flows", testMatch: /\d\d-.*\.spec\.ts$/, dependencies: ["setup"] },
  ],
});
