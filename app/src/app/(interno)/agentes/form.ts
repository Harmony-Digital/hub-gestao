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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLE = /^[A-Z]{2}-[0-9]{2}$/;

/**
 * Papéis do catálogo (AGENTES.md) marcados no formulário. Sem o marcador do campo
 * (página aberta antes de o campo existir), undefined: os papéis ficam como estão.
 */
function roles(form: FormData): string[] | undefined {
  if (text(form, "roles_presentes") !== "1") return undefined;
  return [...new Set(texts(form, "roles").filter((r) => ROLE.test(r)))].slice(
    0,
    20,
  );
}
const BUDGET = /^\d{1,5}(?:[.,]\d{1,2})?$/;

function agentName(form: FormData): Parsed<string> {
  const name = text(form, "name").trim();
  if (!name) return { ok: false, message: "Dê um nome ao agente." };
  if (name.length > 80 || CONTROL.test(name)) {
    return {
      ok: false,
      message: "O nome precisa ter até 80 caracteres, numa linha só.",
    };
  }
  return { ok: true, value: name };
}

/** Orçamento em dólares: vazio vale 0; aceita vírgula ou ponto e até 2 casas. */
export function parseBudget(raw: string): Parsed<number> {
  const value = raw.trim();
  if (!value) return { ok: true, value: 0 };
  const amount = BUDGET.test(value) ? Number(value.replace(",", ".")) : NaN;
  if (!Number.isFinite(amount) || amount > 10_000) {
    return {
      ok: false,
      message:
        "Orçamento em dólares, de 0 a 10.000, com até 2 casas (ex.: 20 ou 12,50).",
    };
  }
  return { ok: true, value: amount };
}

/** Departamento, missão e orçamento: comuns ao cadastro e à edição. */
function agentDetails(form: FormData): Parsed<{
  department: string | null;
  mission: string | null;
  budget_usd_month: number;
}> {
  const department = text(form, "department");
  if (department && !SLUG.test(department)) {
    return {
      ok: false,
      message: "Departamento inválido. Recarregue a página.",
    };
  }
  const mission = text(form, "mission").trim();
  if (mission.length > 2000) {
    return { ok: false, message: "A missão precisa ter até 2.000 caracteres." };
  }
  const budget = parseBudget(text(form, "budget"));
  if (!budget.ok) return budget;
  return {
    ok: true,
    value: {
      department: department || null,
      mission: mission || null,
      budget_usd_month: budget.value,
    },
  };
}

export function parseNewAgentForm(form: FormData): Parsed<{
  name: string;
  kind: AgentKind;
  department?: string;
  mission?: string;
  budget_usd_month?: number;
  roles?: string[];
}> {
  const name = agentName(form);
  if (!name.ok) return name;
  const kind = text(form, "kind");
  if (!(kind in KIND_LABELS)) {
    return { ok: false, message: "Escolha o tipo do agente." };
  }
  const details = agentDetails(form);
  if (!details.ok) return details;
  const { department, mission, budget_usd_month } = details.value;
  const chosen = roles(form);
  return {
    ok: true,
    value: {
      name: name.value,
      kind: kind as AgentKind,
      ...(department ? { department } : {}),
      ...(mission ? { mission } : {}),
      ...(budget_usd_month ? { budget_usd_month } : {}),
      ...(chosen?.length ? { roles: chosen } : {}),
    },
  };
}

export function parseAgentEditForm(form: FormData): Parsed<{
  id: string;
  input: {
    name: string;
    department: string | null;
    mission: string | null;
    budget_usd_month: number;
    owner: string | null;
    roles?: string[];
  };
}> {
  const id = text(form, "id");
  if (!UUID.test(id)) {
    return { ok: false, message: "Agente inválido. Recarregue a página." };
  }
  const name = agentName(form);
  if (!name.ok) return name;
  const details = agentDetails(form);
  if (!details.ok) return details;
  const owner = text(form, "owner");
  if (owner && !UUID.test(owner)) {
    return { ok: false, message: "Responsável inválido. Recarregue a página." };
  }
  const chosen = roles(form);
  return {
    ok: true,
    value: {
      id,
      input: {
        name: name.value,
        ...details.value,
        owner: owner || null,
        ...(chosen ? { roles: chosen } : {}),
      },
    },
  };
}

export function parseAgentStatusForm(
  form: FormData,
): Parsed<{ id: string; status: "active" | "paused" }> {
  const id = text(form, "id");
  const status = text(form, "status");
  if (!UUID.test(id) || (status !== "active" && status !== "paused")) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  return { ok: true, value: { id, status } };
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
