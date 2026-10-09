import "server-only";
import pino from "pino";

/**
 * Log estruturado (AGENTS.md §5.2): JSON em uma linha, com request_id e ator, sem PII e
 * sem segredos. Corpo de pedido, cabeçalhos e parâmetros de SQL nunca entram no log.
 */
export const log = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "hub-gestao", version: process.env.APP_VERSION || "local" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "authorization",
      "*.authorization",
      "key",
      "*.key",
      "secret",
      "*.secret",
    ],
    censor: "[removido]",
  },
});
