/**
 * lib/infrastructure/repos/sqliteMetaRepo.ts — SQLite binding for the
 * `MetaRepo` port. Reads the small KV table the seeder populates; safe to
 * call on a missing `meta` table (returns all-null snapshot, mirroring
 * the v1 `lib/metaRepo.ts` behavior that this binding replaces).
 *
 * All operations run against the injected `Database` so the factory in
 * `lib/infrastructure/repos/index.ts` is the single source of truth for
 * which connection backs the app. v1's "open a fresh readonly connection
 * per call" pattern is dropped — it was a defensive workaround for the
 * singleton-vs-seeder race that the repo factory now resolves structurally.
 */
import fs from "node:fs";
import path from "node:path";
import type { Database as DB } from "better-sqlite3";
import type { MetaRepo } from "@/lib/domain/repositories/metaRepo";
import type { MetaSnapshot, PersonaName } from "@/lib/metaTypes";
import { PERSONAS } from "@/lib/metaTypes";

const META_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

function asPersona(raw: string | undefined): PersonaName | null {
  if (!raw) return null;
  return raw in PERSONAS ? (raw as PersonaName) : null;
}

export class SqliteMetaRepo implements MetaRepo {
  constructor(private readonly db: DB) {}

  async readSnapshot(): Promise<MetaSnapshot> {
    // Defensive: `meta` may not exist yet on a brand-new DB. Better-sqlite3
    // throws on `.prepare` for a missing table, so probe with `try/catch`.
    let rows: Array<{ key: string; value: string }>;
    try {
      rows = this.db
        .prepare("SELECT key, value FROM meta")
        .all() as Array<{ key: string; value: string }>;
    } catch {
      return {
        isDemo: false,
        persona: null,
        label: null,
        description: null,
        generatedAt: null,
      };
    }
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      isDemo: map.get("seed.demo") === "true",
      persona: asPersona(map.get("seed.persona")),
      label: map.get("seed.label") ?? null,
      description: map.get("seed.description") ?? null,
      generatedAt: map.get("seed.generated_at") ?? null,
    };
  }

  async ensureSchema(): Promise<void> {
    this.db.exec(META_SCHEMA);
  }
}
