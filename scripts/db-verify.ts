/**
 * npm run db:verify — dry run of supabase/migrations + supabase/seed.sql against the REAL Supabase
 * database (Postgres 17) in SUPABASE_DB_URL (.env.local), inside ONE transaction that is ALWAYS rolled
 * back (also on errors): nothing is ever committed. Files that contain top-level transaction control
 * (BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT, …; scripts/sql-transaction-control.ts) are refused before
 * connecting, since a COMMIT would end that transaction part-way through; as a tripwire the
 * transaction id is also compared after every file.
 *
 * What it replays is what `supabase db push --include-seed` would run next: the migrations NOT yet
 * recorded in supabase_migrations.schema_migrations (on a database nothing was pushed to: all of them),
 * then the seed (idempotent). It reports which migrations are already deployed and refuses (FAIL) a
 * database that recorded versions this repository does not have, or pending files older than the newest
 * recorded one (`db push` would not apply them). As a best effort it also checks that the deployed files
 * are unchanged (the statements `db push` recorded) — a deployed migration is never applied again, so an
 * edit would silently never reach the database.
 *
 * It proves on the hosted database what the PGlite suite (PostgreSQL 18 + a Supabase shim) cannot: the
 * pending migrations and the seed apply cleanly as the `postgres` role on top of what is deployed (on a
 * fresh database: the triggers on auth.users and the storage policies can be created, Supabase's default
 * privileges are revoked), and RLS and the RPCs behave the same on Postgres 17. Then it runs sanity checks
 * and prints a PASS / FAIL report. Checks that depend on data (the seeded portfolio, opened months) only
 * WARN on a deployed database, whose data may legitimately differ from the seed.
 *
 * Safe to run before and after a `db push`: the whole run is rolled back. While it runs (a few seconds)
 * it holds locks on the objects it touches (e.g. auth.users, storage.objects, and whatever the pending
 * migrations alter), so run it in a quiet moment. Connection details and credentials are never printed.
 *
 * Connection: SUPABASE_DB_URL first. Supabase's direct host (db.<ref>.supabase.co) is IPv6-only unless
 * the IPv4 add-on is enabled, so on a network without IPv6 the script falls back — once per candidate,
 * no endless retries — to the project's Supavisor SESSION pooler (IPv4, port 5432, user
 * postgres.<ref>, same password): SUPABASE_POOLER_URL when set, else
 * aws-0 / aws-1-<SUPABASE_REGION, default ap-southeast-1>.pooler.supabase.com.
 *
 * TLS: the script connects as `postgres` (bypasses RLS, owns everything), so the server's certificate
 * is ALWAYS verified, host name included, before the password is sent (postgres.js answers even a
 * cleartext-password request, and sslmode=require accepts any certificate). The CA: SUPABASE_DB_CA_FILE
 * (PEM), else `sslrootcert=<file>` (or `system`) in the URL, else — for *.supabase.co / *.supabase.com —
 * Supabase's root CA in supabase/certs/prod-ca-2021.crt (Dashboard → Database → Settings → SSL
 * configuration → Download certificate). `sslmode=verify-ca` skips the host-name check; weaker sslmode
 * values are refused. Local hosts (localhost, 127.0.0.1, ::1) keep `prefer`.
 *
 * Exit code 0 = PASS, 1 = FAIL (or no connection).
 */
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";

import postgres from "postgres";

import {
  migrationVersion,
  planMigrations,
  readMigrations,
  readSeed,
  ROOT_DIR,
  statementsMatchFile,
  type SqlFile,
} from "../tests/db/schema";
import { findTransactionControl } from "./sql-transaction-control";

type Tx = postgres.TransactionSql;
type Status = "PASS" | "FAIL" | "WARN";
type Check = { status: Status; name: string; detail: string };

const EXPECTED = {
  serverMajor: 17,
  publicTables: 27,
  companies: 18,
  reportingCompanies: 3,
  fundInvestments: { SV1: 7, SFF: 11 },
  templateFields: 23,
  /** As of 20 Oct 2026 the pilot has Jul–Sep: 3 × 3 submissions and 3 Q3 closes (open_due_periods()). */
  pilotSubmissionsAsOf20Oct2026: 9,
  pilotClosesAsOf20Oct2026: 3,
  /** platform_settings.owner_contributor_limit default (BRD B29). */
  ownerContributorLimit: 4,
};

/** Private helpers the authenticated role may execute (policies, views, storage policies). */
const AUTHENTICATED_HELPERS = [
  "can_edit_submission",
  "can_upload_company_document",
  "can_upload_document_object",
  "can_view_company",
  "company_role",
  "dimension_company",
  "has_role",
  "is_active_company",
  "is_active_user",
  "is_company_member",
  "is_company_user",
  "is_partner_of",
  "is_scaleup",
  "mfa_ok",
  "scaleup_role",
  "shares_company_with",
  "submission_company",
  "template_version_is_draft",
  "today_myt",
  "try_uuid",
];

/** Public RPCs that only the service role may execute (never anon or authenticated). */
const SERVICE_ROLE_RPCS = ["claim_access_link"];

/** A few policies that must exist ([schema, table, policy]). */
const KEY_POLICIES: [string, string, string][] = [
  ["public", "platform_settings", "platform_settings_select"],
  ["public", "profiles", "profiles_select"],
  ["public", "companies", "companies_select"],
  ["public", "company_internal", "company_internal_select"],
  ["public", "company_internal", "company_internal_update"],
  ["public", "submissions", "submissions_select"],
  ["public", "revenue_segments", "revenue_segments_insert"],
  ["public", "comments", "comments_insert"],
  ["public", "documents", "documents_insert"],
  ["public", "audit_log", "audit_log_select"],
  ["storage", "objects", "company_documents_select"],
  ["storage", "objects", "company_documents_insert"],
];

// ---------------------------------------------------------------------------------------------
// Redaction: nothing that identifies the connection is ever printed
// ---------------------------------------------------------------------------------------------
function makeRedactor(urls: string[]): (text: string) => string {
  const secrets = new Set<string>(urls);
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      for (const value of [parsed.password, parsed.username, parsed.hostname, parsed.host]) {
        if (!value) continue;
        secrets.add(value);
        try {
          secrets.add(decodeURIComponent(value));
        } catch {
          // not percent-encoded
        }
      }
    } catch {
      // An unparsable URL: only the URL itself is redacted (postgres() will fail on it anyway).
    }
  }
  const ordered = [...secrets].filter((s) => s.length >= 3).sort((a, b) => b.length - a.length);
  return (text: string) =>
    ordered
      .reduce((out, secret) => out.split(secret).join("[redacted]"), text)
      // Resolved addresses in network errors (e.g. "connect ECONNREFUSED 1.2.3.4:5432").
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[address]")
      .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){3,7}\b/gi, "[address]");
}

// ---------------------------------------------------------------------------------------------
// Connection candidates
// ---------------------------------------------------------------------------------------------
type Candidate = { label: string; url: string };

