/**
 * O que o Concierge sabe a cada pedido: o dia, a tela, quem pede e o alcance dessa pessoa
 * (projetos, equipe e pedidos de aprovação que ela enxerga). Montado no servidor, com as
 * permissões de quem pede (service.ts); aqui, só a forma e a mensagem para a IA. Puro.
 */

export type ContextProject = {
  id: string;
  code: string;
  name: string;
  client: string;
};

export type ContextMember = {
  type: "user" | "agent";
  id: string;
  name: string;
};

export type ContextApproval = {
  /** Número curto do pedido na mensagem (1, 2, 3...): a IA devolve este número. */
  ref: number;
  id: string;
  typeLabel: string;
  title: string;
  project: string | null;
};

export type ConciergeContext = {
  /** Hoje no fuso do workspace (AAAA-MM-DD). */
  today: string;
  /** Código do projeto aberto na tela, se houver. */
  screenProject: string | null;
  me: { id: string; name: string };
  projects: ContextProject[];
  team: ContextMember[];
  approvals: ContextApproval[];
};

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** "2026-10-10" → "sexta-feira". */
export function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()] ?? "";
}

/** Uma linha por item, sem quebras vindas do próprio dado (títulos são uma linha só). */
const line = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * A mensagem do pedido: o contexto e, por último, o pedido (o modelo simulado do
 * computador lê o JSON do fim). Só o alcance de quem pede entra aqui.
 */
export function conciergeMessage(ctx: ConciergeContext, text: string): string {
  const screen = ctx.screenProject
    ? ctx.projects.find((p) => p.code === ctx.screenProject)
    : null;
  const parts = [
    `HOJE: ${weekdayOf(ctx.today)}, ${ctx.today}`,
    `PROJETO DA TELA: ${screen ? `${screen.code} (${line(screen.name)})` : "nenhum"}`,
    `QUEM PEDE: ${line(ctx.me.name)}`,
    "PROJETOS (código · nome · cliente):",
    ...(ctx.projects.length
      ? ctx.projects.map(
          (p) => `- ${p.code} · ${line(p.name)} · ${line(p.client)}`,
        )
      : ["(nenhum)"]),
    "EQUIPE (nome · pessoa ou agente):",
    ...ctx.team.map(
      (m) => `- ${line(m.name)} · ${m.type === "user" ? "pessoa" : "agente"}`,
    ),
    "PEDIDOS DE APROVAÇÃO (número · tipo · título · projeto):",
    ...(ctx.approvals.length
      ? ctx.approvals.map(
          (a) =>
            `${a.ref} · ${a.typeLabel} · ${line(a.title)} · ${a.project ?? "sem projeto"}`,
        )
      : ["(nenhum)"]),
    "PEDIDO:",
    text.trim(),
  ];
  return parts.join("\n");
}
