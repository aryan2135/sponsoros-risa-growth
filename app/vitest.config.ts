import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], testTimeout: 120_000, hookTimeout: 120_000, pool: "forks" },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts") } },
});