/** SUPABASE_DB_URL, then (for a direct db.<ref>.supabase.co URL) the project's IPv4 session pooler. */
function connectionCandidates(url: string): Candidate[] {
  const candidates: Candidate[] = [{ label: "SUPABASE_DB_URL", url }];
  const explicit = process.env.SUPABASE_POOLER_URL?.trim();
  if (explicit) candidates.push({ label: "SUPABASE_POOLER_URL (session pooler)", url: explicit });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return candidates;
  }
  const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(parsed.hostname)?.[1];
  if (!ref || explicit) return candidates;
  const region = process.env.SUPABASE_REGION?.trim() || "ap-southeast-1"; // BRD B1: Singapore
  for (const cluster of ["aws-0", "aws-1"]) {
    const pooler = new URL(url);
    pooler.hostname = `${cluster}-${region}.pooler.supabase.com`;
    pooler.port = "5432"; // session mode
    pooler.username = `postgres.${ref}`;
    candidates.push({ label: `Supavisor session pooler (${cluster}, IPv4 fallback)`, url: pooler.toString() });
  }
  return candidates;
}

// ---------------------------------------------------------------------------------------------
// TLS: always verify the server before sending the password
// ---------------------------------------------------------------------------------------------
/** Supabase's root CA ("Supabase Root 2021 CA"), as downloaded from the dashboard. */
const SUPABASE_CA_FILE = path.join(ROOT_DIR, "supabase", "certs", "prod-ca-2021.crt");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type TlsPlan = { url: string; ssl: postgres.Options<Record<string, never>>["ssl"]; description: string };

/** The CA certificates to verify against, with a printable label (CN + fingerprint; no paths or hosts). */
function loadCa(source: string, pem: string): { ca: string[]; label: string } {
  const blocks: string[] = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const [firstPem] = blocks;
  if (!firstPem) throw new Error(`${source} does not contain a PEM certificate.`);
  const first = new X509Certificate(firstPem);
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(first.subject)?.[1] ?? "certificate";
  const more = blocks.length > 1 ? ` + ${blocks.length - 1} more` : "";
  // (Fingerprint without colons, so the address redaction below leaves it alone.)
  const fingerprint = first.fingerprint256.replace(/:/g, "").slice(0, 16);
  return { ca: blocks, label: `${cn}${more} (sha256 ${fingerprint}…, ${source})` };
}

/**
 * How to connect to `target` safely: the URL without the ssl parameters postgres.js cannot handle
 * (they would be sent to the server as settings) and tls.connect options that verify the server.
 * Throws with a readable reason when the server cannot be verified.
 */
function tlsPlan(target: string): TlsPlan {
  const url = new URL(target);
  const mode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  const rootCert = url.searchParams.get("sslrootcert");
  const hadParams = url.searchParams.has("sslmode") || url.searchParams.has("sslrootcert");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  const cleaned = hadParams ? url.toString() : target;

  if (LOCAL_HOSTS.has(url.hostname)) {
    // A local database (e.g. `supabase start`): nothing crosses the network.
    return { url: cleaned, ssl: mode === "disable" ? false : "prefer", description: "local database (TLS if offered, not verified)" };
  }
  if (mode !== "" && mode !== "verify-full" && mode !== "verify-ca") {
    throw new Error(
      `sslmode=${mode} does not verify the server's certificate, so the database password could be sent to an impostor. ` +
        "Remove sslmode (verify-full is the default here) or use sslmode=verify-full.",
    );
  }
  let trusted: { ca: string[]; label: string };
  const caFile = process.env.SUPABASE_DB_CA_FILE?.trim();
  if (caFile) {
    trusted = loadCa("SUPABASE_DB_CA_FILE", readFileSync(path.resolve(caFile), "utf8"));
  } else if (rootCert === "system") {
    trusted = { ca: [...tls.rootCertificates], label: "the system's trusted root certificates (sslrootcert=system)" };
  } else if (rootCert) {
    trusted = loadCa("sslrootcert", readFileSync(path.resolve(rootCert), "utf8"));
  } else if (/\.supabase\.(co|com)$/.test(url.hostname)) {
    trusted = loadCa("supabase/certs/prod-ca-2021.crt", readFileSync(SUPABASE_CA_FILE, "utf8"));
  } else {
    throw new Error(
      "No CA certificate to verify this database server with: set SUPABASE_DB_CA_FILE to its CA certificate (PEM) " +
        "or add sslrootcert=<file> to the connection string.",
    );
  }
  const checkHost = mode !== "verify-ca";
  return {
    url: cleaned,
    ssl: {
      ca: trusted.ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(checkHost ? {} : { checkServerIdentity: () => undefined }),
    },
    description: `server certificate verified against ${trusted.label}${checkHost ? ", host name checked" : " (sslmode=verify-ca: host name NOT checked)"}`,
  };
}

/** Network-level failures worth trying the next candidate for (not e.g. a wrong password). */
function isUnreachable(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return (
    ["ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT", "EAI_AGAIN"].includes(e.code ?? "") ||
    /Tenant or user not found/i.test(e.message ?? "")
  );
}

// ---------------------------------------------------------------------------------------------
// Transaction helpers
// ---------------------------------------------------------------------------------------------
class RollbackSignal extends Error {}
class UndoSignal extends Error {}

/** Runs fn in a savepoint that is always rolled back (the checks leave no trace, not even in the transaction). */
async function undone<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await tx.savepoint(async (sp) => {
      result = await fn(sp);
      throw new UndoSignal();
    });
  } catch (error) {
    if (!(error instanceof UndoSignal)) throw error;
  }
  return result as T;
}

