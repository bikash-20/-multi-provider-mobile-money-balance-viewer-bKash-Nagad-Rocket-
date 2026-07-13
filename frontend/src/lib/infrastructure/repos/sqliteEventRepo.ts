/**
 * lib/infrastructure/repos/sqliteEventRepo.ts — sqlite binding for
 * `EventRepo`. The log is the durable replay cursor for SSE clients;
 * never UPDATE, never DELETE — only append.
 */
import type { Database as DB } from "better-sqlite3";
import type { EventRepo } from "@/lib/domain/repositories/eventRepo";
import type { WalletEvent, WalletEventType } from "@/lib/domain/entities/walletEvent";
import type { ProviderId } from "@/lib/domain/providerId";

interface WalletEventRow {
  id: number;
  persona_id: string;
  event_type: string;
  provider_id: ProviderId | null;
  payload: string;
  ts: number;
}

function hydrate(row: WalletEventRow): WalletEvent {
  return Object.freeze({
    id: row.id,
    personaId: row.persona_id,
    eventType: row.event_type as WalletEventType,
    providerId: row.provider_id,
    payload: row.payload,
    ts: row.ts,
  });
}

export class SqliteEventRepo implements EventRepo {
  constructor(private readonly db: DB) {}

  async append(args: {
    personaId: string;
    eventType: WalletEventType;
    providerId: ProviderId | null;
    payload: unknown;
    ts?: number;
  }): Promise<number> {
    const info = this.db
      .prepare(
        `INSERT INTO wallet_events
           (persona_id, event_type, provider_id, payload, ts)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        args.personaId,
        args.eventType,
        args.providerId,
        JSON.stringify(args.payload ?? {}),
        args.ts ?? Date.now(),
      );
    return Number(info.lastInsertRowid);
  }

  async since(personaId: string, sinceId: number, limit: number): Promise<WalletEvent[]> {
    const rows = this.db
      .prepare<[string, number, number], WalletEventRow>(
        `SELECT id, persona_id, event_type, provider_id, payload, ts
         FROM wallet_events
         WHERE persona_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(personaId, sinceId, limit);
    return rows.map(hydrate);
  }

  async recent(personaId: string, limit: number): Promise<WalletEvent[]> {
    const rows = this.db
      .prepare<[string, number], WalletEventRow>(
        `SELECT id, persona_id, event_type, provider_id, payload, ts
         FROM wallet_events
         WHERE persona_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(personaId, limit);
    return rows.map(hydrate);
  }
}