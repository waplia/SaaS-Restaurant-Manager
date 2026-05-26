import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["desktop/main/__tests__/**/*.test.ts"],
    environment: "node",
    setupFiles: ["desktop/main/__tests__/setup.ts"],
    pool: "forks",
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