/** Runs fn as the API role `authenticated` with the given JWT claims (like PostgREST does), then undoes it. */
function asAuthenticated<T>(tx: Tx, claims: Record<string, unknown>, fn: (sp: Tx) => Promise<T>): Promise<T> {
  return undone(tx, async (sp) => {
    await sp`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await sp.unsafe("set local role authenticated");
    return fn(sp);
  });
}

function jwt(sub: string, aal: "aal1" | "aal2" = "aal2", email = ""): Record<string, unknown> {
  return { sub, role: "authenticated", aud: "authenticated", aal, email, session_id: randomUUID(), is_anonymous: false };
}

async function count(sp: Tx, query: string): Promise<number> {
  const rows = await sp.unsafe<{ n: number }[]>(`select count(*)::int as n from (${query}) as x`);
  return rows[0].n;
}

/** 1-based line of a character position in a SQL file (for error reports). */
function lineOf(sql: string, position: string | undefined): number | null {
  const pos = Number(position);
  if (!Number.isFinite(pos) || pos <= 0) return null;
  return sql.slice(0, pos).split("\n").length;
}

function describeError(error: unknown, redact: (text: string) => string, file?: SqlFile): string {
  const e = error as Partial<postgres.PostgresError> & { message?: string; code?: string };
  const parts = [e.message ?? String(error)];
  if (e.code) parts.push(`[${e.code}]`);
  if (file) {
    const line = lineOf(file.sql, e.position);
    if (line) parts.push(`at ${file.name} line ${line}`);
  }
  if (e.detail) parts.push(`detail: ${e.detail}`);
  if (e.hint) parts.push(`hint: ${e.hint}`);
  if (e.where) parts.push(`where: ${e.where.split("\n")[0]}`);
  return redact(parts.join(" "));
}

/**
 * Creates auth users (their profiles come from the on_auth_user_created trigger) inside the current
 * savepoint; null when the postgres role may not insert into auth.users here (the check is skipped).
 */
async function createAuthUsers(sp: Tx, names: string[], fullNames: Record<string, string> = {}): Promise<string[] | null> {
  const ids: string[] = [];
  for (const name of names) {
    const id = randomUUID();
    const metadata = fullNames[name] ? { full_name: fullNames[name] } : {};
    try {
      await sp`savepoint create_auth_user`;
      await sp`insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
               values (${id}, ${`db-verify-${name}-${id.slice(0, 8)}@example.invalid`}, 'authenticated', 'authenticated',
                       ${sp.json(metadata)}::jsonb, ${sp.json({ provider: "email" })}::jsonb)`;
      await sp`release savepoint create_auth_user`;
    } catch (error) {
      await sp`rollback to savepoint create_auth_user`;
      if ((error as { code?: string }).code === "42501") return null;
      throw error;
    }
    ids.push(id);
  }
  return ids;
}

/** Marks profiles as having accepted the current terms of use (so their sessions see data). */
async function acceptCurrentTerms(sp: Tx, ids: string[]): Promise<void> {
  await sp`update public.profiles
              set terms_accepted_at = now(),
                  terms_version = (select s.terms_version from public.platform_settings s where s.id = 1)
            where id = any(${ids}::uuid[])`;
}

/** The SQLSTATE a statement fails with ("ok" when it succeeds), in a savepoint that is always undone. */
async function outcomeOf(sp: Tx, fn: (sq: Tx) => Promise<unknown>): Promise<string> {
  try {
    await undone(sp, fn);
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "error";
  }
}

/**
 * Runs fn as the API role `authenticated` with the given JWT claims and KEEPS its changes (inside the
 * check's own savepoint, which is undone later like everything else): "ok", or "<SQLSTATE> <message>"
 * when it fails (the failed statement is rolled back to its savepoint, role included).
 */
async function keptAs(sp: Tx, claims: Record<string, unknown>, fn: (as: Tx) => Promise<unknown>): Promise<string> {
  try {
    await sp.savepoint(async (inner) => {
      await inner`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await inner.unsafe("set local role authenticated");
      await fn(inner);
      await inner.unsafe("reset role");
      await inner`select set_config('request.jwt.claims', '', true)`;
    });
    return "ok";
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return `${e.code ?? "error"} ${e.message ?? ""}`.trim();
  }
}

/** A throw-away active company (rolled back with everything else). */
async function createTestCompany(sp: Tx): Promise<string> {
  const [{ id }] = await sp<{ id: string }[]>`
    insert into public.companies (name) values (${`DB Verify ${randomUUID()}`}) returning id`;
  return id;
}

const SKIPPED_AUTH_USERS = { ok: true, warn: true, detail: "skipped: the postgres role may not insert into auth.users here" };

// ---------------------------------------------------------------------------------------------
// Checks (each runs in its own rolled-back savepoint; a failing check never stops the others).
// `data: true` marks a check that depends on data, not on the migrations: on a deployed database (whose
// data may legitimately differ from the seed) its failure is reported as a warning.
// ---------------------------------------------------------------------------------------------
type CheckFn = (sp: Tx) => Promise<{ ok: boolean; detail: string; warn?: boolean; data?: boolean }>;

