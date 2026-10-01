/**
 * Browser helpers: one context per E2E account (storage state reused between flows), UI sign-in with
 * the TOTP prompt, observers for console errors / page errors / server errors, and flow steps that take
 * screenshots and record what was expected when they fail.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import type { Role } from "./accounts";
import { BASE_URL } from "./env";
import { loadState, OBSERVATIONS_FILE, RESULTS_DIR, SHOTS_DIR, storageStatePath, type UserState } from "./state";
import { nextTotpCode } from "./totp-ledger";

// ---------------------------------------------------------------------------------------------
// Observations (console errors, uncaught page errors, 5xx responses, failed requests, error pages)
// ---------------------------------------------------------------------------------------------

export type Observation = {
  test: string;
  retry: number;
  who: string;
  kind: "console-error" | "page-error" | "http-5xx" | "request-failed" | "error-page" | "note";
  url: string;
  text: string;
  at: string;
};

const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
];

function ensureDirSync(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export class Observer {
  readonly items: Observation[] = [];
  constructor(private readonly testInfo: TestInfo) {}

  record(who: string, kind: Observation["kind"], url: string, text: string) {
    const item: Observation = {
      test: this.testInfo.title,
      retry: this.testInfo.retry,
      who,
      kind,
      url,
      text: text.slice(0, 2000),
      at: new Date().toISOString(),
    };
    this.items.push(item);
    ensureDirSync(RESULTS_DIR);
    appendFileSync(OBSERVATIONS_FILE, `${JSON.stringify(item)}\n`);
  }

  attachPage(page: Page, who: string) {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      const loc = msg.location();
      this.record(who, "console-error", page.url(), `${text}${loc?.url ? ` (at ${loc.url}:${loc.lineNumber})` : ""}`);
    });
    page.on("pageerror", (err) => this.record(who, "page-error", page.url(), `${err.name}: ${err.message}`));
    page.on("response", (resp) => {
      if (resp.status() >= 500) this.record(who, "http-5xx", resp.url(), `${resp.status()} ${resp.statusText()}`);
    });
    page.on("requestfailed", (req) => {
      const failure = req.failure()?.errorText ?? "failed";
      // Cancelled prefetches / navigations are normal in a Next.js app.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return;
      this.record(who, "request-failed", req.url(), `${req.method()} ${failure}`);
    });
  }

  attachContext(context: BrowserContext, who: string) {
    for (const p of context.pages()) this.attachPage(p, who);
    context.on("page", (p) => this.attachPage(p, who));
  }

  async flush() {
    if (this.items.length === 0) return;
    await this.testInfo.attach("observations.json", {
      body: JSON.stringify(this.items, null, 2),
      contentType: "application/json",
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Flow: steps with screenshots and an "expected" description on failure
// ---------------------------------------------------------------------------------------------

export type FailureRecord = {
  test: string;
  retry: number;
  step: string;
  expected: string;
  actual: string;
  screenshots: string[];
  url: string | null;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export class Flow {
  readonly observer: Observer;
  private readonly pages = new Map<string, Page>();
  private readonly contexts: BrowserContext[] = [];
  private readonly sessions: UserSession[] = [];
  readonly failures: FailureRecord[] = [];
  readonly notes: string[] = [];

  constructor(
    readonly testInfo: TestInfo,
    readonly browser: Browser,
  ) {
    this.observer = new Observer(testInfo);
  }

  note(text: string) {
    this.notes.push(text);
    this.observer.record("suite", "note", "", text);
  }

  track(who: string, page: Page) {
    this.pages.set(who, page);
  }

  async step<T>(name: string, expected: string, fn: () => Promise<T>): Promise<T> {
    return test.step(name, async () => {
      try {
        return await fn();
      } catch (error) {
        const shots: string[] = [];
        ensureDirSync(SHOTS_DIR);
        for (const [who, page] of this.pages) {
          if (page.isClosed()) continue;
          const file = resolve(
            SHOTS_DIR,
            `${slug(this.testInfo.title)}--r${this.testInfo.retry}--${slug(name)}--${slug(who)}.png`,
          );
          try {
            await page.screenshot({ path: file, fullPage: true, timeout: 15_000 });
            shots.push(file);
            await this.testInfo.attach(`failure-${who}.png`, { path: file, contentType: "image/png" });
          } catch {
            // The page may be gone; keep going.
          }
        }
        const firstPage = [...this.pages.values()].find((p) => !p.isClosed()) ?? null;
        const message = error instanceof Error ? error.message : String(error);
        const failure: FailureRecord = {
          test: this.testInfo.title,
          retry: this.testInfo.retry,
          step: name,
          expected,
          actual: message.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 1500),
          screenshots: shots,
          url: firstPage ? firstPage.url() : null,
        };
        this.failures.push(failure);
        await this.testInfo.attach(`failure-${slug(name)}.json`, {
          body: JSON.stringify(failure, null, 2),
          contentType: "application/json",
        });
        ensureDirSync(RESULTS_DIR);
        appendFileSync(resolve(RESULTS_DIR, "failures.ndjson"), `${JSON.stringify(failure)}\n`);
        throw error;
      }
    });
  }

  /** A browser context signed in as `role` (reusing the saved session when it is still valid). */
  async as(role: Role, opts: { fresh?: boolean } = {}): Promise<UserSession> {
    const state = loadState();
    const user = state.users[role];
    const statePath = storageStatePath(role);
    const context = await this.browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: "en-GB",
      timezoneId: "Asia/Kuala_Lumpur",
      storageState: !opts.fresh && existsSync(statePath) ? statePath : undefined,
    });
    this.contexts.push(context);
    this.observer.attachContext(context, role);
    const page = await context.newPage();
    this.track(role, page);
    const session = new UserSession(this, role, user, context, page, statePath);
    this.sessions.push(session);
    return session;
  }

  /** A context with no session (e.g. opening an invitation link). */
  async anonymous(who: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await this.browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
      locale: "en-GB",
      timezoneId: "Asia/Kuala_Lumpur",
    });
    this.contexts.push(context);
    this.observer.attachContext(context, who);
    const page = await context.newPage();
    this.track(who, page);
    return { context, page };
  }

  async close() {
    await this.observer.flush();
    // Each session is written once, at the end of the flow: frequent rewrites of files in the
    // (iCloud-synced) repository folder make iCloud create "name 2.json" conflict copies.
    for (const session of this.sessions) await session.persist();
    for (const context of this.contexts) await context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------------------------

export const ERROR_PAGE_TEXT =
  /could not be loaded|couldn['’]t be loaded|couldn['’]t load|We couldn't load|Application error|Unhandled Runtime Error|Internal Server Error/i;

/** Fails when the page shows an error boundary, a Next.js error overlay or a raw server error. */
export async function expectNoErrorPage(page: Page, flow?: Flow, who = "page") {
  const heading = page
    .locator('h1, h2, [data-slot="empty-title"], [data-slot="alert-title"], [data-slot="card-title"]')
    .filter({ hasText: ERROR_PAGE_TEXT });
  const overlay = page.locator("[data-nextjs-dialog]");
  if ((await heading.count()) > 0 || (await overlay.count()) > 0) {
    const text = (await heading.first().textContent().catch(() => null)) ?? "Next.js error overlay";
    flow?.observer.record(who, "error-page", page.url(), text);
  }
  await expect(heading, `error page shown at ${page.url()}`).toHaveCount(0);
  await expect(overlay, `Next.js error overlay at ${page.url()}`).toHaveCount(0);
}

export async function answerMfa(page: Page, user: UserState) {
  if (!user.totpSecret) throw new Error(`No TOTP secret for ${user.email}`);
  const input = page.locator('input[autocomplete="one-time-code"]');
  await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible({ timeout: 60_000 });
  await input.waitFor({ state: "attached", timeout: 60_000 });
  const code = await nextTotpCode(user.id, user.totpSecret);
  await input.click({ force: true });
  await input.pressSequentially(code, { delay: 60 });
  // onComplete submits; press the button too in case the auto-submit did not fire.
  await page.waitForURL((url) => !url.pathname.startsWith("/mfa"), { timeout: 20_000 }).catch(async () => {
    const button = page.getByRole("button", { name: /^Verify/ });
    if (await button.isEnabled().catch(() => false)) await button.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/mfa"), { timeout: 60_000 });
  });
}

export async function acceptTerms(page: Page) {
  await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/terms"), { timeout: 60_000 });
}

/** Email + password on /login, then the TOTP code on /mfa. Leaves the page wherever the app sends it. */
export async function uiLogin(page: Page, user: UserState, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/mfa/, { timeout: 90_000 });
  await answerMfa(page, user);
}

