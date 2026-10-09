import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve o alias "@/..." direto do tsconfig.json, sem plugin extra.
    tsconfigPaths: true,
    alias: {
      // "server-only" só faz sentido no build do Next; nos testes vira um módulo vazio.
      "server-only": path.resolve(
        import.meta.dirname,
        "src/test/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    // O banco local (PGlite) leva alguns segundos para subir e aplicar as migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
