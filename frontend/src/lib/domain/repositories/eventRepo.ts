/**
 * lib/domain/repositories/eventRepo.ts — append-only state-transition log.
 *
 * The SSE replay path is `(personaId, sinceId) -> WalletEvent[]`. SQLite
 * handles ordering with the autoincrement id; the implementation should
 * always `INSERT` and `SELECT` in that order, never update or delete.
 */
import type { WalletEvent, WalletEventType } from "../entities/walletEvent";
import type { ProviderId } from "../providerId";

export interface EventRepo {
  /** Append a new event row. Returns the assigned id. */
  append(args: {
    personaId: string;
    eventType: WalletEventType;
    providerId: ProviderId | null;
    payload: unknown;
    ts?: number;
  }): Promise<number>;

  /** Return events with id > sinceId, newest first, capped at `limit`. */
  since(personaId: string, sinceId: number, limit: number): Promise<WalletEvent[]>;

  /** Most recent N events for a persona regardless of type, newest first. */
  recent(personaId: string, limit: number): Promise<WalletEvent[]>;
}