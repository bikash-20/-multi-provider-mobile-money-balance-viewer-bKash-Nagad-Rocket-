/**
 * /api/transfers/[id]/reverse — issue a compensating transfer.
 *
 * POST /api/transfers/:id/reverse
 *   body: { reason?: string }       // ≤ 120 chars, free text
 *   headers: { "Idempotency-Key"?: string }
 *
 *   201 → { transfer: Transfer }    // the compensating row
 *   400 → bad body / unknown id syntax / Idempotency-Key length
 *   404 → original transfer id does not exist
 *   409 → already reversed (TransferAlreadyReversedError)
 *         OR optimistic-lock version is stale
 *         OR inverse leg would push balance below zero
 *   422 → no active persona
 *   503 → DB read / write failure we can't classify
 *
 * Phase 8: compiles against the SQLite binding's `commitReverse`,
 * which appends a NEW transfers row that swaps from/to and stores
 * `reverses_transfer_id = originalId`. The original transfer is
 * never UPDATEd or DELETEd — the ledger stays append-only.
 *
 * Next.js 15+ typed params as Promise<...>; we await the segment
 * param before looking up the binding.
 */
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getRepositories } from "@/lib/infrastructure/repos";
import {
  TransferAlreadyReversedError,
  TransferConflictError,
  TransferNotFoundError,
} from "@/lib/domain/repositories/transferRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REASON_LEN = 120;
const MAX_IDEMPOTENCY_KEY_LEN = 64;

/**
 * Transfer ids are UUIDv7 — 32 chars of lowercase hex (see
 * `lib/domain/transferId.ts`). We accept that exact shape and reject
 * anything else as 400, so a bad URL never reaches the repo.
 */
const TRANSFER_ID_RE = /^[0-9a-f]{32}$/i;

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

function validateBody(raw: unknown):
  | { ok: true; reason: string }
  | { ok: false; status: 400; error: string } {
  if (raw === undefined || raw === null) return { ok: true, reason: "" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, error: "Body must be a JSON object." };
  }
  const { reason } = raw as Record<string, unknown>;
  if (reason === undefined || reason === null) return { ok: true, reason: "" };
  if (typeof reason !== "string") {
    return {
      ok: false,
      status: 400,
      error: `reason must be a string of at most ${MAX_REASON_LEN} characters.`,
    };
  }
  if (reason.length > MAX_REASON_LEN) {
    return {
      ok: false,
      status: 400,
      error: `reason must be a string of at most ${MAX_REASON_LEN} characters.`,
    };
  }
  return { ok: true, reason };
}

function validateIdempotencyKey(value: string | null):
  | { ok: true }
  | { ok: false; status: 400; error: string } {
  if (value === null) return { ok: true };
  if (value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LEN) {
    return {
      ok: false,
      status: 400,
      error: `Idempotency-Key must be 1..${MAX_IDEMPOTENCY_KEY_LEN} characters.`,
    };
  }
  return { ok: true };
}

export async function POST(
  req: Request,
  segment: { params: Promise<{ id: string }> },
) {
  // 1. Validate the URL segment. Bad id → 400, never reaches the DB.
  const { id } = await segment.params;
  if (!TRANSFER_ID_RE.test(id)) {
    return NextResponse.json(
      { error: "Transfer id must be a UUID." },
      { status: 400 },
    );
  }

  // 2. Header check first — fail fast on a malformed Idempotency-Key.
  const headerKey = req.headers.get("Idempotency-Key");
  const headerCheck = validateIdempotencyKey(headerKey);
  if (!headerCheck.ok) {
    return NextResponse.json(headerCheck, { status: 400 });
  }

  // 3. JSON body — only `reason` is recognised, anything else is 400.
  // We can't rely on `content-length` here because the standard Request
  // implementation strips it on inbound reads. Instead, peek at the
  // raw text: an empty body is allowed (reverse with no reason), but
  // anything non-empty must parse as JSON.
  let body: unknown = null;
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const raw = await req.text();
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json(
          { error: "Body must be valid JSON." },
          { status: 400 },
        );
      }
    }
  }
  const validation = validateBody(body);
  if (!validation.ok) {
    return NextResponse.json(validation, { status: 400 });
  }
  const { reason } = validation;

  // 4. Active persona — same cold-start posture as POST /api/transfers.
  const personaId = readActivePersona();
  if (!personaId) {
    return NextResponse.json(
      { error: "No active persona. Run the demo seeder first." },
      { status: 422 },
    );
  }

  // 5. Read CURRENT provider_balance versions for both original sides.
  //    commitReverse's expectedVersion fields must refer to the *current*
  //    rows; if any writer slipped in between this read and the commit,
  //    the binding raises TransferConflictError → 409.
  const { balances, transfers } = getRepositories(getDb());
  let original;
  let currentRows;
  try {
    original = await transfers.byId(id as never);
    if (!original) {
      return NextResponse.json(
        { error: `Transfer ${id} not found.` },
        { status: 404 },
      );
    }
    currentRows = await balances.listByPersona(personaId);
  } catch {
    return NextResponse.json(
      { error: "Could not read transfer ledger." },
      { status: 503 },
    );
  }

  // The inverse `from` is the original's `to`; the inverse `to` is the
  // original's `from`. Look up the matching current versions.
  const inverseFromRow = currentRows.find(
    (r) => r.providerId === original.toProvider,
  );
  const inverseToRow = currentRows.find(
    (r) => r.providerId === original.fromProvider,
  );
  if (!inverseFromRow || !inverseToRow) {
    return NextResponse.json(
      { error: "Could not read current balances for both providers." },
      { status: 503 },
    );
  }

  // 6. Pre-check: a reverse that would push the inverse `from` side
  //    below zero is friendlier surfaced as 409 (insufficient balance
  //    to put the money back) than as a SQLite CHECK failure bubbling
  //    up as 503. We use the same wording as the forward POST so the
  //    client can show identical copy.
  if ((inverseFromRow.balance as number) < (original.amountBdt as number)) {
    return NextResponse.json(
      {
        error:
          `Insufficient balance in ${original.toProvider} to reverse: ` +
          `have ${inverseFromRow.balance} paise, need ${original.amountBdt} paise.`,
      },
      { status: 409 },
    );
  }

  // 7. Commit the compensation. Errors map 1:1 to HTTP status so the
  //    client only needs to handle six cases (201/400/404/409/422/503).
  try {
    const transfer = await transfers.commitReverse({
      originalTransferId: id as never,
      personaId,
      fromExpectedVersion: inverseFromRow.versionId,
      toExpectedVersion: inverseToRow.versionId,
      note: reason,
    });
    return NextResponse.json(
      { transfer, idempotencyKey: headerKey },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof TransferNotFoundError) {
      return NextResponse.json(
        { error: `Transfer ${id} not found.` },
        { status: 404 },
      );
    }
    if (e instanceof TransferAlreadyReversedError) {
      return NextResponse.json(
        {
          error: `Transfer ${id} is already reversed by ${e.compensatingTransferId}.`,
          compensatingTransferId: e.compensatingTransferId,
        },
        { status: 409 },
      );
    }
    if (e instanceof TransferConflictError) {
      return NextResponse.json(
        {
          error:
            "Transfer conflict: another writer raced us. Refetch balances and retry.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not commit reverse. Please retry." },
      { status: 503 },
    );
  }
}