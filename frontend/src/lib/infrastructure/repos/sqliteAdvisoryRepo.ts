/**
 * lib/infrastructure/repos/sqliteAdvisoryRepo.ts — sqlite binding for
 * `AdvisoryRepo`. Implements the FSM lifecycle from LiquiGuard's
 * `coordination_alerts`, with `(persona_id, dedup_key, status)` as the
 * uniqueness key so a recurring trigger reuses the same case while it
 * is still open.
 */
import type { Database as DB } from "better-sqlite3";
import { withTransaction } from "@/lib/infrastructure/transaction";
import type { AdvisoryRepo } from "@/lib/domain/repositories/advisoryRepo";
import { IllegalAdvisoryTransitionError } from "@/lib/domain/repositories/advisoryRepo";
import {
  advisoryFromRow,
  canTransition,
  type Advisory,
  type AdvisoryStatus,
  type AdvisorySeverity,
  type AdvisoryTransition,
} from "@/lib/domain/entities/advisory";
import type { ProviderId } from "@/lib/domain/providerId";
import type { AlertTokenT } from "@/lib/domain/transferId";

interface AdvisoryRow {
  id: number;
  alert_token: string;
  persona_id: string;
  provider_id: ProviderId | null;
  severity: AdvisorySeverity;
  status: AdvisoryStatus;
  reason: string;
  transitions: string;
  dedup_key: string;
  created_at: number;
  updated_at: number;
}

interface AdvisoryMetadata {
  id: number;
  alert_token: string;
  status: AdvisoryStatus;
  transitions: string;
  updated_at: number;
}

export class SqliteAdvisoryRepo implements AdvisoryRepo {
  constructor(private readonly db: DB) {}

  open(args: {
    personaId: string;
    providerId: ProviderId | null;
    severity: AdvisorySeverity;
    reason: string;
    dedupKey: string;
  }) {
    return Promise.resolve(
      withTransaction(this.db, () => {
        // Dedupe against any open (non-RESOLVED) case for same persona +
        // dedup_key. UNIQUE constraint also enforces this; the SELECT
        // here keeps the API idempotent without generating new rows.
        const existing = this.db
          .prepare<[string, string], AdvisoryMetadata>(
            `SELECT id, alert_token, status, transitions, updated_at
             FROM advisories
             WHERE persona_id = ? AND dedup_key = ?
               AND status <> 'RESOLVED'
             ORDER BY id ASC LIMIT 1`,
          )
          .get(args.personaId, args.dedupKey);
        if (existing) {
          const full = this.db
            .prepare<[number], AdvisoryRow>(
              `SELECT id, alert_token, persona_id, provider_id, severity,
                      status, reason, transitions, dedup_key,
                      created_at, updated_at
               FROM advisories WHERE id = ?`,
            )
            .get(existing.id)!;
          return advisoryFromRow(full);
        }

        const ts = Date.now();
        const info = this.db
          .prepare(
            `INSERT INTO advisories
               (persona_id, provider_id, severity, status, reason,
                transitions, dedup_key, created_at, updated_at)
             VALUES (?, ?, ?, 'PENDING', ?, '[]', ?, ?, ?)`,
          )
          .run(
            args.personaId,
            args.providerId,
            args.severity,
            args.reason,
            args.dedupKey,
            ts,
            ts,
          );
        const id = Number(info.lastInsertRowid);
        const created = this.db
          .prepare<[number], AdvisoryRow>(
            `SELECT id, alert_token, persona_id, provider_id, severity,
                    status, reason, transitions, dedup_key,
                    created_at, updated_at
             FROM advisories WHERE id = ?`,
          )
          .get(id)!;
        return advisoryFromRow(created);
      }),
    );
  }

  async transit(args: {
    alertToken: AlertTokenT;
    toStatus: AdvisoryStatus;
    actor: string;
    reason: string;
  }) {
    return Promise.resolve(
      withTransaction(this.db, () => {
        const current = this.db
          .prepare<[string], AdvisoryRow>(
            `SELECT id, alert_token, persona_id, provider_id, severity,
                    status, reason, transitions, dedup_key,
                    created_at, updated_at
             FROM advisories WHERE alert_token = ?`,
          )
          .get(args.alertToken as string);
        if (!current) {
          throw new Error(
            `advisory not found for alert_token=${args.alertToken as string}`,
          );
        }
        if (!canTransition(current.status, args.toStatus)) {
          throw new IllegalAdvisoryTransitionError(current.status, args.toStatus);
        }
        const ts = Date.now();
        const next: AdvisoryTransition[] = [
          ...JSON.parse(current.transitions),
          {
            from: current.status,
            to: args.toStatus,
            actor: args.actor,
            reason: args.reason,
            ts,
          },
        ];
        const info = this.db
          .prepare(
            `UPDATE advisories
             SET status      = ?,
                 transitions = ?,
                 updated_at  = ?
             WHERE alert_token = ? AND status = ?`,
          )
          .run(
            args.toStatus,
            JSON.stringify(next),
            ts,
            args.alertToken as string,
            current.status,
          );
        if (info.changes !== 1) {
          throw new IllegalAdvisoryTransitionError(current.status, args.toStatus);
        }
        const updated = this.db
          .prepare<[string], AdvisoryRow>(
            `SELECT id, alert_token, persona_id, provider_id, severity,
                    status, reason, transitions, dedup_key,
                    created_at, updated_at
             FROM advisories WHERE alert_token = ?`,
          )
          .get(args.alertToken as string)!;
        return advisoryFromRow(updated);
      }),
    );
  }

  byToken(token: AlertTokenT) {
    const row = this.db
      .prepare<[string], AdvisoryRow>(
        `SELECT id, alert_token, persona_id, provider_id, severity,
                status, reason, transitions, dedup_key,
                created_at, updated_at
         FROM advisories WHERE alert_token = ?`,
      )
      .get(token as string);
    return Promise.resolve(row ? advisoryFromRow(row) : null);
  }

  listOpen(personaId: string, limit: number) {
    const rows = this.db
      .prepare<[string, number], AdvisoryRow>(
        `SELECT id, alert_token, persona_id, provider_id, severity,
                status, reason, transitions, dedup_key,
                created_at, updated_at
         FROM advisories
         WHERE persona_id = ? AND status <> 'RESOLVED'
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(personaId, limit);
    return Promise.resolve(rows.map(advisoryFromRow));
  }
}
