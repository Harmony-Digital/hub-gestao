/**
 * Pedidos de aprovação como aparecem nas telas (Hoje e Aprovações): rótulos, o que muda
 * ao aprovar, detalhes do pedido e a leitura do formulário de decisão. Sem dependências
 * de servidor, para valer na tela e nos testes. Quem decide o que é permitido continua
 * sendo o serviço (src/modules/approvals/service.ts).
 */
import { formatAge, formatDate, formatTimestampDay } from "@/lib/format";
import {
  AGENT_ROLE,
  APPROVAL_STATUS,
  APPROVAL_TYPE,
  PROJECT_STATUS,
  type Tone,
} from "@/lib/labels";

/** O que a tela precisa de um pedido (o ApprovalDto, sem depender do servidor). */
export type ApprovalLike = {
  id: string;
  type: keyof typeof APPROVAL_TYPE;
  status: string;
  project_code: string | null;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  requested_by: { type: string; name: string | null };
  acting_role: string | null;
  due_at: string | null;
  decision_note: string | null;
  decided_by: { name: string | null } | null;
  decided_at: string | null;
  effect: Record<string, unknown>;
  created_at: string;
};

export type DecisionItem = {
  id: string;
  typeLabel: string;
  tone: Tone;
  projectCode: string | null;
  title: string;
  summary: string | null;
  requestedBy: string;
  requestedByAgent: boolean;
  roleLabel: string | null;
  age: string;
  /** Prazo pedido para a decisão, se houver ("até 12/10"). */
  due: string | null;
  late: boolean;
  /** O que acontece ao aprovar, numa frase que começa em minúscula. */
  effect: string;
  details: { label: string; value: string }[];
};

const NOTHING_AUTOMATIC =
  "nada muda sozinho: a decisão fica registrada e quem pediu segue a partir dela.";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function approvalEffect(
  type: ApprovalLike["type"],
  payload: Record<string, unknown>,
): string {
  switch (type) {
    case "milestone_acceptance":
      return "o marco passa a Aceito, com o registro de quem aceitou e quando.";
    case "client_visibility": {
      const title = text(payload.title_client);
      return title
        ? `a frente passa a aparecer para o cliente, com o título “${title}”.`
        : "a frente passa a aparecer para o cliente.";
    }
    case "status_report":
      return "o relatório é publicado para o cliente.";
    case "import_review": {
      const next = text(payload.next_status);
      const label =
        next && Object.hasOwn(PROJECT_STATUS, next)
          ? PROJECT_STATUS[next as keyof typeof PROJECT_STATUS].label
          : PROJECT_STATUS.active.label;
      return `o projeto sai de Em revisão e fica como ${label}.`;
    }
    default:
      return NOTHING_AUTOMATIC;
  }
}

const DETAIL_LABELS: Record<string, string> = {
  title_client: "Título para o cliente",
  description_client: "Descrição para o cliente",
  title: "Título",
  due_date: "Data",
  next_status: "Status depois da revisão",
  acceptance_criteria: "Critérios de aceite",
};

function detailValue(key: string, value: unknown): string | null {
  if (key === "due_date" && typeof value === "string") {
    return formatDate(value) || value;
  }
  if (key === "next_status" && typeof value === "string") {
    return Object.hasOwn(PROJECT_STATUS, value)
      ? PROJECT_STATUS[value as keyof typeof PROJECT_STATUS].label
      : value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((v) =>
        typeof v === "string"
          ? v
          : v && typeof v === "object" && "text" in v
            ? String((v as { text: unknown }).text)
            : null,
      )
      .filter((v): v is string => Boolean(v));
    return items.length ? items.join("; ") : null;
  }
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Detalhes do pedido: os campos conhecidos com nome em PT-BR, os outros como vieram. */
export function approvalDetails(
  payload: Record<string, unknown>,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(payload)) {
    const value = detailValue(key, raw);
    if (!value) continue;
    out.push({
      label: DETAIL_LABELS[key] ?? key,
      value: value.length > 600 ? `${value.slice(0, 600)}…` : value,
    });
  }
  return out;
}

