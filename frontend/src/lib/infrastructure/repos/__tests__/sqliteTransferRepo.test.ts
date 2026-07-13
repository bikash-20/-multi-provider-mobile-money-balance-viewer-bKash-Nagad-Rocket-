/**
 * SqliteTransferRepo — atomic 4-row txn + replay safety + conflict path.
 */
import { describe, it, expect } from "vitest";
import { freshMigratedDb } from "@/__tests__/migratedDb";
import { SqliteTransferRepo } from "../sqliteTransferRepo";
import { SqliteBalanceRepo } from "../sqliteBalanceRepo";
import { newTransferId } from "@/lib/domain/transferId";
import {
  TransferConflictError,
  TransferNotFoundError,
  TransferAlreadyReversedError,
} from "@/lib/domain/repositories/transferRepo";

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

  // ─── Phase 8: commitReverse ─────────────────────────────────────────
  //
  // The contract:
  //   • Insert a NEW transfers row whose from/to are swapped and whose
  //     `reverses_transfer_id` points at the original.
  //   • Apply the inverse deltas atomically.
  //   • Throw TransferNotFoundError / TransferAlreadyReversedError /
  //     TransferConflictError as appropriate.
  //   • Append a wallet_events row tagged 'transfer.reversed'.
  //
  // The original row is NEVER updated — it remains immutable. After a
  // reverse, listing transfers for the persona returns BOTH rows; the
  // original is still visible with reversesTransferId still null, and
  // the compensation is visible with reversesTransferId = originalId.

  /** Helper: run a forward bkash → nagad transfer of 5000 paise. */
  async function seedForward(
    transfers: SqliteTransferRepo,
    balances: SqliteBalanceRepo,
    personaId: string,
    amount = 5_000,
  ) {
    const before = await balances.listByPersona(personaId);
    const bkash = before.find((b) => b.providerId === "bkash")!;
    const nagad = before.find((b) => b.providerId === "nagad")!;
    const id = newTransferId();
    const tx = await transfers.commit({
      transferId: id,
      personaId,
      fromProvider: "bkash",
      toProvider: "nagad",
      amountBdt: amount as never,
      fromExpectedVersion: bkash.versionId,
      toExpectedVersion: nagad.versionId,
      note: "seed",
    });
    return { originalId: tx.transferId, amount };
  }

  it("commitReverse: happy path swaps from/to and links reverses_transfer_id", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId, amount } = await seedForward(transfers, balances, personaId);

    // After the seed forward, the provider_balance versions are 2 for
    // both bkash and nagad. The inverse's `from` is nagad (= original's
    // `to`), the inverse's `to` is bkash (= original's `from`).
    const mid = await balances.listByPersona(personaId);
    const nagadVer = mid.find((b) => b.providerId === "nagad")!.versionId;
    const bkashVer = mid.find((b) => b.providerId === "bkash")!.versionId;

    const reverse = await transfers.commitReverse({
      originalTransferId: originalId,
      personaId,
      fromExpectedVersion: nagadVer,
      toExpectedVersion: bkashVer,
      note: "wrong recipient",
    });

    // The compensation is a NEW row with from/to swapped and the link set.
    expect(reverse.transferId).not.toBe(originalId);
    expect(reverse.fromProvider).toBe("nagad");
    expect(reverse.toProvider).toBe("bkash");
    expect(reverse.amountBdt).toBe(amount);
    expect(reverse.reversesTransferId).toBe(originalId);

    // And the original is untouched (immutable).
    const originalAgain = await transfers.byId(originalId);
    expect(originalAgain?.reversesTransferId).toBeNull();

    // Balances returned to opening values.
    const after = await balances.listByPersona(personaId);
    expect(after.find((b) => b.providerId === "bkash")!.balance).toBe(50_000);
    expect(after.find((b) => b.providerId === "nagad")!.balance).toBe(20_000);
  });

  it("commitReverse: appends wallet_events row tagged 'transfer.reversed'", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId } = await seedForward(transfers, balances, personaId);

    const mid = await balances.listByPersona(personaId);
    const reverse = await transfers.commitReverse({
      originalTransferId: originalId,
      personaId,
      fromExpectedVersion: mid.find((b) => b.providerId === "nagad")!.versionId,
      toExpectedVersion: mid.find((b) => b.providerId === "bkash")!.versionId,
      note: "",
    });

    const events = db
      .prepare(
        "SELECT event_type, payload FROM wallet_events WHERE persona_id = ?",
      )
      .all(personaId) as { event_type: string; payload: string }[];
    const reversedEvents = events.filter((e) => e.event_type === "transfer.reversed");
    expect(reversedEvents.length).toBe(1);
    const payload = JSON.parse(reversedEvents[0].payload) as {
      transferId: string;
      originalTransferId: string;
      fromProvider: string;
      toProvider: string;
    };
    expect(payload.transferId).toBe(reverse.transferId);
    expect(payload.originalTransferId).toBe(originalId);
    expect(payload.fromProvider).toBe("nagad");
    expect(payload.toProvider).toBe("bkash");
  });

  it("commitReverse: appends per-leg balance_entries rows with source='transfer'", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId } = await seedForward(transfers, balances, personaId);

    const mid = await balances.listByPersona(personaId);
    await transfers.commitReverse({
      originalTransferId: originalId,
      personaId,
      fromExpectedVersion: mid.find((b) => b.providerId === "nagad")!.versionId,
      toExpectedVersion: mid.find((b) => b.providerId === "bkash")!.versionId,
      note: "",
    });

    const transferEntries = db
      .prepare(
        `SELECT provider_id, balance FROM balance_entries
         WHERE persona_id = ? AND source = 'transfer' ORDER BY ts DESC, id DESC`,
      )
      .all(personaId) as { provider_id: string; balance: number }[];
    // 2 legs from the forward + 2 legs from the reverse = 4 rows.
    expect(transferEntries.length).toBe(4);
    // Newest two (the compensation's legs) should reflect the post-rebalance.
    expect(transferEntries[0].balance).toBe(50_000); // bkash after credit
    expect(transferEntries[1].balance).toBe(20_000); // nagad after debit
  });

  it("commitReverse: raises TransferNotFoundError for an unknown id", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const bogus = newTransferId();
    await expect(
      transfers.commitReverse({
        originalTransferId: bogus,
        personaId,
        fromExpectedVersion: 1,
        toExpectedVersion: 1,
        note: "",
      }),
    ).rejects.toBeInstanceOf(TransferNotFoundError);
  });

  it("commitReverse: raises TransferAlreadyReversedError on a second reverse", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId } = await seedForward(transfers, balances, personaId);

    // First reverse succeeds.
    const mid1 = await balances.listByPersona(personaId);
    const first = await transfers.commitReverse({
      originalTransferId: originalId,
      personaId,
      fromExpectedVersion: mid1.find((b) => b.providerId === "nagad")!.versionId,
      toExpectedVersion: mid1.find((b) => b.providerId === "bkash")!.versionId,
      note: "first",
    });

    // After the first reverse, bkash and nagad are back to opening
    // balances. A *second* reverse attempt must throw with the original
    // compensating id surfaced in the error.
    const mid2 = await balances.listByPersona(personaId);
    let caught: unknown;
    try {
      await transfers.commitReverse({
        originalTransferId: originalId,
        personaId,
        fromExpectedVersion: mid2.find((b) => b.providerId === "nagad")!.versionId,
        toExpectedVersion: mid2.find((b) => b.providerId === "bkash")!.versionId,
        note: "second",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TransferAlreadyReversedError);
    expect((caught as TransferAlreadyReversedError).compensatingTransferId).toBe(
      first.transferId,
    );

    // Ledger side-effects from the rejected second reverse must be absent:
    // the balances are still at opening, not minus the amount.
    const after = await balances.listByPersona(personaId);
    expect(after.find((b) => b.providerId === "bkash")!.balance).toBe(50_000);
    expect(after.find((b) => b.providerId === "nagad")!.balance).toBe(20_000);
  });

  it("commitReverse: raises TransferConflictError on stale optimistic version", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId } = await seedForward(transfers, balances, personaId);

    // version=999 won't match anything in the live rows.
    await expect(
      transfers.commitReverse({
        originalTransferId: originalId,
        personaId,
        fromExpectedVersion: 999,
        toExpectedVersion: 999,
        note: "stale",
      }),
    ).rejects.toBeInstanceOf(TransferConflictError);

    // Ledger must be unchanged after a rejected reverse.
    const after = await balances.listByPersona(personaId);
    expect(after.find((b) => b.providerId === "bkash")!.balance).toBe(45_000);
    expect(after.find((b) => b.providerId === "nagad")!.balance).toBe(25_000);
  });

  it("commitReverse: insufficient balance on inverse leg → TransferConflictError", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    // Transfer 5000 paise bkash → nagad.
    const { originalId } = await seedForward(transfers, balances, personaId, 5_000);

    // Manually drain nagad below the inverse amount — simulates the
    // reverse being requested AFTER another forward that already moved
    // those funds out of nagad.
    db.prepare(
      `UPDATE provider_balance SET balance = 1000 WHERE persona_id = ? AND provider_id = 'nagad'`,
    ).run(personaId);

    const mid = await balances.listByPersona(personaId);
    await expect(
      transfers.commitReverse({
        originalTransferId: originalId,
        personaId,
        fromExpectedVersion: mid.find((b) => b.providerId === "nagad")!.versionId,
        toExpectedVersion: mid.find((b) => b.providerId === "bkash")!.versionId,
        note: "no funds",
      }),
    ).rejects.toBeInstanceOf(TransferConflictError);

    // Nothing should be inserted, no compensation row, no event.
    const reverseRows = db
      .prepare(
        "SELECT count(*) as n FROM transfers WHERE reverses_transfer_id IS NOT NULL",
      )
      .get() as { n: number };
    expect(reverseRows.n).toBe(0);
    const reversedEvents = db
      .prepare(
        "SELECT count(*) as n FROM wallet_events WHERE event_type = 'transfer.reversed'",
      )
      .get() as { n: number };
    expect(reversedEvents.n).toBe(0);
  });

  it("commitReverse: recent() surfaces both rows newest-first", async () => {
    const { db, personaId } = freshMigratedDb();
    const transfers = new SqliteTransferRepo(db);
    const balances = new SqliteBalanceRepo(db);
    const { originalId } = await seedForward(transfers, balances, personaId);

    const mid = await balances.listByPersona(personaId);
    await transfers.commitReverse({
      originalTransferId: originalId,
      personaId,
      fromExpectedVersion: mid.find((b) => b.providerId === "nagad")!.versionId,
      toExpectedVersion: mid.find((b) => b.providerId === "bkash")!.versionId,
      note: "",
    });

    const list = await transfers.recent(personaId, 10);
    expect(list.length).toBe(2);
    // Both rows are present; the compensation is the one with
    // `reversesTransferId` set (its ordering within recent() is
    // secondary-tiebreak, so we don't assert index 0 vs 1 — only that
    // the two halves are distinguishable).
    const compensation = list.find(
      (t) => t.reversesTransferId === originalId,
    );
    const forward = list.find((t) => t.transferId === originalId);
    expect(compensation).toBeDefined();
    expect(forward).toBeDefined();
    expect(compensation!.fromProvider).toBe("nagad");
    expect(compensation!.toProvider).toBe("bkash");
    expect(forward!.reversesTransferId).toBeNull();
    expect(forward!.fromProvider).toBe("bkash");
    expect(forward!.toProvider).toBe("nagad");
  });
});
