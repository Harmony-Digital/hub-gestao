/**
 * Formulários do console de agentes: rótulos em PT-BR, valores padrão e a leitura do que
 * chega do navegador. Sem dependências de servidor, para valer na tela e nos testes.
 * Quem decide o que é permitido continua sendo o serviço (src/modules/agents/service.ts).
 */

export type AgentKind = "session" | "hermes" | "internal" | "integration";

export const KIND_LABELS: Record<AgentKind, string> = {
  session: "Sessão de código (Claude Code, Codex)",
  hermes: "Hermes (Kratos)",
  internal: "Agente interno do Hub",
  integration: "Integração",
};

/** Escopos que a tela oferece. "workspace:*" entra só pela opção "todos os projetos". */
export const KEY_SCOPES = [
  "projects:read",
  "milestones:read",
  "tasks:read",
  "agents:read",
  "tasks:write",
  "tasks:complete",
  "workstreams:write",
  "comments:write",
  "approvals:request",
  "reports:draft",
  "time:write",
  "sync:plan",
  "projects:import",
] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export const SCOPE_LABELS: Record<KeyScope, string> = {
  "projects:read": "Ler projetos",
  "milestones:read": "Ler marcos",
  "tasks:read": "Ler tarefas",
  "agents:read": "Ver agentes",
  "tasks:write": "Criar e editar tarefas",
  "tasks:complete": "Concluir tarefas, com evidência",
  "workstreams:write": "Criar e editar frentes",
  "comments:write": "Comentar",
  "approvals:request": "Pedir aprovação",
  "reports:draft": "Rascunhar relatórios",
  "time:write": "Lançar tempo",
  "sync:plan": "Sincronizar o plan.md",
  "projects:import": "Importar projetos",
};

/** Ponto de partida para um agente que executa tarefas num projeto. */
export const DEFAULT_KEY_SCOPES: readonly KeyScope[] = [
  "projects:read",
  "milestones:read",
  "tasks:read",
  "tasks:write",
  "tasks:complete",
  "comments:write",
  "approvals:request",
  "time:write",
];

export const EXPIRY_OPTIONS = [30, 90, 180, 365] as const;
export const DEFAULT_EXPIRY = 90;

export type AgentFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export type KeyFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "created";
      /** Valor completo da chave: aparece só nesta resposta, nunca mais. */
      key: string;
      prefix: string;
      expiresAt: string;
      mcpUrl: string;
    };

export type RevokeState =
  { status: "idle" } | { status: "ok" } | { status: "error"; message: string };

export const INITIAL_AGENT_FORM: AgentFormState = { status: "idle" };
export const INITIAL_KEY_FORM: KeyFormState = { status: "idle" };
export const INITIAL_REVOKE: RevokeState = { status: "idle" };

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const PROJECT_CODE = /^[A-Z0-9]{2,8}$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function texts(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

export function parseNewAgentForm(
  form: FormData,
): Parsed<{ name: string; kind: AgentKind }> {
  const name = text(form, "name").trim();
  const kind = text(form, "kind");
  if (!name) return { ok: false, message: "Dê um nome ao agente." };
  if (name.length > 80 || CONTROL.test(name)) {
    return {
      ok: false,
      message: "O nome precisa ter até 80 caracteres, numa linha só.",
    };
  }
  if (!(kind in KIND_LABELS)) {
    return { ok: false, message: "Escolha o tipo do agente." };
  }
  return { ok: true, value: { name, kind: kind as AgentKind } };
}

export function parseNewKeyForm(form: FormData): Parsed<{
  agent_id: string;
  scopes: string[];
  projects: string[] | "all";
  expires_in_days: number;
}> {
  const agentId = text(form, "agent_id");
  if (!UUID.test(agentId)) {
    return { ok: false, message: "Agente inválido. Recarregue a página." };
  }
  const known = new Set<string>(KEY_SCOPES);
  const scopes = [...new Set(texts(form, "scope").filter((s) => known.has(s)))];
  if (scopes.length === 0) {
    return { ok: false, message: "Marque pelo menos uma permissão." };
  }
  const allProjects = text(form, "todos") === "on";
  const projects = [...new Set(texts(form, "project"))].filter((c) =>
    PROJECT_CODE.test(c),
  );
  if (!allProjects && projects.length === 0) {
    return {
      ok: false,
      message: "Escolha pelo menos um projeto, ou marque todos os projetos.",
    };
  }
  const days = Number(text(form, "validade"));
  const expires = (EXPIRY_OPTIONS as readonly number[]).includes(days)
    ? days
    : DEFAULT_EXPIRY;
  return {
    ok: true,
    value: {
      agent_id: agentId,
      scopes: allProjects ? [...scopes, "workspace:*"] : scopes,
      projects: allProjects ? "all" : projects,
      expires_in_days: expires,
    },
  };
}

export function parseRevokeForm(form: FormData): Parsed<{ keyId: string }> {
  const keyId = text(form, "key_id");
  return UUID.test(keyId)
    ? { ok: true, value: { keyId } }
    : { ok: false, message: "Chave inválida. Recarregue a página." };
}
