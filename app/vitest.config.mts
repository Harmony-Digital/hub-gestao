import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve o alias "@/..." direto do tsconfig.json, sem plugin extra.
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    // O banco local (PGlite) leva alguns segundos para subir e aplicar as migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
