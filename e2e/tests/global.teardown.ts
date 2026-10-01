import { expect, test as teardown } from "@playwright/test";

import { tearDownRun } from "../helpers/fixtures";
import { removeSyncConflictCopies, scrubSecrets } from "../helpers/state";
import { adminClient } from "../helpers/supabase";

teardown("delete the E2E company and ban the E2E accounts", async () => {
  teardown.setTimeout(3 * 60_000);
  if (process.env.E2E_KEEP === "1") {
    teardown.info().annotations.push({ type: "skipped", description: "E2E_KEEP=1: test data kept" });
    return;
  }
  const result = await tearDownRun(adminClient());
  // The accounts are banned and their authenticators removed: their passwords, TOTP secrets and saved
  // browser sessions are of no further use, so they leave the (cloud-synced) disk.
  scrubSecrets();
  const duplicates = removeSyncConflictCopies();
  if (duplicates.length > 0) console.log(`[teardown] removed ${duplicates.length} iCloud conflict copies`);
  console.log(
    `[teardown] deleted companies: ${result.deletedCompanies.length}; banned: ${result.banned.join(", ") || "none"}`,
  );
  expect(result.problems, "teardown problems").toEqual([]);
});
