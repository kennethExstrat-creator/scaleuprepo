/**
 * Bootstrap users from the command line (service-role key; bypasses RLS — admin use only).
 *
 *   npm run user:create -- --email ana@scaleup.my --name "Ana Tan" --role super_admin
 *   npm run user:create -- --email ceo@batik.my --name "Siti" --company "Batik Boutique" --company-role owner
 *
 * New users get NO password: the script prints a one-time invitation link (`<site>/access/<token>`,
 * valid for 7 days, BRD B14) to send them yourself; they choose a password and set up two-factor
 * authentication when they open it. People who already have an account but never signed in get a
 * fresh invitation link (earlier ones stop working). The link is printed once and never stored.
 *
 * Options:
 *   --sign-in-link    For an EXISTING account that has signed in before (e.g. the only Super Admin forgot
 *                     their password, BRD B23): print a one-time sign-in link (24 hours) instead.
 *   --password-stdin  Automated test users only: set a password instead of issuing a link, read from
 *                     standard input (a hidden prompt in a terminal, or piped:
 *                     printf '%s\n' "$PW" | npm run user:create -- … --password-stdin).
 *                     CREATE_USER_PASSWORD=<password> in the environment works too.
 *                     Passwords are never accepted as command-line arguments (shell history, `ps`).
 *   --force           Allow changes to an EXISTING account that alter its access: a different ScaleUp
 *                     role, reactivating it, a new password, changing an existing membership, or
 *                     giving one person both a ScaleUp role and a company membership.
 *
 * Existing users: prints their current role, status and memberships, updates the name, and refuses
 * anything that changes access unless --force is given. The last active Super Admin is never demoted.
 * Writes use the service-role key, so the audit log records them without an actor ("system"); issued
 * links are logged with log_audit_event as system. Env comes from .env.local (NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_SITE_URL for the link).
 *
 * Plain Node (tsx), so it deliberately does not import the app's `server-only` modules: it reuses the
 * client-injected helpers of src/lib/auth-admin (links, users, tokens) with its own admin client.
 */
import { parseArgs } from "node:util";

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { issueAccessLink } from "../src/lib/auth-admin/links";
import type { AccessLinkPurpose } from "../src/lib/auth-admin/purpose";
import { normaliseSiteUrl } from "../src/lib/auth-admin/tokens";
import { findAuthUserByEmail, setBanned } from "../src/lib/auth-admin/users";
import type { Database } from "../src/lib/supabase/database.types";
import { COMPANY_ROLES, SCALEUP_ROLES, type CompanyRole, type ScaleupRole } from "../src/lib/types/enums";

type Admin = SupabaseClient<Database>;

const MIN_PASSWORD_LENGTH = 12;
/** Supabase Auth hashes with bcrypt, which only uses the first 72 bytes. */
const MAX_PASSWORD_LENGTH = 72;
const DEFAULT_SITE_URL = "http://localhost:3000";

const USAGE = `Usage:
  npm run user:create -- --email <email> --name "<full name>" --role super_admin|fund_admin|partner|viewer [--sign-in-link] [--password-stdin] [--force]
  npm run user:create -- --email <email> --name "<full name>" --company "<company name>" --company-role owner|contributor [--sign-in-link] [--password-stdin] [--force]

  (default)         new people get a one-time invitation link (7 days) to send them; no password is set
  --sign-in-link    an existing account that has signed in before gets a one-time sign-in link (24 hours)
  --password-stdin  automated test users: set a password from stdin (hidden prompt, or piped) instead of a link;
                    or set CREATE_USER_PASSWORD
  --force           allow access changes to an existing account (role, reactivation, password, membership)`;

type Target = { kind: "scaleup"; role: ScaleupRole } | { kind: "company"; company: string; role: CompanyRole };

type Options = {
  email: string;
  name: string;
  passwordStdin: boolean;
  signInLink: boolean;
  force: boolean;
  target: Target;
};

class UsageError extends Error {}

function readArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        company: { type: "string" },
        "company-role": { type: "string" },
        "password-stdin": { type: "boolean" },
        "sign-in-link": { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
      throw new UsageError(
        "--password is not accepted: a password on the command line ends up in shell history and the process list. " +
          "Use --password-stdin or the CREATE_USER_PASSWORD environment variable (automated test users), or leave it " +
          "out to get a one-time invitation link.",
      );
    }
    throw new UsageError(message);
  }
}

