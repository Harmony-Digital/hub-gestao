import type { Actor } from "@/lib/db/actor";
import { forbidden } from "@/lib/errors";

/**
 * Autorização central (AGENTS.md §5.2): toda rota da API e toda ferramenta MCP passa
 * por aqui antes de tocar o banco. A RLS é a segunda linha de defesa.
 *
 * Regras:
 * - Pessoas: owner pode tudo; admin pode tudo menos chaves de agente e decisões de gate;
 *   member atua nos projetos de que participa.
 * - Agentes: cada ação exige um escopo da chave e o projeto precisa estar na chave
 *   (ou a chave ter workspace:*). Decisões humanas nunca são de agente (PRD RF-26).
 * - Contato de cliente: só o portal (M6). Sistema: rotinas, nunca decisões.
 */

export type Action =
  | "project.read"
  | "project.import"
  | "milestone.read"
  | "milestone.write"
  | "milestone.accept"
  | "workstream.read"
  | "workstream.write"
  | "workstream.visibility"
  | "task.read"
  | "task.write"
  | "task.transition"
  | "comment.read"
  | "comment.write"
  | "comment.write_client"
  | "attachment.write_client"
  | "time.write"
  | "approval.read"
  | "approval.request"
  | "approval.decide"
  | "report.read"
  | "report.draft"
  | "report.publish"
  | "agent.read"
  | "audit.read"
  | "agent.manage"
  | "agent.keys"
  | "sync.plan"
  | "search"
  | "webhook.manage"
  | "portal.manage"
  | "workspace.admin";

export type ProjectRole =
  "lead" | "member" | "client_viewer" | "client_approver" | "guest";

export type Resource = {
  /** Projeto alvo da ação, quando houver. */
  projectId?: string;
  /** Papel da pessoa no projeto (para member), carregado pelo serviço. */
  projectRole?: ProjectRole | null;
};

/** Escopo exigido de uma chave de agente para cada ação. */
const AGENT_SCOPE: Partial<Record<Action, string>> = {
  "project.read": "projects:read",
  "project.import": "projects:import",
  "milestone.read": "milestones:read",
  "workstream.read": "projects:read",
  "workstream.write": "workstreams:write",
  "task.read": "tasks:read",
  "task.write": "tasks:write",
  "task.transition": "tasks:complete",
  "comment.read": "projects:read",
  "comment.write": "comments:write",
  "time.write": "time:write",
  "audit.read": "agents:read",
  "approval.read": "projects:read",
  "approval.request": "approvals:request",
  "report.read": "projects:read",
  "report.draft": "reports:draft",
  "sync.plan": "sync:plan",
  search: "projects:read",
};

/** Ações que só uma pessoa faz. Agente recebe orientação para pedir aprovação. */
const HUMAN_ONLY: ReadonlySet<Action> = new Set<Action>([
  "milestone.write",
  "milestone.accept",
  "workstream.visibility",
  "comment.write_client",
  "attachment.write_client",
  "approval.decide",
  "report.publish",
  "agent.manage",
  "agent.keys",
  "webhook.manage",
  "portal.manage",
  "workspace.admin",
]);

/** Decisões que nem o sistema toma sozinho. */
const DECISIONS: ReadonlySet<Action> = new Set<Action>([
  "milestone.accept",
  "approval.decide",
  "report.publish",
  "agent.keys",
  "comment.write_client",
  "attachment.write_client",
  "workstream.visibility",
]);

/**
 * O que o owner reserva para si por padrão (D9: o aceite é do Fábio). Webhooks de saída
 * também: é o Hub mandando dados para fora, com segredo.
 */
const OWNER_ONLY: ReadonlySet<Action> = new Set<Action>([
  "milestone.accept",
  "approval.decide",
  "agent.keys",
  "webhook.manage",
  // D9: liberar, renovar e revogar o acesso de um contato ao portal é do dono.
  "portal.manage",
]);