const CHECKS: [string, CheckFn][] = [
  [
    "public tables and row level security",
    async (sp) => {
      const tables = await sp<{ relname: string; rls: boolean }[]>`
        select c.relname, c.relrowsecurity as rls from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1`;
      const withoutRls = tables.filter((t) => !t.rls).map((t) => t.relname);
      return {
        ok: tables.length === EXPECTED.publicTables && withoutRls.length === 0,
        detail: `${tables.length} tables (expected ${EXPECTED.publicTables}); RLS off on: ${withoutRls.join(", ") || "none"}`,
      };
    },
  ],
  [
    "anon has no privileges; Supabase's default grants are revoked",
    async (sp) => {
      const relations = await count(
        sp,
        `select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p', 'S')
           and (case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
                     else has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') end)`,
      );
      const functions = await count(
        sp,
        `select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
           and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      );
      const [{ usage }] = await sp<{ usage: boolean }[]>`select has_schema_privilege('anon', 'private', 'USAGE') as usage`;
      return {
        ok: relations === 0 && functions === 0 && !usage,
        detail: `anon: ${relations} relations, ${functions} functions, private schema usage ${usage}`,
      };
    },
  ],
  [
    "authenticated reaches only the policy helpers in private, and every public RPC but the service-role-only ones",
    async (sp) => {
      const helpers = await sp<{ proname: string }[]>`
        select distinct p.proname from pg_proc p where p.pronamespace = 'private'::regnamespace
          and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`;
      const names = helpers.map((h) => h.proname);
      const unexpected = names.filter((n) => !AUTHENTICATED_HELPERS.includes(n));
      const missing = AUTHENTICATED_HELPERS.filter((n) => !names.includes(n));
      // (Event-trigger functions, e.g. Supabase's own public.rls_auto_enable(), are not RPCs.)
      const closedRpcs = await count(
        sp,
        `select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
           and p.proname <> all (array[${SERVICE_ROLE_RPCS.map((n) => `'${n}'`).join(", ")}])
           and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
      );
      const serviceOnly = await sp<{ proname: string; api: boolean; service: boolean }[]>`
        select p.proname,
               has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') as api,
               has_function_privilege('service_role', p.oid, 'EXECUTE') as service
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${SERVICE_ROLE_RPCS})`;
      const serviceOk = serviceOnly.length === SERVICE_ROLE_RPCS.length && serviceOnly.every((f) => !f.api && f.service);
      return {
        ok: unexpected.length === 0 && missing.length === 0 && closedRpcs === 0 && serviceOk,
        detail:
          `${names.length} helpers; unexpected: ${unexpected.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}; ` +
          `RPCs not executable: ${closedRpcs}; service role only: ${serviceOnly.map((f) => `${f.proname}${f.api ? " (API!)" : ""}`).join(", ") || "none"}`,
      };
    },
  ],
  [
    "security definer functions pin search_path = ''",
    async (sp) => {
      // Supabase's own event-trigger functions (e.g. public.rls_auto_enable) are platform objects:
      // checked separately below.
      const loose = await sp<{ fn: string }[]>`
        select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and p.prorettype <> 'event_trigger'::regtype
          and not coalesce(p.proconfig @> array['search_path=""'], false)`;
      return { ok: loose.length === 0, detail: loose.length ? loose.map((r) => r.fn).join(", ") : "all pinned" };
    },
  ],
  [
    "Supabase's own event-trigger functions in public are not callable through the API",
    async (sp) => {
      const fns = await sp<{ fn: string; api: boolean }[]>`
        select p.oid::regprocedure::text as fn,
               has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') as api
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'event_trigger'::regtype order by 1`;
      const callable = fns.filter((f) => f.api).map((f) => f.fn);
      return {
        ok: callable.length === 0,
        detail: fns.length
          ? `${fns.map((f) => f.fn).join(", ")}: EXECUTE revoked from anon and authenticated by 20260930000800_grants.sql${callable.length ? `; still callable: ${callable.join(", ")}` : ""}`
          : "none",
      };
    },
  ],
  [
    "key policies exist (public and storage.objects)",
    async (sp) => {
      const rows = await sp<{ schemaname: string; tablename: string; policyname: string }[]>`
        select schemaname, tablename, policyname from pg_policies where schemaname in ('public', 'storage')`;
      const have = new Set(rows.map((r) => `${r.schemaname}.${r.tablename}.${r.policyname}`));
      const missing = KEY_POLICIES.map((p) => p.join(".")).filter((p) => !have.has(p));
      const publicCount = rows.filter((r) => r.schemaname === "public").length;
      return {
        ok: missing.length === 0,
        detail: `${publicCount} policies in public; missing: ${missing.join(", ") || "none"}`,
      };
    },
  ],
  [
    "access_links is service-role only (RLS on, no policies, no API grants, guard trigger, no audit trigger)",
    async (sp) => {
      const [row] = await sp<{ rls: boolean; policies: number; anon: boolean; authenticated: boolean; service: boolean; triggers: string }[]>`
        select c.relrowsecurity as rls,
               (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'access_links') as policies,
               has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as anon,
               has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as authenticated,
               has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as service,
               coalesce((select string_agg(t.tgname, ', ' order by t.tgname) from pg_trigger t
                          where t.tgrelid = c.oid and not t.tgisinternal), '') as triggers
        from pg_class c where c.oid = 'public.access_links'::regclass`;
      return {
        ok: row.rls && row.policies === 0 && !row.anon && !row.authenticated && row.service && row.triggers === "access_links_guard",
        detail: `rls ${row.rls}, policies ${row.policies}, anon ${row.anon}, authenticated ${row.authenticated}, service_role ${row.service}, triggers: ${row.triggers || "none"}`,
      };
    },
  ],
  [
    "seed: the launch portfolio (18 companies, 3 reporting, funds SV1 7 / SFF 11)",
    async (sp) => {
      const [c] = await sp<{ companies: number; reporting: number; internal: number; stayhere: string; imotorbike: string; huddle_kpis: number }[]>`
        select (select count(*)::int from public.companies) as companies,
               (select count(*)::int from public.companies where reporting_start_month = '2026-07-01') as reporting,
               (select count(*)::int from public.company_internal) as internal,
               (select status::text from public.companies where name = 'StayHere') as stayhere,
               (select reporting_currency from public.companies where name = 'i-Motorbike') as imotorbike,
               (select count(*)::int from public.company_kpis k join public.companies co on co.id = k.company_id where co.name = 'Huddle') as huddle_kpis`;
      const funds = await sp<{ code: string; n: number }[]>`
        select f.code, count(*)::int as n from public.fund_investments fi join public.funds f on f.id = fi.fund_id group by f.code`;
      const byFund = Object.fromEntries(funds.map((f) => [f.code, f.n]));
      const ok =
        c.companies === EXPECTED.companies &&
        c.reporting === EXPECTED.reportingCompanies &&
        c.internal === EXPECTED.companies &&
        c.stayhere === "written_off" &&
        c.imotorbike === "USD" &&
        c.huddle_kpis === 4 &&
        byFund.SV1 === EXPECTED.fundInvestments.SV1 &&
        byFund.SFF === EXPECTED.fundInvestments.SFF;
      return {
        ok,
        data: true,
        detail: `${c.companies} companies (${c.reporting} reporting), ${c.internal} internal rows, SV1 ${byFund.SV1 ?? 0} / SFF ${byFund.SFF ?? 0}, StayHere ${c.stayhere}, i-Motorbike ${c.imotorbike}, Huddle KPIs ${c.huddle_kpis}`,
      };
    },
  ],
  [
    "seed: default template published, settings row, private documents bucket",
    async (sp) => {
      const [t] = await sp<{ published: number; fields: number; settings: number; bucket_private: boolean | null; bucket_limit: number | null }[]>`
        select (select count(*)::int from public.template_versions v join public.templates t on t.id = v.template_id
                 where t.is_default and v.status = 'published') as published,
               (select count(*)::int from public.template_fields f join public.template_versions v on v.id = f.template_version_id
                 where v.status = 'published') as fields,
               (select count(*)::int from public.platform_settings) as settings,
               (select not b.public from storage.buckets b where b.id = 'company-documents') as bucket_private,
               (select b.file_size_limit::int from storage.buckets b where b.id = 'company-documents') as bucket_limit`;
      return {
        ok: t.published === 1 && t.fields === EXPECTED.templateFields && t.settings === 1 && t.bucket_private === true && t.bucket_limit === 26214400,
        data: true,
        detail: `published versions ${t.published}, fields ${t.fields}, settings rows ${t.settings}, bucket private ${t.bucket_private}, limit ${t.bucket_limit}`,
      };
    },
  ],
  [
    "triggers on auth.users (profiles are created and kept in sync)",
    async (sp) => {
      const triggers = await sp<{ tgname: string }[]>`
        select tgname from pg_trigger where tgrelid = 'auth.users'::regclass
          and tgname in ('on_auth_user_created', 'on_auth_user_email_updated') order by 1`;
      return { ok: triggers.length === 2, detail: triggers.map((t) => t.tgname).join(", ") || "none" };
    },
  ],
  [
    "get_client_settings() for the system and for any signed-in session (incl. owner_contributor_limit, BRD B29)",
    async (sp) => {
      const [settings] = await sp<{ terms_version: string; owner_contributor_limit: number }[]>`
        select terms_version, owner_contributor_limit from public.platform_settings where id = 1`;
      const system = await sp<{ terms_version: string; owner_contributor_limit: number }[]>`
        select * from public.get_client_settings()`;
      const signedIn = await asAuthenticated(sp, jwt(randomUUID(), "aal1"), (as) =>
        as<Record<string, unknown>[]>`select * from public.get_client_settings()`,
      );
      const columns = signedIn[0] ? Object.keys(signedIn[0]).join(", ") : "none";
      const [grants] = await sp<{ authenticated: boolean; service: boolean; anon: boolean }[]>`
        select has_function_privilege('authenticated', 'public.get_client_settings()', 'EXECUTE') as authenticated,
               has_function_privilege('service_role', 'public.get_client_settings()', 'EXECUTE') as service,
               has_function_privilege('anon', 'public.get_client_settings()', 'EXECUTE') as anon`;
      return {
        ok:
          system.length === 1 &&
          system[0].terms_version === settings?.terms_version &&
          system[0].owner_contributor_limit === settings?.owner_contributor_limit &&
          signedIn.length === 1 &&
          columns === "require_mfa, terms_version, declaration_text, due_day, owner_contributor_limit" &&
          grants.authenticated &&
          grants.service &&
          !grants.anon,
        detail:
          `system ${system.length} row, aal1 session ${signedIn.length} row (${columns}); owner_contributor_limit ` +
          `${settings?.owner_contributor_limit ?? "?"} (default ${EXPECTED.ownerContributorLimit}); EXECUTE: authenticated ` +
          `${grants.authenticated}, service_role ${grants.service}, anon ${grants.anon}`,
      };
    },
  ],
  [
    "open_due_periods() as of 20 Oct 2026: the pilot has Jul–Sep, nobody else has months",
    async (sp) => {
      await sp`select set_config('app.today', '2026-10-20', true)`;
      const [{ created }] = await sp<{ created: number }[]>`select public.open_due_periods() as created`;
      // Counted after the call, so months a deployed database already opened (pg_cron, page loads) count too.
      const [s] = await sp<{ submissions: number; companies: number; closes: number }[]>`
        select (select count(*)::int from public.submissions) as submissions,
               (select count(distinct company_id)::int from public.submissions) as companies,
               (select count(*)::int from public.period_closes) as closes`;
      return {
        ok:
          s.submissions === EXPECTED.pilotSubmissionsAsOf20Oct2026 &&
          s.companies === EXPECTED.reportingCompanies &&
          s.closes === EXPECTED.pilotClosesAsOf20Oct2026,
        data: true,
        detail: `${created} rows created by this call; ${s.submissions} submissions for ${s.companies} companies, ${s.closes} closes`,
      };
    },
  ],
  [
    "RLS on Postgres 17: a new auth user gets a profile; data needs MFA and the current terms",
    async (sp) => {
      const userId = randomUUID();
      const email = `db-verify-${userId.slice(0, 8)}@example.invalid`;
      try {
        await sp`savepoint auth_insert`;
        await sp`insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
                 values (${userId}, ${email}, 'authenticated', 'authenticated',
                         ${sp.json({ full_name: "DB Verify" })}::jsonb, ${sp.json({ provider: "email" })}::jsonb)`;
      } catch (error) {
        const code = (error as { code?: string }).code;
        await sp`rollback to savepoint auth_insert`;
        if (code === "42501") {
          return { ok: true, warn: true, detail: "skipped: the postgres role may not insert into auth.users here" };
        }
        throw error;
      }
      const [profile] = await sp<{ n: number }[]>`select count(*)::int as n from public.profiles where id = ${userId} and email = ${email}`;
      await sp`update public.profiles set scaleup_role = 'super_admin' where id = ${userId}`;
      const visible = (aal: "aal1" | "aal2") =>
        asAuthenticated(sp, jwt(userId, aal, email), async (as) => ({
          companies: await count(as, "select 1 from public.companies"),
          settings: await count(as, "select 1 from public.platform_settings"),
          profiles: await count(as, "select 1 from public.profiles"),
        }));
      const pendingTerms = await visible("aal2");
      await acceptCurrentTerms(sp, [userId]);
      const beforeMfa = await visible("aal1");
      const full = await visible("aal2");
      const [{ companies: allCompanies }] = await sp<{ companies: number }[]>`select count(*)::int as companies from public.companies`;
      // A ScaleUp partner, whose profile company users must never see (BRD B24, B28).
      const partnerId = randomUUID();
      await sp`insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
               values (${partnerId}, ${`db-verify-${partnerId.slice(0, 8)}@example.invalid`}, 'authenticated', 'authenticated',
                       ${sp.json({ full_name: "DB Verify Partner" })}::jsonb, ${sp.json({ provider: "email" })}::jsonb)`;
      await sp`update public.profiles set scaleup_role = 'partner' where id = ${partnerId}`;
      const staffSeenByAdmin = await asAuthenticated(sp, jwt(userId, "aal2", email), (as) =>
        count(as, `select 1 from public.profiles where scaleup_role is not null and id in ('${userId}', '${partnerId}')`),
      );
      // The same user as a company owner of one company.
      await sp`update public.profiles set scaleup_role = null where id = ${userId}`;
      await sp`insert into public.company_members (company_id, user_id, role)
               select c.id, ${userId}, 'owner' from public.companies c where c.name = 'Batik Boutique'`;
      const owner = await asAuthenticated(sp, jwt(userId, "aal2", email), async (as) => ({
        companies: await count(as, "select 1 from public.companies"),
        settings: await count(as, "select 1 from public.platform_settings"),
        internal: await count(as, "select 1 from public.company_internal"),
        funds: await count(as, "select 1 from public.fund_investments"),
        staff: await count(as, "select 1 from public.profiles where scaleup_role is not null"),
      }));
      const ok =
        profile.n === 1 &&
        pendingTerms.companies === 0 && pendingTerms.settings === 0 && pendingTerms.profiles === 1 &&
        beforeMfa.companies === 0 && beforeMfa.settings === 0 &&
        full.companies === allCompanies && full.settings === 1 && staffSeenByAdmin === 2 &&
        owner.companies === 1 && owner.settings === 0 && owner.internal === 0 && owner.funds === 0 && owner.staff === 0;
      return {
        ok,
        detail:
          `profile ${profile.n}; super admin before terms ${pendingTerms.companies} companies, at aal1 ${beforeMfa.companies}, ` +
          `fully signed in ${full.companies} of ${allCompanies} companies / ${full.settings} settings / ${staffSeenByAdmin} of 2 test staff profiles; ` +
          `company owner ${owner.companies} company, ${owner.settings} settings, ${owner.internal} internal, ` +
          `${owner.funds} fund rows, ${owner.staff} staff profiles`,
      };
    },
  ],
  [
    "access links on Postgres 17: validity cap, owners' links only for their own contributors, single-use claim",
    async (sp) => {
      const users: string[] = [];
      for (const name of ["owner", "contributor", "other"]) {
        const id = randomUUID();
        try {
          await sp`savepoint link_user`;
          await sp`insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data)
                   values (${id}, ${`db-verify-${name}-${id.slice(0, 8)}@example.invalid`}, 'authenticated', 'authenticated',
                           '{}'::jsonb, ${sp.json({ provider: "email" })}::jsonb)`;
        } catch (error) {
          await sp`rollback to savepoint link_user`;
          if ((error as { code?: string }).code === "42501") {
            return { ok: true, warn: true, detail: "skipped: the postgres role may not insert into auth.users here" };
          }
          throw error;
        }
        users.push(id);
      }
      const [owner, contributor, other] = users;
      await sp`insert into public.company_members (company_id, user_id, role)
               select c.id, u.id, u.role::public.company_role from public.companies c,
                 (values (${owner}::uuid, 'owner'), (${contributor}::uuid, 'contributor')) as u(id, role)
               where c.name = 'Batik Boutique'`;
      await sp`insert into public.company_members (company_id, user_id, role)
               select c.id, ${other}::uuid, 'owner' from public.companies c where c.name = 'Kiddocare'`;
      const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
      const outcome = async (fn: (sq: Tx) => Promise<unknown>): Promise<string> => {
        try {
          await undone(sp, fn);
          return "ok";
        } catch (error) {
          return (error as { code?: string }).code ?? "error";
        }
      };
      const insert = (userId: string, createdBy: string | null, purpose: string, validFor: string, token = hash()) => (sq: Tx) =>
        sq`insert into public.access_links (user_id, purpose, token_hash, expires_at, created_by)
           values (${userId}, ${purpose}, ${token}, now() + ${validFor}::interval, ${createdBy})`;
      const own = await outcome(insert(contributor, owner, "invite", "7 days"));
      const foreign = await outcome(insert(other, owner, "signin", "24 hours"));
      const tooLong = await outcome(insert(contributor, null, "signin", "25 hours"));
      // Single use: the first claim returns the account, the second nothing. (Called as this trusted
      // connection, i.e. a system caller like the service role; EXECUTE is checked above.)
      const token = hash();
      const claims = await undone(sp, async (sq) => {
        await insert(contributor, owner, "signin", "24 hours", token)(sq);
        const first = await sq<{ user_id: string }[]>`select * from public.claim_access_link(${token})`;
        const second = await sq<{ user_id: string }[]>`select * from public.claim_access_link(${token})`;
        return [first.length, second.length, first[0]?.user_id === contributor];
      });
      const ok = own === "ok" && foreign === "42501" && tooLong === "23514" && claims[0] === 1 && claims[1] === 0 && claims[2] === true;
      return {
        ok,
        detail: `owner → own contributor ${own}, owner → another company's owner ${foreign}, 25-hour sign-in link ${tooLong}; claims ${claims[0]} then ${claims[1]}`,
      };
    },
  ],
  [
    "BRD B28 on Postgres 17: company users get ScaleUp names only through staff_display_names() (no profile, email or role)",
    async (sp) => {
      const users = await createAuthUsers(sp, ["b28-owner", "b28-partner", "b28-fund-admin"], {
        "b28-owner": "DB Verify Owner",
        "b28-partner": "DB Verify Partner",
      });
      if (!users) return SKIPPED_AUTH_USERS;
      const [owner, partner, nameless] = users;
      await sp`update public.profiles set scaleup_role = 'partner' where id = ${partner}`;
      await sp`update public.profiles set scaleup_role = 'fund_admin' where id = ${nameless}`;
      await acceptCurrentTerms(sp, [owner]);
      const company = await createTestCompany(sp);
      await sp`insert into public.company_members (company_id, user_id, role) values (${company}, ${owner}, 'owner')`;
      const ids = [partner, nameless, owner, randomUUID()];
      const seen = await asAuthenticated(sp, jwt(owner, "aal2"), async (as) => ({
        names: await as<{ id: string; display_name: string }[]>`
          select id::text as id, display_name from public.staff_display_names(${ids}::uuid[]) order by display_name`,
        staffProfiles: await count(as, `select 1 from public.profiles where id in ('${partner}', '${nameless}')`),
      }));
      const atAal1 = await outcomeOf(sp, (sq) =>
        asAuthenticated(sq, jwt(owner, "aal1"), (as) => as`select * from public.staff_display_names(${ids}::uuid[])`),
      );
      const [grants] = await sp<{ authenticated: boolean; anon: boolean }[]>`
        select has_function_privilege('authenticated', 'public.staff_display_names(uuid[])', 'EXECUTE') as authenticated,
               has_function_privilege('anon', 'public.staff_display_names(uuid[])', 'EXECUTE') as anon`;
      const expected = [
        { id: partner, display_name: "DB Verify Partner (ScaleUp)" },
        { id: nameless, display_name: "ScaleUp" },
      ];
      return {
        ok:
          JSON.stringify(seen.names) === JSON.stringify(expected) &&
          seen.staffProfiles === 0 &&
          atAal1 === "42501" &&
          grants.authenticated &&
          !grants.anon,
        detail:
          `company owner sees ${seen.names.map((n) => `"${n.display_name}"`).join(", ") || "no names"} for 2 staff ids, ` +
          `${seen.staffProfiles} staff profiles; at aal1 ${atAal1}; EXECUTE authenticated ${grants.authenticated}, anon ${grants.anon}`,
      };
    },
  ],
  [
    "BRD B29 on Postgres 17: owners are held to owner_contributor_limit, ScaleUp is not",
    async (sp) => {
      const users = await createAuthUsers(sp, ["b29-owner", "b29-admin", "b29-c1", "b29-c2", "b29-c3", "b29-c4"]);
      if (!users) return SKIPPED_AUTH_USERS;
      const [owner, admin, c1, c2, c3, c4] = users;
      await sp`update public.profiles set scaleup_role = 'super_admin' where id = ${admin}`;
      await acceptCurrentTerms(sp, [owner, admin]);
      const company = await createTestCompany(sp);
      await sp`insert into public.company_members (company_id, user_id, role) values (${company}, ${owner}, 'owner')`;
      await sp`update public.platform_settings set owner_contributor_limit = 2 where id = 1`;
      const add = (caller: string, user: string) =>
        keptAs(sp, jwt(caller, "aal2"), (as) =>
          as`insert into public.company_members (company_id, user_id, role) values (${company}, ${user}, 'contributor')`,
        );
      const steps = [
        ["owner adds 1st", await add(owner, c1)],
        ["owner adds 2nd", await add(owner, c2)],
        ["owner adds 3rd", await add(owner, c3)],
        ["Super Admin adds 3rd", await add(admin, c3)],
        ["owner adds 4th", await add(owner, c4)],
      ];
      const full = (n: number) => `P0001 Your team already has ${n} contributors. Deactivate one, or ask ScaleUp to add more.`;
      const expected = ["ok", "ok", full(2), "ok", full(3)];
      const [{ active }] = await sp<{ active: number }[]>`
        select count(*)::int as active from public.company_members where company_id = ${company} and role = 'contributor' and is_active`;
      return {
        ok: steps.every(([, outcome], i) => outcome === expected[i]) && active === 3,
        detail: `limit 2: ${steps.map(([step, outcome]) => `${step} → ${outcome}`).join("; ")}; ${active} active contributors`,
      };
    },
  ],
  [
    "BRD B30 on Postgres 17: owners set their own revenue segments through set_company_revenue_segments(); ScaleUp lines stay direct writes",
    async (sp) => {
      const users = await createAuthUsers(sp, ["b30-owner", "b30-fund-admin", "b30-contributor"]);
      if (!users) return SKIPPED_AUTH_USERS;
      const [owner, admin, contributor] = users;
      await sp`update public.profiles set scaleup_role = 'fund_admin' where id = ${admin}`;
      await acceptCurrentTerms(sp, [owner, admin, contributor]);
      const company = await createTestCompany(sp);
      await sp`insert into public.company_members (company_id, user_id, role) values
                 (${company}, ${owner}, 'owner'), (${company}, ${contributor}, 'contributor')`;
      const set = (caller: string, list: postgres.JSONValue) =>
        keptAs(sp, jwt(caller, "aal2"), (as) =>
          as`select * from public.set_company_revenue_segments(${company}, ${as.json(list)}::jsonb)`,
        );
      const insert = (caller: string, kind: string, name: string) =>
        keptAs(sp, jwt(caller, "aal2"), (as) =>
          as`insert into public.revenue_segments (company_id, kind, name) values (${company}, ${kind}, ${name})`,
        );
      const steps: [string, string, (outcome: string) => boolean][] = [
        ["owner sets Online, Retail", await set(owner, [{ name: "Online" }, { name: "Retail" }]), (o) => o === "ok"],
        [
          "owner repeats a name",
          await set(owner, [{ name: "Online" }, { name: " online" }]),
          (o) => o === 'P0001 There are two revenue segments called "online". Give each segment a different name.',
        ],
        ["contributor", await set(contributor, [{ name: "Online" }]), (o) => o === "42501 Only the company owner can change its revenue segments."],
        ["Fund Admin adds Corporate", await set(admin, [{ name: "Online" }, { name: "Retail" }, { name: "Corporate" }]), (o) => o === "ok"],
        ["owner inserts a company segment directly", await insert(owner, "company", "Direct"), (o) => o.startsWith("42501 ")],
        ["Fund Admin inserts a company segment directly", await insert(admin, "company", "Direct"), (o) => o.startsWith("42501 ")],
        ["Fund Admin adds a ScaleUp line", await insert(admin, "scaleup", "Online"), (o) => o === "ok"],
      ];
      const [rows] = await sp<{ company: number; scaleup: number; on_behalf: boolean | null }[]>`
        select (select count(*)::int from public.revenue_segments where company_id = ${company} and kind = 'company' and is_active) as company,
               (select count(*)::int from public.revenue_segments where company_id = ${company} and kind = 'scaleup') as scaleup,
               (select bool_and(a.on_behalf) from public.audit_log a
                 where a.company_id = ${company} and a.summary = 'Revenue segment "Corporate" added') as on_behalf`;
      return {
        ok: steps.every(([, outcome, expected]) => expected(outcome)) && rows.company === 3 && rows.scaleup === 1 && rows.on_behalf === true,
        detail:
          `${steps.map(([step, outcome]) => `${step} → ${outcome}`).join("; ")}; ${rows.company} company segments, ` +
          `${rows.scaleup} ScaleUp line, Fund Admin's change audited on behalf: ${rows.on_behalf}`,
      };
    },
  ],
  [
    "pg_cron job open-due-periods (optional)",
    async (sp) => {
      const [{ schema }] = await sp<{ schema: boolean }[]>`select to_regnamespace('cron') is not null as schema`;
      if (!schema) return { ok: true, warn: true, detail: "pg_cron not installed: months open on page loads only" };
      const jobs = await sp<{ schedule: string }[]>`select schedule from cron.job where jobname = 'open-due-periods'`;
      return jobs.length === 1
        ? { ok: true, detail: `scheduled '${jobs[0].schedule}' (UTC)` }
        : { ok: true, warn: true, detail: "not scheduled (see supabase/README.md)" };
    },
  ],
];

