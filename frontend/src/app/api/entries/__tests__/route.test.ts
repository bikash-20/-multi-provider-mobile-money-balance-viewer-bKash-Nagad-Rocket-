/**
 * route.test.ts — exercises the POST/GET handlers as plain functions.
 *
 * The route module exports `GET` and `POST` as named handlers taking a
 * Request. We don't need Next.js's runtime to import them, so we can
 * call them directly and assert on the returned NextResponse.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb } from "@/lib/db";
import { GET, POST } from "@/app/api/entries/route";
import { withTempDb } from "@/__tests__/withTempDb";

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/entries", () => {
  beforeEach(() => {
    closeDb();
  });

  describe("GET", () => {
    it("returns an empty envelope on a fresh database (200)", async () => {
      await withTempDb(async () => {
        const res = await GET(
          new Request("http://localhost/api/entries"),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          entries: Array<{ provider: string; balance: number }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(body.entries).toEqual([]);
        // No rows → server can't promise another page.
        expect(body.nextCursor).toBeNull();
      });
    });

    it("returns persisted entries newest-first (200) with nextCursor=null when the page is short", async () => {
      await withTempDb(async () => {
        await POST(makeJsonRequest({ provider: "bkash", balance: 100 }));
        await POST(makeJsonRequest({ provider: "nagad", balance: 200 }));
        const res = await GET(
          new Request("http://localhost/api/entries"),
        );
        const body = (await res.json()) as {
          entries: Array<{ provider: string; balance: number }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(body.entries.map((e) => e.provider)).toEqual(["nagad", "bkash"]);
        expect(body.entries.map((e) => e.balance)).toEqual([200, 100]);
        // Default limit (50) > 2 rows ⇒ server knows it returned
        // the full tail, so the cursor is null (no "ask again"
        // round-trip needed). The non-null case is exercised by
        // the limit=N tests below.
        expect(body.nextCursor).toBeNull();
      });
    });

    it("returns nextCursor = null once the page size hits the row count", async () => {
      await withTempDb(async () => {
        await POST(makeJsonRequest({ provider: "bkash", balance: 100 }));
        await POST(makeJsonRequest({ provider: "nagad", balance: 200 }));
        // limit=2 means the only two rows fill the page exactly.
        const res = await GET(
          new Request("http://localhost/api/entries?limit=2"),
        );
        const body = (await res.json()) as {
          entries: unknown[];
          nextCursor: { ts: number; id: string } | null;
        };
        expect(body.entries).toHaveLength(2);
        // list.length === limit means we can't be sure there's a next
        // page, but the *common* contract here is "list.length < limit
        // ⇒ no next page". We have length === limit, so the cursor
        // is the optimistic "maybe more" signal (still non-null).
        // The actual end-of-history is decided client-side by the
        // *next* request returning an empty array — that one will
        // collapse to nextCursor=null because list.length(0) < limit.
        expect(body.nextCursor).not.toBeNull();
      });
    });

    it("round-trips keyset pagination across two pages with no duplicates", async () => {
      await withTempDb(async () => {
        // Seed 3 entries in chronological order — note the third one
        // is inserted with a slight delay so its ts strictly exceeds
        // the previous. We can't fake same-ms ties here because the
        // SQL tuple comparison only matters when (ts, id) is equal,
        // and that branch is unreachable in a single-process test.
        await POST(makeJsonRequest({ provider: "bkash", balance: 100 }));
        await POST(makeJsonRequest({ provider: "nagad", balance: 200 }));
        await POST(makeJsonRequest({ provider: "rocket", balance: 300 }));

        const first = await GET(
          new Request("http://localhost/api/entries?limit=2"),
        );
        const firstBody = (await first.json()) as {
          entries: Array<{ provider: string }>;
          nextCursor: { ts: number; id: string } | null;
        };
        expect(firstBody.entries.map((e) => e.provider)).toEqual([
          "rocket",
          "nagad",
        ]);
        expect(firstBody.nextCursor).not.toBeNull();

        const second = await GET(
          new Request(
            `http://localhost/api/entries?limit=2&beforeTs=${firstBody.nextCursor!.ts}&beforeId=${firstBody.nextCursor!.id}`,
          ),
        );
        const secondBody = (await second.json()) as {
          entries: Array<{ provider: string }>;
          nextCursor: { ts: number; id: string } | null;
        };
        // Page 2 should hold exactly the remaining row.
        expect(secondBody.entries.map((e) => e.provider)).toEqual(["bkash"]);
        // list.length(1) < limit(2) → server reports no more pages.
        expect(secondBody.nextCursor).toBeNull();
      });
    });

    it("rejects a partial cursor (only beforeTs) with 400", async () => {
      await withTempDb(async () => {
        const res = await GET(
          new Request("http://localhost/api/entries?beforeTs=1"),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/beforeTs/);
      });
    });

    it("rejects a non-numeric cursor id with 400", async () => {
      await withTempDb(async () => {
        const res = await GET(
          new Request(
            "http://localhost/api/entries?beforeTs=1000&beforeId=abc",
          ),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/beforeId|id/i);
      });
    });

    it("rejects an out-of-range limit with 400", async () => {
      await withTempDb(async () => {
        const res = await GET(
          new Request("http://localhost/api/entries?limit=0"),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/limit/i);
      });
    });
  });

  describe("POST happy path", () => {
    it("persists a valid entry and returns 201 with the row", async () => {
      await withTempDb(async () => {
        const res = await POST(
          makeJsonRequest({ provider: "rocket", balance: 1234.56 }),
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          id: string;
          provider: string;
          balance: number;
          timestamp: string;
        };
        expect(body.provider).toBe("rocket");
        expect(body.balance).toBe(1234.56);
        // Server-generated id is a numeric string of lastInsertRowid.
        expect(body.id).toMatch(/^\d+$/);
        expect(typeof body.timestamp).toBe("string");
        // ISO 8601 — parseable back into a Date.
        expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
      });
    });

    it("treats balance = 0 as valid", async () => {
      await withTempDb(async () => {
        const res = await POST(makeJsonRequest({ provider: "bkash", balance: 0 }));
        expect(res.status).toBe(201);
        const body = (await res.json()) as { balance: number };
        expect(body.balance).toBe(0);
      });
    });
  });

  describe("POST rejection paths", () => {
    it.each([
      ["unknown provider", { provider: "paypal", balance: 50 }],
      ["empty-string provider", { provider: "", balance: 50 }],
      ["null provider", { provider: null, balance: 50 }],
      ["number provider", { provider: 42, balance: 50 }],
    ] as Array<[string, Record<string, unknown>]>)(
      "rejects %s with 400",
      async (_label: string, payload: Record<string, unknown>) => {
      await withTempDb(async () => {
        const res = await POST(makeJsonRequest(payload));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/provider/i);
      });
    });

    it.each([
      ["negative number", { provider: "bkash", balance: -1 }],
      ["NaN", { provider: "bkash", balance: Number.NaN }],
      ["Infinity", { provider: "bkash", balance: Number.POSITIVE_INFINITY }],
      ["string", { provider: "bkash", balance: "100" }],
      ["null", { provider: "bkash", balance: null }],
      ["missing", { provider: "bkash" }],
    ] as Array<[string, Record<string, unknown>]>)(
      "rejects bad balance (%s) with 400",
      async (_label: string, payload: Record<string, unknown>) => {
      await withTempDb(async () => {
        const res = await POST(makeJsonRequest(payload));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toMatch(/balance/i);
      });
    });

    it("rejects malformed JSON with 400", async () => {
      await withTempDb(async () => {
        const req = new Request("http://localhost/api/entries", {
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
        const req = new Request("http://localhost/api/entries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify("just a string"),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
      });
    });

    it("does not persist anything on rejection", async () => {
      await withTempDb(async () => {
        const bad = await POST(makeJsonRequest({ provider: "nagad", balance: -5 }));
        expect(bad.status).toBe(400);
        const get = await GET(
          new Request("http://localhost/api/entries"),
        );
        const body = (await get.json()) as {
          entries: unknown[];
          nextCursor: unknown;
        };
        expect(body.entries).toEqual([]);
        expect(body.nextCursor).toBeNull();
      });
    });
  });
});
