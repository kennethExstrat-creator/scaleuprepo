/**
 * Read-only check after a run: the E2E company is gone, every E2E account is banned and inactive with no
 * ScaleUp role, and the real data the suite must never touch is still there. Prints no secrets.
 *   npx tsx scripts/verify-clean.ts
 */
import { ACCOUNTS, E2E_COMPANY, INVITEE, OTHER_COMPANY_NAME, PROTECTED_EMAILS, ROLES } from "../helpers/accounts";
import { findAuthUserByEmail } from "../helpers/fixtures";
import { adminClient } from "../helpers/supabase";

const sb = adminClient();
const problems: string[] = [];

const companies = await sb.from("companies").select("id, name").eq("name", E2E_COMPANY.name);
console.log(`E2E companies left: ${companies.data?.length ?? "?"}`);
if ((companies.data?.length ?? 1) !== 0) problems.push("E2E company still exists");

for (const email of [...ROLES.map((r) => ACCOUNTS[r].email), INVITEE.email]) {
  const user = await findAuthUserByEmail(sb, email);
  if (!user) {
    console.log(`${email}: no account`);
    continue;
  }
  const profile = await sb.from("profiles").select("is_active, scaleup_role").eq("id", user.id).single();
  const factors = await sb.auth.admin.mfa.listFactors({ userId: user.id });
  const banned = user.banned_until ? new Date(user.banned_until) > new Date() : false;
  console.log(
    `${email}: banned=${banned} active=${profile.data?.is_active} role=${profile.data?.scaleup_role ?? "none"} factors=${factors.data?.factors.length ?? "?"}`,
  );
  if (!banned || profile.data?.is_active !== false || profile.data?.scaleup_role) problems.push(`${email} not fully deactivated`);
}

const other = await sb.from("companies").select("id, name, status").eq("name", OTHER_COMPANY_NAME).maybeSingle();
console.log(`${OTHER_COMPANY_NAME}: ${other.data ? `present (${other.data.status})` : "MISSING"}`);
const count = await sb.from("companies").select("id", { count: "exact", head: true });
console.log(`companies in total: ${count.count}`);
for (const email of PROTECTED_EMAILS) {
  const user = await findAuthUserByEmail(sb, email);
  console.log(`${email}: ${user ? `present, banned=${user.banned_until ? new Date(user.banned_until) > new Date() : false}` : "no account"}`);
}

if (problems.length) {
  console.error(`PROBLEMS:\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("clean");
}
