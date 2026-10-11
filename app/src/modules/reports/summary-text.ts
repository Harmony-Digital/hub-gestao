import { formatDate } from "@/lib/format";

/** O que aconteceu no período, lido do banco (`periodFacts`). */
export type PeriodFacts = {
  /** Marcos entregues ou aceitos no período. */
  delivered: {
    code: string;
    title: string;
    titleClient: string | null;
    client: boolean;
  }[];
  /** O próximo marco ainda aberto (na ordem do projeto). */
  next: {
    code: string;
    title: string;
    titleClient: string | null;
    client: boolean;
    due: string | null;
  } | null;
  /** O próximo marco que o cliente vê (para o texto dele). */
  nextClient: { titleClient: string; due: string | null } | null;
  completed: { code: string; title: string }[];
  blocked: { code: string; title: string; reason: string | null }[];
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * O resumo do período, pronto para a pessoa revisar: sem IA, só com o que o Hub
 * registrou. Para o cliente, em segunda pessoa e sem nada interno (código de tarefa,
 * título interno, marco interno, bloqueio); interno, com os códigos e os bloqueios.
 */
export function renderSummary(
  facts: PeriodFacts,
  audience: "client" | "internal",
  start: string,
  end: string,
): string {
  const period = `${formatDate(start)} a ${formatDate(end)}`;
  if (audience === "client") {
    const lines = [`## Andamento de ${period}`, ""];
    const delivered = facts.delivered.filter((m) => m.client && m.titleClient);
    if (facts.completed.length > 0) {
      lines.push(
        `Neste período, a equipe concluiu ${plural(facts.completed.length, "etapa", "etapas")} do seu projeto.`,
      );
    } else {
      lines.push(
        "Neste período, a equipe seguiu trabalhando nas próximas entregas do seu projeto.",
      );
    }
    if (delivered.length > 0) {
      lines.push("", "**Entregas concluídas:**", "");
      for (const m of delivered) lines.push(`- ${m.titleClient}`);
    }
    if (facts.nextClient) {
      lines.push(
        "",
        `**Próxima entrega:** ${facts.nextClient.titleClient}${facts.nextClient.due ? `, prevista para ${formatDate(facts.nextClient.due)}` : ""}.`,
      );
    }
    lines.push(
      "",
      "Você acompanha tudo pelo portal e pode falar com a equipe por lá.",
    );
    return lines.join("\n");
  }
  const lines = [`## Status interno de ${period}`];
  lines.push("", "**Entregas no período:**", "");
  if (facts.delivered.length === 0) lines.push("- Nenhuma.");
  for (const m of facts.delivered) lines.push(`- ${m.code} ${m.title}`);
  lines.push("", `**Tarefas concluídas (${facts.completed.length}):**`, "");
  if (facts.completed.length === 0) lines.push("- Nenhuma.");
  for (const t of facts.completed) lines.push(`- ${t.code} ${t.title}`);
  if (facts.blocked.length > 0) {
    lines.push("", `**Bloqueadas (${facts.blocked.length}):**`, "");
    for (const t of facts.blocked) {
      lines.push(`- ${t.code} ${t.title}${t.reason ? `: ${t.reason}` : ""}`);
    }
  }
  if (facts.next) {
    lines.push(
      "",
      `**Próximo marco:** ${facts.next.code} ${facts.next.title}${facts.next.due ? `, ${formatDate(facts.next.due)}` : ", sem data"}.`,
    );
  }
  return lines.join("\n");
}
