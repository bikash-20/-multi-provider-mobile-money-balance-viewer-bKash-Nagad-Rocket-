/**
 * Vitest config — Node environment (the app code uses node:fs / node:path
 * via the better-sqlite3 module, and the API route handlers are
 * test-imported as plain TS, not run through Next.js). React component
 * tests would change this to "jsdom" + @testing-library/react; we don't
 * have any yet, so keep it minimal.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Tests touch a real SQLite file in a temp dir per test. Run them
    // sequentially so the better-sqlite3 native binding isn't contended.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
