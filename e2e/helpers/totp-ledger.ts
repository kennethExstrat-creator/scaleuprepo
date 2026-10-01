/**
 * Never answers two prompts of the same account with a code from the same 30-second step (the auth
 * server may treat a repeated code as a replay). The last step used per account is kept in
 * e2e/.auth/totp-ledger.json so it also holds across Playwright worker processes.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { AUTH_DIR, ensureDir } from "./state";
import { msLeftInStep, totp } from "./totp";

const LEDGER = resolve(AUTH_DIR, "totp-ledger.json");

function readLedger(): Record<string, number> {
  try {
    return existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function currentStep(): number {
  return Math.floor(Date.now() / 30_000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fresh code for `accountKey` (e.g. the user id), with at least `minMs` left in its step. */
export async function nextTotpCode(accountKey: string, secret: string, minMs = 7000): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const ledger = readLedger();
    const step = currentStep();
    if (ledger[accountKey] !== undefined && ledger[accountKey] >= step) {
      await sleep(msLeftInStep() + 300);
      continue;
    }
    if (msLeftInStep() < minMs) {
      await sleep(msLeftInStep() + 300);
      continue;
    }
    ensureDir(AUTH_DIR);
    writeFileSync(LEDGER, JSON.stringify({ ...ledger, [accountKey]: step }), { mode: 0o600 });
    return totp(secret);
  }
  return totp(secret);
}
