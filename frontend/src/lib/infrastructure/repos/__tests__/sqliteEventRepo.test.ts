/**
 * SqliteEventRepo — append + monotonic cursor + payload JSON sanity.
 */
import { describe, it, expect } from "vitest";
import { freshMigratedDb } from "@/__tests__/migratedDb";
import { SqliteEventRepo } from "../sqliteEventRepo";

describe("SqliteEventRepo", () => {
  it("appends and returns monotonic ids", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteEventRepo(db);
    const a = await repo.append({
      personaId, eventType: "transfer.committed", providerId: "bkash",
      payload: { transferId: "t1" }, ts: 1_000,
    });
    const b = await repo.append({
      personaId, eventType: "balance.appended", providerId: null,
      payload: { ok: true }, ts: 2_000,
    });
    expect(a).toBeLessThan(b);
  });

  it("since returns rows with id > sinceId ordered asc", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteEventRepo(db);
    const a = await repo.append({
      personaId, eventType: "transfer.committed", providerId: "bkash",
      payload: { transferId: "t1" }, ts: 1_000,
    });
    await repo.append({
      personaId, eventType: "balance.appended", providerId: null,
      payload: { ok: true }, ts: 2_000,
    });
    const rows = await repo.since(personaId, a, 100);
    expect(rows.length).toBe(1);
    expect(rows[0]!.ts).toBe(2_000);
  });

  it("recent returns newest-first", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteEventRepo(db);
    await repo.append({
      personaId, eventType: "transfer.committed", providerId: "bkash",
      payload: { transferId: "t1" }, ts: 1_000,
    });
    await repo.append({
      personaId, eventType: "balance.appended", providerId: null,
      payload: { ok: true }, ts: 2_000,
    });
    const rows = await repo.recent(personaId, 10);
    expect(rows[0]!.ts).toBe(2_000);
  });
});
