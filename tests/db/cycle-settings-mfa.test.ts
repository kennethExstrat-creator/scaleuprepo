/**
 * supabase/migrations/20261001000500_cycle_settings_and_mfa_guard.sql
 *
 * - public.set_cycle_settings(): Super Admins and Fund Admins (BRD A5, B10) change the reporting-cycle
 *   columns of platform_settings (due day, grace period, escalation) and nothing else; other roles and
 *   company users get 42501; ranges and a lost-update guard; audited as the caller.
 * - Trigger platform_settings_mfa_guard (BRD §11, B11): require_mfa can be switched on, but off only by a
 *   trusted system caller.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { expectDenied, expectRule, freshDb, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

type Settings = { due_day: number; backfill_grace_days: number; escalation_days: number; updated_at: string };

function settings(): Promise<Settings> {
  return db.one<Settings>(
    "select due_day, backfill_grace_days, escalation_days, updated_at::text as updated_at from public.platform_settings where id = 1",
  );
}

function setCycle(user: string, due: number, grace: number, escalation: number, expected?: string | null) {
  return db.asUser(user, (sql) =>
    expected === undefined
      ? sql.value<string>("select public.set_cycle_settings($1, $2, $3)", [due, grace, escalation])
      : sql.value<string>("select public.set_cycle_settings($1, $2, $3, $4::timestamptz)", [due, grace, escalation, expected]),
  );
}

describe("set_cycle_settings (BRD A5, B10)", () => {
  it("lets Fund Admins and Super Admins change the due day, grace period and escalation — audited as them", async () => {
    await setCycle(p.fundAdmin, 20, 10, 21);
    expect(await settings()).toMatchObject({ due_day: 20, backfill_grace_days: 10, escalation_days: 21 });
    const audit = await db.one<{ actor_id: string; actor_role: string; action: string; summary: string; new_data: Record<string, unknown> }>(
      `select actor_id, actor_role, action, summary, new_data from public.audit_log
        where entity = 'platform_settings' order by id desc limit 1`,
    );
    expect(audit).toMatchObject({
      actor_id: p.fundAdmin,
      actor_role: "fund_admin",
      action: "update",
      summary: "Reporting cycle settings changed: due day 15 → 20, grace period 14 → 10 days, escalation 14 → 21 days",
    });
    expect(audit.new_data).toMatchObject({ due_day: 20, backfill_grace_days: 10, escalation_days: 21 });

    await setCycle(p.superAdmin, 15, 14, 14);
    expect(await settings()).toMatchObject({ due_day: 15, backfill_grace_days: 14, escalation_days: 14 });
  });

  it("changes nothing else and writes nothing when the values are the same", async () => {
    const before = await settings();
    const auditRows = await db.count("select 1 from public.audit_log where entity = 'platform_settings'");
    expect(await setCycle(p.fundAdmin, before.due_day, before.backfill_grace_days, before.escalation_days)).toBeDefined();
    expect(await db.count("select 1 from public.audit_log where entity = 'platform_settings'")).toBe(auditRows);
    expect(await db.value("select require_mfa from public.platform_settings")).toBe(true);
  });

  it("is refused to partners, viewers and company users, and keeps RLS for direct writes", async () => {
    for (const user of [p.partner, p.viewer, p.batikOwner]) {
      await expectDenied(setCycle(user, 20, 14, 14), "Only Super Admins and Fund Admins can change the reporting cycle settings.");
    }
    // A Fund Admin still cannot update the table directly (RLS: Super Admins only): nothing changes.
    await db.asUser(p.fundAdmin, (sql) => sql.query("update public.platform_settings set due_day = 3 where id = 1"));
    expect((await settings()).due_day).toBe(15);
    expect(await db.value("select has_function_privilege('anon', 'public.set_cycle_settings(integer, integer, integer, timestamptz)', 'EXECUTE')")).toBe(false);
  });

  it("checks the ranges and refuses a save over someone else's change", async () => {
    await expectRule(setCycle(p.fundAdmin, 29, 14, 14), "Choose a due day from 1 to 28.");
    await expectRule(setCycle(p.fundAdmin, 0, 14, 14), "Choose a due day from 1 to 28.");
    await expectRule(setCycle(p.fundAdmin, 15, 0, 14), "Enter a grace period from 1 to 365 days.");
    await expectRule(setCycle(p.fundAdmin, 15, 14, 366), "Enter an escalation period from 0 to 365 days.");
    const { updated_at } = await settings();
    await expectRule(
      setCycle(p.fundAdmin, 20, 14, 14, "2020-01-01T00:00:00Z"),
      "Someone else changed the settings while you were editing. Reload the page to see their changes, then try again.",
    );
    await setCycle(p.fundAdmin, 20, 14, 14, updated_at);
    expect((await settings()).due_day).toBe(20);
  });
});

describe("platform_settings_mfa_guard (BRD §11, B11)", () => {
  it("never lets a signed-in user switch two-factor authentication off", async () => {
    await expectRule(
      db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set require_mfa = false where id = 1")),
      /Two-factor authentication is required for everyone/,
    );
    expect(await db.value("select require_mfa from public.platform_settings")).toBe(true);
  });

  it("lets it be switched back on, and off again only by a system caller (operators' emergency path)", async () => {
    await db.query("update public.platform_settings set require_mfa = false where id = 1"); // direct connection
    expect(await db.value("select require_mfa from public.platform_settings")).toBe(false);
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set require_mfa = true where id = 1"), { aal: "aal1" });
    expect(await db.value("select require_mfa from public.platform_settings")).toBe(true);
    // Other columns stay editable by Super Admins.
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set escalation_days = 10 where id = 1"));
    expect((await settings()).escalation_days).toBe(10);
  });
});
