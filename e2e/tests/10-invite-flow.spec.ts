import { expect, test } from "@playwright/test";

import { E2E_COMPANY, INVITEE } from "../helpers/accounts";
import { expectNoErrorPage } from "../helpers/browser";
import { runFlow } from "../helpers/flow-test";
import { generatePassword, removeInvitee, findAuthUserByEmail } from "../helpers/fixtures";
import { loadState, saveState } from "../helpers/state";
import { adminClient, must } from "../helpers/supabase";
import { nextTotpCode } from "../helpers/totp-ledger";

test("Flow 10 - owner invites a contributor; the invitee accepts, sets a password, enrols TOTP, accepts terms", ({ browser }, testInfo) =>
  runFlow(browser, testInfo, async (flow, state) => {
  const cid = state.company.id;
  const admin = adminClient();
  // Precondition (also on a retry): no account for the invitee yet, so this is a first-time invitation.
  const leftover = await removeInvitee(admin);
  if (leftover) flow.note(leftover);

  const owner = await flow.as("owner");
  const page = owner.page;

  const invite = page.getByRole("button", { name: "Invite contributor" });
  await flow.step("Open the team page", 'Team page with the "Invite contributor" action', async () => {
    await owner.goto(`/portal/${cid}/team`);
    await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expectNoErrorPage(page, flow, "owner");
    await expect(invite).toBeVisible();
  });

  if (await invite.isDisabled()) {
    const reason = (await invite.getAttribute("title")) ?? "Invite contributor is disabled";
    flow.note(`skipped: the contributor limit does not allow another invitation (${reason})`);
    const s = loadState();
    s.inviteSkippedReason = reason;
    saveState(s);
    test.skip(true, `Contributor limit reached: ${reason}`);
    return;
  }

  const linkPath = await flow.step(
    "Invite e2e.invitee@example.com as a contributor",
    'Dialog "Invite a contributor" → "Create invitation" → "Invitation link for E2E Invitee" with a /access/<token> link',
    async () => {
      await invite.click();
      const dialog = page.getByRole("dialog", { name: "Invite a contributor" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Full name").fill(INVITEE.fullName);
      await dialog.getByLabel("Work email address").fill(INVITEE.email);
      await dialog.getByRole("button", { name: "Create invitation" }).click();
      const linkDialog = page.getByRole("dialog", { name: `Invitation link for ${INVITEE.fullName}` });
      await expect(linkDialog).toBeVisible({ timeout: 60_000 });
      const url = await linkDialog.getByLabel("Invitation link").inputValue();
      const parsed = new URL(url);
      expect(parsed.pathname).toMatch(/^\/access\/[A-Za-z0-9_-]{20,}$/);
      if (parsed.origin !== "http://localhost:3001") flow.note(`invitation link origin is ${parsed.origin} (opened on the test server instead)`);
      await linkDialog.getByRole("button", { name: "Done" }).click();
      return parsed.pathname;
    },
  );

  await flow.step("The invitee is on the team", "The team list shows E2E Invitee as a contributor (invited)", async () => {
    await expect(page.getByText(INVITEE.email).first()).toBeVisible();
  });
  await owner.save();

  const { page: inv } = await flow.anonymous("invitee");
  const password = generatePassword();

  await flow.step("Open the invitation link in a fresh browser", 'Page "Accept your invitation" with an "Accept invitation" button', async () => {
    await inv.goto(linkPath);
    await expect(inv.getByRole("heading", { name: "Accept your invitation", level: 1 })).toBeVisible();
    await expectNoErrorPage(inv, flow, "invitee");
  });

  await flow.step("Accept the invitation", "Signed in and sent to /set-password", async () => {
    await inv.getByRole("button", { name: "Accept invitation" }).click();
    await inv.waitForURL(/\/set-password/, { timeout: 90_000 });
    await expect(inv.getByRole("heading", { name: "Set your password", level: 1 })).toBeVisible();
  });

  await flow.step("Set a password", "Password saved; sent to two-factor set-up (/mfa)", async () => {
    await inv.locator("#password").fill(password);
    await inv.locator("#confirm").fill(password);
    await inv.getByRole("button", { name: "Save password and continue" }).click();
    await inv.waitForURL(/\/mfa/, { timeout: 90_000 });
  });

  let secret = "";
  await flow.step(
    "Enrol TOTP with the setup key",
    '"Set up two-factor authentication" shows a setup key; the computed code turns 2FA on',
    async () => {
      await expect(inv.getByRole("heading", { name: "Set up two-factor authentication", level: 1 })).toBeVisible({
        timeout: 60_000,
      });
      const key = inv.locator("code").filter({ hasText: /^[A-Z2-7 ]{16,}$/ });
      await expect(key).toBeVisible();
      secret = ((await key.textContent()) ?? "").replace(/\s+/g, "");
      expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
      const user = await findAuthUserByEmail(admin, INVITEE.email);
      const code = await nextTotpCode(user?.id ?? INVITEE.email, secret);
      const input = inv.locator('input[autocomplete="one-time-code"]');
      await input.click({ force: true });
      await input.pressSequentially(code, { delay: 60 });
      await inv.waitForURL((url) => !url.pathname.startsWith("/mfa"), { timeout: 60_000 });
    },
  );

  await flow.step("Accept the terms", "Terms page, then the portal of the E2E company", async () => {
    await inv.waitForURL(/\/terms/, { timeout: 60_000 });
    await inv.getByRole("checkbox").first().check();
    await inv.getByRole("button", { name: "Accept and continue" }).click();
    await inv.waitForURL(new RegExp(`/portal/${cid}`), { timeout: 90_000 });
    await expect(inv.getByRole("heading", { name: E2E_COMPANY.name, level: 1 })).toBeVisible();
    await expectNoErrorPage(inv, flow, "invitee");
  });

  await flow.step("The invitee is an active contributor", "Profile active with terms accepted; contributor membership of the E2E company", async () => {
    const user = await findAuthUserByEmail(admin, INVITEE.email);
    expect(user).not.toBeNull();
    const profile = must(
      await admin.from("profiles").select("is_active, scaleup_role, terms_accepted_at").eq("id", user!.id).single(),
      "read invitee profile",
    ) as { is_active: boolean; scaleup_role: string | null; terms_accepted_at: string | null };
    expect(profile.is_active).toBe(true);
    expect(profile.scaleup_role).toBeNull();
    expect(profile.terms_accepted_at).not.toBeNull();
    const member = must(
      await admin.from("company_members").select("role, is_active").eq("company_id", cid).eq("user_id", user!.id).single(),
      "read invitee membership",
    ) as { role: string; is_active: boolean };
    expect(member).toEqual({ role: "contributor", is_active: true });
    const s = loadState();
    s.invitee = { role: "invitee", id: user!.id, email: INVITEE.email, fullName: INVITEE.fullName, password, totpSecret: secret };
    s.inviteSkippedReason = null;
    saveState(s);
  });
}),
);
