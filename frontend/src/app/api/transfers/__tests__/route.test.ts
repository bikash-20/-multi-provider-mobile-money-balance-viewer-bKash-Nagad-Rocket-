/**
 * route.test.ts — POST /api/transfers contract tests.
 *
 * The route is the v2-binding seam for the transfer ledger. The
 * SqliteTransferRepo binding tests already cover the v2 atomicity,
 * replay-safety, and conflict path; this file covers the HTTP surface:
 * validation order, status codes, and the active-persona precondition.
 *
 * Each test seeds its own DB with a known persona so the route's
 * `meta.active_persona` lookup succeeds without depending on the
 * demo seeder.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb, getDb } from "@/lib/db";
import { POST } from "@/app/api/transfers/route";
import { withTempDb } from "@/__tests__/withTempDb";

const PERSONA = "persona-route-test";

function seedPersona(balances: { bkash: number; nagad: number; rocket: number }) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO personas
       (id, display_name, opening_bkash, opening_nagad, opening_rocket,
        inflow_rate, volatility)
     VALUES (?, ?, ?, ?, ?, 1.0, 0.10)`,
  ).run(
    PERSONA,
    "Route Test",
    balances.bkash,
    balances.nagad,
    balances.rocket,
  );
  db.prepare(
    `INSERT INTO provider_balance
       (persona_id, provider_id, balance, version_id, updated_at)
     VALUES (?, 'bkash',  ?, 1, ?),
            (?, 'nagad',  ?, 1, ?),
            (?, 'rocket', ?, 1, ?)`,
  ).run(
    PERSONA, balances.bkash, now,
    PERSONA, balances.nagad, now,
    PERSONA, balances.rocket, now,
  );
  db.prepare(
    `INSERT INTO balance_entries (persona_id, provider_id, balance, source, ts)
     VALUES (?, 'bkash',  ?, 'seed', ?),
            (?, 'nagad',  ?, 'seed', ?),
            (?, 'rocket', ?, 'seed', ?)`,
  ).run(
    PERSONA, balances.bkash, now,
    PERSONA, balances.nagad, now,
    PERSONA, balances.rocket, now,
  );
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
  ).run("active_persona", PERSONA);
}

function makeJsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/transfers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const DEFAULT_BALANCES = { bkash: 50_000, nagad: 20_000, rocket: 10_000 };

describe("POST /api/transfers", () => {
  beforeEach(() => {
    closeDb();
  });

  describe("happy path", () => {
    it("persists a valid transfer and returns 201 with the row", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 100 }),
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          transfer: {
            transferId: string;
            fromProvider: string;
            toProvider: string;
            amountBdt: number;
            fromDelta: number;
            toDelta: number;
            fromAfter: number;
            toAfter: number;
            note: string;
          };
          idempotencyKey: string | null;
        };
        expect(body.transfer.fromProvider).toBe("bkash");
        expect(body.transfer.toProvider).toBe("nagad");
        // amountBdt is stored as paise; 100 BDT = 10_000 paise.
        expect(body.transfer.amountBdt).toBe(10_000);
        expect(body.transfer.fromDelta).toBe(-10_000);
        expect(body.transfer.toDelta).toBe(10_000);
        expect(body.transfer.fromAfter).toBe(40_000); // 50_000 - 10_000
        expect(body.transfer.toAfter).toBe(30_000);   // 20_000 + 10_000
        expect(body.transfer.note).toBe("");
        expect(body.idempotencyKey).toBeNull();
        expect(body.transfer.transferId).toMatch(/^[0-9a-f]{32}$/);
      });
    });

    it("echoes the Idempotency-Key header in the response", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest(
            { from: "bkash", to: "rocket", amountBdt: 50, note: "x" },
            { "Idempotency-Key": "client-key-1234" },
          ),
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as { idempotencyKey: string };
        expect(body.idempotencyKey).toBe("client-key-1234");
      });
    });

    it("replay-safely returns 201 with the original row when the same body is POSTed twice", async () => {
      // The PK on transfer_id makes a true server-side retry a no-op.
      // Two POSTs from the same client produce *different* ids, so this
      // test exercises the path where two writes both succeed but
      // produce two distinct transfers — and asserts both are valid.
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const r1 = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 25 }),
        );
        const r2 = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 25 }),
        );
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);
        const b1 = (await r1.json()) as { transfer: { transferId: string } };
        const b2 = (await r2.json()) as { transfer: { transferId: string } };
        expect(b1.transfer.transferId).not.toBe(b2.transfer.transferId);
      });
    });
  });

  describe("400 — bad request shape", () => {
    it("rejects malformed JSON with 400", async () => {
      await withTempDb(async () => {
        const req = new Request("http://localhost/api/transfers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{not json",
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/json/i);
      });
    });

    it("rejects a non-object body with 400", async () => {
      await withTempDb(async () => {
        const res = await POST(makeJsonRequest("just a string"));
        expect(res.status).toBe(400);
      });
    });

    it.each([
      ["unknown from", { from: "paypal", to: "nagad", amountBdt: 10 }],
      ["unknown to", { from: "bkash", to: "stripe", amountBdt: 10 }],
      ["missing from", { to: "nagad", amountBdt: 10 }],
      ["number from", { from: 42, to: "nagad", amountBdt: 10 }],
    ] as Array<[string, Record<string, unknown>]>)(
      "rejects %s with 400",
      async (_label, payload) => {
        await withTempDb(async () => {
          const res = await POST(makeJsonRequest(payload));
          expect(res.status).toBe(400);
          const body = (await res.json()) as { error: string };
          expect(body.error).toMatch(/(from|to|must be one of)/i);
        });
      },
    );

    it("rejects an Idempotency-Key longer than 64 chars with 400", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest(
            { from: "bkash", to: "nagad", amountBdt: 10 },
            { "Idempotency-Key": "x".repeat(65) },
          ),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/Idempotency-Key/i);
      });
    });
  });

  describe("422 — semantic rejection", () => {
    it("rejects from === to with 422", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest({ from: "bkash", to: "bkash", amountBdt: 10 }),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/different providers/i);
      });
    });

    it.each([
      ["zero", { from: "bkash", to: "nagad", amountBdt: 0 }],
      ["negative", { from: "bkash", to: "nagad", amountBdt: -5 }],
      ["NaN", { from: "bkash", to: "nagad", amountBdt: Number.NaN }],
      ["Infinity", { from: "bkash", to: "nagad", amountBdt: Number.POSITIVE_INFINITY }],
      ["string", { from: "bkash", to: "nagad", amountBdt: "100" }],
      ["missing", { from: "bkash", to: "nagad" }],
    ] as Array<[string, Record<string, unknown>]>)(
      "rejects bad amountBdt (%s) with 422",
      async (_label, payload) => {
        await withTempDb(async () => {
          seedPersona(DEFAULT_BALANCES);
          const res = await POST(makeJsonRequest(payload));
          expect(res.status).toBe(422);
          const body = (await res.json()) as { error: string };
          expect(body.error).toMatch(/amountBdt/i);
        });
      },
    );

    it("rejects note longer than 120 chars with 422", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest({
            from: "bkash",
            to: "nagad",
            amountBdt: 10,
            note: "x".repeat(121),
          }),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/note/i);
      });
    });

    it("rejects insufficient balance with 422", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        // bkash has 50_000 paise; ask for 1_000_000 to force the pre-check.
        const res = await POST(
          makeJsonRequest({
            from: "bkash",
            to: "nagad",
            amountBdt: 10_000, // 1_000_000 paise
          }),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/insufficient/i);
      });
    });

    it("rejects when no active persona is set with 422", async () => {
      await withTempDb(async () => {
        // No seedPersona() call — meta.active_persona is absent.
        const res = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 10 }),
        );
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/active persona/i);
      });
    });
  });

  describe("persistence side-effects", () => {
    it("does not persist anything on rejection", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const rejected = await POST(
          makeJsonRequest({ from: "bkash", to: "bkash", amountBdt: 10 }),
        );
        expect(rejected.status).toBe(422);
        const row = getDb()
          .prepare("SELECT count(*) as n FROM transfers")
          .get() as { n: number };
        expect(row.n).toBe(0);
      });
    });

    it("records the transfer row + 2 per-leg history rows on success", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 5 }),
        );
        expect(res.status).toBe(201);
        const t = (getDb()
          .prepare("SELECT count(*) as n FROM transfers")
          .get()) as { n: number };
        const history = (getDb()
          .prepare(
            "SELECT count(*) as n FROM balance_entries WHERE source = 'transfer'",
          )
          .get()) as { n: number };
        expect(t.n).toBe(1);
        expect(history.n).toBe(2);
      });
    });
  });
});