/** O que o convidado de um projeto pode fazer nele: só ler (PRD §4.1). */
const GUEST_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "project.read",
  "milestone.read",
  "workstream.read",
  "task.read",
  "comment.read",
  "approval.read",
  "report.read",
  "search",
]);

/** O que um member pode fazer, sempre dentro dos projetos de que participa. */
const MEMBER_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "project.read",
  "milestone.read",
  "workstream.read",
  "workstream.write",
  "task.read",
  "task.write",
  "task.transition",
  "comment.read",
  "comment.write",
  "time.write",
  "approval.read",
  "approval.request",
  "report.read",
  "report.draft",
  "agent.read",
  "sync.plan",
  "search",
]);

type Denial = { detail: string; extra?: Record<string, unknown> };

function check(
  actor: Actor,
  action: Action,
  resource: Resource,
): Denial | null {
  if (actor.scope === "client") {
    return {
      detail:
        "Contatos de cliente acompanham pelo portal; esta ação não está disponível para eles.",
    };
  }

  if (actor.type === "system") {
    return DECISIONS.has(action)
      ? {
          detail:
            "Rotinas automáticas não tomam decisões; isso é de uma pessoa.",
        }
      : null;
  }

  if (actor.type === "agent") {
    if (HUMAN_ONLY.has(action)) {
      return {
        detail:
          "Esta ação é de uma pessoa. Use hub_request_approval (ou POST /api/v1/approvals) para pedir a decisão ao Fábio.",
        extra: { human_only: true },
      };
    }
    const scope = AGENT_SCOPE[action];
    const all = actor.scopes.includes("workspace:*");
    if (scope && !all && !actor.scopes.includes(scope)) {
      return {
        detail: `A chave não tem o escopo ${scope}, necessário para esta ação. Peça ao Fábio para incluir o escopo na chave.`,
        extra: { missing_scope: scope },
      };
    }
    if (
      resource.projectId &&
      actor.projectIds !== null &&
      !actor.projectIds.includes(resource.projectId)
    ) {
      return {
        detail:
          "A chave não dá acesso a este projeto. Confira o código do projeto ou peça ao Fábio para incluí-lo na chave.",
        extra: { project_out_of_scope: true },
      };
    }
    return null;
  }

  // Pessoa da equipe.
  if (actor.role === "owner") return null;
  if (actor.role === "admin") {
    return OWNER_ONLY.has(action)
      ? {
          detail:
            "Esta decisão é do dono do workspace (owner), conforme a decisão D9.",
        }
      : null;
  }
  if (!MEMBER_ACTIONS.has(action)) {
    return {
      detail: "Seu papel no workspace não permite esta ação. Fale com o Fábio.",
    };
  }
  if (resource.projectId && resource.projectRole === "guest") {
    // Convidado pontual (PRD §4.1): só lê o projeto em que foi posto.
    return GUEST_ACTIONS.has(action)
      ? null
      : {
          detail:
            "Você é convidado deste projeto: pode acompanhar, não mudar. Fale com quem cuida dele.",
        };
  }
  if (
    resource.projectId &&
    resource.projectRole !== "lead" &&
    resource.projectRole !== "member"
  ) {
    return { detail: "Você não participa deste projeto." };
  }
  return null;
}

/** Lança 403 com explicação quando o ator não pode fazer a ação. */
export function authorize(
  actor: Actor,
  action: Action,
  resource: Resource = {},
): void {
  const denial = check(actor, action, resource);
  if (denial) throw forbidden(denial.detail, { action, ...denial.extra });
}

export function can(
  actor: Actor,
  action: Action,
  resource: Resource = {},
): boolean {
  return check(actor, action, resource) === null;
}

/**
 * Projetos que o ator enxerga numa listagem: null = todos do workspace (RLS cuida do
 * workspace); lista = só esses. Para member, o serviço filtra pela participação.
 */
export function projectFilter(actor: Actor): string[] | null {
  return actor.type === "agent" ? actor.projectIds : null;
}