function parseOptions(argv: string[]): Options {
  const values = readArgs(argv);
  if (values.help) throw new UsageError("");

  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UsageError("--email must be a valid email address.");
  const name = values.name?.trim();
  if (!name) throw new UsageError('--name is required, e.g. --name "Ana Tan".');

  const hasRole = values.role !== undefined;
  const hasCompany = values.company !== undefined || values["company-role"] !== undefined;
  if (hasRole === hasCompany) {
    throw new UsageError("Give either --role (ScaleUp user) or --company with --company-role (company user).");
  }

  const common = {
    email,
    name,
    passwordStdin: values["password-stdin"] === true,
    signInLink: values["sign-in-link"] === true,
    force: values.force === true,
  };

  if (hasRole) {
    const role = SCALEUP_ROLES.find((candidate) => candidate === values.role);
    if (!role) throw new UsageError(`--role must be one of: ${SCALEUP_ROLES.join(", ")}.`);
    return { ...common, target: { kind: "scaleup", role } };
  }

  const company = values.company?.trim();
  if (!company) throw new UsageError('--company is required with --company-role, e.g. --company "Batik Boutique".');
  const companyRole = COMPANY_ROLES.find((candidate) => candidate === values["company-role"]);
  if (!companyRole) throw new UsageError(`--company-role must be one of: ${COMPANY_ROLES.join(", ")}.`);
  return { ...common, target: { kind: "company", company, role: companyRole } };
}

/** The password from --password-stdin or CREATE_USER_PASSWORD, validated; undefined when neither is used. */
async function readPassword(options: Options): Promise<string | undefined> {
  let password: string | undefined;
  if (options.passwordStdin) {
    password = process.stdin.isTTY ? await promptHidden("Password (input hidden): ") : await readFirstStdinLine();
  } else if (process.env.CREATE_USER_PASSWORD) {
    password = process.env.CREATE_USER_PASSWORD;
  }
  if (password === undefined) return undefined;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UsageError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) {
    throw new UsageError(`The password must be at most ${MAX_PASSWORD_LENGTH} bytes.`);
  }
  return password;
}

