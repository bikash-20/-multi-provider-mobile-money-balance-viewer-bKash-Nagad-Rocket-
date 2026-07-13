/**
 * SqliteTransferRepo — atomic 4-row txn + replay safety + conflict path.
 */
import { describe, it, expect } from "vitest";
import { freshMigratedDb } from "@/__tests__/migratedDb";
import { SqliteTransferRepo } from "../sqliteTransferRepo";
import { SqliteBalanceRepo } from "../sqliteBalanceRepo";
import { newTransferId } from "@/lib/domain/transferId";
import { TransferConflictError } from "@/lib/domain/repositories/transferRepo";

describe("SqliteTransferRepo", () => {
  it("commits and produces double-entry shape", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);

    const before = await balances.listByPersona(personaId);
    const bkash = before.find((b) => b.providerId === "bkash")!;
    const nagad = before.find((b) => b.providerId === "nagad")!;

    const result = await transfers.commit({
      transferId: newTransferId(),
      personaId,
      fromProvider: "bkash",
      toProvider: "nagad",
      amountBdt: 5_000 as never,
      fromExpectedVersion: bkash.versionId,
      toExpectedVersion: nagad.versionId,
      note: "rent share",
    });

    expect(result.amountBdt).toBe(5_000);
    expect(result.fromDelta).toBe(-5_000);
    expect(result.toDelta).toBe(5_000);
    expect(result.fromAfter).toBe(45_000);
    expect(result.toAfter).toBe(25_000);
    expect(result.fromVersion).toBe(2);
    expect(result.toVersion).toBe(2);

    const entries = db.prepare(
      "SELECT provider_id, balance FROM balance_entries ORDER BY id",
    ).all() as { provider_id: string; balance: number }[];
    expect(entries.length).toBe(3 + 2); // 3 seed + 2 per-leg history rows
  });

  it("is replay-safe: second commit with same id is a no-op", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const before = await balances.listByPersona(personaId);
    const transferId = newTransferId();

    const first = await transfers.commit({
      transferId,
      personaId,
      fromProvider: "bkash",
      toProvider: "rocket",
      amountBdt: 1_000 as never,
      fromExpectedVersion: before.find((b) => b.providerId === "bkash")!.versionId,
      toExpectedVersion: before.find((b) => b.providerId === "rocket")!.versionId,
      note: "replay",
    });
    const second = await transfers.commit({
      transferId,
      personaId,
      fromProvider: "bkash",
      toProvider: "rocket",
      amountBdt: 1_000 as never,
      fromExpectedVersion: 1,
      toExpectedVersion: 1,
      note: "replay",
    });
    expect(second.transferId).toBe(first.transferId);

    const after = await balances.listByPersona(personaId);
    expect(after.find((b) => b.providerId === "bkash")!.balance).toBe(49_000);
  });

  it("raises TransferConflictError on stale optimistic version", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    await expect(
      transfers.commit({
        transferId: newTransferId(),
        personaId,
        fromProvider: "bkash",
        toProvider: "nagad",
        amountBdt: 1_000 as never,
        fromExpectedVersion: 999,
        toExpectedVersion: 1,
        note: "stale",
      }),
    ).rejects.toBeInstanceOf(TransferConflictError);
  });

  it("rollback leaves the ledger untouched when the txn throws", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const before = await balances.listByPersona(personaId);

    expect(() => {
      (() => {
        try {
          db.transaction(() => {
            // First INSERT should succeed; second must fail and roll back.
            db.prepare(
              "INSERT INTO transfers (transfer_id, persona_id, from_provider, to_provider, amount_bdt, from_delta, to_delta, from_after, from_version, to_after, to_version, note, ts) VALUES (?, ?, 'bkash', 'nagad', 1, -1, 1, 1, 1, 1, 1, '', 0)",
            ).run("first", personaId);
            db.prepare(
              "INSERT INTO transfers (transfer_id, persona_id, from_provider, to_provider, amount_bdt, from_delta, to_delta, from_after, from_version, to_after, to_version, note, ts) VALUES (?, ?, 'bkash', 'nagad', 1, -1, 1, 1, 1, 1, 1, '', 0)",
            ).run("first", personaId);
          })();
        } catch {
          // expected
        }
      })();
    }).not.toThrow();
    // Sanity: no `first` row.
    const stuck = db.prepare("SELECT count(*) as n FROM transfers WHERE transfer_id = 'first'").get() as { n: number };
    expect(stuck.n).toBe(0);

    // And the balances are unchanged.
    const after = await balances.listByPersona(personaId);
    expect(after.find((b) => b.providerId === "bkash")!.balance).toBe(
      before.find((b) => b.providerId === "bkash")!.balance,
    );
  });
});
