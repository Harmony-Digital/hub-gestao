import { ZodError } from "zod";

/**
 * Erros do Hub no formato application/problem+json (RFC 9457).
 * As mensagens são em PT-BR e explicam o que fazer, para que um agente consiga se
 * corrigir sozinho (PRD §8.1).
 */

export type ProblemExtra = Record<string, unknown>;

export class HubError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly extra: ProblemExtra;

  constructor(
    status: number,
    code: string,
    title: string,
    detail: string,
    extra: ProblemExtra = {},
  ) {
    super(detail);
    this.name = "HubError";
    this.status = status;
    this.code = code;
    this.title = title;
    this.extra = extra;
  }

  get detail(): string {
    return this.message;
  }
}

export const badRequest = (detail: string, extra?: ProblemExtra) =>
  new HubError(400, "invalid_request", "Pedido inválido", detail, extra);
export const unauthorized = (detail: string) =>
  new HubError(401, "unauthorized", "Autenticação necessária", detail);
export const forbidden = (detail: string, extra?: ProblemExtra) =>
  new HubError(403, "forbidden", "Sem permissão", detail, extra);
export const notFound = (detail: string) =>
  new HubError(404, "not_found", "Não encontrado", detail);
export const methodNotAllowed = (detail: string) =>
  new HubError(405, "method_not_allowed", "Método não permitido", detail);
export const conflict = (detail: string, extra?: ProblemExtra) =>
  new HubError(409, "conflict", "Conflito", detail, extra);
export const preconditionFailed = (detail: string, extra?: ProblemExtra) =>
  new HubError(
    412,
    "precondition_failed",
    "Versão desatualizada",
    detail,
    extra,
  );
export const payloadTooLarge = (detail: string) =>
  new HubError(413, "payload_too_large", "Pedido grande demais", detail);
export const unsupportedMediaType = (detail: string) =>
  new HubError(415, "unsupported_media_type", "Formato não aceito", detail);
export const unprocessable = (detail: string, extra?: ProblemExtra) =>
  new HubError(
    422,
    "rule_violation",
    "Regra do Hub não atendida",
    detail,
    extra,
  );
export const locked = (detail: string) =>
  new HubError(423, "agent_paused", "Agente pausado", detail);
export const tooManyRequests = (detail: string, retryAfterSeconds: number) =>
  new HubError(429, "rate_limited", "Muitos pedidos", detail, {
    retry_after: retryAfterSeconds,
  });
export const notImplemented = (detail: string) =>
  new HubError(501, "not_implemented", "Ainda não disponível", detail);
export const serverMisconfigured = (detail: string) =>
  new HubError(
    500,
    "server_misconfigured",
    "Servidor sem configuração",
    detail,
  );

/** Mensagens claras para as restrições do schema que um cliente da API pode violar. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  tasks_done_state:
    "Estado de conclusão inconsistente. Use a ação de concluir ou reabrir.",
  tasks_assignee_pair: "Responsável precisa de tipo e id juntos.",
  tasks_not_own_parent: "Uma tarefa não pode ser pai de si mesma.",
  comments_task_internal: "Comentário em tarefa é sempre interno.",
  comments_project_entity:
    "Comentário de projeto precisa apontar para o próprio projeto.",
  attachments_task_internal: "Anexo de tarefa é sempre interno.",
  attachments_project_entity:
    "Anexo de projeto precisa apontar para o próprio projeto.",
  workstreams_client_text:
    "Frente visível ao cliente precisa de título escrito para o cliente.",
  workstreams_assignee_pair: "Responsável precisa de tipo e id juntos.",
  milestones_acceptance_state: "Marco aceito precisa de quem aceitou e quando.",
  approvals_decision_state:
    "Decisão precisa de quem decidiu e quando, ou ficar pendente.",
  agent_api_keys_forbidden_scopes:
    "Escopo proibido para agentes: approvals:decide, portal:read, portal:write e agents:keys.",
  tasks_workspace_id_code_key: "Já existe uma tarefa com esse código.",
  projects_workspace_id_code_key: "Já existe um projeto com esse código.",
  clients_workspace_id_slug_key:
    "Outro cliente com nome parecido acabou de ser criado. Tente de novo.",
  approvals_one_pending_per_item:
    "Já existe um pedido pendente igual para este item.",
  status_reports_version_unique:
    "Outro rascunho do mesmo período acabou de ser criado. Tente de novo.",
  tasks_title_single_line: "Use uma linha só no título, sem quebras de linha.",
  workstreams_title_single_line:
    "Use uma linha só no título, sem quebras de linha.",
  milestones_title_single_line:
    "Use uma linha só no título, sem quebras de linha.",
  approvals_title_single_line:
    "Use uma linha só no título, sem quebras de linha.",
  projects_name_single_line: "Use uma linha só no nome, sem quebras de linha.",
  clients_name_single_line: "Use uma linha só no nome, sem quebras de linha.",
  agents_name_single_line: "Use uma linha só no nome, sem quebras de linha.",
};

type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  constraint?: unknown;
  table?: unknown;
};

/**
 * Converte um erro do Postgres (pg ou PGlite) em erro do Hub. Devolve null quando o
 * erro não é do banco ou não tem tradução segura (vira 500, sem detalhes internos).
 */
