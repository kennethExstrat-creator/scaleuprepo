/**
 * Imports the months BEFORE each company's reporting start month from the historical C4 workbooks
 * (BRD §6.1, §12, B3: "Months before that come from the historical workbook migration") as approved
 * monthly updates, so YoY comparisons, half-year totals and the C4 workbook have their history.
 *
 *   npx tsx --env-file=.env.local scripts/import-history.ts --file history/batik-boutique.csv
 *   npx tsx --env-file=.env.local scripts/import-history.ts --file history/all.xlsx --sheet Monthly --commit
 *
 * DRY RUN BY DEFAULT: everything is checked and written inside one transaction that is then rolled back,
 * so the report shows exactly what would happen (database rules included) and nothing changes. Add
 * --commit to import for real (still one transaction: all or nothing).
 *
 * File format (CSV, or the first sheet of an .xlsx / the one named with --sheet): one row per company and
 * month; the first row names the columns.
 *   company            company name as on the platform (or its id)
 *   month              2025-07, 2025-07-01 or "Jul 2025" (an Excel date works too)
 *   revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt
 *                      the core figures, in the company's reporting currency (required unless
 *                      --allow-missing; revenue_total may be left out when segment:… columns are given:
 *                      it is then their sum)
 *   <field key>        any other field of the reporting template, e.g. key_milestones,
 *                      financial_commentary, fundraising_status (one of its options), team_morale (1–5),
 *                      help_tags (options separated by ";")
 *   segment:<name>     revenue of the company's own revenue segment <name>; they must add up to revenue_total
 *   line:<name>        revenue of ScaleUp revenue line <name> (need not add up)
 *   kpi:<name>         a company KPI; kpi:<name> [<member>] for a KPI reported per dimension member
 *   #<anything>        ignored (notes)
 * Blank cells are left empty. Numbers may be written as 1234.5, "1,234.50", "RM 1,234" or "(1,000)".
 * A starting point: docs/history-import-template.csv (replace the example company, segments and KPIs with the
 * company's own; columns a company does not use can be left out).
 *
 * Rules: the company must exist; the month must have ended and be before the company's reporting start
 * month (any ended month for a company that is not reporting yet); months already on the platform are
 * skipped and never changed (a re-run is harmless); segments, lines, KPIs and members are matched by name
 * (ignoring case) — with --create-segments, segments and lines the company does not have are added as
 * ones no longer in use. Imported months are approved with an "Imported from the historical workbook"
 * timeline entry and audited as "system" (action "import"). Reporting months that do not exist yet are
 * created with the platform's due day and the default template's published version (or
 * --template-version <uuid>). FX rates of non-MYR companies for those months are set as usual on
 * /admin/cycles (FX rates tab).
 *
 * Connection: SUPABASE_DB_URL from .env.local, TLS verified as in db:verify (scripts/lib/db-connect.ts).
 * Exit code 0 = imported (or dry run passed), 1 = errors (nothing written).
 */
import { parseArgs } from "node:util";

import { todayMYT } from "../src/lib/periods";
import { connect } from "./lib/db-connect";
import {
  applyImport,
  describeMonths,
  loadImportContext,
  planImport,
  type ImportMessage,
  type ImportOptions,
  type SqlExecutor,
} from "./lib/history-import";
import { readTable, TableError, type Table } from "./lib/tabular";

const USAGE = `Usage:
  npx tsx --env-file=.env.local scripts/import-history.ts --file <file.csv|file.xlsx> [--file …] [--sheet <name>]
                                                          [--commit] [--allow-missing] [--create-segments]
                                                          [--template-version <uuid>]

  (default)            dry run: checks and writes everything in a transaction that is rolled back
  --commit             import for real (one transaction: all or nothing)
  --allow-missing      import months whose core figures are incomplete (reported as warnings)
  --create-segments    add revenue segments / ScaleUp revenue lines the company does not have, as no longer in use
  --template-version   template version for reporting months the import creates (default: the default template)
  --sheet              the Excel sheet to read (default: the first)`;

class RollbackSignal extends Error {}

function printMessages(title: string, messages: ImportMessage[], limit = 200): void {
  if (messages.length === 0) return;
  console.log(`\n${title} (${messages.length}):`);
  for (const message of messages.slice(0, limit)) console.log(`  ${message.source}: ${message.message}`);
  if (messages.length > limit) console.log(`  … and ${messages.length - limit} more`);
}

function readArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      file: { type: "string", multiple: true },
      sheet: { type: "string" },
      commit: { type: "boolean", default: false },
      "allow-missing": { type: "boolean", default: false },
      "create-segments": { type: "boolean", default: false },
      "template-version": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
}

async function main(): Promise<number> {
  let args: ReturnType<typeof readArgs>;
  try {
    args = readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`import-history: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  if (args.values.help) {
    console.log(USAGE);
    return 0;
  }
  const files = args.values.file ?? [];
  if (files.length === 0) {
    console.error(`import-history: name at least one --file.\n\n${USAGE}`);
    return 1;
  }

  const tables: Table[] = [];
  try {
    for (const file of files) tables.push(await readTable(file, { sheet: args.values.sheet }));
  } catch (error) {
    console.error(`import-history: ${error instanceof TableError || error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const rowCount = tables.reduce((total, table) => total + table.rows.length, 0);
  console.log(`import-history: read ${rowCount} rows from ${tables.map((table) => table.file).join(", ")}`);

  const options: ImportOptions = {
    allowMissing: args.values["allow-missing"] ?? false,
    createSegments: args.values["create-segments"] ?? false,
    templateVersionId: args.values["template-version"]?.trim() || null,
    today: todayMYT(),
  };
  const commit = args.values.commit ?? false;

  let connection: Awaited<ReturnType<typeof connect>>;
  try {
    connection = await connect("scaleup-import-history");
  } catch (error) {
    console.error(`import-history: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const { sql, redact } = connection;
  console.log(`import-history: connected via ${connection.via} (certificate verified)`);
  console.log(commit ? "import-history: importing (one transaction)" : "import-history: DRY RUN (rolled back at the end)");

  let outcome: "committed" | "dry-run" | "failed" = "failed";
  try {
    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '300s'`;
      await tx`set local lock_timeout = '20s'`;
      const exec: SqlExecutor = {
        query: async <T>(text: string, params: unknown[] = []) =>
          Array.from(await tx.unsafe(text, params as never[])) as T[],
      };
      const context = await loadImportContext(exec, { templateVersionId: options.templateVersionId });
      const plan = planImport(context, tables, options);

      printMessages("Errors", plan.errors);
      printMessages("Warnings", plan.warnings);
      printMessages("Skipped (already on the platform)", plan.skipped, 50);
      if (plan.errors.length > 0) {
        console.log("\nResult: FAIL — fix the errors above; nothing was written.");
        throw new RollbackSignal("errors");
      }

      console.log("\nTo import:");
      for (const company of plan.companies) {
        const created = company.newSegments.length
          ? `; adds ${company.newSegments.map((segment) => `"${segment.name}"`).join(", ")} (no longer in use)`
          : "";
        console.log(`  ${company.companyName}: ${describeMonths(company.months.map((month) => month.month))}${created}`);
      }
      if (plan.companies.length === 0) console.log("  nothing (every month is already on the platform)");
      if (plan.newPeriods.length > 0) console.log(`  New reporting months: ${describeMonths(plan.newPeriods)}`);

      const result = await applyImport(exec, plan, context);
      console.log(
        `\nWrote ${result.monthsImported} approved months, ${result.periodsCreated} reporting months and ` +
          `${result.segmentsCreated.length} segments no longer in use.`,
      );
      if (!commit) throw new RollbackSignal("dry run");
    });
    outcome = "committed";
  } catch (error) {
    if (error instanceof RollbackSignal) {
      outcome = error.message === "dry run" ? "dry-run" : "failed";
    } else {
      const e = error as { message?: string; code?: string; detail?: string };
      console.error(
        `\nimport-history: the database refused the import: ${redact(`${e.message ?? String(error)}${e.code ? ` [${e.code}]` : ""}${e.detail ? ` (${e.detail})` : ""}`)}`,
      );
      console.log("Result: FAIL — the transaction was rolled back; nothing was written.");
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (outcome === "dry-run") {
    console.log("Result: PASS (dry run) — everything was rolled back. Run again with --commit to import.");
    return 0;
  }
  if (outcome === "committed") {
    console.log("Result: IMPORTED — committed.");
    return 0;
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`import-history: unexpected error: ${error instanceof Error ? error.name : "unknown"}`);
    process.exit(1);
  },
);