// ---------------------------------------------------------------------------------------------
// What is deployed (supabase_migrations, written by `supabase db push`)
// ---------------------------------------------------------------------------------------------
type Recorded = { version: string; name: string | null; statements: string[] | null };

/** The migrations `db push` recorded in supabase_migrations.schema_migrations, oldest first ([] when none). */
async function recordedMigrations(tx: Tx): Promise<Recorded[]> {
  const [{ present }] = await tx<{ present: boolean }[]>`
    select to_regclass('supabase_migrations.schema_migrations') is not null as present`;
  if (!present) return [];
  const columns = new Set(
    (
      await tx<{ name: string }[]>`
        select a.attname as name from pg_attribute a
        where a.attrelid = 'supabase_migrations.schema_migrations'::regclass and a.attnum > 0 and not a.attisdropped`
    ).map((c) => c.name),
  );
  // (Older CLI versions record only the version.)
  return tx.unsafe<Recorded[]>(
    `select version::text as version,
            ${columns.has("name") ? "name::text" : "null::text"} as name,
            ${columns.has("statements") ? "statements::text[]" : "null::text[]"} as statements
       from supabase_migrations.schema_migrations
      order by version`,
  );
}

/**
 * Best effort: the deployed files still spell the statements `db push` recorded for them (ignoring
 * whitespace and semicolons), under the same name. `db push` never applies a recorded version again, so
 * an edited deployed file would silently never reach the database: changes belong in a new migration.
 */
