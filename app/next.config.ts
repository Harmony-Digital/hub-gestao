import type { NextConfig } from "next";

// Só no computador de quem programa e só quando pedido: observar os arquivos por consulta
// periódica. Com muitos servidores abertos no Mac, o macOS esgota os observadores
// (FSEvents) e o `next dev` não sobe ("unable to start FSEvent stream").
const pollIntervalMs = Number(process.env.HUB_DEV_POLL_MS);

const nextConfig: NextConfig = {
  ...(Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
    ? { watchOptions: { pollIntervalMs } }
    : {}),
  // Imagem Docker enxuta para a VPS (padrão do Certato): gera .next/standalone com server.js.
  output: "standalone",
  poweredByHeader: false,
  // Banco local de desenvolvimento (Postgres em WebAssembly): carregado pelo Node, sem empacotar.
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
