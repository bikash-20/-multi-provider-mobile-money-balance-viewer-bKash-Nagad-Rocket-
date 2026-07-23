/**
 * /api/forex — Exchange rate information.
 *
 * GET /api/forex
 *   Returns the current USD → BDT rate and a timestamp.
 *   The server caches the rate for 1 hour; the client can force
 *   a refresh by clearing the cache.
 *
 *   200 → { rate: number, fetchedAt: string, source: string }
 *   503 → API unreachable, returning fallback rate
 */

import { NextResponse } from "next/server";
import { getUsdBdtRate, clearForexCache } from "@/lib/domain/forex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "true";

  if (refresh) {
    clearForexCache();
  }

  try {
    const rate = await getUsdBdtRate();
    return NextResponse.json({
      rate,
      fetchedAt: new Date().toISOString(),
      source: "frankfurter.app",
    });
  } catch {
    // Fallback rate when API is unreachable.
    return NextResponse.json(
      {
        rate: 110,
        fetchedAt: new Date().toISOString(),
        source: "fallback",
      },
      { status: 503 },
    );
  }
}
