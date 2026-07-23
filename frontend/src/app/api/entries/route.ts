/**
 * /api/entries — minimal backend phase surface.
 *
 * GET   /api/entries        → 200, sorted newest-first
 * POST  /api/entries        → 201, the persisted BalanceEntry
 *                              body: { provider: "bkash"|"nagad"|"rocket",
 *                                      balance: number >= 0 }
 *                              400 on invalid provider / negative /
 *                              non-finite balance
 *
 * No PUT, no DELETE — the log is append-only per spec §4. Server owns
 * id and timestamp; the client never sets them.
 *
 * Phase 3: this route no longer imports `lib/entriesRepo.ts`. It pulls
 * the `EntriesRepo` port through `getRepositories(getDb())` so the
 * persistence layer is swappable end-to-end.
 *
 * Phase 10: GET now supports keyset pagination via ?limit=N&beforeTs=<ms>&beforeId=<id>
 *   where `beforeId` is the stringified autoincrement `balance_entries.id`.
 *   The composite `(ts, id)` cursor is stable across same-ms ties because
 *   `id` is monotonically increasing. The response carries `nextCursor`
 *   iff the page is full; null on a short page signals end-of-history.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRepositories } from "@/lib/infrastructure/repos";
import { PROVIDERS, type Provider } from "@/features/wallet/types";
import { isCurrency, type Currency } from "@/features/currency/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** balance_entries.id is the stringified autoincrement primary key.
 *  SQLite rowids fit comfortably in 19–20 digits for any realistic
 *  ledger; we cap at 20 to leave headroom. */
const ENTRY_ID_RE = /^\d{1,20}$/;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function isProvider(x: unknown): x is Provider {
  return typeof x === "string" && (PROVIDERS as string[]).includes(x);
}

function isFiniteNonNegativeNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function parseLimit(raw: string | null):
  | { ok: true; value: number }
  | { ok: false; status: 400; error: string } {
  if (raw === null) return { ok: true, value: DEFAULT_LIMIT };
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      status: 400,
      error: "limit must be a positive integer.",
    };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT) {
    return {
      ok: false,
      status: 400,
      error: `limit must be between 1 and ${MAX_LIMIT}.`,
    };
  }
  return { ok: true, value: n };
}

/**
 * Phase 10: keyset cursor. `beforeTs` is a non-negative ms-epoch
 * integer (the row's `ts`); `beforeId` is that row's stringified
 * autoincrement `id`. Both must be supplied together — a partial
 * cursor would silently drift the page boundary on a tie, so we
 * reject it with 400 rather than fall back to the first page.
 */
function parseCursor(
  rawTs: string | null,
  rawId: string | null,
):
  | { ok: true; value: { ts: number; id: string } | null }
  | { ok: false; status: 400; error: string } {
  const hasTs = rawTs !== null;
  const hasId = rawId !== null;
  if (!hasTs && !hasId) return { ok: true, value: null };
  if (hasTs !== hasId) {
    return {
      ok: false,
      status: 400,
      error: "beforeTs and beforeId must be provided together.",
    };
  }
  if (!/^\d+$/.test(rawTs as string)) {
    return {
      ok: false,
      status: 400,
      error: "beforeTs must be a non-negative integer (ms epoch).",
    };
  }
  const ts = Number(rawTs);
  if (!Number.isFinite(ts) || ts < 0) {
    return {
      ok: false,
      status: 400,
      error: "beforeTs must be a non-negative integer (ms epoch).",
    };
  }
  if (!ENTRY_ID_RE.test(rawId as string)) {
    return {
      ok: false,
      status: 400,
      error: "beforeId must be a stringified integer entry id.",
    };
  }
  return { ok: true, value: { ts, id: rawId as string } };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitCheck = parseLimit(url.searchParams.get("limit"));
  if (!limitCheck.ok) {
    return NextResponse.json(limitCheck, { status: 400 });
  }
  const cursorCheck = parseCursor(
    url.searchParams.get("beforeTs"),
    url.searchParams.get("beforeId"),
  );
  if (!cursorCheck.ok) {
    return NextResponse.json(cursorCheck, { status: 400 });
  }

  const list = await getRepositories(getDb()).entries.listPage({
    limit: limitCheck.value,
    before: cursorCheck.value ?? undefined,
  });

  // If the page is full, there may be more rows. Emit a cursor
  // pointing at the LAST row (oldest on this page); clients feed
  // that back as `beforeTs` + `beforeId` to fetch the next page.
  // We do NOT emit a cursor on a short page — that signals the
  // end of history without an extra round-trip.
  const last = list[list.length - 1];
  const nextCursor =
    list.length === limitCheck.value && last
      ? {
          ts: Date.parse(last.timestamp),
          id: last.id,
        }
      : null;

  // Surface the entries list in the same shape as Phase 9 transfers:
  // an envelope so the client doesn't have to read two message types.
  return NextResponse.json(
    { entries: list, nextCursor },
    { status: 200 },
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
    return NextResponse.json({ error: "Body must be an object." }, { status: 400 });
  }
  const { provider, balance, currency } = body as {
    provider?: unknown;
    balance?: unknown;
    currency?: unknown;
  };
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

  // Optional currency field (defaults to BDT).
  const entryCurrency: Currency =
    currency !== undefined && isCurrency(currency) ? currency : "BDT";

  // For USD entries, accept an optional exchange rate. If not provided,
  // the server will try to fetch the live rate; if that fails, we use
  // the fallback rate (~110 BDT/USD).
  const exchangeRateBdt =
    body && typeof body === "object" && "exchangeRateBdt" in body
      ? (body as Record<string, unknown>).exchangeRateBdt
      : undefined;

  const entry = await getRepositories(getDb()).entries.appendEntry(
    provider,
    balance,
    entryCurrency,
    typeof exchangeRateBdt === "number" && Number.isFinite(exchangeRateBdt)
      ? exchangeRateBdt
      : undefined,
  );
  return NextResponse.json(entry, { status: 201 });
}