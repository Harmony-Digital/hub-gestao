/**
 * Saúde do Hub (/api/health), a parte pura. `ok` diz que o processo respondeu (o
 * contêiner e a publicação conferem isso e a versão); `status` e `checks` dizem como
 * estão o banco e a fila de jobs, para quem monitora.
 */

/** Sem ciclo do relógio há mais que isso (três rodadas de 5 minutos), a fila parou. */
export const STALL_MINUTES = 15;

export type QueueState = "ok" | "stalled" | "failing" | "unknown";

export type HealthChecks = {
  database: "ok" | "down";
  queue: QueueState;
};

export type Health = {
  ok: true;
  service: "hub-gestao";
  version: string;
  time: string;
  status: "ok" | "degraded" | "down";
  checks: HealthChecks;
};

/** O retrato da fila que a saúde precisa: o último job concluído, os atrasados e as falhas. */
export type QueueSnapshot = {
  lastTickAt: Date | null;
  /** Jobs na fila há mais de STALL_MINUTES depois da hora marcada. */
  overdue: number;
  /** Jobs que esgotaram as tentativas nas últimas 24 horas. */
  failed24h: number;
};

/**
 * Parada: job atrasado na fila ou nenhum ciclo do relógio há mais de STALL_MINUTES. Com
 * falha: algum job esgotou as tentativas nas últimas 24 horas. Sem nenhum ciclo ainda
 * (banco novo, ou o computador de quem programa, onde o relógio não roda): desconhecida.
 */
export function queueState(snapshot: QueueSnapshot, now: Date): QueueState {
  if (snapshot.overdue > 0) return "stalled";
  if (!snapshot.lastTickAt) return "unknown";
  if (now.getTime() - snapshot.lastTickAt.getTime() > STALL_MINUTES * 60_000) {
    return "stalled";
  }
  return snapshot.failed24h > 0 ? "failing" : "ok";
}

/**
 * Monta a resposta de /api/health. A versão vem de APP_VERSION, que o pipeline
 * preenche com o SHA do commit publicado; localmente vale "local".
 */
export function buildHealth(
  env: Record<string, string | undefined>,
  now: Date,
  checks: HealthChecks,
): Health {
  const version = env.APP_VERSION?.trim();
  const status =
    checks.database === "down"
      ? "down"
      : checks.queue === "stalled" || checks.queue === "failing"
        ? "degraded"
        : "ok";
  return {
    ok: true,
    service: "hub-gestao",
    version: version ? version : "local",
    time: now.toISOString(),
    status,
    checks,
  };
}
