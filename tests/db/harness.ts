/**
 * PGlite test harness for supabase/migrations.
 *
 * - The migrated + seeded base database is built once (shim → migrations → seed) and cached as a
 *   PGDATA tarball in the OS temp dir, keyed by a hash of the SQL. Every test file then loads its
 *   own fresh copy (`freshDb()`), so files are isolated and the suite stays fast.
 * - `db.asUser(userId, fn, { aal })` runs `fn` in a transaction as the `authenticated` role with
 *   Supabase-style `request.jwt.claims` (sub, role, aal, email), like PostgREST does.
 *   `asAnon` / `asService` do the same for the anon and service_role roles.
 * - `db.setToday('2026-10-20')` sets the `app.today` test hook read by private.today_myt().
 * - Direct `db.query()` calls run as the `postgres` superuser (setup only; bypasses RLS).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { expect } from "vitest";
import { createMigratedDatabase, schemaFingerprint, setUtcTimeZone } from "./schema";

export type Row = Record<string, unknown>;
export type ScaleupRole = "super_admin" | "fund_admin" | "partner" | "viewer";
export type CompanyRole = "owner" | "contributor";
export type CompanyStatus = "active" | "exited" | "written_off";
export type Aal = "aal1" | "aal2";

/** Result parsers: dates stay 'YYYY-MM-DD', timestamps stay raw text, numerics become numbers. */
const PARSERS = {
  1082: (value: string) => value, // date
  1114: (value: string) => value, // timestamp
  1184: (value: string) => value, // timestamptz
  1700: (value: string) => Number(value), // numeric
};

type Queryable = Pick<PGlite, "query" | "exec"> | Pick<Transaction, "query" | "exec">;

/** Query helpers shared by the superuser connection and role-scoped transactions. */
export class Sql {
  constructor(protected readonly conn: Queryable) {}

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.conn.query<T>(sql, params as never[]);
    return result.rows;
  }

  /** Exactly one row (throws otherwise). */
  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}: ${sql}`);
    return rows[0];
  }

  /** First column of the first row (undefined when there is no row). */
  async value<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<Row>(sql, params);
    const first = rows[0];
    return (first ? Object.values(first)[0] : undefined) as T;
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    return Number(await this.value(`select count(*)::int from (${sql}) as _counted`, params));
  }

  async exec(sql: string): Promise<void> {
    await this.conn.exec(sql);
  }

  /** Calls public.<fn>(arg => value, …) with named arguments and returns its result. */
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`Bad function name: ${fn}`);
    const names = Object.keys(args);
    for (const name of names) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad argument name: ${name}`);
    }
    const list = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
    const rows = await this.query<{ result: T }>(
      `select public.${fn}(${list}) as result`,
      names.map((name) => args[name]),
    );
    return rows[0]?.result as T;
  }
}

export type UserOptions = {
  email?: string;
  fullName?: string | null;
  scaleupRole?: ScaleupRole | null;
  isActive?: boolean;
  /**
   * Accept the current terms of use (platform_settings.terms_version) on creation. Default true: the
   * database hides all data from users who have not accepted them (private.terms_ok()).
   */
  acceptTerms?: boolean;
  /** Extra raw_user_meta_data (e.g. to prove roles are never taken from metadata). */
  metadata?: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
};

export type CompanyOptions = {
  name?: string;
  /** First month to report ('YYYY-MM-01'); default '2026-07-01'; null = not yet reporting. */
  reportingStartMonth?: string | null;
  status?: CompanyStatus;
  /** Stored in company_internal (ScaleUp-only). */
  partnerInChargeId?: string | null;
  currency?: string;
};

export class TestDb extends Sql {
  private readonly emails = new Map<string, string>();

