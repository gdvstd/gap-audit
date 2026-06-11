import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve "@" to the repo root relative to this config file, so the alias
// survives the project being moved/renamed (no hardcoded absolute path).
const repoRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": repoRoot,
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: [
      "lib/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.ts",
      "actor-sim/__tests__/**/*.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist"],
    coverage: {
      provider: "v8",
      include: ["lib/contracts/**/*.ts", "lib/normalizer/**/*.ts"],
      exclude: ["lib/contracts/__tests__/**", "lib/normalizer/__tests__/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      reporter: ["text", "json", "html"],
    },
  },
});
