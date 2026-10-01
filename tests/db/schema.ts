/**
 * Builds the ScaleUp database in PGlite: Supabase shim → supabase/migrations (filename order) →
 * optional supabase/seed.sql. Shared by the DB test harness and scripts/gen-db-types.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/** The repository root: the nearest directory (from the working directory up) with supabase/migrations. */
function findRootDir(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "supabase", "migrations")) && existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Run this from the repository (no supabase/migrations folder found).");
    dir = parent;
  }
}

export const ROOT_DIR = findRootDir();
export const MIGRATIONS_DIR = path.join(ROOT_DIR, "supabase", "migrations");
export const SEED_FILE = path.join(ROOT_DIR, "supabase", "seed.sql");
export const SHIM_FILE = path.join(ROOT_DIR, "tests", "db", "supabase-shim.sql");

export type SqlFile = { name: string; sql: string };

/** Migration files named <14-digit timestamp>_<name>.sql, in the order `supabase db push` applies them. */
export function readMigrations(): SqlFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_[A-Za-z0-9_-]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
}

/** The version `supabase db push` records for a migration file: its 14-digit timestamp prefix. */
export function migrationVersion(name: string): string {
  return /^(\d{14})_/.exec(name)?.[1] ?? name;
}

export type MigrationPlan = {
  /** Files whose version is recorded in supabase_migrations.schema_migrations (already deployed). */
  deployed: SqlFile[];
  /** Files not recorded yet, in the order `db push` applies them. */
  pending: SqlFile[];
  /** Recorded versions with no file here (`db push` refuses to run until they are pulled). */
  unknown: string[];
  /** Pending files older than the newest recorded version (`db push` skips them without --include-all). */
  outOfOrder: SqlFile[];
};

/** Which migrations a deployed database still needs, given the versions it has recorded. */
export function planMigrations(files: SqlFile[], recordedVersions: Iterable<string>): MigrationPlan {
  const recorded = new Set(recordedVersions);
  const local = new Set(files.map((file) => migrationVersion(file.name)));
  const deployed = files.filter((file) => recorded.has(migrationVersion(file.name)));
  const pending = files.filter((file) => !recorded.has(migrationVersion(file.name)));
  const newest = [...recorded].sort().at(-1);
  return {
    deployed,
    pending,
    unknown: [...recorded].filter((version) => !local.has(version)).sort(),
    outOfOrder: newest === undefined ? [] : pending.filter((file) => migrationVersion(file.name) < newest),
  };
}

/**
 * True when the statements `supabase db push` recorded for a migration (schema_migrations.statements:
 * the file split at top-level semicolons, each trimmed) still spell the file on disk, ignoring whitespace
 * and semicolons. A deployed migration must never change: `db push` would not run it again.
 */
export function statementsMatchFile(statements: readonly string[], sql: string): boolean {
  const squash = (text: string) => text.replace(/[\s;]+/g, "");
  return squash(statements.join("\n")) === squash(sql);
}

export function readShim(): SqlFile {
  return { name: "supabase-shim.sql", sql: readFileSync(SHIM_FILE, "utf8") };
}

export function readSeed(): SqlFile {
  return { name: "seed.sql", sql: readFileSync(SEED_FILE, "utf8") };
}

/** Hash of everything that shapes the database (used to cache the migrated base image). */
export function schemaFingerprint(seed: boolean): string {
  const hash = createHash("sha256");
  hash.update(PGLITE_VERSION);
  for (const file of [readShim(), ...readMigrations(), ...(seed ? [readSeed()] : [])]) {
    hash.update(`\n--${file.name}\n`);
    hash.update(file.sql);
  }
  return hash.digest("hex").slice(0, 24);
}

const PGLITE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT_DIR, "node_modules", "@electric-sql", "pglite", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

export class SqlFileError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    const err = cause as { message?: string; code?: string; position?: string; where?: string };
    super(
      `${file} failed: ${err?.message ?? String(cause)}` +
        (err?.code ? ` [${err.code}]` : "") +
        (err?.where ? `\n  where: ${err.where}` : ""),
    );
    this.name = "SqlFileError";
  }
}

/** Runs one SQL file as a single implicit transaction (like `supabase db push` does per migration). */
export async function runSqlFile(db: PGlite, file: SqlFile): Promise<void> {
  try {
    await db.exec(file.sql);
  } catch (error) {
    throw new SqlFileError(file.name, error);
  }
}

/** Sessions run in UTC like Supabase (PGlite otherwise uses the host time zone). */
export async function setUtcTimeZone(db: PGlite): Promise<void> {
  await db.exec("set timezone to 'UTC';");
}

/** A new in-memory database with the shim, all migrations and (optionally) the seed applied. */
export async function createMigratedDatabase(options: { seed: boolean }): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec("alter database postgres set timezone to 'UTC';");
  await setUtcTimeZone(db);
  await runSqlFile(db, readShim());
  for (const migration of readMigrations()) {
    await runSqlFile(db, migration);
  }
  if (options.seed) {
    await runSqlFile(db, readSeed());
  }
  return db;
}
