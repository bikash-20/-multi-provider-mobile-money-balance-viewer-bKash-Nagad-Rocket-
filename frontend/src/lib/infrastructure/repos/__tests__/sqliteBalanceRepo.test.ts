/**
 * SqliteBalanceRepo — optimistic lock + insufficient balance.
 */
import { describe, it, expect } from "vitest";
import { freshMigratedDb } from "@/__tests__/migratedDb";
import { SqliteBalanceRepo } from "../sqliteBalanceRepo";
import {
  BalanceConflictError,
  InsufficientBalanceError,
} from "@/lib/domain/repositories/balanceRepo";

describe("SqliteBalanceRepo", () => {
  it("reads the seeded balance", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteBalanceRepo(db);
    const row = await repo.get(personaId, "bkash");
    expect(row?.balance).toBe(50_000);
    expect(row?.versionId).toBe(1);
  });

  it("applies a positive delta and bumps version_id", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteBalanceRepo(db);
    const after = await repo.applyDelta({
      personaId, providerId: "bkash", deltaBdt: 1_000 as never, expectedVersion: 1,
    });
    expect(after.balance).toBe(51_000);
    expect(after.versionId).toBe(2);
  });

  it("raises BalanceConflictError on stale version", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteBalanceRepo(db);
    await repo.applyDelta({
      personaId, providerId: "bkash", deltaBdt: 1_000 as never, expectedVersion: 1,
    });
    await expect(
      repo.applyDelta({
        personaId, providerId: "bkash", deltaBdt: 1_000 as never, expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(BalanceConflictError);
  });

  it("raises InsufficientBalanceError when delta would underflow", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteBalanceRepo(db);
    await expect(
      repo.applyDelta({
        personaId, providerId: "rocket", deltaBdt: -20_000 as never, expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });

  it("lists by persona", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteBalanceRepo(db);
    const rows = await repo.listByPersona(personaId);
    expect(rows.map((r) => r.providerId).sort()).toEqual(["bkash", "nagad", "rocket"]);
  });
});