function deployedFilesCheck(files: SqlFile[], recorded: Recorded[]): Check {
  const byVersion = new Map(recorded.map((row) => [row.version, row]));
  const changed: string[] = [];
  const renamed: string[] = [];
  let compared = 0;
  for (const file of files) {
    const row = byVersion.get(migrationVersion(file.name));
    if (!row) continue;
    if (row.name && `${row.version}_${row.name}.sql` !== file.name) renamed.push(`${file.name} (recorded as ${row.name})`);
    if (!row.statements || row.statements.length === 0) continue;
    compared += 1;
    if (!statementsMatchFile(row.statements, file.sql)) changed.push(file.name);
  }
  const issues = [
    changed.length ? `changed since they were pushed: ${changed.join(", ")} (put the change in a NEW migration and restore the file)` : "",
    renamed.length ? `renamed: ${renamed.join(", ")}` : "",
  ].filter(Boolean);
  return {
    status: issues.length === 0 ? "PASS" : "WARN",
    name: "deployed migration files are unchanged since they were pushed (best effort)",
    detail:
      compared === 0
        ? "the recorded migrations carry no statements to compare with"
        : `${compared - changed.length} of ${compared} match the recorded statements${issues.length ? `; ${issues.join("; ")}` : ""}`,
  };
}

