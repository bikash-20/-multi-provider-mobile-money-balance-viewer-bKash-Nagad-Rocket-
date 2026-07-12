/**
 * /api/entries — minimal backend phase surface.
 *
 * GET   /api/entries        → 200, BalanceEntry[] sorted newest-first
 * POST  /api/entries        → 201, the persisted BalanceEntry
 *                              body: { provider: "bkash"|"nagad"|"rocket", balance: number >= 0 }
 *                              400 on invalid provider / negative / non-finite balance
 *
 * No PUT, no DELETE — the log is append-only per spec §4. Server owns
 * id and timestamp; the client never sets them.
 */
import { NextResponse } from "next/server";
import { appendEntry, listEntries } from "@/lib/entriesRepo";
import { PROVIDERS, type Provider } from "@/features/wallet/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isProvider(x: unknown): x is Provider {
  return typeof x === "string" && (PROVIDERS as string[]).includes(x);
}

function isFiniteNonNegativeNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

export async function GET() {
  const entries = listEntries();
  return NextResponse.json(entries, { status: 200 });
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
    return NextResponse.json({ error: "Body must be an object." }, { status: 400 });
  }
  const { provider, balance } = body as { provider?: unknown; balance?: unknown };

  if (!isProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${PROVIDERS.join(", ")}.` },
      { status: 400 },
    );
  }
  if (!isFiniteNonNegativeNumber(balance)) {
    return NextResponse.json(
      { error: "balance must be a non-negative finite number." },
      { status: 400 },
    );
  }

  const entry = appendEntry(provider, balance);
  return NextResponse.json(entry, { status: 201 });
}