async function readFirstStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (data: string) => {
      for (const char of data) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function createAdmin(): Admin {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local first.",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** The base URL for links: NEXT_PUBLIC_SITE_URL, else http://localhost:3000 (with a warning). */
function resolveSiteUrl(): string {
  const configured = normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;
  console.warn(`  ! NEXT_PUBLIC_SITE_URL is not set in .env.local: links will point at ${DEFAULT_SITE_URL}.`);
  return DEFAULT_SITE_URL;
}

async function ensureProfile(admin: Admin, userId: string, email: string, name: string): Promise<void> {
  // The profile is normally created by the private.handle_new_user() trigger; wait briefly for it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (error) throw new Error(`Could not read profile: ${error.message}`);
    if (data) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.warn("  ! No profile row found (is the handle_new_user trigger installed?). Creating it.");
  const { error } = await admin.from("profiles").insert({ id: userId, email, full_name: name });
  if (error) throw new Error(`Could not create profile: ${error.message}`);
}

async function findCompany(admin: Admin, name: string): Promise<{ id: string; name: string }> {
  const { data, error } = await admin.from("companies").select("id, name").order("name");
  if (error) throw new Error(`Could not read companies: ${error.message}`);
  const companies: { id: string; name: string }[] = data ?? [];
  const match = companies.find((company) => company.name.toLowerCase() === name.toLowerCase());
  if (!match) {
    const known = companies.map((company) => `"${company.name}"`).join(", ") || "(none yet)";
    throw new Error(`No company named "${name}". Existing companies: ${known}.`);
  }
  return match;
}

type ProfileState = { scaleupRole: ScaleupRole | null; isActive: boolean; fullName: string | null };
type MembershipState = { companyId: string; companyName: string; role: CompanyRole; isActive: boolean };

async function loadProfile(admin: Admin, userId: string): Promise<ProfileState | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("scaleup_role, is_active, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the profile: ${error.message}`);
  if (!data) return null;
  const row: { scaleup_role: ScaleupRole | null; is_active: boolean; full_name: string | null } = data;
  return { scaleupRole: row.scaleup_role, isActive: row.is_active, fullName: row.full_name };
}

async function loadMemberships(admin: Admin, userId: string): Promise<MembershipState[]> {
  const { data, error } = await admin
    .from("company_members")
    .select("company_id, role, is_active, company:companies(name)")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not read company memberships: ${error.message}`);
  type Row = { company_id: string; role: CompanyRole; is_active: boolean; company: { name: string } | { name: string }[] | null };
  const rows: Row[] = data ?? [];
  return rows.map((row) => {
    const company = Array.isArray(row.company) ? row.company[0] : row.company;
    return { companyId: row.company_id, companyName: company?.name ?? row.company_id, role: row.role, isActive: row.is_active };
  });
}

async function countActiveSuperAdmins(admin: Admin): Promise<number> {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("scaleup_role", "super_admin")
    .eq("is_active", true);
  if (error) throw new Error(`Could not count Super Admins: ${error.message}`);
  return count ?? 0;
}

function describeMemberships(memberships: MembershipState[]): string {
  if (memberships.length === 0) return "none";
  return memberships
    .map((m) => `${m.companyName} (${m.role}${m.isActive ? "" : ", inactive"})`)
    .join(", ");
}

/**
 * Checks what the requested change would do to an existing account. Returns the access changes
 * that need --force; throws for changes that are never allowed.
 */
async function reviewExistingAccount(
  admin: Admin,
  options: Options,
  password: string | undefined,
  profile: ProfileState,
  memberships: MembershipState[],
  company: { id: string; name: string } | null,
): Promise<string[]> {
  const needsForce: string[] = [];
  const activeMemberships = memberships.filter((m) => m.isActive);

  if (!profile.isActive) needsForce.push("reactivate this deactivated account");
  if (password !== undefined) needsForce.push("replace the password of this existing account");

  if (options.target.kind === "scaleup") {
    const newRole = options.target.role;
    if (profile.scaleupRole !== newRole) {
      if (profile.scaleupRole === "super_admin" && profile.isActive && (await countActiveSuperAdmins(admin)) <= 1) {
        throw new Error("Refusing to demote the only active Super Admin. Create another Super Admin first.");
      }
      needsForce.push(`change the ScaleUp role from ${profile.scaleupRole ?? "none (company user)"} to ${newRole}`);
    }
    if (activeMemberships.length > 0) {
      needsForce.push(
        `give a ScaleUp role to a company user (memberships: ${describeMemberships(activeMemberships)}) — ScaleUp roles see the whole portfolio`,
      );
    }
  } else if (company) {
    if (profile.scaleupRole) {
      needsForce.push(`add a company membership to a ScaleUp user (role ${profile.scaleupRole})`);
    }
    const existing = memberships.find((m) => m.companyId === company.id);
    if (existing && existing.role !== options.target.role) {
      needsForce.push(`change the ${company.name} role from ${existing.role} to ${options.target.role}`);
    }
    if (existing && !existing.isActive) needsForce.push(`reactivate the ${company.name} membership`);
  }
  return needsForce;
}

/** "7 Oct 2026, 14:05" in Malaysia time. */
function formatMyt(iso: string): string {
  const text = new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${text} (Malaysia time)`;
}

/**
 * Issues a one-time link (created_by null = this trusted script), records it in the audit log as a
 * system event (best effort) and prints it. The link is shown once and never stored.
 */
async function issueAndPrintLink(
  admin: Admin,
  user: { id: string; email: string },
  purpose: AccessLinkPurpose,
  siteUrl: string,
): Promise<void> {
  const link = await issueAccessLink(admin, { userId: user.id, purpose, createdBy: null, siteUrl });

  const { error: auditError } = await admin.rpc("log_audit_event", {
    p_action: purpose === "invite" ? "invite" : "sign_in_link",
    p_entity: "profiles",
    p_entity_id: user.id,
    p_summary: `${purpose === "invite" ? "Invitation" : "Sign-in"} link for ${user.email} issued by scripts/create-user.ts (valid until ${formatMyt(link.expiresAt)})`,
    p_data: { link_id: link.id, purpose, expires_at: link.expiresAt, issued_by: "scripts/create-user.ts" },
  });
  if (auditError) console.warn(`  ! Could not record the link in the audit log: ${auditError.message}`);

  console.log("");
  console.log(
    purpose === "invite"
      ? `  Invitation link for ${user.email} (works once, valid until ${formatMyt(link.expiresAt)}):`
      : `  Sign-in link for ${user.email} (works once, valid until ${formatMyt(link.expiresAt)}):`,
  );
  console.log(`    ${link.url}`);
  console.log("");
  console.log("  Send it to them yourself (email or chat). Anyone who has the link can sign in as this person,");
  console.log("  and it is not stored: run this command again for a new one (the previous link then stops working).");
  console.log(
    purpose === "invite"
      ? "  Opening it: choose a password, set up an authenticator app (two-factor authentication), accept the terms of use."
      : "  Opening it: confirm with the authenticator app, then choose a new password.",
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const password = await readPassword(options);
  if (password !== undefined && options.signInLink) {
    throw new UsageError("--sign-in-link issues a link instead of a password: use one or the other.");
  }
  const admin = createAdmin();
  const siteUrl = password === undefined ? resolveSiteUrl() : DEFAULT_SITE_URL;

  const company = options.target.kind === "company" ? await findCompany(admin, options.target.company) : null;
  let user: User | null = await findAuthUserByEmail(admin, options.email);
  let createdNow = false;

  if (user) {
    const profile = (await loadProfile(admin, user.id)) ?? { scaleupRole: null, isActive: true, fullName: null };
    const memberships = await loadMemberships(admin, user.id);
    console.log(`• ${options.email} already exists (${user.id}).`);
    console.log(`  Current ScaleUp role: ${profile.scaleupRole ?? "none"} · ${profile.isActive ? "active" : "DEACTIVATED"}`);
    console.log(`  Current memberships: ${describeMemberships(memberships)}`);
    console.log(`  Last sign-in: ${user.last_sign_in_at ? formatMyt(user.last_sign_in_at) : "never"}`);

    const needsForce = await reviewExistingAccount(admin, options, password, profile, memberships, company);
    if (needsForce.length > 0 && !options.force) {
      console.error("\nNothing was changed. This would:");
      for (const change of needsForce) console.error(`  - ${change}`);
      console.error("Check this is intended, then run the same command again with --force.");
      process.exit(1);
    }
    for (const change of needsForce) console.log(`  ! --force: will ${change}.`);

    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      ...(password !== undefined ? { password } : {}),
      user_metadata: { ...(user.user_metadata ?? {}), full_name: options.name },
    });
    if (error) throw new Error(`Could not update the auth user: ${error.message}`);
    user = data.user;
    await ensureProfile(admin, user.id, options.email, options.name);

    const profileUpdate: Database["public"]["Tables"]["profiles"]["Update"] = { full_name: options.name };
    if (options.target.kind === "scaleup") profileUpdate.scaleup_role = options.target.role;
    if (!profile.isActive) profileUpdate.is_active = true; // only reached with --force
    const { error: profileError } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (profileError) throw new Error(`Could not update the profile: ${profileError.message}`);
    if (!profile.isActive) {
      // Deactivated accounts are also blocked from signing in (BRD B22): lift that too.
      await setBanned(admin, user.id, false);
      console.log("• Reactivated (signing in is allowed again).");
    }
    if (profile.fullName !== options.name) console.log(`• Name: ${profile.fullName ?? "(none)"} → ${options.name}.`);
    if (password !== undefined) console.log("• Password replaced.");
  } else {
    if (options.signInLink) {
      throw new UsageError(`${options.email} has no account yet: leave out --sign-in-link to create it with an invitation link.`);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: options.email,
      ...(password !== undefined ? { password } : {}),
      email_confirm: true,
      user_metadata: { full_name: options.name },
    });
    if (error || !data.user) throw new Error(`Could not create the auth user: ${error?.message ?? "no user returned"}`);
    user = data.user;
    createdNow = true;
    console.log(`• Created auth user ${options.email} (${user.id})${password === undefined ? ", no password yet" : ""}.`);
    await ensureProfile(admin, user.id, options.email, options.name);

    const profileUpdate: Database["public"]["Tables"]["profiles"]["Update"] = { full_name: options.name };
    if (options.target.kind === "scaleup") profileUpdate.scaleup_role = options.target.role;
    const { error: profileError } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (profileError) throw new Error(`Could not update the profile: ${profileError.message}`);
  }

  if (options.target.kind === "scaleup") {
    console.log(`• ScaleUp role: ${options.target.role}.`);
  } else if (company) {
    const { error } = await admin
      .from("company_members")
      .upsert(
        { company_id: company.id, user_id: user.id, role: options.target.role, is_active: true },
        { onConflict: "company_id,user_id" },
      );
    if (error) throw new Error(`Could not add the company membership: ${error.message}`);
    console.log(`• ${options.target.role} of ${company.name}.`);
  }

  const account = { id: user.id, email: user.email ?? options.email };
  if (password !== undefined) {
    console.log("");
    console.log("  Password set (automated test user). First sign-in: set up an authenticator app and accept the terms of use.");
  } else if (options.signInLink) {
    await issueAndPrintLink(admin, account, "signin", siteUrl);
  } else if (createdNow || !user.last_sign_in_at) {
    await issueAndPrintLink(admin, account, "invite", siteUrl);
  } else {
    console.log("");
    console.log("  They have signed in before, so no invitation link is needed: they sign in as usual.");
    console.log("  Forgotten password? Run the same command with --sign-in-link, or use Users in the app.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    if (error.message) console.error(`Error: ${error.message}\n`);
    console.error(USAGE);
    process.exit(error.message ? 1 : 0);
  }
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