export function decisionView(a: ApprovalLike, now: Date): DecisionItem {
  const type = Object.hasOwn(APPROVAL_TYPE, a.type)
    ? APPROVAL_TYPE[a.type]
    : APPROVAL_TYPE.custom;
  const dueTime = a.due_at ? Date.parse(a.due_at) : NaN;
  return {
    id: a.id,
    typeLabel: type.label,
    tone: type.tone,
    projectCode: a.project_code,
    title: a.title,
    summary: a.summary,
    requestedBy:
      a.requested_by.name ??
      (a.requested_by.type === "agent" ? "Agente" : "Hub"),
    requestedByAgent: a.requested_by.type === "agent",
    roleLabel: a.acting_role
      ? (AGENT_ROLE[a.acting_role] ?? a.acting_role)
      : null,
    age: formatAge(a.created_at, now),
    due: a.due_at ? `até ${formatTimestampDay(a.due_at)}` : null,
    late: Number.isFinite(dueTime) && dueTime < now.getTime(),
    effect: approvalEffect(a.type, a.payload),
    details: approvalDetails(a.payload),
  };
}

// Decisão -----------------------------------------------------------------------------

export type Decision = "approved" | "rejected" | "adjust_requested";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDecisionForm(
  form: FormData,
):
  | { ok: true; value: { id: string; decision: Decision; note?: string } }
  | { ok: false; message: string } {
  const id = form.get("id");
  const decision = form.get("decision");
  const rawNote = form.get("note");
  if (typeof id !== "string" || !UUID.test(id)) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  if (
    decision !== "approved" &&
    decision !== "rejected" &&
    decision !== "adjust_requested"
  ) {
    return { ok: false, message: "Escolha aprovar, ajustar ou recusar." };
  }
  const note =
    typeof rawNote === "string" ? rawNote.replace(/\r\n?/g, "\n").trim() : "";
  if (decision === "adjust_requested" && !note) {
    return {
      ok: false,
      message: "Diga o que deve mudar, para quem pediu refazer.",
    };
  }
  if (note.length > 4000) {
    return {
      ok: false,
      message: "A orientação passou de 4 mil caracteres. Encurte o texto.",
    };
  }
  return { ok: true, value: { id, decision, ...(note ? { note } : {}) } };
}

/** O que a aprovação de fato mudou, pelo efeito gravado no pedido. */
export function approvalResult(effect: Record<string, unknown>): string {
  if (effect.milestone_status === "accepted") return "O marco foi aceito.";
  if (effect.workstream_visibility === "client") {
    return "A frente agora aparece para o cliente.";
  }
  if (effect.report_published === true) return "O relatório foi publicado.";
  if (
    typeof effect.project_status === "string" &&
    Object.hasOwn(PROJECT_STATUS, effect.project_status)
  ) {
    return `O projeto ficou como ${PROJECT_STATUS[effect.project_status as keyof typeof PROJECT_STATUS].label}.`;
  }
  return "A decisão ficou registrada para quem pediu.";
}

/** Mensagem depois da decisão, com o efeito que de fato aconteceu. */
export function decisionMessage(
  a: Pick<ApprovalLike, "status" | "title" | "effect">,
): string {
  if (a.status === "adjust_requested") {
    return `Orientação registrada para “${a.title}”. Quem pediu vê o que mudar e devolve um pedido novo.`;
  }
  if (a.status === "rejected") {
    return `Pedido recusado e registrado: “${a.title}”.`;
  }
  const result = approvalResult(a.effect);
  return `Aprovado: “${a.title}”. ${result}`;
}

// Histórico ---------------------------------------------------------------------------

export type HistoryItem = DecisionItem & {
  outcome: string;
  outcomeTone: Tone;
  decidedBy: string | null;
  /** Dia da decisão em Brasília ("10/10"). */
  decidedOn: string | null;
  note: string | null;
  /** O que mudou, só quando foi aprovado. */
  result: string | null;
};

export function historyView(a: ApprovalLike, now: Date): HistoryItem {
  const status = Object.hasOwn(APPROVAL_STATUS, a.status)
    ? APPROVAL_STATUS[a.status as keyof typeof APPROVAL_STATUS]
    : { label: a.status, tone: "neutral" as Tone };
  return {
    ...decisionView(a, now),
    outcome: status.label,
    outcomeTone: status.tone,
    decidedBy: a.decided_by?.name ?? null,
    decidedOn: a.decided_at ? formatTimestampDay(a.decided_at) : null,
    note: a.decision_note?.trim() || null,
    result: a.status === "approved" ? approvalResult(a.effect) : null,
  };
}
