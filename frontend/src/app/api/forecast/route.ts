/**
 * /api/forecast — Balance prediction using EWMA.
 *
 * GET /api/forecast
 *   Returns a 7-day EWMA forecast for each provider, including:
 *    - Historical daily series
 *    - Smoothed EWMA values
 *    - Forecast points with 68% and 95% confidence intervals
 *    - Residual statistics (RMSE, stdDev)
 *
 *   200 → { forecasts: ProviderForecast[], generatedAt: string }
 *   503 → DB read failure
 *
 * The forecast is computed server-side from the active persona's
 * balance entries. The EWMA α defaults to 0.3 (moderate smoothing).
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROVIDERS, type Provider, PROVIDER_HEX } from "@/features/wallet/types";
import { forecastEwma, type ProviderForecast } from "@/lib/domain/forecast";
import { buildDailySeries } from "@/lib/sparklineSeries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORECAST_HORIZON = 7;
const FORECAST_WINDOW = 90; // use last 90 days for fitting

export async function GET() {
  try {
    const db = getDb();

    // Read active persona.
    const personaRow = db
      .prepare<[], { value: string }>(
        "SELECT value FROM meta WHERE key = 'active_persona'",
      )
      .get();
    const personaId = personaRow?.value ?? null;

    if (!personaId) {
      return NextResponse.json(
        { forecasts: [], generatedAt: new Date().toISOString() },
        { status: 200 },
      );
    }

    // Read entries for this persona (include currency/exchange_rate for USD→BDT normalization).
    const entryRows = db
      .prepare<[string], { provider_id: string; balance: number; ts: string; currency: string | null; exchange_rate: number | null }>(
        `SELECT provider_id, balance, ts, currency, exchange_rate
         FROM balance_entries
         WHERE persona_id = ?
         ORDER BY ts ASC`,
      )
      .all(personaId);

    const entries = entryRows.map((r) => {
      let balanceInBdt = (r.balance as number) / 100; // paise or cents → taka or dollars
      // Normalize USD entries to BDT-equivalent using the stored exchange rate.
      if (r.currency === "USD" && r.exchange_rate != null) {
        balanceInBdt = balanceInBdt * r.exchange_rate;
      }
      return {
        id: "",
        provider: r.provider_id as Provider,
        balance: balanceInBdt, // always in BDT for forecasting
        // r.ts is INTEGER epoch millis; convert to ISO string for
        // consistency with the BalanceEntry type used downstream.
        timestamp: new Date(Number(r.ts)).toISOString(),
      };
    });

    // Build daily series.
    const series = buildDailySeries(entries, FORECAST_WINDOW);

    // Compute forecast for each provider.
    const forecasts: ProviderForecast[] = [];
    for (const s of series) {
      const color = PROVIDER_HEX[s.provider];
      const result = forecastEwma(s.points, color, { alpha: 0.3 }, FORECAST_HORIZON);
      if (result) {
        result.provider = s.provider;
        forecasts.push(result);
      }
    }

    return NextResponse.json(
      { forecasts, generatedAt: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Forecast computation failed.",
        forecasts: [],
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
