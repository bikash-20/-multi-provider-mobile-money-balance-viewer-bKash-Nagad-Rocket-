/**
 * /api/persona/switch route — POST handler that wipes the database
 * and reseeds with the requested persona. The route delegates to
 * `seedDemo()` from src/lib/seedDemo.ts (the same path the CLI
 * uses) so the data shape matches what's seeded by `npm run db:seed`.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { closeDb } from "@/lib/db";
import { listEntries } from "@/lib/entriesRepo";
import { POST } from "@/app/api/persona/switch/route";
import { withTempDb } from "@/__tests__/withTempDb";

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/persona/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/persona/switch", () => {
  beforeEach(() => {
    closeDb();
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/persona/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid JSON/i);
  });

  it("returns 400 when persona is missing", async () => {
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/persona must be one of/);
  });

  it("returns 400 when persona is unknown", async () => {
    const res = await POST(makeJsonRequest({ persona: "vampire" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/persona must be one of/);
  });

  it("returns 400 when days is out of range", async () => {
    const res = await POST(
      makeJsonRequest({ persona: "student", days: 10 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/days must be/);
  });

  it("seeds entries and returns ok=true with the meta snapshot", async () => {
    await withTempDb(async () => {
      const res = await POST(
        makeJsonRequest({ persona: "student", days: 30 }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.meta.persona).toBe("student");
      expect(body.meta.isDemo).toBe(true);
      expect(body.summary).toBeTruthy();
      expect(body.summary.persona).toBe("student");
      // `daysCovered` depends on local time-zone vs UTC rollover when
      // entries are stamped, so allow ±2 days rather than tying the
      // assertion to a non-deterministic wall-clock detail.
      expect(body.summary.daysCovered).toBeGreaterThanOrEqual(28);
      expect(body.summary.daysCovered).toBeLessThanOrEqual(30);
      expect(body.summary.totalEntries).toBeGreaterThan(0);
      // 30 days × 3 providers × ~1.2 entries/day with some spike rolls,
      // but should be at least 60 rows (lower bound sanity check).
      closeDb();
      const entries = listEntries();
      expect(entries.length).toBeGreaterThan(60);
    });
  });

  it("wipes previous entries on switch", async () => {
    await withTempDb(async () => {
      // First seed as freelancer with a fixed small window.
      await POST(makeJsonRequest({ persona: "freelancer", days: 30 }));
      closeDb();
      const firstCount = listEntries().length;

      // Switch to student. The DB should be fully reseeded, not
      // appended to.
      await POST(makeJsonRequest({ persona: "student", days: 30 }));
      closeDb();
      const secondCount = listEntries().length;
      // Second count reflects student persona distribution, not
      // freelancer + student concatenated.
      expect(secondCount).toBeGreaterThan(60);
      expect(secondCount).toBeLessThan(firstCount * 2);
    });
  });
});