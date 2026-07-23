/**
 * /api/analytics — aggregated financial intelligence endpoint.
 *
 * GET /api/analytics
 *   Returns a full AnalyticsSnapshot with:
 *    - balanceHistory: daily balance per provider (90-day window)
 *    - netWorthHistory: combined total over time
 *    - transferFlows: cross-provider flow amounts
 *    - monthlyAggregates: per-provider month-over-month breakdown
 *    - velocities: average daily/weekly change rates
 *
 *   Dates back 90 days (matching the sparkline window). Data is
 *   read from the active persona's entries and transfers table.
 *
 *   200 → AnalyticsSnapshot
 *   422 → No active persona (cold start)
 *   503 → DB read failure
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROVIDERS, type Provider, PROVIDER_HEX } from "@/features/wallet/types";
import type { Transfer } from "@/lib/domain/entities/transfer";
import { transferFromRow } from "@/lib/domain/entities/transfer";
import { computeAnalytics } from "@/features/analytics/computeAnalytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readActivePersona(): string | null {
  try {
    const row = getDb()
      .prepare<[], { value: string }>(
        "SELECT value FROM meta WHERE key = 'active_persona'",
      )
      .get();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const personaId = readActivePersona();
  if (!personaId) {
    return NextResponse.json(
      {
        error: "No active persona. Run the demo seeder first.",
        balanceHistory: [],
        netWorthHistory: [],
        transferFlows: [],
        monthlyAggregates: [],
        velocities: [],
        daysCovered: 0,
        generatedAt: new Date().toISOString(),
      },
      { status: 200 }, // Return empty data instead of 422 so the UI renders gracefully
    );
  }

  try {
    const db = getDb();

    // 1. Read balance entries for this persona (newest first, all time).
    const entryRows = db
      .prepare<[string], { provider_id: string; balance: number; ts: string }>(
        `SELECT provider_id, balance, ts
         FROM balance_entries
         WHERE persona_id = ?
         ORDER BY ts ASC`,
      )
      .all(personaId);

    // Transform DB rows to BalanceEntry shape.
    // r.ts is INTEGER epoch millis; convert to ISO string for
    // consistency with how getRepositories().entries.listPage()
    // returns BalanceEntry.timestamp.
    const entries = entryRows.map((r) => ({
      id: "", // Not used in analytics
      provider: r.provider_id as Provider,
      balance: (r.balance as number) / 100, // paise to BDT
      timestamp: new Date(Number(r.ts)).toISOString(),
    }));

    // 2. Read transfers for this persona.
    const transferRows = db
      .prepare<[string], Record<string, unknown>>(
        `SELECT * FROM transfers WHERE persona_id = ? ORDER BY ts ASC`,
      )
      .all(personaId);

    const transfers: Transfer[] = transferRows.map((r) =>
      transferFromRow(r as Parameters<typeof transferFromRow>[0]),
    );

    // 3. Compute analytics (pure function).
    const snapshot = computeAnalytics(entries, transfers);

    return NextResponse.json(snapshot, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Analytics read failed.",
        balanceHistory: [],
        netWorthHistory: [],
        transferFlows: [],
        monthlyAggregates: [],
        velocities: [],
        daysCovered: 0,
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
