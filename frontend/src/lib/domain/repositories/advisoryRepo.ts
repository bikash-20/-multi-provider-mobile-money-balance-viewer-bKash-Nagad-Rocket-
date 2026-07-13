/**
 * lib/domain/repositories/advisoryRepo.ts — coordination FSM.
 *
 * `open` is the only call that mutates outside transitions; if a case
 * with the same `(personaId, dedupKey, status)` already exists it is
 * returned instead of a new row.
 *
 * `transit` enforces the FSM and appends a transition record atomically.
 */
import type { Advisory, AdvisoryStatus } from "../entities/advisory";
import type { ProviderId } from "../providerId";
import type { AlertTokenT } from "../transferId";

export interface AdvisoryRepo {
  /**
   * Open a new advisory or return the active one with the same dedup key.
   * An advisory with status=RESOLVED does not dedup — a fresh case is
   * opened and recorded.
   */
  open(args: {
    personaId: string;
    providerId: ProviderId | null;
    severity: Advisory["severity"];
    reason: string;
    dedupKey: string;
  }): Promise<Advisory>;

  /** Apply a transition. Returns the post-commit advisory. */
  transit(args: {
    alertToken: AlertTokenT;
    toStatus: AdvisoryStatus;
    actor: string;
    reason: string;
  }): Promise<Advisory>;

  byToken(token: AlertTokenT): Promise<Advisory | null>;

  /** Open + recently-updated advisories for the persona, newest first. */
  listOpen(personaId: string, limit: number): Promise<Advisory[]>;
}

export class IllegalAdvisoryTransitionError extends Error {
  constructor(public readonly from: AdvisoryStatus, public readonly to: AdvisoryStatus) {
    super(`illegal advisory transition: ${from} -> ${to}`);
    this.name = "IllegalAdvisoryTransitionError";
  }
}