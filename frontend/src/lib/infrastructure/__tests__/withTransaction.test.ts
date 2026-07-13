/***************
 * withTransaction.test.ts — prove the atomicity guarantee before any
 * caller (ledger, advisory FSM, event log) depends on it.
 *
 * Three cases:
 *   1. resolved callback commits,
 *   2. thrown callback rolls back the whole batch,
 *   3. thrown SQL inside the transaction still rolls back (defence in
 *      depth — the callback may swallow a SQLite constraint violation).
 ***************/
import { describe, it, expect } from "vitest";
import Database, { type Database as DB, type Statement } from "better-sqlite3";
import { withTransaction } from "../transaction";

function freshDb(): DB {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (n INTEGER NOT NULL)");
  return db;
}

describe("withTransaction", () => {
  it("commits when fn resolves", () => {
    const db = freshDb();
    const insert: Statement<[number]> = db.prepare("INSERT INTO t VALUES (?)");
    withTransaction(db, () => {
      insert.run(1);
      insert.run(2);
    });
    const rows = db.prepare<[], { n: number }>("SELECT n FROM t ORDER BY n").all();
    expect(rows).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("rolls back when fn throws", () => {
    const db = freshDb();
    const insert: Statement<[number]> = db.prepare("INSERT INTO t VALUES (?)");
    expect(() =>
      withTransaction(db, () => {
        insert.run(1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const rows = db.prepare("SELECT n FROM t").all();
    expect(rows).toEqual([]);
  });

  it("rolls back when an inner statement violates a constraint", () => {
    const db = freshDb();
    db.exec("CREATE UNIQUE INDEX idx_t_n ON t(n)");
    const insert: Statement<[number]> = db.prepare("INSERT INTO t VALUES (?)");
    expect(() =>
      withTransaction(db, () => {
        insert.run(1);
        insert.run(1); // duplicate
      }),
    ).toThrow();
    const rows = db.prepare("SELECT n FROM t").all();
    expect(rows).toEqual([]);
  });
});
