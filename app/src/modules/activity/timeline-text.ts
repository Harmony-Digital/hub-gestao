import { formatDate } from "@/lib/format";
import {
  APPROVAL_TYPE,
  HEALTH,
  MILESTONE_STATUS,
  PROJECT_STATUS,
  WORKSTREAM_STATUS,
} from "@/lib/labels";

/**
 * A frase de cada registro do histórico de marco, frente, projeto e cliente (RF-43), em
 * PT-BR, a partir da ação e do que mudou. Puro: vale na tela e nos testes. O jsonb não
 * guarda a ordem das chaves: as mudanças saem numa ordem fixa.
 */

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function labelOf(
  map: Record<string, { label: string }>,
  value: unknown,
): string | null {
  return typeof value === "string" && Object.hasOwn(map, value)
    ? map[value].label
    : null;
}

/** "a", "a e b", "a, b e c". */
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

const NOUN: Record<string, string> = {
  milestone: "o marco",
  workstream: "a frente",
  project: "o projeto",
  client: "o cliente",
};

const STATUS_LABELS: Record<string, Record<string, { label: string }>> = {
  milestone: MILESTONE_STATUS,
  workstream: WORKSTREAM_STATUS,
  project: PROJECT_STATUS,
};

/** Os campos que mudam, na ordem em que aparecem na frase. */
const FIELD_ORDER = [
  "name",
  "title",
  "status",
  "due_date",
  "visibility",
  "gate_required",
  "title_client",
  "description_client",
  "acceptance_criteria",
  "milestone",
  "department",
  "assignee",
  "description_internal",
  "segment",
  "accent_color",
  "notes_internal",
  "objective_internal",
  "objective_client",
  "phase",
  "start_date",
  "target_date",
  "require_evidence",
  "client_can_confirm_receipt",
  "sort_order",
] as const;

function fieldChange(
  entity: string,
  key: string,
  value: unknown,
): string | null {
  switch (key) {
    case "status": {
      const label = labelOf(STATUS_LABELS[entity] ?? {}, value);
      return label ? `mudou o status para ${label}` : "mudou o status";
    }
    case "due_date":
    case "target_date":
      return value
        ? `mudou a data para ${formatDate(String(value)) || String(value)}`
        : "tirou a data";
    case "start_date":
      return value
        ? `mudou o início para ${formatDate(String(value)) || String(value)}`
        : "tirou o início";
    case "visibility":
      return value === "client"
        ? "passou a mostrar ao cliente"
        : "deixou de mostrar ao cliente";
    case "gate_required":
      return value === false ? "tirou o GATE" : "pôs o GATE";
    case "name":
      return "mudou o nome";
    case "title":
      return "mudou o título";
    case "title_client":
      return "mudou o título para o cliente";
    case "description_client":
      return "mudou a descrição para o cliente";
    case "acceptance_criteria":
      return "mudou os critérios de aceite";
    case "milestone":
      return "mudou o marco";
    case "department":
      return "mudou o departamento";
    case "assignee":
      return value ? "trocou o responsável" : "tirou o responsável";
    case "description_internal":
      return "editou a descrição interna";
    case "segment":
      return "mudou o segmento";
    case "accent_color":
      return "mudou a cor de destaque";
    case "notes_internal":
      return "editou as notas internas";
    case "objective_internal":
      return "editou o objetivo interno";
    case "objective_client":
      return "editou o objetivo para o cliente";
    case "phase":
      return "mudou a fase";
    case "require_evidence":
      return value
        ? "passou a exigir evidência para concluir"
        : "deixou de exigir evidência para concluir";
    case "client_can_confirm_receipt":
      return value
        ? "deixou o cliente confirmar o recebimento"
        : "tirou a confirmação de recebimento pelo cliente";
    case "sort_order":
      return "mudou a ordem";
    default:
      return null;
  }
}

const DECISION: Record<string, string> = {
  approved: "aprovou o pedido",
  rejected: "recusou o pedido",
  adjust_requested: "pediu ajuste no pedido",
  cancelled: "cancelou o pedido",
};

export function describeEntityEvent(
  action: string,
  after: unknown,
): { text: string; detail: string | null } {
  const a =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : {};
  const [entity, verb] = action.split(".");
  const noun = NOUN[entity] ?? "o item";
  switch (action) {
    case "approval.requested": {
      const type = labelOf(APPROVAL_TYPE, a.type);
      return {
        text: type ? `pediu uma aprovação (${type})` : "pediu uma aprovação",
        detail: text(a.title),
      };
    }
    case "approval.decided":
      return {
        text: DECISION[String(a.status)] ?? "decidiu o pedido",
        detail: text(a.note),
      };
    case "milestone.moved":
      return { text: "mudou a ordem do marco", detail: null };
    case "milestone.receipt_confirmed":
      return { text: "confirmou o recebimento da entrega", detail: null };
    case "workstream.visibility_changed":
      return {
        text:
          a.visibility === "client"
            ? "passou a mostrar a frente ao cliente"
            : "deixou de mostrar a frente ao cliente",
        detail: null,
      };
    case "workstream.dependencies_changed":
      return { text: "mudou as dependências da frente", detail: null };
    case "project.health_changed": {
      const health = labelOf(HEALTH, a.health);
      const reasons = Array.isArray(a.reasons)
        ? a.reasons.filter((r): r is string => typeof r === "string")
        : [];
      return {
        text: health ? `a saúde passou a ${health}` : "a saúde mudou",
        detail: reasons.length ? reasons.join(" ") : null,
      };
    }
    case "client.logo_changed":
      return { text: "trocou o logo", detail: null };
    case "client.logo_removed":
      return { text: "tirou o logo", detail: null };
  }
  switch (verb) {
    case "created":
      return { text: `criou ${noun}`, detail: null };
    case "archived":
      return { text: `arquivou ${noun}`, detail: null };
    case "restored":
      return { text: `restaurou ${noun}`, detail: null };
    case "updated": {
      const parts = FIELD_ORDER.filter((k) => k in a)
        .map((k) => fieldChange(entity, k, a[k]))
        .filter((p): p is string => p !== null);
      return { text: joinPt(parts) || `atualizou ${noun}`, detail: null };
    }
    default:
      return { text: action, detail: null };
  }
}
