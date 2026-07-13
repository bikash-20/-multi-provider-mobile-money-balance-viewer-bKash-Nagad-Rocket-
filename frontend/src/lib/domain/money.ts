/**
 * lib/domain/money.ts — integer paise BDT value object.
 *
 * Wallets are persisted in integer paise to dodge floating-point drift
 * (the current schema uses REAL — that gets migrated to INTEGER on the
 * next `db:reset`). The domain layer only sees this type; callers that
 * accept human BDT amounts route through `bdtToPaise` here so the unit
 * boundary is enforced in one place.
 *
 * Branded type: `Paise` is nominal-tagged at compile time so a raw number
 * never silently masquerades as a money amount inside the domain layer.
 */
export type Paise = number & { readonly __brand: "Paise" };

/** One BDT = 100 paise. */
const PAISE_PER_BDT = 100;

export function bdtToPaise(bdt: number): Paise {
  if (!Number.isFinite(bdt)) {
    throw new Error(`bdtToPaise: not a finite number: ${String(bdt)}`);
  }
  if (bdt < 0) {
    throw new Error(`bdtToPaise: negative BDT not allowed: ${bdt}`);
  }
  return Math.round(bdt * PAISE_PER_BDT) as Paise;
}

export function paiseToBdt(paise: Paise): number {
  return (paise as number) / PAISE_PER_BDT;
}

export function paiseEquals(a: Paise, b: Paise): boolean {
  return (a as number) === (b as number);
}

export const ZERO_PAISE = 0 as Paise;

export function isNonNegative(paise: Paise): boolean {
  return (paise as number) >= 0;
}
