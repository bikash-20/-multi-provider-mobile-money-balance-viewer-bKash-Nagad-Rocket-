/**
 * seed.ts — intentionally empty.
 *
 * Backend phase (spec §8): the server is now the source of truth. The
 * app boots with an empty log and the API returns whatever is in the
 * SQLite file. To demo with sample data, append a few rows via the
 * `db:reset` script + curl, or just type values into the cards.
 *
 * This file is kept (rather than deleted) so `tsconfig.json`'s path
 * resolution and any test fixtures that import from `./seed` keep
 * working. It exports nothing.
 */
export {};
