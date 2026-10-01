/**
 * Finds top-level transaction-control statements (BEGIN, START TRANSACTION, COMMIT, END, ROLLBACK,
 * ABORT, SAVEPOINT, RELEASE, PREPARE TRANSACTION) in a SQL file.
 *
 * Migrations and the seed must not contain any: `supabase db push` runs each file in its own
 * transaction, and `npm run db:verify` replays them all inside ONE transaction that it always rolls
 * back — a COMMIT (or END) in a file would commit that dry run part-way through on the real database,
 * and a ROLLBACK would let the statements after it autocommit. db-verify refuses such files before it
 * connects; tests/db/migrations.test.ts keeps the repository free of them.
 *
 * A small SQL lexer: skips -- and nested /* *\/ comments, '…' strings (with '' and, for E'…', backslash
 * escapes), "…" identifiers and $tag$…$tag$ bodies (PL/pgSQL begin/end/commit inside them are not
 * statements), and splits statements on semicolons outside parentheses (CREATE RULE … DO (…; …)) and
 * outside SQL-standard function bodies (CREATE FUNCTION/PROCEDURE … BEGIN ATOMIC … END), as psql does.
 */

export type TransactionControl = {
  /** 1-based line of the statement's first keyword. */
  line: number;
  /** The statement's leading keywords, e.g. "COMMIT" or "START TRANSACTION". */
  statement: string;
};

const CONTROL_KEYWORDS = new Set(["begin", "start", "commit", "end", "rollback", "abort", "savepoint", "release"]);

type Word = { text: string; offset: number };

/** Every top-level transaction-control statement of `sql`, in order. */
export function findTransactionControl(sql: string): TransactionControl[] {
  const found: TransactionControl[] = [];
  let words: Word[] = []; // the first words of the current statement
  let atomicDepth = 0; // BEGIN ATOMIC … END nesting inside CREATE FUNCTION / PROCEDURE
  let parenDepth = 0;

  const lineAt = (offset: number) => sql.slice(0, offset).split("\n").length;
  const isRoutineDefinition = () => {
    const w = words.map((x) => x.text);
    const i = w[0] === "create" ? (w[1] === "or" && w[2] === "replace" ? 3 : 1) : -1;
    return i > 0 && (w[i] === "function" || w[i] === "procedure");
  };
  const endStatement = () => {
    const first = words[0];
    if (first && CONTROL_KEYWORDS.has(first.text)) {
      found.push({ line: lineAt(first.offset), statement: words.slice(0, first.text === "start" ? 2 : 1).map((w) => w.text.toUpperCase()).join(" ") });
    } else if (first?.text === "prepare" && words[1]?.text === "transaction") {
      found.push({ line: lineAt(first.offset), statement: "PREPARE TRANSACTION" });
    }
    words = [];
    atomicDepth = 0;
    parenDepth = 0;
  };

  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // /* block comment */ (nested)
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    // 'string' (E'…' allows backslash escapes)
    if (ch === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      i++;
      while (i < n) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    // "quoted identifier"
    if (ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"' && sql[i + 1] === '"') i += 2;
        else if (sql[i] === '"') {
          i++;
          break;
        } else i++;
      }
      continue;
    }
    // $tag$ body $tag$ (not $1 parameters, not a $ inside an identifier such as a$b)
    if (ch === "$" && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1]))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 66))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    // Words (keywords and identifiers)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      const text = sql.slice(start, i).toLowerCase();
      if (words.length < 8) words.push({ text, offset: start });
      if (isRoutineDefinition()) {
        if (text === "begin") atomicDepth++;
        else if (text === "case" && atomicDepth > 0) atomicDepth++;
        else if (text === "end" && atomicDepth > 0) atomicDepth--;
      }
      continue;
    }
    if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === ";" && atomicDepth === 0 && parenDepth === 0) endStatement();
    i++;
  }
  endStatement();
  return found;
}
