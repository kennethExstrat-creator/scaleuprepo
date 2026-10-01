/** Standalone cleanup (same as the Playwright "teardown" project): `npm run teardown`. */
import { tearDownRun } from "../helpers/fixtures";
import { removeSyncConflictCopies, scrubSecrets } from "../helpers/state";
import { adminClient } from "../helpers/supabase";

const result = await tearDownRun(adminClient());
scrubSecrets();
removeSyncConflictCopies();
console.log(`[teardown] deleted companies: ${result.deletedCompanies.length}; banned: ${result.banned.join(", ") || "none"}`);
if (result.problems.length > 0) {
  console.error(`[teardown] problems:\n  ${result.problems.join("\n  ")}`);
  process.exitCode = 1;
}
