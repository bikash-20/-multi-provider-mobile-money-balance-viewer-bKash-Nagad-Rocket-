/**
 * SqliteAdvisoryRepo — FSM transitions + dedup behaviour.
 */
import { describe, it, expect } from "vitest";
import { freshMigratedDb } from "@/__tests__/migratedDb";
import { SqliteAdvisoryRepo } from "../sqliteAdvisoryRepo";
import { IllegalAdvisoryTransitionError } from "@/lib/domain/repositories/advisoryRepo";

describe("SqliteAdvisoryRepo", () => {
  it("opens a fresh advisory with status=PENDING", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteAdvisoryRepo(db);
    const a = await repo.open({
      personaId,
      providerId: "bkash",
      severity: "medium",
      reason: "low-balance",
      dedupKey: "persona/bkash/balance",
    });
    expect(a.status).toBe("PENDING");
    expect(a.transitions.length).toBe(0);
  });

  it("dedupes repeat triggers while the case is open", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteAdvisoryRepo(db);
    const a = await repo.open({
      personaId,
      providerId: "bkash",
      severity: "medium",
      reason: "low-balance",
      dedupKey: "persona/bkash/balance",
    });
    const b = await repo.open({
      personaId,
      providerId: "bkash",
      severity: "high",
      reason: "low-balance",
      dedupKey: "persona/bkash/balance",
    });
    expect(b.id).toBe(a.id);
    expect(b.alertToken).toBe(a.alertToken);
  });

  it("walks the full PENDING -> ACKNOWLEDGED -> ESCALATED -> RESOLVED path", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteAdvisoryRepo(db);
    const a = await repo.open({
      personaId,
      providerId: "bkash",
      severity: "medium",
      reason: "low-balance",
      dedupKey: "k1",
    });
    const b = await repo.transit({
      alertToken: a.alertToken,
      toStatus: "ACKNOWLEDGED",
      actor: "ui:demo",
      reason: "seen",
    });
    const c = await repo.transit({
      alertToken: a.alertToken,
      toStatus: "ESCALATED",
      actor: "ui:demo",
      reason: "needs refill",
    });
    const d = await repo.transit({
      alertToken: a.alertToken,
      toStatus: "RESOLVED",
      actor: "ui:demo",
      reason: "refilled",
    });
    expect(b.transitions.length).toBe(1);
    expect(c.transitions.length).toBe(2);
    expect(d.transitions.length).toBe(3);
    expect(d.status).toBe("RESOLVED");
  });

  it("rejects illegal transitions", async () => {
    const { db, personaId } = freshMigratedDb();
    const repo = new SqliteAdvisoryRepo(db);
    const a = await repo.open({
      personaId,
      providerId: null,
      severity: "low",
      reason: "noise",
      dedupKey: "k2",
    });
    // Walk to RESOLVED first — terminal state cannot transition anywhere.
    await repo.transit({
      alertToken: a.alertToken,
      toStatus: "RESOLVED",
      actor: "ui:demo",
      reason: "instant",
    });
    await expect(
      repo.transit({
        alertToken: a.alertToken,
        toStatus: "ACKNOWLEDGED",
        actor: "ui:demo",
        reason: "reopen",
      }),
    ).rejects.toBeInstanceOf(IllegalAdvisoryTransitionError);
  });
});
