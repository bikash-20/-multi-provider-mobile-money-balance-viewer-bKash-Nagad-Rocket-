/**
 * /api/persona/switch — wipe + reseed with a different persona.
 *
 * POST /api/persona/switch
 *   body: { persona: "freelancer" | "small_business" | "student",
 *           days?: number }
 *   → 200 { ok: true, summary: SeedResult, meta: MetaSnapshot }
 *
 *   400 if persona is missing/unknown, days is out of range.
 *
 * This is the in-app equivalent of `npm run db:seed`. Both paths call
 * the same shared `seedDemo()` from src/lib/seedDemo.ts, so the data
 * is byte-identical to what the CLI produces.
 *
 * Writes complete in a single transaction; if anything fails, the
 * existing entries + meta rows are untouched.
 */
import { NextResponse } from "next/server";
import path from "node:path";

import { seedDemo, PERSONAS, type PersonaName } from "@/lib/seedDemo";
import { readMetaSnapshot } from "@/lib/metaRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveDbPath(): string {
  if (process.env.WALLETSYNC_DB_PATH) return process.env.WALLETSYNC_DB_PATH;
  return path.resolve(process.cwd(), "..", "data", "walletsync.db");
}

const DEFAULT_DAYS = 75;

function isPersonaName(x: unknown): x is PersonaName {
  return typeof x === "string" && x in PERSONAS;
}

function isValidDays(x: unknown): x is number {
  return (
    typeof x === "number" && Number.isFinite(x) && x >= 30 && x <= 180
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Body must be an object." },
      { status: 400 },
    );
  }

  const { persona, days } = body as {
    persona?: unknown;
    days?: unknown;
  };

  if (!isPersonaName(persona)) {
    return NextResponse.json(
      {
        error: `persona must be one of: ${Object.keys(PERSONAS).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const dayCount = days === undefined ? DEFAULT_DAYS : days;
  if (!isValidDays(dayCount)) {
    return NextResponse.json(
      { error: "days must be a number between 30 and 180." },
      { status: 400 },
    );
  }

  const summary = seedDemo(persona, dayCount, resolveDbPath());
  const meta = readMetaSnapshot();

  return NextResponse.json(
    { ok: true, summary, meta },
    { status: 200 },
  );
}
