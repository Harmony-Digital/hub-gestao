import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
