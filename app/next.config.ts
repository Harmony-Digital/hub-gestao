import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagem Docker enxuta para a VPS (padrão do Certato): gera .next/standalone com server.js.
  output: "standalone",
  poweredByHeader: false,
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
