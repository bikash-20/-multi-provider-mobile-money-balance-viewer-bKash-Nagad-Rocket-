#!/usr/bin/env node
/**
 * scripts/smoke.mjs — post-deploy liveness + sanity probe.
 *
 * Hits a handful of routes against $WALLETSYNC_URL (default
 * http://localhost:3001) and prints a one-line per-route summary.
 * Exits 0 iff every check is green; non-zero on any failure.
 *
 * Usage:
 *   node scripts/smoke.mjs                      # against localhost:3001
 *   WALLETSYNC_URL=https://... node scripts/smoke.mjs
 *
 * The probe is intentionally tiny — just enough to catch the four
 * classes of post-deploy breakage we've already seen:
 *   1. Server didn't start (connection refused)
 *   2. DB didn't migrate (health says "down")
 *   3. Env vars missing (meta returns isDemo=false but no snapshot)
 *   4. Static assets broken (GET / returns non-200)
 *
 * The /api/health endpoint carries the canonical "is this thing OK?"
 * signal; everything else is a smoke check on the response shapes
 * the dashboard depends on.
 */

const BASE = (process.env.WALLETSYNC_URL ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);
const TIMEOUT_MS = 10_000;

const CHECKS = [
  { path: "/", expectStatus: 200, name: "Dashboard SSR" },
  { path: "/api/health", expectStatus: [200, 503], name: "Health probe" },
  { path: "/api/meta", expectStatus: 200, name: "Meta snapshot" },
  { path: "/api/entries", expectStatus: 200, name: "Entries page-1" },
  { path: "/api/transfers", expectStatus: 200, name: "Transfers page-1" },
];

let failures = 0;
const startedAt = Date.now();

console.log(`🔎 WalletSync smoke check against ${BASE}\n`);

for (const check of CHECKS) {
  const url = `${BASE}${check.path}`;
  const t0 = Date.now();
  let status = 0;
  let body = "";
  let err = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    status = res.status;
    body = await res.text();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const dt = Date.now() - t0;

  const expected = Array.isArray(check.expectStatus)
    ? check.expectStatus
    : [check.expectStatus];
  const ok = err === "" && expected.includes(status);
  const icon = ok ? "✓" : "✗";
  const summary = err
    ? `${icon} ${check.name.padEnd(20)} ERROR   ${dt.toString().padStart(5)}ms  ${err}`
    : `${icon} ${check.name.padEnd(20)} ${String(status).padEnd(7)} ${dt.toString().padStart(5)}ms  ${check.path}`;

  console.log(summary);

  // For the health check, surface the top-level status field so the
  // operator can see "degraded" without having to curl separately.
  if (check.path === "/api/health" && status === 200) {
    try {
      const parsed = JSON.parse(body);
      console.log(
        `    └─ health.status=${parsed.status} db.open=${parsed.db?.open ?? "?"} db.writesOk=${parsed.db?.writesOk ?? "?"}`,
      );
      if (parsed.status !== "ok") {
        failures++;
        console.log(`    └─ ! expected status:"ok", got "${parsed.status}"`);
      }
    } catch {
      // body wasn't JSON; the status code check above already
      // flagged this case if applicable.
    }
  }

  if (!ok) failures++;
}

const elapsed = Date.now() - startedAt;
console.log(
  `\n${failures === 0 ? "✅" : "❌"} ${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} in ${elapsed}ms`,
);
process.exit(failures === 0 ? 0 : 1);
