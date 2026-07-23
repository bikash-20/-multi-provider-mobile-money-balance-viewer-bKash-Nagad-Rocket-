/**
 * /api/export/csv — Downloadable CSV reports.
 *
 * GET /api/export/csv?type=entries       → All balance entries
 * GET /api/export/csv?type=transfers     → All transfers
 * GET /api/export/csv?type=statement&provider=bkash → Per-provider statement
 *
 * All responses are 200 with Content-Type text/csv and a
 * Content-Disposition header that triggers a browser download.
 *
 * 400 → Missing or invalid type/provider parameter
 * 422 → No active persona (cold start)
 * 503 → DB read failure
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROVIDERS, type Provider, type BalanceEntry, PROVIDER_LABEL } from "@/features/wallet/types";
import type { Transfer } from "@/lib/domain/entities/transfer";
import { transferFromRow } from "@/lib/domain/entities/transfer";
import {
  entriesToCsv,
  transfersToCsv,
  providerStatementCsv,
  csvFilename,
} from "@/features/export/generateCsv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES = ["entries", "transfers", "statement"] as const;
type ExportType = (typeof VALID_TYPES)[number];

function isExportType(x: unknown): x is ExportType {
  return typeof x === "string" && (VALID_TYPES as readonly string[]).includes(x);
}

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const providerRaw = url.searchParams.get("provider");

  if (!type || !isExportType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  // For statement type, validate provider
  if (type === "statement") {
    if (!providerRaw || !(PROVIDERS as readonly string[]).includes(providerRaw)) {
      return NextResponse.json(
        { error: `provider must be one of: ${PROVIDERS.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const personaId = readActivePersona();
  if (!personaId) {
    // Return empty CSV instead of error — friendlier UX
    const empty = type === "entries" || type === "statement"
      ? entriesToCsv([])
      : transfersToCsv([]);
    const filename = type === "statement"
      ? csvFilename(`statement-${providerRaw}`)
      : csvFilename(type);
    return new NextResponse(empty, {
      status: 200,
      headers: csvHeaders(filename),
    });
  }

  try {
    const db = getDb();
    let csv: string;
    let filename: string;

    switch (type) {
      case "entries": {
        const rows = db
          .prepare<
            [string],
            { id: number; provider_id: string; balance: number; ts: string }
          >(
            `SELECT id, provider_id, balance, ts
             FROM balance_entries
             WHERE persona_id = ?
             ORDER BY ts DESC`,
          )
          .all(personaId);

        const entries: BalanceEntry[] = rows.map((r) => ({
          id: String(r.id),
          provider: r.provider_id as Provider,
          balance: (r.balance as number) / 100, // paise to BDT
          timestamp: r.ts,
        }));

        csv = entriesToCsv(entries);
        filename = csvFilename("entries");
        break;
      }

      case "transfers": {
        const rows = db
          .prepare<[string], Record<string, unknown>>(
            `SELECT * FROM transfers WHERE persona_id = ? ORDER BY ts DESC`,
          )
          .all(personaId);

        const transfers: Transfer[] = rows.map((r) =>
          transferFromRow(r as Parameters<typeof transferFromRow>[0]),
        );

        csv = transfersToCsv(transfers);
        filename = csvFilename("transfers");
        break;
      }

      case "statement": {
        const provider = providerRaw as Provider;
        const rows = db
          .prepare<
            [string, string],
            { id: number; balance: number; ts: string }
          >(
            `SELECT id, balance, ts
             FROM balance_entries
             WHERE persona_id = ? AND provider_id = ?
             ORDER BY ts DESC`,
          )
          .all(personaId, provider);

        const entries: BalanceEntry[] = rows.map((r) => ({
          id: String(r.id),
          provider,
          balance: (r.balance as number) / 100,
          timestamp: r.ts,
        }));

        csv = providerStatementCsv(provider, entries);
        filename = csvFilename(`statement-${providerRaw}`);
        break;
      }
    }

    return new NextResponse(csv, {
      status: 200,
      headers: csvHeaders(filename),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed." },
      { status: 503 },
    );
  }
}

function csvHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-cache",
  };
}
