/**
 * Run state shared between the set-up project and the flows: account ids, passwords and TOTP secrets
 * (generated per run), and the E2E company's ids. Lives in e2e/.auth (git-ignored, mode 0600).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Role } from "./accounts";
import { E2E_ROOT } from "./env";

export const AUTH_DIR = resolve(E2E_ROOT, ".auth");
export const STATE_FILE = resolve(AUTH_DIR, "state.json");
export const RESULTS_DIR = resolve(E2E_ROOT, "test-results");
export const OBSERVATIONS_FILE = resolve(RESULTS_DIR, "observations.ndjson");
export const SHOTS_DIR = resolve(RESULTS_DIR, "screenshots");

export type UserState = {
  role: Role | "invitee";
  id: string;
  email: string;
  fullName: string;
  password: string;
  totpSecret: string | null;
};

export type RunState = {
  runId: string;
  startedAt: string;
  termsVersion: string;
  users: Record<Role, UserState>;
  invitee?: UserState;
  company: {
    id: string;
    name: string;
    scaleupLineId: string;
    kpiId: string;
    submissions: Record<string, string>; // 'YYYY-MM' -> submission id
    q3CloseId: string | null;
  };
  otherCompanyId: string | null;
  /** Filled by flow 10. */
  inviteSkippedReason?: string | null;
};

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function saveState(state: RunState): void {
  ensureDir(AUTH_DIR);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
}

export function loadState(): RunState {
  if (!existsSync(STATE_FILE)) {
    throw new Error("e2e/.auth/state.json is missing: run the set-up project first (npx playwright test runs it).");
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
}

export function storageStatePath(role: Role | "invitee"): string {
  return resolve(AUTH_DIR, `storage-${role}.json`);
}

/**
 * After teardown: drops the run's secrets from disk (the repository folder is cloud-synced). Passwords and
 * TOTP secrets are blanked in state.json (ids stay for reference) and the saved browser sessions deleted.
 */
export function scrubSecrets(): void {
  for (const who of ["admin", "partner", "owner", "contributor", "invitee"] as const) {
    rmSync(storageStatePath(who), { force: true });
  }
  rmSync(resolve(AUTH_DIR, "totp-ledger.json"), { force: true });
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as RunState;
  for (const user of [...Object.values(state.users), ...(state.invitee ? [state.invitee] : [])]) {
    user.password = "";
    user.totpSecret = null;
  }
  saveState(state);
}

/**
 * Removes iCloud conflict copies ("storage-owner 2.json", "results 2.json") from the suite's own output
 * folders. The suite never names a file with a space, so any such file there is a sync duplicate.
 */
export function removeSyncConflictCopies(): string[] {
  const removed: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (/ \d+(\.[^./ ]+)?$/.test(entry.name)) {
        rmSync(path, { recursive: true, force: true });
        removed.push(path);
      } else if (entry.isDirectory()) {
        walk(path);
      }
    }
  };
  walk(AUTH_DIR);
  walk(RESULTS_DIR);
  return removed;
}
