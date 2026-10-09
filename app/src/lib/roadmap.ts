export type MilestoneStatus =
  "concluido" | "em-andamento" | "planejado" | "adiado";

export type Milestone = {
  code: string;
  title: string;
  summary: string;
  status: MilestoneStatus;
};

// Espelho resumido do PLAN.md. O PLAN.md continua sendo a fonte de verdade.
export const roadmap: Milestone[] = [
  {
    code: "M0",
    title: "Fundação e decisões",
    summary:
      "Repositório, base do app, identidade visual, testes e banco registrado.",
    status: "concluido",
  },
  {
    code: "M1",
    title: "Núcleo para agentes",
    summary:
      "Modelo de dados com regras de acesso, API, servidor MCP, chaves e auditoria.",
    status: "concluido",
  },
  {
    code: "M2",
    title: "Publicação inicial",
    summary: "No ar em hub.harmonydigital.com.br, protegido por login.",
    status: "em-andamento",
  },
  {
    code: "M3",
    title: "Interface essencial",
    summary:
      "Hoje, projetos, lista, quadro, tarefa, aprovações e Sala de Controle.",
    status: "planejado",
  },
  {
    code: "M4",
    title: "Plano, comando hub e GitHub",
    summary:
      "Sincronização do plan.md, comando hub e ligação com commits e PRs.",
    status: "planejado",
  },
  {
    code: "M5",
    title: "Agentes de gestão e importação",
    summary:
      "Kratos com os papéis de gestão, Concierge, Planejador e importação dos projetos.",
    status: "planejado",
  },
  {
    code: "M6",
    title: "Portal do cliente",
    summary: "Portal por convite, relatórios aprovados e Redator do Cliente.",
    status: "planejado",
  },
  {
    code: "M7",
    title: "Departamentos e visões",
    summary:
      "Linha do tempo, calendário, tabela, painéis e modelos de projeto.",
    status: "planejado",
  },
  {
    code: "M8",
    title: "Operação e segurança",
    summary: "Backups testados, observabilidade, LGPD e manual de operação.",
    status: "planejado",
  },
  {
    code: "M9",
    title: "Produto replicável",
    summary:
      "Adiado por decisão do Fábio: o Hub é de uso interno até ser validado.",
    status: "adiado",
  },
];

export const statusLabel: Record<MilestoneStatus, string> = {
  concluido: "Concluído",
  "em-andamento": "Em andamento",
  planejado: "Planejado",
  adiado: "Adiado",
};
