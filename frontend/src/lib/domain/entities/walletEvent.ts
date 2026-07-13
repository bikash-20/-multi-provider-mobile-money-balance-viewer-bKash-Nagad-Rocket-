/**
 * lib/domain/entities/walletEvent.ts — append-only state-transition log.
 *
 * Each domain mutation appends one row inside the same transaction that
 * wrote the change. The SSE endpoint replays rows from this table by
 * `(persona_id, id > last_event_id)`, so the entire event history is
 * the durable replay cursor — losing the in-memory broadcaster buffer
 * costs no information.
 */
import type { ProviderId } from "../providerId";

export type WalletEventType =
  | "transfer.committed"
  | "balance.appended"
  | "forecast.updated"
  | "anomaly.detected"
  | "advisory.opened"
  | "advisory.transitioned"
  | "advisory.resolved"
  | "scenario.tick";

export interface WalletEvent {
  readonly id: number;
  readonly personaId: string;
  readonly eventType: WalletEventType;
  readonly providerId: ProviderId | null;
  /** Free-form JSON string. Validated by SQLite CHECK (json_valid). */
  readonly payload: string;
  readonly ts: number;
}