/** The seed as `db push --include-seed` recorded it (supabase_migrations.seed_files: sha256 of the file). */
async function seedCheck(tx: Tx, seed: SqlFile): Promise<Check> {
  const name = "seed.sql as recorded by db push --include-seed";
  const [{ present }] = await tx<{ present: boolean }[]>`select to_regclass('supabase_migrations.seed_files') is not null as present`;
  if (!present) return { status: "PASS", name, detail: "no seed recorded (pushed without --include-seed)" };
  const rows = await tx<{ path: string; hash: string }[]>`select path, hash from supabase_migrations.seed_files`;
  const row = rows.find((r) => /(^|\/)seed\.sql$/.test(r.path));
  if (!row) return { status: "PASS", name, detail: "no seed recorded (pushed without --include-seed)" };
  const hash = createHash("sha256").update(seed.sql).digest("hex");
  return {
    status: "PASS",
    name,
    detail:
      row.hash === hash
        ? "unchanged since it was pushed"
        : "changed since it was pushed: `db push --include-seed` will run it again (safe: every block is idempotent)",
  };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    console.error("db:verify: SUPABASE_DB_URL is not set (add the Supabase Postgres connection string to .env.local).");
    return 1;
  }
  const candidates = connectionCandidates(url);
  const redact = makeRedactor(candidates.map((c) => c.url));
  const notices: string[] = [];

  // Refuse files that would end the dry run's transaction (checked before connecting).
  const migrations = readMigrations();
  const seed = readSeed();
  const control = [...migrations, seed].flatMap((file) =>
    findTransactionControl(file.sql).map((t) => `${file.name} line ${t.line}: ${t.statement}`),
  );
  if (control.length > 0) {
    console.log("db:verify: these files contain transaction control, which would commit the dry run part-way through:");
    for (const entry of control) console.log(`  FAIL  ${entry}`);
    console.log("Result: FAIL — nothing was run. Migrations and the seed must not contain BEGIN / COMMIT / END / ROLLBACK / SAVEPOINT (supabase/README.md).");
    return 1;
  }

  const open = (plan: TlsPlan) =>
    postgres(plan.url, {
      max: 1,
      prepare: false, // works through the Supavisor poolers too
      connect_timeout: 15,
      idle_timeout: 5,
      ssl: plan.ssl,
      connection: { application_name: "scaleup-db-verify" },
      onnotice: (notice) => notices.push(redact(notice.message ?? String(notice))),
    });

  // Connect: one attempt per candidate, stopping at the first that answers. Every candidate's server
  // certificate is verified before the password is sent.
  let sql: postgres.Sql | null = null;
  let tlsDescription = "";
  const attempts: string[] = [];
  for (const candidate of candidates) {
    let plan: TlsPlan;
    try {
      plan = tlsPlan(candidate.url);
    } catch (error) {
      attempts.push(`${candidate.label}: ${redact(error instanceof Error ? error.message : String(error))}`);
      break;
    }
    const client = open(plan);
    try {
      await client`select 1`;
      sql = client;
      tlsDescription = plan.description;
      console.log(`db:verify: connected via ${candidate.label}`);
      break;
    } catch (error) {
      attempts.push(`${candidate.label}: ${describeError(error, redact)}`);
      await client.end({ timeout: 2 }).catch(() => undefined);
      if (!isUnreachable(error)) break;
    }
  }
  if (!sql) {
    console.log("db:verify: could not connect to the database:");
    for (const attempt of attempts) console.log(`  FAIL  ${attempt}`);
    console.log("Result: FAIL — nothing was run.");
    return 1;
  }
  console.log(`db:verify: TLS: ${redact(tlsDescription)}`);

  const checks: Check[] = [];
  const applied: string[] = [];
  let server = "";
  let fatal: string | null = null;

  console.log(
    "db:verify: dry run of the migrations not yet deployed + seed.sql on the Supabase database (one transaction, always rolled back)",
  );
  try {
    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '300s'`;
      await tx`set local lock_timeout = '20s'`;
      const [info] = await tx<{ version: string; num: number; role: string }[]>`
        select current_setting('server_version') as version, current_setting('server_version_num')::int as num, current_user as role`;
      server = `PostgreSQL ${info.version} as ${info.role === "postgres" ? "postgres" : "a non-postgres role"}`;
      const major = Math.floor(info.num / 10000);
      checks.push({
        status: major === EXPECTED.serverMajor ? "PASS" : "WARN",
        name: `server is Postgres ${EXPECTED.serverMajor}`,
        detail: `PostgreSQL ${info.version}`,
      });

      // What `db push` has recorded, and what it would apply next.
      const recorded = await recordedMigrations(tx);
      const plan = planMigrations(migrations, recorded.map((r) => r.version));
      const deployed = recorded.length > 0;
      const [{ existing }] = await tx<{ existing: number }[]>`
        select count(*)::int as existing from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'p')`;
      if (!deployed) {
        checks.push({
          status: existing === 0 ? "PASS" : "WARN",
          name: "nothing deployed yet: no recorded migrations and an empty public schema",
          detail: `${existing} existing tables/views; all ${migrations.length} migrations are pending`,
        });
      } else {
        const problems = [
          plan.unknown.length > 0
            ? `recorded but not in supabase/migrations: ${plan.unknown.join(", ")} (pull them, or check SUPABASE_DB_URL points at this project)`
            : "",
          plan.outOfOrder.length > 0
            ? `pending but older than the newest deployed version ${recorded.at(-1)?.version}: ${plan.outOfOrder.map((f) => f.name).join(", ")} (db push would skip them; rename them later than it)`
            : "",
        ].filter(Boolean);
        checks.push({
          status: problems.length === 0 ? "PASS" : "FAIL",
          name: "deployed migrations are a prefix of supabase/migrations; the rest is pending",
          detail:
            `${plan.deployed.length} deployed (latest ${recorded.at(-1)?.version}), ${plan.pending.length} pending` +
            `${plan.pending.length ? `: ${plan.pending.map((f) => f.name).join(", ")}` : ""}; ${existing} tables/views in public` +
            (problems.length ? `; ${problems.join("; ")}` : ""),
        });
        checks.push(deployedFilesCheck(plan.deployed, recorded));
        checks.push(await seedCheck(tx, seed));
      }
      if (plan.unknown.length > 0 || plan.outOfOrder.length > 0) {
        fatal = "the database and supabase/migrations disagree (see above): nothing was applied.";
        throw new RollbackSignal(fatal);
      }

      // Tripwire: the transaction id must stay the same through every file (a COMMIT / ROLLBACK that
      // slipped past the scan would end this transaction and let the rest of the file autocommit).
      const xid = async () => (await tx<{ xid: string }[]>`select pg_current_xact_id()::text as xid`)[0].xid;
      const startXid = await xid();
      for (const file of [...plan.pending, seed]) {
        const started = Date.now();
        try {
          await tx.unsafe(file.sql).simple();
        } catch (error) {
          fatal = `${file.name} failed: ${describeError(error, redact, file)}`;
          throw error;
        }
        if ((await xid()) !== startXid) {
          fatal =
            `${file.name} ended the dry run's transaction (transaction control in the file?): statements may have been ` +
            "COMMITTED to the real database. Check it now.";
          throw new Error(fatal);
        }
        applied.push(`${file.name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      }
      checks.push({
        status: "PASS",
        name: `applied ${plan.pending.length} pending migration${plan.pending.length === 1 ? "" : "s"} and the seed`,
        detail: applied.join(", "),
      });

      for (const [name, fn] of CHECKS) {
        try {
          const result = await undone(tx, fn);
          const status: Status = result.ok
            ? result.warn
              ? "WARN"
              : "PASS"
            : deployed && result.data
              ? "WARN"
              : "FAIL";
          const note = !result.ok && deployed && result.data ? " (data on the deployed database differs from the seed)" : "";
          checks.push({ status, name, detail: redact(result.detail + note) });
        } catch (error) {
          checks.push({ status: "FAIL", name, detail: describeError(error, redact) });
        }
      }
      throw new RollbackSignal("always roll back");
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal) && !fatal) {
      fatal = `could not run the dry run: ${describeError(error, redact)}`;
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (server) console.log(`Server: ${server}`);
  for (const check of checks) console.log(`  ${check.status}  ${check.name} — ${check.detail}`);
  const uniqueNotices = [...new Set(notices)];
  if (uniqueNotices.length > 0) {
    console.log(`Notices (${notices.length}): ${uniqueNotices.slice(0, 8).join(" | ")}${uniqueNotices.length > 8 ? " | …" : ""}`);
  }
  const failed = checks.filter((c) => c.status === "FAIL").length;
  const warned = checks.filter((c) => c.status === "WARN").length;
  if (fatal) {
    console.log(`  FAIL  ${fatal}`);
    console.log("Result: FAIL — the transaction was rolled back; the database is unchanged.");
    return 1;
  }
  console.log(
    `Result: ${failed === 0 ? "PASS" : "FAIL"} — ${checks.length - failed - warned} passed, ${warned} warnings, ${failed} failed. ` +
      "Everything was rolled back; the database is unchanged.",
  );
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Unexpected (e.g. a bug in this script): never print the raw error object (it could carry options).
    console.error(`db:verify: unexpected error: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
