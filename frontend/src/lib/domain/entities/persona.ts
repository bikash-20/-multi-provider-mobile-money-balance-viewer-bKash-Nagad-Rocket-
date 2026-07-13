/**
 * lib/domain/entities/persona.ts — a wallet owner's profile.
 *
 * Personas are seeded by the existing `seedDemo` script; this entity is
 * the read shape used by the application layer. The opening balances are
 * captured in paise, the volatility + inflow rate are floats used by the
 * scenario injectors (Phase 3).
 */
import type { Paise } from "../money";
import type { ProviderId } from "../providerId";

export interface Persona {
  readonly id: string;
  readonly displayName: string;
  readonly openingBalances: Readonly<Record<ProviderId, Paise>>;
  readonly inflowRate: number;
  readonly volatility: number;
}

export function personaFromRow(row: {
  id: string;
  display_name: string;
  opening_bkash: number;
  opening_nagad: number;
  opening_rocket: number;
  inflow_rate: number;
  volatility: number;
}): Persona {
  return Object.freeze({
    id: row.id,
    displayName: row.display_name,
    openingBalances: Object.freeze({
      bkash:  row.opening_bkash  as Paise,
      nagad:  row.opening_nagad  as Paise,
      rocket: row.opening_rocket as Paise,
    }),
    inflowRate: row.inflow_rate,
    volatility: row.volatility,
  });
}