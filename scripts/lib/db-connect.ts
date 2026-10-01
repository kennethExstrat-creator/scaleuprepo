/**
 * A direct, TLS-verified Postgres connection for one-off admin scripts (scripts/import-history.ts), with
 * the same rules as scripts/db-verify.ts:
 *   - SUPABASE_DB_URL first; for a direct db.<ref>.supabase.co host (IPv6-only without the IPv4 add-on)
 *     the project's Supavisor SESSION pooler is tried next (SUPABASE_POOLER_URL, else aws-0 / aws-1 in
 *     SUPABASE_REGION, default ap-southeast-1), once each;
 *   - the server's certificate is ALWAYS verified before the password is sent, host name included:
 *     SUPABASE_DB_CA_FILE (PEM), else sslrootcert=<file>|system in the URL, else Supabase's root CA in
 *     supabase/certs/prod-ca-2021.crt for *.supabase.co / *.supabase.com hosts; sslmode=verify-ca skips
 *     the host-name check; weaker sslmode values are refused; local hosts keep `prefer`;
 *   - connection details and credentials are never printed (makeRedactor).
 * Connects as the URL's role (normally `postgres`: bypasses RLS; audited as "system").
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";

import postgres from "postgres";

/** The repository root: the nearest directory (from the working directory up) with supabase/migrations. */
function rootDir(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "supabase", "migrations")) && existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const SUPABASE_CA_FILE = path.join(rootDir(), "supabase", "certs", "prod-ca-2021.crt");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Hides passwords, user names, host names and IP addresses in text that may be printed. */
export function makeRedactor(urls: string[]): (text: string) => string {
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
      // An unparsable URL: only the URL itself is redacted.
    }
  }
  const ordered = [...secrets].filter((secret) => secret.length >= 3).sort((a, b) => b.length - a.length);
  return (text: string) =>
    ordered
      .reduce((out, secret) => out.split(secret).join("[redacted]"), text)
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[address]")
      .replace(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){3,7}\b/gi, "[address]");
}

type Candidate = { label: string; url: string };

/** SUPABASE_DB_URL, then (for a direct db.<ref>.supabase.co URL) the project's IPv4 session pooler. */
export function connectionCandidates(url: string): Candidate[] {
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
  const region = process.env.SUPABASE_REGION?.trim() || "ap-southeast-1";
  for (const cluster of ["aws-0", "aws-1"]) {
    const pooler = new URL(url);
    pooler.hostname = `${cluster}-${region}.pooler.supabase.com`;
    pooler.port = "5432";
    pooler.username = `postgres.${ref}`;
    candidates.push({ label: `Supavisor session pooler (${cluster}, IPv4 fallback)`, url: pooler.toString() });
  }
  return candidates;
}

type TlsPlan = { url: string; ssl: postgres.Options<Record<string, never>>["ssl"] };

function loadCa(source: string, pem: string): string[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (blocks.length === 0) throw new Error(`${source} does not contain a PEM certificate.`);
  return blocks;
}

/** How to connect safely: the URL without the ssl parameters postgres.js cannot handle, and verifying TLS options. */
export function tlsPlan(target: string): TlsPlan {
  const url = new URL(target);
  const mode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  const rootCert = url.searchParams.get("sslrootcert");
  const hadParams = url.searchParams.has("sslmode") || url.searchParams.has("sslrootcert");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  const cleaned = hadParams ? url.toString() : target;

  if (LOCAL_HOSTS.has(url.hostname)) return { url: cleaned, ssl: mode === "disable" ? false : "prefer" };
  if (mode !== "" && mode !== "verify-full" && mode !== "verify-ca") {
    throw new Error(
      `sslmode=${mode} does not verify the server's certificate, so the database password could be sent to an impostor. ` +
        "Remove sslmode (verify-full is the default here) or use sslmode=verify-full.",
    );
  }
  let ca: string[];
  const caFile = process.env.SUPABASE_DB_CA_FILE?.trim();
  if (caFile) ca = loadCa("SUPABASE_DB_CA_FILE", readFileSync(path.resolve(caFile), "utf8"));
  else if (rootCert === "system") ca = [...tls.rootCertificates];
  else if (rootCert) ca = loadCa("sslrootcert", readFileSync(path.resolve(rootCert), "utf8"));
  else if (/\.supabase\.(co|com)$/.test(url.hostname)) ca = loadCa("supabase/certs/prod-ca-2021.crt", readFileSync(SUPABASE_CA_FILE, "utf8"));
  else {
    throw new Error(
      "No CA certificate to verify this database server with: set SUPABASE_DB_CA_FILE to its CA certificate (PEM) " +
        "or add sslrootcert=<file> to the connection string.",
    );
  }
  return {
    url: cleaned,
    ssl: {
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(mode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}),
    },
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

export type Connection = { sql: postgres.Sql; via: string; redact: (text: string) => string };

/** Connects to SUPABASE_DB_URL (or its pooler fallback) with a verified certificate; throws a readable error. */
export async function connect(applicationName: string): Promise<Connection> {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error("SUPABASE_DB_URL is not set (add the Supabase Postgres connection string to .env.local).");
  const candidates = connectionCandidates(url);
  const redact = makeRedactor(candidates.map((candidate) => candidate.url));
  const attempts: string[] = [];
  for (const candidate of candidates) {
    let plan: TlsPlan;
    try {
      plan = tlsPlan(candidate.url);
    } catch (error) {
      attempts.push(`${candidate.label}: ${redact(error instanceof Error ? error.message : String(error))}`);
      break;
    }
    const client = postgres(plan.url, {
      max: 1,
      prepare: false, // works through the Supavisor poolers too
      connect_timeout: 15,
      idle_timeout: 5,
      ssl: plan.ssl,
      connection: { application_name: applicationName },
      onnotice: () => undefined,
    });
    try {
      await client`select 1`;
      return { sql: client, via: candidate.label, redact };
    } catch (error) {
      const e = error as { message?: string; code?: string };
      attempts.push(`${candidate.label}: ${redact(`${e.message ?? String(error)}${e.code ? ` [${e.code}]` : ""}`)}`);
      await client.end({ timeout: 2 }).catch(() => undefined);
      if (!isUnreachable(error)) break;
    }
  }
  throw new Error(`Could not connect to the database:\n  ${attempts.join("\n  ")}`);
}
