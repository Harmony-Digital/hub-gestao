/**
 * Rótulos em PT-BR e tons de cor dos estados do Hub. Sem dependências de servidor:
 * valem nas telas, nos componentes do navegador e nos testes.
 */

export type Tone = "ok" | "warn" | "danger" | "info" | "review" | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-fg",
  warn: "bg-warn-soft text-warn-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  review: "bg-review-soft text-review-fg",
  neutral: "bg-off-2 text-ink-2",
};

type Labeled = { label: string; tone: Tone };

export const HEALTH: Record<"healthy" | "attention" | "at_risk", Labeled> = {
  healthy: { label: "Saudável", tone: "ok" },
  attention: { label: "Atenção", tone: "warn" },
  at_risk: { label: "Em risco", tone: "danger" },
};

export const PROJECT_STATUS: Record<
  "in_review" | "discovery" | "active" | "paused" | "delivered" | "archived",
  Labeled
> = {
  in_review: { label: "Em revisão", tone: "review" },
  discovery: { label: "Descoberta", tone: "info" },
  active: { label: "Ativo", tone: "ok" },
  paused: { label: "Pausado", tone: "warn" },
  delivered: { label: "Entregue", tone: "neutral" },
  archived: { label: "Arquivado", tone: "neutral" },
};

export const PHASES = [
  { key: "descobrir", label: "Descobrir" },
  { key: "validar", label: "Validar" },
  { key: "escalar", label: "Escalar" },
] as const;
export type PhaseKey = (typeof PHASES)[number]["key"];

export const MILESTONE_STATUS: Record<
  "planned" | "in_progress" | "delivered" | "accepted",
  Labeled
> = {
  planned: { label: "Planejado", tone: "neutral" },
  in_progress: { label: "Em andamento", tone: "info" },
  delivered: { label: "Entregue", tone: "review" },
  accepted: { label: "Aceito", tone: "ok" },
};

export const WORKSTREAM_STATUS: Record<
  "planned" | "in_progress" | "blocked" | "done",
  Labeled
> = {
  planned: { label: "Planejada", tone: "neutral" },
  in_progress: { label: "Em andamento", tone: "info" },
  blocked: { label: "Bloqueada", tone: "danger" },
  done: { label: "Concluída", tone: "ok" },
};

/** Tom da categoria fixa do status de tarefa (o nome do status é do projeto). */
export const STATUS_CATEGORY_TONE: Record<
  "todo" | "in_progress" | "review" | "blocked" | "done",
  Tone
> = {
  todo: "neutral",
  in_progress: "info",
  review: "review",
  blocked: "danger",
  done: "ok",
};

export const PRIORITY: Record<"urgent" | "high" | "normal" | "low", Labeled> = {
  urgent: { label: "Urgente", tone: "danger" },
  high: { label: "Alta", tone: "warn" },
  normal: { label: "Normal", tone: "neutral" },
  low: { label: "Baixa", tone: "neutral" },
};

export const ROLE_LABEL: Record<"owner" | "admin" | "member", string> = {
  owner: "Dono",
  admin: "Administração",
  member: "Equipe",
};

/** Por onde a tarefa entrou no Hub (coluna source). */
export const TASK_SOURCE: Record<string, string> = {
  hub: "pelo Hub",
  api: "pela API",
  mcp: "por um agente (MCP)",
  plan_md: "pelo plan.md",
  github: "pelo GitHub",
};

/** Tipos de pedido de aprovação, como aparecem nas telas. */
export const APPROVAL_TYPE: Record<
  | "status_report"
  | "milestone_acceptance"
  | "milestone_proposal"
  | "replan"
  | "scope_change"
  | "client_visibility"
  | "external_message"
  | "agent_key"
  | "import_review"
  | "custom",
  Labeled
> = {
  status_report: { label: "Relatório para o cliente", tone: "info" },
  milestone_acceptance: { label: "Aceite de marco", tone: "ok" },
  milestone_proposal: { label: "Proposta de marco", tone: "neutral" },
  replan: { label: "Replanejamento", tone: "warn" },
  scope_change: { label: "Mudança de escopo", tone: "warn" },
  client_visibility: { label: "Mostrar ao cliente", tone: "info" },
  external_message: { label: "Mensagem externa", tone: "review" },
  agent_key: { label: "Chave de agente", tone: "neutral" },
  import_review: { label: "Importação de projeto", tone: "review" },
  custom: { label: "Pedido", tone: "neutral" },
};

/** Papéis do catálogo de agentes (AGENTES.md), pelo código gravado em cada escrita. */
export const AGENT_ROLE: Record<string, string> = {
  "KR-00": "Kratos",
  "GP-01": "Gestor de Projetos",
  "CT-02": "Coordenador Tático",
  "RL-03": "Relator de Status",
  "QA-04": "Guardião da Qualidade",
  "VP-05": "Vigia de Prazos e Riscos",
  "EX-06": "Executor de Desenvolvimento",
  "EX-07": "Executor de Design",
  "EX-08": "Executor de Marketing e Conteúdo",
  "EX-09": "Executor de Dados",
  "CO-10": "Concierge do Hub",
  "PL-11": "Planejador",
  "RC-12": "Redator do Cliente",
  "OB-13": "Onboarding de Cliente",
  "AC-14": "Auditor de Acesso e Segurança",
  "TO-15": "Controlador de Tempo e Orçamento",
  "GH-16": "GitHub Sync",
  "N8-17": "n8n Bridge",
};
