import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test as setup } from "@playwright/test";

import { setUpRun } from "../helpers/fixtures";
import { adminClient } from "../helpers/supabase";
import { AUTH_DIR, OBSERVATIONS_FILE, RESULTS_DIR, removeSyncConflictCopies, saveState } from "../helpers/state";

setup("reset E2E accounts and recreate the E2E company", async () => {
  setup.setTimeout(5 * 60_000);
  // Fresh observation / failure logs and no stale browser sessions from an earlier run.
  rmSync(OBSERVATIONS_FILE, { force: true });
  rmSync(resolve(RESULTS_DIR, "failures.ndjson"), { force: true });
  for (const role of ["admin", "partner", "owner", "contributor", "invitee"]) {
    rmSync(resolve(AUTH_DIR, `storage-${role}.json`), { force: true });
  }
  removeSyncConflictCopies();

  const state = await setUpRun(adminClient());
  saveState(state);

  expect(state.company.submissions["2026-07"], "July 2026 opened for the E2E company").toBeTruthy();
  expect(state.company.submissions["2026-08"], "August 2026 opened for the E2E company").toBeTruthy();
  expect(state.company.q3CloseId, "Q3 2026 close created").toBeTruthy();
  for (const user of Object.values(state.users)) expect(user.totpSecret, `${user.email} has TOTP`).toBeTruthy();
});
