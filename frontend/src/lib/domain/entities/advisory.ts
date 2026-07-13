/**
 * lib/domain/entities/advisory.ts — a coordination case with an FSM.
 *
 * Lifecycle: PENDING -> ACKNOWLEDGED -> ESCALATED -> RESOLVED.
 * Each transition is appended to `transitions` (an immutable list) along
 * with actor + timestamp so the audit log is the source of truth.
 *
 * `dedupKey` collapses repeat triggers: if the same persona + provider
 * surface the same reason, we re-use the existing case instead of
 * opening a new one each tick.
 */
import type { ProviderId } from "../providerId";
import type { AlertTokenT } from "../transferId";

export type AdvisoryStatus =
  | "PENDING"
  | "ACKNOWLEDGED"
  | "ESCALATED"
  | "RESOLVED";

export type AdvisorySeverity = "low" | "medium" | "high";

export interface AdvisoryTransition {
  readonly from: AdvisoryStatus;
  readonly to: AdvisoryStatus;
  readonly actor: string;
  readonly reason: string;
  readonly ts: number;
}

export interface Advisory {
  readonly id: number;
  readonly alertToken: AlertTokenT;
  readonly personaId: string;
  readonly providerId: ProviderId | null;
  readonly severity: AdvisorySeverity;
  readonly status: AdvisoryStatus;
  readonly reason: string;
  readonly transitions: ReadonlyArray<AdvisoryTransition>;
  readonly dedupKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const VALID_TRANSITIONS: Readonly<Record<AdvisoryStatus, ReadonlyArray<AdvisoryStatus>>> = {
  PENDING:     ["ACKNOWLEDGED", "ESCALATED", "RESOLVED"],
  ACKNOWLEDGED: ["ESCALATED", "RESOLVED"],
  ESCALATED:   ["ACKNOWLEDGED", "RESOLVED"],
  RESOLVED:    [],
};

export function canTransition(from: AdvisoryStatus, to: AdvisoryStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function advisoryFromRow(row: {
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
}): Advisory {
  return Object.freeze({
    id: row.id,
    alertToken: row.alert_token as AlertTokenT,
    personaId: row.persona_id,
    providerId: row.provider_id,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    transitions: Object.freeze(JSON.parse(row.transitions) as AdvisoryTransition[]),
    dedupKey: row.dedup_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}