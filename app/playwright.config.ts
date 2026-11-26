import { defineConfig } from "@playwright/test";

// e2e runs its own dev server on port 3200 against a fresh, throwaway PGlite database,
// with AI keys blanked so the deterministic analyst path is exercised reproducibly.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: { baseURL: "http://localhost:3200", screenshot: "only-on-failure", viewport: { width: 1440, height: 900 }, channel: process.env.PW_CHANNEL ?? "msedge" },
  webServer: {
    command: "npx next dev -p 3200",
    url: "http://localhost:3200/api/health",
    timeout: 240_000,
    reuseExistingServer: false,
    env: { PGLITE_DIR: `.data/e2e-${Date.now()}`, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
  },
});
