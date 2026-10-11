/**
 * Saúde do projeto (PRD §5.7): regra em código, nunca decidida por IA.
 *
 * Vermelho (at_risk): marco atrasado, mais de 25% das tarefas abertas bloqueadas, ou
 * dependência quebrada (frente que começou antes de terminar a frente de que depende,
 * `workstreams/dependency-rule.ts`).
 * Amarelo (attention): de 10% a 25% bloqueadas, ou aprovação pendente há mais de 3 dias úteis.
 * Verde (healthy): nenhum dos sinais acima.
 *
 * Ainda não entra: deriva prevista pelo ritmo.
 */

export type Health = "healthy" | "attention" | "at_risk";

export type HealthInputs = {
  open_task_count: number;
  blocked_task_count: number;
  late_milestones: number;
  /** Frentes que começaram antes de terminar a frente de que dependem. */
  broken_dependencies: number;
  oldest_pending_approval_at: Date | string | null;
};

export type HealthResult = { health: Health; reasons: string[] };

/** Dias úteis (segunda a sexta) depois de `from` até `to`, sem contar feriados. */
export function businessDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let days = 0;
  for (let day = start + 86_400_000; day <= end; day += 86_400_000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

export function computeHealth(input: HealthInputs, now: Date): HealthResult {
  const red: string[] = [];
  const yellow: string[] = [];

  if (input.late_milestones > 0) {
    red.push(
      input.late_milestones === 1
        ? "1 marco passou da data sem entrega."
        : `${input.late_milestones} marcos passaram da data sem entrega.`,
    );
  }

  if (input.broken_dependencies > 0) {
    red.push(
      input.broken_dependencies === 1
        ? "1 frente começou antes de terminar a frente de que depende."
        : `${input.broken_dependencies} frentes começaram antes de terminar as frentes de que dependem.`,
    );
  }

  const ratio =
    input.open_task_count > 0
      ? input.blocked_task_count / input.open_task_count
      : 0;
  const pct = Math.round(ratio * 100);
  if (ratio > 0.25) {
    red.push(`${pct}% das tarefas abertas estão bloqueadas.`);
  } else if (ratio >= 0.1) {
    yellow.push(`${pct}% das tarefas abertas estão bloqueadas.`);
  }

  if (input.oldest_pending_approval_at) {
    const since = new Date(input.oldest_pending_approval_at);
    const days = businessDaysBetween(since, now);
    if (days > 3) {
      yellow.push(`Há aprovação esperando decisão há ${days} dias úteis.`);
    }
  }

  if (red.length > 0)
    return { health: "at_risk", reasons: [...red, ...yellow] };
  if (yellow.length > 0) return { health: "attention", reasons: yellow };
  return { health: "healthy", reasons: [] };
}
