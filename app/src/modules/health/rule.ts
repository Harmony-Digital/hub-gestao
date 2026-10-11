/**
 * Saúde do projeto (PRD §5.7): regra em código, nunca decidida por IA.
 *
 * Vermelho (at_risk): marco atrasado, mais de 25% das tarefas abertas bloqueadas, ou
 * dependência quebrada (frente que começou antes de terminar a frente de que depende,
 * `workstreams/dependency-rule.ts`).
 * Amarelo (attention): de 10% a 25% bloqueadas, ou aprovação pendente há mais de 3 dias úteis.
 * Verde (healthy): nenhum dos sinais acima.
 *
 * Cada sinal tem um tipo (`HealthSignal`) e uma ação sugerida (`riskAction`), que o Hoje
 * mostra ao lado do risco (RF-24). Ainda não entra: deriva prevista pelo ritmo.
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

/** Os sinais que a regra conhece; cada um tem uma ação sugerida no Hoje (RF-24). */
export type HealthSignalKind =
  | "late_milestones"
  | "broken_dependencies"
  | "blocked_tasks"
  | "stale_approval";

export type HealthSignal = { kind: HealthSignalKind; text: string };

export type HealthResult = {
  health: Health;
  /** As frases dos sinais, na ordem (vermelhos antes): o que já era gravado e enviado. */
  reasons: string[];
  signals: HealthSignal[];
};

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
  const red: HealthSignal[] = [];
  const yellow: HealthSignal[] = [];

  if (input.late_milestones > 0) {
    red.push({
      kind: "late_milestones",
      text:
        input.late_milestones === 1
          ? "1 marco passou da data sem entrega."
          : `${input.late_milestones} marcos passaram da data sem entrega.`,
    });
  }

  if (input.broken_dependencies > 0) {
    red.push({
      kind: "broken_dependencies",
      text:
        input.broken_dependencies === 1
          ? "1 frente começou antes de terminar a frente de que depende."
          : `${input.broken_dependencies} frentes começaram antes de terminar as frentes de que dependem.`,
    });
  }

  const ratio =
    input.open_task_count > 0
      ? input.blocked_task_count / input.open_task_count
      : 0;
  const pct = Math.round(ratio * 100);
  const blocked: HealthSignal = {
    kind: "blocked_tasks",
    text: `${pct}% das tarefas abertas estão bloqueadas.`,
  };
  if (ratio > 0.25) {
    red.push(blocked);
  } else if (ratio >= 0.1) {
    yellow.push(blocked);
  }

  if (input.oldest_pending_approval_at) {
    const since = new Date(input.oldest_pending_approval_at);
    const days = businessDaysBetween(since, now);
    if (days > 3) {
      yellow.push({
        kind: "stale_approval",
        text: `Há aprovação esperando decisão há ${days} dias úteis.`,
      });
    }
  }

  const result = (health: Health, signals: HealthSignal[]): HealthResult => ({
    health,
    reasons: signals.map((s) => s.text),
    signals,
  });
  if (red.length > 0) return result("at_risk", [...red, ...yellow]);
  if (yellow.length > 0) return result("attention", yellow);
  return result("healthy", []);
}

/**
 * A ação sugerida para cada sinal, com o lugar certo para resolver (RF-24). Regra fixa,
 * sem IA: a frase diz o próximo passo e o link leva para a tela onde ele acontece.
 */
export function riskAction(
  kind: HealthSignalKind,
  projectCode: string,
): { label: string; href: string } {
  switch (kind) {
    case "late_milestones":
      return {
        label:
          "Replaneje a data do marco ou, se já foi entregue, marque como Entregue.",
        href: `/projetos/${projectCode}`,
      };
    case "broken_dependencies":
      return {
        label:
          "Veja qual frente começou antes da hora e combine a ordem com quem cuida dela.",
        href: `/projetos/${projectCode}`,
      };
    case "blocked_tasks":
      return {
        label:
          "Abra as bloqueadas no Quadro e cobre de quem destrava a próxima ação.",
        href: `/projetos/${projectCode}/quadro`,
      };
    case "stale_approval":
      return {
        label: "Decida o pedido parado nas Aprovações.",
        href: `/aprovacoes?projeto=${projectCode}`,
      };
  }
}

export type Risk = {
  text: string;
  action: { label: string; href: string };
};

const SIGNAL_KINDS = new Set<HealthSignalKind>([
  "late_milestones",
  "broken_dependencies",
  "blocked_tasks",
  "stale_approval",
]);

/**
 * Os riscos de um projeto como o Hoje mostra: cada sinal gravado com a ação sugerida. O
 * que foi gravado antes dos sinais com tipo (só as frases) aponta para o projeto.
 */
export function risksFrom(healthReason: unknown, projectCode: string): Risk[] {
  const saved =
    healthReason && typeof healthReason === "object"
      ? (healthReason as { reasons?: unknown; signals?: unknown })
      : {};
  if (Array.isArray(saved.signals)) {
    return saved.signals.flatMap((s) => {
      if (!s || typeof s !== "object") return [];
      const { kind, text } = s as { kind?: unknown; text?: unknown };
      if (typeof text !== "string") return [];
      return [
        {
          text,
          action: SIGNAL_KINDS.has(kind as HealthSignalKind)
            ? riskAction(kind as HealthSignalKind, projectCode)
            : { label: "Abrir o projeto.", href: `/projetos/${projectCode}` },
        },
      ];
    });
  }
  if (!Array.isArray(saved.reasons)) return [];
  return saved.reasons
    .filter((r): r is string => typeof r === "string")
    .map((text) => ({
      text,
      action: { label: "Abrir o projeto.", href: `/projetos/${projectCode}` },
    }));
}