export function fromDatabaseError(err: unknown): HubError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as DatabaseErrorLike;
  if (typeof e.code !== "string") return null;
  const message = typeof e.message === "string" ? e.message : "";
  const constraint =
    typeof e.constraint === "string" ? e.constraint : undefined;
  const known = constraint ? CONSTRAINT_MESSAGES[constraint] : undefined;

  switch (e.code) {
    case "23505":
      return conflict(known ?? "Já existe um registro com esses dados.", {
        constraint,
      });
    case "23503":
      return unprocessable(
        "Referência inválida: o item relacionado não existe neste workspace.",
        { constraint },
      );
    case "23514":
      // Restrição nomeada: mensagem do dicionário. Trava de trigger: a mensagem já é PT-BR.
      if (constraint) {
        return unprocessable(known ?? "Regra de dados não atendida.", {
          constraint,
        });
      }
      return unprocessable(message || "Regra de dados não atendida.");
    case "23502":
      return badRequest("Campo obrigatório ausente.");
    case "22P02":
    case "22007":
    case "22008":
      return badRequest("Valor em formato inválido.");
    case "22001":
      return badRequest("Texto maior que o permitido.");
    case "42501":
      if (message.startsWith("new row violates row-level security")) {
        return forbidden(
          "O banco recusou a gravação pelas regras de acesso. Confira o projeto e o workspace.",
        );
      }
      return forbidden(message || "Sem permissão.");
    case "P0001":
      return unprocessable(message || "Regra do Hub não atendida.");
    default:
      return null;
  }
}

/** Erro de validação do zod vira 400 com a lista de campos e o que corrigir. */
export function fromValidationError(err: ZodError): HubError {
  return badRequest(
    "Há campos inválidos no pedido. Corrija os itens listados em errors.",
    {
      errors: err.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "(corpo)",
        message: issue.message,
      })),
    },
  );
}

/** Qualquer erro vira HubError; o que não é conhecido vira 500 genérico. */
export function toHubError(err: unknown): HubError {
  if (err instanceof HubError) return err;
  if (err instanceof ZodError) return fromValidationError(err);
  const fromDb = fromDatabaseError(err);
  if (fromDb) return fromDb;
  return new HubError(
    500,
    "internal_error",
    "Erro interno",
    "Algo deu errado no Hub. O erro foi registrado; tente de novo em instantes.",
  );
}

export const PROBLEM_BASE = "https://hub.harmonydigital.com.br/problemas/";

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  request_id?: string;
} & ProblemExtra;

export function problemBody(
  err: HubError,
  instance?: string,
  requestId?: string,
): ProblemBody {
  return {
    type: PROBLEM_BASE + err.code,
    title: err.title,
    status: err.status,
    detail: err.detail,
    ...(instance ? { instance } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...err.extra,
  };
}

/** Nomes dos campos em PT-BR, para mensagens nas telas (a API fala com agentes). */
const FIELD_LABELS: Record<string, string> = {
  title: "título",
  description_md: "descrição",
  body_md: "comentário",
  reason: "motivo",
  evidence: "evidência",
  external_ref: "referência externa",
  name: "nome",
};

/**
 * Mensagem de erro para uma pessoa na tela: troca o nome técnico do campo pelo nome em
 * PT-BR e, em erro de validação, mostra o primeiro problema em vez de "veja errors".
 */
export function screenMessage(error: HubError): string {
  const field =
    typeof error.extra.field === "string" ? error.extra.field : null;
  if (field && FIELD_LABELS[field]) {
    return error.detail.replace(
      `O campo ${field} `,
      `O campo ${FIELD_LABELS[field]} `,
    );
  }
  const issues = error.extra.errors;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0] as { field?: unknown; message?: unknown };
    const message =
      typeof first.message === "string" ? first.message : error.detail;
    const name = typeof first.field === "string" ? first.field : null;
    const label = name ? (FIELD_LABELS[name] ?? null) : null;
    return label ? `Confira o campo ${label}: ${message}` : message;
  }
  return error.detail;
}