export class UserSession {
  constructor(
    readonly flow: Flow,
    readonly role: Role,
    readonly user: UserState,
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly statePath: string,
  ) {}

  /**
   * Opens `path`, signing in first when the saved session is missing or expired. Terms are accepted
   * when asked (flow 1 checks the terms page explicitly before calling this).
   */
  async goto(path: string) {
    const page = this.page;
    await page.goto(path);
    for (let i = 0; i < 3; i += 1) {
      const url = new URL(page.url());
      if (url.pathname.startsWith("/login")) {
        await uiLogin(page, this.user, path);
        this.flow.note(`${this.role}: signed in through the UI`);
        continue;
      }
      if (url.pathname.startsWith("/mfa")) {
        await answerMfa(page, this.user);
        continue;
      }
      if (url.pathname.startsWith("/terms")) {
        await acceptTerms(page);
        this.flow.note(`${this.role}: accepted the terms`);
        await page.goto(path);
        continue;
      }
      break;
    }
    this.keep = true;
  }

  private keep = false;

  /** Keep this session for the next flows (written once when the flow closes). */
  async save() {
    this.keep = true;
  }

  /** Writes the session's cookies and storage atomically (temp file + rename). */
  async persist() {
    if (!this.keep || this.page.isClosed()) return;
    try {
      const snapshot = await this.context.storageState();
      const tmp = `${this.statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(tmp, this.statePath);
    } catch {
      // A missing session only means the next flow signs in through the UI again.
    }
  }
}

export const MONTH_URL = (companyId: string, month: string) => `/portal/${companyId}/updates/${month}`;
