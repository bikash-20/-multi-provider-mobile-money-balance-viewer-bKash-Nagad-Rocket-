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
    it("returns an empty array on a fresh database (200)", async () => {
      await withTempDb(async () => {
        const res = await GET();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
      });
    });

    it("returns persisted entries newest-first (200)", async () => {
      await withTempDb(async () => {
        await POST(makeJsonRequest({ provider: "bkash", balance: 100 }));
        await POST(makeJsonRequest({ provider: "nagad", balance: 200 }));
        const res = await GET();
        const body = (await res.json()) as Array<{ provider: string; balance: number }>;
        expect(body.map((e) => e.provider)).toEqual(["nagad", "bkash"]);
        expect(body.map((e) => e.balance)).toEqual([200, 100]);
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
        const get = await GET();
        expect(await get.json()).toEqual([]);
      });
    });
  });
});
