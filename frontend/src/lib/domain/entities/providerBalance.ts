/**
 * lib/domain/entities/providerBalance.ts — current balance snapshot.
 *
 * `versionId` is the optimistic-lock token. Every successful UPDATE bumps
 * it; every caller that wishes to mutate supplies the version it read,
 * and a version mismatch means another writer beat us to it.
 */
import type { Paise } from "../money";
import type { ProviderId } from "../providerId";

export interface ProviderBalance {
  readonly personaId: string;
  readonly providerId: ProviderId;
  readonly balance: Paise;
  readonly versionId: number;
  readonly updatedAt: number; // epoch millis
}

export function providerBalanceFromRow(row: {
  persona_id: string;
  provider_id: ProviderId;
  balance: number;
  version_id: number;
  updated_at: number;
}): ProviderBalance {
  return Object.freeze({
    personaId: row.persona_id,
    providerId: row.provider_id,
    balance: row.balance as Paise,
    versionId: row.version_id,
    updatedAt: row.updated_at,
  });
}