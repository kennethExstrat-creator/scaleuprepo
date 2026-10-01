import { describe, expect, it } from "vitest";

import { findTransactionControl } from "../../scripts/sql-transaction-control";

// scripts/sql-transaction-control.ts guards `npm run db:verify` (one always-rolled-back transaction on
// the real database): a top-level COMMIT / END / ROLLBACK … in a migration or the seed would commit the
// dry run part-way through. tests/db/migrations.test.ts checks the real files.

const statements = (sql: string) => findTransactionControl(sql).map((t) => `${t.line}:${t.statement}`);

describe("findTransactionControl", () => {
  it("finds every kind of top-level transaction control, case-insensitively, with its line", () => {
    const sql = [
      "create table t (id int);", // 1
      "BEGIN;", // 2
      "insert into t values (1);", // 3
      "commit;", // 4
      "Start Transaction isolation level serializable;", // 5
      "savepoint a; release savepoint a;", // 6
      "rollback to savepoint a;", // 7
      "ROLLBACK;", // 8
      "abort;", // 9
      "end;", // 10
      "commit prepared 'x'; prepare transaction 'y';", // 11
      "  -- a comment first", // 12
      "  commit", // 13 (no trailing semicolon)
    ].join("\n");
    expect(statements(sql)).toEqual([
      "2:BEGIN",
      "4:COMMIT",
      "5:START TRANSACTION",
      "6:SAVEPOINT",
      "6:RELEASE",
      "7:ROLLBACK",
      "8:ROLLBACK",
      "9:ABORT",
      "10:END",
      "11:COMMIT",
      "11:PREPARE TRANSACTION",
      "13:COMMIT",
    ]);
  });

  it("ignores PL/pgSQL bodies, comments, strings and identifiers", () => {
    const sql = `
      create or replace function private.f() returns trigger language plpgsql as $$
      begin
        if new.x then
          commit; -- (would fail inside a transaction anyway)
        end if;
        return new;
      end;
      $$;
      create function g() returns int language plpgsql as $body$ begin return 1; end $body$;
      do $$ begin perform 1; end $$;
      create function h() returns text language sql as 'select ''commit;'' ';
      select 'x; commit; y', E'it\\'s; end;', "commit;end" from t; -- commit;
      /* begin; /* nested; commit; */ still a comment; rollback; */
      select $1::int, a$b, "begin" from t;
      comment on table t is 'end; begin;';
      prepare q as select 1;
      create rule r as on insert to t do also (insert into u values (1); insert into u values (2));
    `;
    expect(statements(sql)).toEqual([]);
  });

  it("keeps SQL-standard function bodies (BEGIN ATOMIC … END) whole", () => {
    const sql = `
      create function f(a int) returns int language sql
      begin atomic
        select case when a > 0 then 1 else 0 end;
        select 2;
      end;
      create or replace procedure p() language sql begin atomic insert into t values (1); end;
      commit;
    `;
    expect(statements(sql)).toEqual(["8:COMMIT"]);
  });

  it("an unterminated string or body swallows the rest (nothing after it is a statement)", () => {
    expect(statements("select 'oops; commit;")).toEqual([]);
    expect(statements("do $$ begin; commit;")).toEqual([]);
  });
});
