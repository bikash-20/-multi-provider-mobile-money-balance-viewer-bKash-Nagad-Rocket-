/**
 * /api/transfers — append-only double-entry ledger write.
 *
 * POST /api/transfers
 *   body: {
 *     from: "bkash" | "nagad" | "rocket",
 *     to:   "bkash" | "nagad" | "rocket",
 *     amountBdt: number,                // > 0
 *     note?: string,                    // <= 120 chars
 *   }
 *   headers: { "Idempotency-Key"?: string }   // optional, echoed in response
 *
 *   201 → { transfer: Transfer, idempotencyKey: string | null }
 *   400 → invalid JSON / unknown provider / wrong shape / header too long
 *   422 → from === to / amountBdt <= 0 / note too long / no active persona
 *         / insufficient balance
 *   409 → optimistic-lock conflict (another writer raced us)
 *
 * The transfer_id is the PRIMARY KEY of the `transfers` table, so a retry
 * with the same body returns the previously persisted row — the response
 * is naturally idempotent. The `Idempotency-Key` header is an opt-in
 * client correlation tag, not a server-side dedup key.
 *
 * Phase 6: routes through the v2 `TransferRepo` port via
 * `getRepositories(getDb()).transfers`. No direct SQL in this file.
 */
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getRepositories } from "@/lib/infrastructure/repos";
import { PROVIDERS, type Provider } from "@/features/wallet/types";
import {
  TransferConflictError,
} from "@/lib/domain/repositories/transferRepo";
import { bdtToPaise } from "@/lib/domain/money";
import { newTransferId } from "@/lib/domain/transferId";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_NOTE_LEN = 120;
const MAX_IDEMPOTENCY_KEY_LEN = 64;

function isProvider(x: unknown): x is Provider {
  return typeof x === "string" && (PROVIDERS as string[]).includes(x);
}

function isFinitePositiveNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

function isOptionalShortString(
  x: unknown,
  maxLen: number,
): x is string | undefined {
  return x === undefined || (typeof x === "string" && x.length <= maxLen);
}

/**
 * Read the active persona id from `meta.active_persona`, or null when
 * the key is absent (cold start, before `seedDemo` ran). The entries
 * route has the same cold-start posture; we keep the surface identical
 * so the UI's "empty state" copy works for both endpoints.
 */
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

interface ValidatedBody {
  from: Provider;
  to: Provider;
  amountBdt: number;
  note: string;
}

function validateBody(
  raw: unknown,
):
  | { ok: true; value: ValidatedBody }
  | { ok: false; status: 400 | 422; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      status: 400,
      error: "Body must be a JSON object.",
    };
  }
  const { from, to, amountBdt, note } = raw as Record<string, unknown>;

  if (!isProvider(from)) {
    return {
      ok: false,
      status: 400,
      error: `from must be one of: ${PROVIDERS.join(", ")}.`,
    };
  }
  if (!isProvider(to)) {
    return {
      ok: false,
      status: 400,
      error: `to must be one of: ${PROVIDERS.join(", ")}.`,
    };
  }
  if (from === to) {
    return {
      ok: false,
      status: 422,
      error: "from and to must be different providers.",
    };
  }
  if (!isFinitePositiveNumber(amountBdt)) {
    return {
      ok: false,
      status: 422,
      error: "amountBdt must be a finite positive number.",
    };
  }
  if (!isOptionalShortString(note, MAX_NOTE_LEN)) {
    return {
      ok: false,
      status: 422,
      error: `note must be a string of at most ${MAX_NOTE_LEN} characters.`,
    };
  }

  return {
    ok: true,
    value: {
      from,
      to,
      amountBdt,
      note: typeof note === "string" ? note : "",
    },
  };
}

function validateIdempotencyKey(
  value: string | null,
): { ok: true } | { ok: false; status: 400; error: string } {
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

export async function POST(req: Request) {
  // 1. Header check first — fail-fast on a malformed key rather than
  //    going through JSON parsing that may not even be needed.
  const headerKey = req.headers.get("Idempotency-Key");
  const headerCheck = validateIdempotencyKey(headerKey);
  if (!headerCheck.ok) return NextResponse.json(headerCheck, { status: 400 });

  // 2. JSON body parsing.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON." },
      { status: 400 },
    );
  }

  // 3. Shape + domain validation.
  const validation = validateBody(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }
  const { from, to, amountBdt, note } = validation.value;

  // 4. Active persona — lazy-create-or-reject decision. We mirror the
  //    entries route's "422 if no active persona" rather than silently
  //    materialising one, because a transfer without a persona context
  //    is a contract violation the client should know about.
  const personaId = readActivePersona();
  if (!personaId) {
    return NextResponse.json(
      { error: "No active persona. Run the demo seeder first." },
      { status: 422 },
    );
  }

  const { balances, transfers } = getRepositories(getDb());

  // 5. Look up the optimistic-lock versions for both providers. This
  //    closes the read/write gap: we issue the UPDATE with the exact
  //    version we *just* observed. A concurrent writer bumps it, the
  //    repo throws TransferConflictError, and we surface 409.
  let fromRow;
  let toRow;
  try {
    const rows = await balances.listByPersona(personaId);
    fromRow = rows.find((r) => r.providerId === from);
    toRow = rows.find((r) => r.providerId === to);
  } catch {
    return NextResponse.json(
      { error: "Could not read current balances." },
      { status: 503 },
    );
  }
  if (!fromRow || !toRow) {
    return NextResponse.json(
      { error: "Both providers must have an initial balance." },
      { status: 422 },
    );
  }

  // 6. Pre-check insufficient balance — friendlier than relying on the
  //    SQLite CHECK(balance>=0) violation, which would surface as a
  //    generic 409. A 422 with a precise message is more helpful and
  //    keeps the 409 channel reserved for *real* optimistic-lock races.
  const amountPaise = bdtToPaise(amountBdt);
  if ((fromRow.balance as number) < (amountPaise as number)) {
    return NextResponse.json(
      {
        error: `Insufficient balance in ${from}: have ${fromRow.balance} paise, need ${amountPaise} paise.`,
      },
      { status: 422 },
    );
  }

  // 7. Commit the transfer. The repo is replay-safe (transfer_id is
  //    the PK), so a network-level retry from the client lands as a
  //    no-op SELECT and returns the original row.
  try {
    const transfer = await transfers.commit({
      transferId: newTransferId(),
      personaId,
      fromProvider: from,
      toProvider: to,
      amountBdt: amountPaise,
      fromExpectedVersion: fromRow.versionId,
      toExpectedVersion: toRow.versionId,
      note,
    });
    return NextResponse.json(
      {
        transfer,
        idempotencyKey: headerKey,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof TransferConflictError) {
      return NextResponse.json(
        {
          error:
            "Transfer conflict: another writer raced us. Refetch balances and retry.",
        },
        { status: 409 },
      );
    }
    // Repo's catch-all translates the SQLite CHECK(balance>=0) into a
    // TransferConflictError too; if anything else escapes (DB locked,
    // I/O error), surface as 503 so the client can back off.
    return NextResponse.json(
      { error: "Could not commit transfer. Please retry." },
      { status: 503 },
    );
  }
}
