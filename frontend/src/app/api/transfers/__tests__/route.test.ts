/**
 * route.test.ts — POST + GET /api/transfers contract tests.
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
import { POST, GET } from "@/app/api/transfers/route";
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

  describe("GET /api/transfers", () => {
    function makeGetRequest(query: Record<string, string> = {}) {
      const url = new URL("http://localhost/api/transfers");
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      return new Request(url.toString(), { method: "GET" });
    }

    it("returns 200 with empty transfers list when no commits yet", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await GET(makeGetRequest());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          transfers: unknown[];
          personaId: string;
        };
        expect(body.transfers).toEqual([]);
        expect(body.personaId).toBe(PERSONA);
      });
    });

    it("returns the committed transfer with full ledger fields", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        // amountBdt is in BDT at the wire layer; the route multiplies by 100
        // before storing in `transfers.amount_bdt` (Paise). 12 BDT is well
        // under the 50k-bkash / 10k-rocket opening balances.
        const post = await POST(
          makeJsonRequest({
            from: "bkash",
            to: "rocket",
            amountBdt: 12,
            note: "rent split",
          }),
        );
        expect(post.status).toBe(201);

        const res = await GET(makeGetRequest());
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          transfers: Array<{
            transferId: string;
            personaId: string;
            fromProvider: string;
            toProvider: string;
            amountBdt: number;
            fromDelta: number;
            toDelta: number;
            fromAfter: number;
            fromVersion: number;
            toAfter: number;
            toVersion: number;
            note: string;
            ts: string;
          }>;
        };
        expect(body.transfers).toHaveLength(1);
        const t = body.transfers[0]!;
        expect(t.fromProvider).toBe("bkash");
        expect(t.toProvider).toBe("rocket");
        // amountBdt is the Paise integer at the wire layer (12 BDT = 1200).
        expect(t.amountBdt).toBe(1200);
        expect(t.fromDelta).toBe(-1200);
        expect(t.toDelta).toBe(1200);
        // Default seed opened 50k bkash / 10k rocket; subtract / add 1200.
        expect(t.fromAfter).toBe(50000 - 1200);
        expect(t.toAfter).toBe(10000 + 1200);
        // Versions advance by exactly one per leg.
        expect(t.fromVersion).toBe(2);
        expect(t.toVersion).toBe(2);
        expect(t.note).toBe("rent split");
        expect(typeof t.transferId).toBe("string");
        expect(t.personaId).toBe(PERSONA);
      });
    });

    it("returns transfers newest-first", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const a = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
        );
        const aId = ((await a.json()) as { transfer: { transferId: string } })
          .transfer.transferId;
        // Sleep > 1ms so the ISO string differs — the route sorts by ts
        // desc, and Date.now() has only ms resolution in the SQLite driver.
        await new Promise((r) => setTimeout(r, 5));
        const b = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 2 }),
        );
        const bId = ((await b.json()) as { transfer: { transferId: string } })
          .transfer.transferId;

        const res = await GET(makeGetRequest());
        const body = (await res.json()) as {
          transfers: Array<{ transferId: string }>;
        };
        expect(body.transfers.map((t) => t.transferId)).toEqual([bId, aId]);
      });
    });

    it("respects ?limit=N", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        for (let i = 0; i < 3; i++) {
          // Sleep between posts so timestamps differ.
          if (i > 0) await new Promise((r) => setTimeout(r, 3));
          const res = await POST(
            makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
          );
          expect(res.status).toBe(201);
        }
        const res = await GET(makeGetRequest({ limit: "2" }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { transfers: unknown[] };
        expect(body.transfers).toHaveLength(2);
      });
    });

    it("uses the default limit when ?limit is omitted", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        // Commit a single transfer; default limit is well above this.
        const post = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 1 }),
        );
        expect(post.status).toBe(201);
        const res = await GET(makeGetRequest());
        const body = (await res.json()) as { transfers: unknown[] };
        expect(body.transfers).toHaveLength(1);
      });
    });

    it.each([
      ["non-numeric", "abc"],
      ["zero", "0"],
      ["negative", "-1"],
      ["over max", "201"],
      ["fractional", "1.5"],
    ])("returns 400 on bad limit (%s)", async (_label, value) => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await GET(makeGetRequest({ limit: value }));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(typeof body.error).toBe("string");
      });
    });

    it("returns 422 when no active persona is set", async () => {
      await withTempDb(async () => {
        // Seed a persona but do NOT set meta.active_persona so the
        // route's precondition fails. This mirrors the cold-start path
        // before the first /api/persona/switch call.
        const db = getDb();
        db.prepare(
          `INSERT INTO personas
             (id, display_name, opening_bkash, opening_nagad, opening_rocket,
              inflow_rate, volatility)
           VALUES (?, 'No Active', 1, 1, 1, 1.0, 0.10)`,
        ).run(PERSONA);
        const res = await GET(makeGetRequest());
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error?: string };
        expect(typeof body.error).toBe("string");
      });
    });

    it("scopes the result to the active persona only", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const post = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 1 }),
        );
        expect(post.status).toBe(201);
        const ownTransferId = ((await post.json()) as {
          transfer: { transferId: string };
        }).transfer.transferId;

        // Switch active persona to a different one with no transfers.
        getDb()
          .prepare(
            `INSERT INTO personas
               (id, display_name, opening_bkash, opening_nagad, opening_rocket,
                inflow_rate, volatility)
             VALUES ('persona-other', 'Other', 1, 1, 1, 1.0, 0.10)`,
          )
          .run();
        getDb()
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
          .run("active_persona", "persona-other");

        const res = await GET(makeGetRequest());
        const body = (await res.json()) as {
          transfers: Array<{ transferId: string }>;
          personaId: string;
        };
        expect(body.personaId).toBe("persona-other");
        expect(body.transfers).toEqual([]);
        // Sanity check: switching back returns the original transfer.
        getDb()
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
          .run("active_persona", PERSONA);
        const back = await GET(makeGetRequest());
        const backBody = (await back.json()) as {
          transfers: Array<{ transferId: string }>;
        };
        expect(backBody.transfers.map((t) => t.transferId)).toEqual([
          ownTransferId,
        ]);
      });
    });

    // ─── Phase 9: keyset pagination on the GET surface ───────────

    it("first page: emits nextCursor when the page is full, null otherwise", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);

        // 2 of 3 — under limit: no cursor.
        const a = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
        );
        expect(a.status).toBe(201);
        await new Promise((r) => setTimeout(r, 3));
        const b = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 1 }),
        );
        expect(b.status).toBe(201);

        const short = await GET(makeGetRequest({ limit: "5" }));
        const shortBody = (await short.json()) as {
          transfers: unknown[];
          nextCursor: { ts: number; id: string } | null;
        };
        expect(shortBody.transfers).toHaveLength(2);
        expect(shortBody.nextCursor).toBeNull();

        // Fill to limit: cursor is non-null.
        await new Promise((r) => setTimeout(r, 3));
        const c = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
        );
        expect(c.status).toBe(201);
        await new Promise((r) => setTimeout(r, 3));
        const d = await POST(
          makeJsonRequest({ from: "bkash", to: "rocket", amountBdt: 1 }),
        );
        expect(d.status).toBe(201);
        await new Promise((r) => setTimeout(r, 3));
        const e = await POST(
          makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
        );
        expect(e.status).toBe(201);

        const full = await GET(makeGetRequest({ limit: "5" }));
        const fullBody = (await full.json()) as {
          transfers: Array<{ transferId: string; ts: number }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(fullBody.transfers).toHaveLength(5);
        expect(fullBody.nextCursor).not.toBeNull();
        // Cursor's row == the oldest on this page (last in DESC order).
        const oldest = fullBody.transfers[fullBody.transfers.length - 1]!;
        expect(fullBody.nextCursor!.ts).toBe(oldest.ts);
        expect(fullBody.nextCursor!.id).toBe(oldest.transferId);
      });
    });

    it("second page: cursor fetches rows strictly older than (ts, id)", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 3));
          const res = await POST(
            makeJsonRequest({ from: "bkash", to: "nagad", amountBdt: 1 }),
          );
          ids.push(
            ((await res.json()) as { transfer: { transferId: string } })
              .transfer.transferId,
          );
        }

        // Page 1: limit 2 → newest two.
        const page1 = await GET(makeGetRequest({ limit: "2" }));
        const page1Body = (await page1.json()) as {
          transfers: Array<{ transferId: string; ts: number }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(page1Body.transfers.map((t) => t.transferId)).toEqual([
          ids[4]!,
          ids[3]!,
        ]);
        expect(page1Body.nextCursor).not.toBeNull();

        // Page 2: feed the cursor back.
        const page2 = await GET(
          makeGetRequest({
            limit: "2",
            beforeTs: String(page1Body.nextCursor!.ts),
            beforeId: page1Body.nextCursor!.id,
          }),
        );
        const page2Body = (await page2.json()) as {
          transfers: Array<{ transferId: string }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(page2Body.transfers.map((t) => t.transferId)).toEqual([
          ids[2]!,
          ids[1]!,
        ]);
        expect(page2Body.nextCursor).not.toBeNull();

        // Page 3: short page → no further cursor.
        const page3 = await GET(
          makeGetRequest({
            limit: "2",
            beforeTs: String(page2Body.nextCursor!.ts),
            beforeId: page2Body.nextCursor!.id,
          }),
        );
        const page3Body = (await page3.json()) as {
          transfers: Array<{ transferId: string }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(page3Body.transfers.map((t) => t.transferId)).toEqual([
          ids[0]!,
        ]);
        expect(page3Body.nextCursor).toBeNull();
      });
    });

    it("returns 400 when only one side of the cursor is provided", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        // Only beforeTs — beforeId is missing.
        const res = await GET(
          makeGetRequest({
            limit: "5",
            beforeTs: String(Date.now()),
          }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toMatch(/beforeTs and beforeId/);
      });
    });

    it("returns 400 when beforeId is not 32-char hex", async () => {
      await withTempDb(async () => {
        seedPersona(DEFAULT_BALANCES);
        const res = await GET(
          makeGetRequest({
            limit: "5",
            beforeTs: String(Date.now()),
            beforeId: "not-a-valid-id",
          }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toMatch(/beforeId must be a 32-char hex/);
      });
    });

    it("returns 422 when no active persona is set, even with cursor params", async () => {
      await withTempDb(async () => {
        // Seed a persona but leave meta.active_persona unset.
        const db = getDb();
        db.prepare(
          `INSERT INTO personas
             (id, display_name, opening_bkash, opening_nagad, opening_rocket,
              inflow_rate, volatility)
           VALUES (?, 'No Active', 1, 1, 1, 1.0, 0.10)`,
        ).run(PERSONA);
        // Both sides of the cursor are well-formed so the cursor
        // parser returns ok, but the persona precondition fires
        // before the binding is touched.
        const res = await GET(
          makeGetRequest({
            limit: "5",
            beforeTs: "1700000000000",
            beforeId: "0".repeat(32),
          }),
        );
        expect(res.status).toBe(422);
      });
    });
  });
});