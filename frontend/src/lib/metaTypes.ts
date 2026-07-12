/**
 * metaTypes.ts — shared, runtime-free types for the meta snapshot.
 *
 * Lives in its own module so that client components (page.tsx,
 * AppShell, PersonaSwitcher, DemoBadge) can import these types
 * without dragging in `seedDemo.ts` → `better-sqlite3` + `node:fs`
 * into the client bundle. Splitting types from the implementation
 * is the standard Next.js pattern for sharing shapes across the
 * server/client boundary without `import type` accidentally pulling
 * in server-only side effects (Webpack's chunk graph walks the
 * re-exported module even when the consumer only asks for a type).
 */

export type PersonaName = "freelancer" | "small_business" | "student";

export interface PersonaDisplay {
  name: PersonaName;
  label: string;
  description: string;
}

/** Display-only persona metadata. Safe to import from client components
 *  — no SQLite / Node-only deps in this module. The full PersonaSpec
 *  (with baseline / volatility / drift / spike) lives in seedDemo.ts
 *  and is server-only. */
export const PERSONAS: Readonly<Record<PersonaName, PersonaDisplay>> = {
  freelancer: {
    name: "freelancer",
    label: "Freelancer",
    description:
      "Mixed inflows from freelance projects, steady daily outflows. " +
      "Rocket used as the savings stash.",
  },
  small_business: {
    name: "small_business",
    label: "Small Business (Retail)",
    description:
      "High daily turn-over on bKash and Nagad from customer " +
      "transactions. Rocket held back for supplier payments.",
  },
  student: {
    name: "student",
    label: "Student",
    description:
      "Low magnitudes, frequent small changes from daily expenses. " +
      "Rocket used least; mostly sits empty.",
  },
};

export interface MetaSnapshot {
  isDemo: boolean;
  persona: PersonaName | null;
  label: string | null;
  description: string | null;
  generatedAt: string | null;
}