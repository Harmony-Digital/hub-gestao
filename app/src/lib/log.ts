import "server-only";
import pino from "pino";
import { safeError } from "@/lib/log-safe";

/**
 * Log estruturado (AGENTS.md §5.2): JSON em uma linha, com request_id e ator, sem PII e
 * sem segredos. Corpo de pedido, cabeçalhos e parâmetros de SQL nunca entram no log. O
 * erro passa por `safeError` (sem o `detail` do Postgres, com e-mail e chave trocados por
 * marcadores) e os campos de nome sensível saem censurados, por garantia.
 */
export const log = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "hub-gestao", version: process.env.APP_VERSION || "local" },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { err: safeError, error: safeError },
  redact: {
    paths: [
      "authorization",
      "*.authorization",
      "key",
      "*.key",
      "secret",
      "*.secret",
      "password",
      "*.password",
      "token",
      "*.token",
      "email",
      "*.email",
      "cookie",
      "*.cookie",
      "headers",
      "*.headers",
    ],
    censor: "[removido]",
  },
});
