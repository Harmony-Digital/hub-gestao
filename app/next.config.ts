import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

// Só no computador de quem programa e só quando pedido: observar os arquivos por consulta
// periódica. Com muitos servidores abertos no Mac, o macOS esgota os observadores
// (FSEvents) e o `next dev` não sobe ("unable to start FSEvent stream").
const pollIntervalMs = Number(process.env.HUB_DEV_POLL_MS);

/** Corpo máximo de um envio: o anexo de 25 MB mais a folga do multipart. */
export const ATTACHMENT_BODY_LIMIT = "26mb";

const nextConfig: NextConfig = {
  ...(Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
    ? { watchOptions: { pollIntervalMs } }
    : {}),
  // Imagem Docker enxuta para a VPS (padrão do Certato): gera .next/standalone com server.js.
  output: "standalone",
  poweredByHeader: false,
  // Cabeçalhos de segurança em todas as respostas (CSP, permissões, isolamento; M8). O
  // portal do cliente ainda fica fora dos buscadores e sem mandar o endereço (que pode
  // levar o link de uso único) para outros sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(
          process.env.NODE_ENV === "production" ? "production" : "development",
        ),
      },
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
    // Anexo de tarefa: até 25 MB por arquivo (mais a folga do envio multipart). O proxy
    // (src/proxy.ts) lê o corpo antes da ação e, sem este limite, corta em 10 MB: o envio
    // chegava truncado e a página caía ("Unexpected end of form").
    serverActions: { bodySizeLimit: ATTACHMENT_BODY_LIMIT },
    proxyClientMaxBodySize: ATTACHMENT_BODY_LIMIT,
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