  constructor(readonly pg: PGlite) {
    super(pg);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  /** Sets the app.today test hook (Malaysia date) for this session; null restores the real date. */
  async setToday(date: string | null): Promise<void> {
    await this.query("select set_config('app.today', $1, false)", [date ?? ""]);
  }

  /** Creates an auth user (the trigger creates the profile) and optionally a ScaleUp role. */
  async createUser(options: UserOptions = {}): Promise<string> {
    const id = randomUUID();
    const email = options.email ?? `user-${id.slice(0, 8)}@example.test`;
    const metadata: Record<string, unknown> = { ...options.metadata };
    if (options.fullName !== null) metadata.full_name = options.fullName ?? `User ${id.slice(0, 4)}`;
    await this.query(
      `insert into auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
       values ($1, $2, 'authenticated', 'authenticated', $3, $4, now())`,
      [id, email, metadata, { provider: "email", providers: ["email"], ...options.appMetadata }],
    );
    const acceptTerms = options.acceptTerms ?? true;
    if (options.scaleupRole || options.isActive === false || acceptTerms) {
      await this.query(
        `update public.profiles
            set scaleup_role = $2,
                is_active = $3,
                terms_accepted_at = case when $4 then now() end,
                terms_version = case when $4 then (select s.terms_version from public.platform_settings s where s.id = 1) end
          where id = $1`,
        [id, options.scaleupRole ?? null, options.isActive ?? true, acceptTerms],
      );
    }
    this.emails.set(id, email);
    return id;
  }

  /** Records that the user accepted the current terms of use (as the database owner). */
  async acceptTerms(userId: string): Promise<void> {
    await this.query(
      `update public.profiles
          set terms_accepted_at = now(),
              terms_version = (select s.terms_version from public.platform_settings s where s.id = 1)
        where id = $1`,
      [userId],
    );
  }

  async addMember(companyId: string, userId: string, role: CompanyRole, isActive = true): Promise<void> {
    await this.query(
      `insert into public.company_members (company_id, user_id, role, is_active) values ($1, $2, $3, $4)
       on conflict (company_id, user_id) do update set role = excluded.role, is_active = excluded.is_active`,
      [companyId, userId, role, isActive],
    );
  }

  async createCompany(options: CompanyOptions = {}): Promise<string> {
    const id = randomUUID();
    await this.query(
      `insert into public.companies (id, name, reporting_start_month, status, reporting_currency)
       values ($1, $2, $3, $4, $5)`,
      [
        id,
        options.name ?? `Company ${id.slice(0, 8)}`,
        options.reportingStartMonth === undefined ? "2026-07-01" : options.reportingStartMonth,
        options.status ?? "active",
        options.currency ?? "MYR",
      ],
    );
    if (options.partnerInChargeId) {
      // The company_internal row is created by trigger with the company.
      await this.query("update public.company_internal set partner_in_charge_id = $2 where company_id = $1", [
        id,
        options.partnerInChargeId,
      ]);
    }
    return id;
  }

  /** Runs fn in a transaction as `authenticated` with JWT claims for userId (aal2 by default). */
  async asUser<T>(
    userId: string,
    fn: (sql: Sql) => Promise<T>,
    options: { aal?: Aal; email?: string } = {},
  ): Promise<T> {
    const claims = {
      aud: "authenticated",
      role: "authenticated",
      sub: userId,
      email: options.email ?? this.emails.get(userId) ?? "",
      aal: options.aal ?? "aal2",
      session_id: randomUUID(),
      is_anonymous: false,
    };
    return this.withRole("authenticated", claims, fn);
  }

  async asAnon<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.withRole("anon", { role: "anon", is_anonymous: false }, fn);
  }

  async asService<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.withRole("service_role", { role: "service_role" }, fn);
  }

  private async withRole<T>(role: string, claims: Row, fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.query(`set local role ${role}`);
      return fn(new Sql(tx));
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Base image cache
// ---------------------------------------------------------------------------------------------
const CACHE_DIR = path.join(os.tmpdir(), "scaleup-db-tests");
let baseImage: Promise<Blob> | null = null;

async function buildBaseImage(): Promise<Blob> {
  const key = schemaFingerprint(true);
  const file = path.join(CACHE_DIR, `base-${key}.tar`);
  if (existsSync(file)) {
    try {
      return new Blob([readFileSync(file)]);
    } catch {
      // fall through and rebuild
    }
  }
  const db = await createMigratedDatabase({ seed: true });
  const dump = await db.dumpDataDir("none");
  await db.close();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    for (const old of readdirSync(CACHE_DIR)) {
      if (old.startsWith("base-") && old.endsWith(".tar") && old !== path.basename(file)) {
        rmSync(path.join(CACHE_DIR, old), { force: true });
      }
    }
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
    renameSync(tmp, file);
  } catch {
    // The cache is an optimisation only.
  }
  return dump;
}

/** A fresh, fully migrated and seeded database (own PGlite instance). */
export async function freshDb(): Promise<TestDb> {
  baseImage ??= buildBaseImage();
  const image = await baseImage;
  const pg = await PGlite.create({ loadDataDir: image, parsers: PARSERS });
  await setUtcTimeZone(pg);
  return new TestDb(pg);
}

// ---------------------------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------------------------
export type PgError = Error & { code?: string; detail?: string; hint?: string };

/** Awaits a promise that must reject with a Postgres error (optionally with code / message). */
export async function expectPgError(
  promise: Promise<unknown>,
  expected: { code?: string; message?: string | RegExp } = {},
): Promise<PgError> {
  let error: PgError | undefined;
  try {
    await promise;
  } catch (caught) {
    error = caught as PgError;
  }
  expect(error, `expected a database error${expected.message ? ` matching ${String(expected.message)}` : ""}`).toBeDefined();
  const err = error as PgError;
  if (expected.code) expect(err.code, `error code for: ${err.message}`).toBe(expected.code);
  if (expected.message instanceof RegExp) expect(err.message).toMatch(expected.message);
  else if (typeof expected.message === "string") expect(err.message).toBe(expected.message);
  return err;
}

/** Permission failure raised by our RPCs / RLS / privileges (SQLSTATE 42501). */
export async function expectDenied(promise: Promise<unknown>, message?: string | RegExp): Promise<PgError> {
  return expectPgError(promise, { code: "42501", message });
}

/** Business-rule failure raised by our RPCs (SQLSTATE P0001). */
export async function expectRule(promise: Promise<unknown>, message?: string | RegExp): Promise<PgError> {
  return expectPgError(promise, { code: "P0001", message });
}
