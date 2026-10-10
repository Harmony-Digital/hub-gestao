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
  // Portal do cliente: fora dos buscadores e sem mandar o endereço (que pode levar o
  // link de uso único) para outros sites.
  async headers() {
    return [
      {
        source: "/portal/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  // Banco local de desenvolvimento (Postgres em WebAssembly): carregado pelo Node, sem empacotar.
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Anexo de tarefa: até 10 MB por arquivo (mais a folga do envio multipart).
    serverActions: { bodySizeLimit: "11mb" },
  },
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
