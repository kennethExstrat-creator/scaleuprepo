import { expect, test } from "@playwright/test";

import { E2E_COMPANY } from "../helpers/accounts";
import { acceptTerms, answerMfa, expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { adminClient, must } from "../helpers/supabase";

test("Flow 1 - owner signs in (password + TOTP), accepts the terms, home shows July 2026 to do", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  // Precondition (also on a retry): the owner has not accepted the current terms.
  must(
    await adminClient().from("profiles").update({ terms_accepted_at: null, terms_version: null }).eq("id", state.users.owner.id),
    "reset owner terms",
  );

  const owner = await flow.as("owner", { fresh: true });
  const page = owner.page;

  await flow.step("Open /login", "The sign-in form (email, password) is shown", async () => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "owner");
  });

  await flow.step("Sign in with email and password", "Redirected to /mfa, which asks for the 6-digit code", async () => {
    await page.locator("#email").fill(owner.user.email);
    await page.locator("#password").fill(owner.user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/mfa/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Two-factor authentication", level: 1 })).toBeVisible({ timeout: 60_000 });
  });

  await flow.step("Enter the TOTP code on /mfa", "The code is accepted and the terms page opens", async () => {
    await answerMfa(page, owner.user);
    await page.waitForURL(/\/terms/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Terms of use", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
  });

  await flow.step("Accept the terms", "Lands on the portal home of the E2E company", async () => {
    await acceptTerms(page);
    await page.waitForURL(new RegExp(`/portal/${cid}$`), { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: E2E_COMPANY.name, level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "owner");
    const profile = must(
      await adminClient().from("profiles").select("terms_version, terms_accepted_at").eq("id", owner.user.id).single(),
      "read owner terms",
    ) as { terms_version: string | null; terms_accepted_at: string | null };
    expect(profile.terms_version).toBe(state.termsVersion);
    expect(profile.terms_accepted_at).not.toBeNull();
  });

  await flow.step(
    "Home shows July 2026 as needing action",
    'The focus card "Your next monthly update" is July 2026 (Not submitted) with a link to /updates/2026-07',
    async () => {
      await expect(page.getByText("Your next monthly update")).toBeVisible();
      await expect(page.getByRole("heading", { name: "July 2026", level: 2 })).toBeVisible();
      await expect(page.getByRole("link", { name: /^(Start|Continue) update/ })).toHaveAttribute(
        "href",
        `/portal/${cid}/updates/2026-07`,
      );
      // August and September are listed as still to submit after July.
      await expect(page.getByText(/After Jul 2026, .*Aug 2026.*still to submit/)).toBeVisible();
    },
  );
  await owner.save();
}),
);
