/** Standalone data reset (same as the Playwright "setup" project): `npm run setup`. Prints no secrets. */
import { setUpRun } from "../helpers/fixtures";
import { saveState } from "../helpers/state";
import { adminClient } from "../helpers/supabase";

const state = await setUpRun(adminClient());
saveState(state);
console.log(`[setup] run ${state.runId}: company ${state.company.id}, months ${Object.keys(state.company.submissions).join(", ")}`);
