/**
 * lib/domain/providerId.ts — provider whitelist + branded ID.
 *
 * The provider list is deliberately closed. Adding a fourth provider is
 * an explicit, review-bearing decision: schema CHECK constraints, the
 * persona seeder, the frontend token map, and the scenario dispatcher all
 * need updates. Keeping the source of truth here means a TypeScript type
 * error flags every site that needs attention.
 */
export const PROVIDERS = ["bkash", "nagad", "rocket"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type ProviderIdT = string & { readonly __brand: "ProviderId" };

const PROVIDER_SET: ReadonlySet<string> = new Set<string>(PROVIDERS);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_SET.has(value);
}

export function asProviderId(value: string): ProviderIdT {
  if (!isProviderId(value)) {
    throw new Error(
      `unknown provider id: "${value}". Must be one of: ${PROVIDERS.join(", ")}`,
    );
  }
  return value as ProviderIdT;
}

export function assertProviderId(value: unknown): asserts value is ProviderId {
  if (!isProviderId(value)) {
    throw new Error(
      `unknown provider id: ${JSON.stringify(value)}. Must be one of: ${PROVIDERS.join(", ")}`,
    );
  }
}

/** Display metadata for the UI. Brand hex tokens match the existing palette. */
export const PROVIDER_META: Record<ProviderId, { label: string; hex: string }> = {
  bkash:  { label: "bKash",  hex: "#E0447A" },
  nagad:  { label: "Nagad",  hex: "#E0883B" },
  rocket: { label: "Rocket", hex: "#8B7FE8" },
};
