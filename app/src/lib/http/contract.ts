import { z } from "zod";
import { ActivityExport } from "@/modules/activity/export";
import { MeDto } from "@/modules/agents/service";
import { AccessAuditDto } from "@/modules/audit/access";
import {
  ApprovalDto,
  ApprovalList,
  DecideApprovalInput,
  RequestApprovalInput,
} from "@/modules/approvals/service";
import {
  CommentDto,
  CommentList,
  CommentTarget,
  CreateCommentInput,
} from "@/modules/comments/service";
import {
  HealthDto,
  MilestoneDto,
  PlanDto,
  ProjectDetail,
  ProjectList,
  WorkstreamDto,
} from "@/modules/projects/schemas";
import {
  DraftReportInput,
  DraftReportResult,
  ReportDto,
} from "@/modules/reports/service";
import { SearchDto } from "@/modules/search/service";
import { MilestoneDetailDto } from "@/modules/milestones/dates";
import { CustomFieldList } from "@/modules/tasks/custom-fields";
import {
  BlockTaskInput,
  CompleteTaskInput,
  CreateTaskInput,
  ReopenTaskInput,
  TaskDto,
  TaskPage,
  UpdateTaskInput,
} from "@/modules/tasks/schemas";
import {
  LogTimeInput,
  ProjectTimeDto,
  TimeEntryDto,
} from "@/modules/time/service";
import { SyncPlanInput, SyncPlanResult } from "@/modules/sync/service";
import { TodayDto } from "@/modules/today/service";
import {
  CreateWorkstreamInput,
  UpdateWorkstreamInput,
} from "@/modules/workstreams/service";

/**
 * Contrato da API v1 (OpenAPI 3.1), gerado dos mesmos esquemas zod que validam os
 * pedidos. O teste de contrato compara com docs/api/openapi.v1.json a cada mudança.
 */

type Param = {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
};

type Spec = {
  method: "get" | "post" | "patch";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  scope?: string;
  pathParams?: Param[];
  query?: (Param & { required?: boolean })[];
  body?: string;
  response: string;
  status?: number;
  write?: boolean;
  etag?: boolean;
  ifMatch?: boolean;
};

const CODE: Param = {
  name: "code",
  description: "Código do projeto (ex.: HUB) ou da tarefa (ex.: HUB-12).",
};
const ID: Param = {
  name: "id",
  description: "Id (UUID).",
  schema: { type: "string", format: "uuid" },
};

/** Esquemas de resposta e de corpo, com o nome que aparece em components.schemas. */
const RESPONSES = {
  Me: MeDto,
  AccessAudit: AccessAuditDto,
  ProjectList,
  ProjectDetail,
  Plan: PlanDto,
  PlanMarkdown: z.object({ project_code: z.string(), markdown: z.string() }),
  Health: HealthDto,
  MilestoneList: z.object({ items: z.array(MilestoneDto) }),
  Milestone: MilestoneDto,
  MilestoneDetail: MilestoneDetailDto,
  WorkstreamList: z.object({ items: z.array(WorkstreamDto) }),
  Workstream: WorkstreamDto,
  TaskPage,
  Task: TaskDto,
  CommentList,
  Comment: CommentDto,
  TimeEntry: TimeEntryDto,
  ActivityExport,
  ProjectTime: ProjectTimeDto,
  CustomFieldList,
  ApprovalList,
  Approval: ApprovalDto,
  ReportList: z.object({ items: z.array(ReportDto) }),
  DraftReportResult,
  Today: TodayDto,
  Search: SearchDto,
  PlanExport: z.object({
    project_code: z.string(),
    plan_path: z.string().nullable(),
    markdown: z.string(),
  }),
  SyncPlanResult,
} satisfies Record<string, z.ZodType>;

const REQUESTS = {
  SyncPlanRequest: SyncPlanInput,
  CreateTaskRequest: CreateTaskInput,
  UpdateTaskRequest: UpdateTaskInput,
  StartTaskRequest: z.strictObject({}),
  CompleteTaskRequest: CompleteTaskInput,
  BlockTaskRequest: BlockTaskInput,
  ReopenTaskRequest: ReopenTaskInput,
  CreateCommentRequest: CreateCommentInput,
  CommentOnTargetRequest: z.strictObject({
    target: CommentTarget,
    body_md: CreateCommentInput.shape.body_md,
    mentions: CreateCommentInput.shape.mentions,
  }),
  LogTimeRequest: LogTimeInput,
  CreateWorkstreamRequest: CreateWorkstreamInput.omit({ project: true }),
  UpdateWorkstreamRequest: UpdateWorkstreamInput,
  RequestApprovalRequest: RequestApprovalInput,
  DecideApprovalRequest: DecideApprovalInput,
  DraftReportRequest: DraftReportInput,
} satisfies Record<string, z.ZodType>;

export const API_SPECS: Spec[] = [
  {
    method: "get",
    path: "/me",
    tag: "Identidade",
    summary: "Quem sou eu",
    description:
      "Identidade da chave, workspace, projetos permitidos, escopos e orçamento. Primeira chamada de toda sessão.",
    response: "Me",
  },
  {
    method: "get",
    path: "/audit/access",
    tag: "Identidade",
    summary: "Auditoria de acesso e segurança",
    description:
      "AC-14: chaves de agente (idade, uso, escopo, vencimento), pessoas e contatos sem atividade, aprovações paradas, recusas, gasto de IA, chaves de IA antigas e webhooks falhando, com o que o dono pode fazer. Só lê; quem revoga e troca é o dono. Precisa de chave com acesso a todos os projetos.",
    scope: "agents:read",
    response: "AccessAudit",
  },
  {
    method: "get",
    path: "/projects",
    tag: "Projetos",
    summary: "Listar projetos",
    scope: "projects:read",
    response: "ProjectList",
  },
  {
    method: "get",
    path: "/projects/{code}",
    tag: "Projetos",
    summary: "Detalhe do projeto",
    scope: "projects:read",
    pathParams: [CODE],
    response: "ProjectDetail",
  },
  {
    method: "get",
    path: "/projects/{code}/plan",
    tag: "Projetos",
    summary: "Árvore do plano",
    description:
      "Marcos, frentes e tarefas. Com format=md, devolve o texto no formato plan.md.",
    scope: "projects:read",
    pathParams: [CODE],
    query: [{ name: "format", description: '"json" (padrão) ou "md".' }],
    response: "Plan",
  },
  {
    method: "get",
    path: "/projects/{code}/health",
    tag: "Projetos",
    summary: "Saúde do projeto",
    description: "Regra do PRD §5.7 calculada agora, com motivos e números.",
    scope: "projects:read",
    pathParams: [CODE],
    response: "Health",
  },
  {
    method: "get",
    path: "/projects/{code}/time",
    tag: "Projetos",
    summary: "Tempo do projeto",
    description:
      "Tempo registrado por pessoa ou agente e por frente, o estimado contra o registrado e as tarefas acima da estimativa (TO-15). Informativo.",
    scope: "tasks:read",
    pathParams: [CODE],
    response: "ProjectTime",
  },
  {
    method: "get",
    path: "/projects/{code}/custom-fields",
    tag: "Projetos",
    summary: "Campos personalizados das tarefas",
    description:
      "Os campos próprios do projeto (texto, número, seleção, data ou URL), com as opções da seleção. O valor de cada tarefa vem em custom_fields e muda pela atualização da tarefa, pelo nome do campo.",
    scope: "tasks:read",
    pathParams: [CODE],
    response: "CustomFieldList",
  },
  {
    method: "get",
    path: "/projects/{code}/milestones",
    tag: "Marcos",
    summary: "Marcos do projeto",
    description: "Criar ou mudar marco é pedido de aprovação.",
    scope: "milestones:read",
    pathParams: [CODE],
    response: "MilestoneList",
  },
  {
    method: "get",
    path: "/milestones/{id}",
    tag: "Marcos",
    summary: "Detalhe do marco",
    description:
      "Com o histórico de datas (date_history): cada mudança da data prevista, com o motivo.",
    scope: "milestones:read",
    pathParams: [ID],
    response: "MilestoneDetail",
  },
  {
    method: "get",
    path: "/projects/{code}/workstreams",
    tag: "Frentes",
    summary: "Frentes do projeto",
    scope: "projects:read",
    pathParams: [CODE],
    response: "WorkstreamList",
  },
  {
    method: "post",
    path: "/projects/{code}/workstreams",
    tag: "Frentes",
    summary: "Criar frente",
    description:
      "Sempre interna; mostrar ao cliente é pedido de aprovação (client_visibility).",
    scope: "workstreams:write",
    pathParams: [CODE],
    body: "CreateWorkstreamRequest",
    response: "Workstream",
    status: 201,
    write: true,
  },
  {
    method: "get",
    path: "/workstreams/{id}",
    tag: "Frentes",
    summary: "Detalhe da frente",
    scope: "projects:read",
    pathParams: [ID],
    response: "Workstream",
  },
  {
    method: "patch",
    path: "/workstreams/{id}",
    tag: "Frentes",
    summary: "Atualizar frente",
    scope: "workstreams:write",
    pathParams: [ID],
    body: "UpdateWorkstreamRequest",
    response: "Workstream",
    write: true,
  },
  {
    method: "get",
    path: "/tasks",
    tag: "Tarefas",
    summary: "Listar tarefas",
    scope: "tasks:read",
    query: [
      { name: "project", description: "Código do projeto." },
      {
        name: "assignee",
        description: '"me", "none", "agent:<uuid>" ou "user:<uuid>".',
      },
      {
        name: "status_category",
        description:
          "Lista separada por vírgula: todo, in_progress, review, blocked, done.",
      },
      {
        name: "due_before",
        description: "Vence até esta data (AAAA-MM-DD), inclusive.",
      },
      { name: "blocked", description: '"true" ou "false".' },
      { name: "workstream_id", description: "Id da frente." },
      {
        name: "department",
        description:
          "Slug do departamento (ex.: sistemas): só as tarefas das frentes ativas dele.",
      },
      {
        name: "parent",
        description: "Código da tarefa-pai, para listar subtarefas.",
      },
      { name: "cursor", description: "next_cursor da página anterior." },
      { name: "limit", description: "De 1 a 200; padrão 50." },
    ],
    response: "TaskPage",
  },
  {
    method: "post",
    path: "/tasks",
    tag: "Tarefas",
    summary: "Criar tarefa",
    description: "Tarefa operacional com código HUB-n gerado pelo Hub.",
    scope: "tasks:write",
    body: "CreateTaskRequest",
    response: "Task",
    status: 201,
    write: true,
    etag: true,
  },
  {
    method: "get",
    path: "/tasks/{code}",
    tag: "Tarefas",
    summary: "Detalhe da tarefa",
    description: "O ETag traz a versão, para usar em If-Match.",
    scope: "tasks:read",
    pathParams: [CODE],
    response: "Task",
    etag: true,
  },
  {
    method: "patch",
    path: "/tasks/{code}",
    tag: "Tarefas",
    summary: "Atualizar tarefa",
    description:
      "Com If-Match, recusa (412) se outra escrita veio antes. Concluir e bloquear têm ações próprias.",
    scope: "tasks:write",
    pathParams: [CODE],
    body: "UpdateTaskRequest",
    response: "Task",
    write: true,
    etag: true,
    ifMatch: true,
  },
  {
    method: "post",
    path: "/tasks/{code}/start",
    tag: "Tarefas",
    summary: "Iniciar tarefa",
    description:
      "Atribui a quem chama, se estiver livre. Um agente tem uma tarefa em andamento por vez, salvo configuração.",
    scope: "tasks:complete",
    pathParams: [CODE],
    body: "StartTaskRequest",
    response: "Task",
    write: true,
    etag: true,
  },
  {
    method: "post",
    path: "/tasks/{code}/complete",
    tag: "Tarefas",
    summary: "Concluir tarefa",
    description: "Evidência obrigatória: SHA, URL, arquivo ou teste.",
    scope: "tasks:complete",
    pathParams: [CODE],
    body: "CompleteTaskRequest",
    response: "Task",
    write: true,
    etag: true,
  },
  {
    method: "post",
    path: "/tasks/{code}/block",
    tag: "Tarefas",
    summary: "Bloquear tarefa",
    description: "Diga o que falta e de quem depende.",
    scope: "tasks:complete",
    pathParams: [CODE],
    body: "BlockTaskRequest",
    response: "Task",
    write: true,
    etag: true,
  },
  {
    method: "post",
    path: "/tasks/{code}/reopen",
    tag: "Tarefas",
    summary: "Reabrir tarefa",
    description: "Volta para A fazer; o motivo vira comentário interno.",
    scope: "tasks:complete",
    pathParams: [CODE],
    body: "ReopenTaskRequest",
    response: "Task",
    write: true,
    etag: true,
  },
  {
    method: "get",
    path: "/tasks/{code}/comments",
    tag: "Comentários",
    summary: "Comentários da tarefa",
    scope: "projects:read",
    pathParams: [CODE],
    response: "CommentList",
  },
  {
    method: "post",
    path: "/tasks/{code}/comments",
    tag: "Comentários",
    summary: "Comentar na tarefa",
    description: "Sempre interno.",
    scope: "comments:write",
    pathParams: [CODE],
    body: "CreateCommentRequest",
    response: "Comment",
    status: 201,
    write: true,
  },
  {
    method: "post",
    path: "/tasks/{code}/time",
    tag: "Tarefas",
    summary: "Registrar tempo",
    scope: "time:write",
    pathParams: [CODE],
    body: "LogTimeRequest",
    response: "TimeEntry",
    status: 201,
    write: true,
  },
  {
    method: "get",
    path: "/activity",
    tag: "Projetos",
    summary: "Atividade do projeto por período",
    description:
      "O registro de atividades do projeto (quem, papel, origem, ação em PT-BR, tarefa e o que foi gravado), do primeiro ao último dia, até 366 dias e 50 mil registros. Agente informa sempre o projeto.",
    scope: "projects:read",
    query: [
      { name: "project", description: "Código do projeto." },
      { name: "from", description: "Primeiro dia (AAAA-MM-DD)." },
      { name: "to", description: "Último dia (AAAA-MM-DD), incluído." },
    ],
    response: "ActivityExport",
  },
  {
    method: "get",
    path: "/comments",
    tag: "Comentários",
    summary: "Comentários de um item",
    description: "Informe um só: task, project, milestone_id ou workstream_id.",
    scope: "projects:read",
    query: [
      { name: "task", description: "Código da tarefa." },
      { name: "project", description: "Código do projeto." },
      { name: "milestone_id", description: "Id do marco." },
      { name: "workstream_id", description: "Id da frente." },
    ],
    response: "CommentList",
  },
  {
    method: "post",
    path: "/comments",
    tag: "Comentários",
    summary: "Comentar em projeto, marco, frente ou tarefa",
    description: "Sempre interno. Texto para o cliente passa por aprovação.",
    scope: "comments:write",
    body: "CommentOnTargetRequest",
    response: "Comment",
    status: 201,
    write: true,
  },
  {
    method: "get",
    path: "/approvals",
    tag: "Aprovações",
    summary: "Listar pedidos de aprovação",
    scope: "projects:read",
    query: [
      {
        name: "status",
        description:
          "pending, approved, rejected, adjust_requested ou cancelled.",
      },
      { name: "project", description: "Código do projeto." },
      { name: "mine", description: '"true" para só os próprios pedidos.' },
    ],
    response: "ApprovalList",
  },
  {
    method: "post",
    path: "/approvals",
    tag: "Aprovações",
    summary: "Pedir aprovação",
    description:
      "Aceite de marco, novo marco, replanejamento, mudança de escopo, frente visível ao cliente, mensagem externa. Quem decide é o Fábio.",
    scope: "approvals:request",
    body: "RequestApprovalRequest",
    response: "Approval",
    status: 201,
    write: true,
  },
  {
    method: "get",
    path: "/approvals/{id}",
    tag: "Aprovações",
    summary: "Detalhe do pedido",
    scope: "projects:read",
    pathParams: [ID],
    response: "Approval",
  },
  {
    method: "post",
    path: "/approvals/{id}/decide",
    tag: "Aprovações",
    summary: "Decidir pedido (só pessoas)",
    description:
      "Exige sessão de uma pessoa com papel owner. Com chave de agente, a resposta é sempre 403.",
    pathParams: [ID],
    body: "DecideApprovalRequest",
    response: "Approval",
    write: true,
  },
  {
    method: "get",
    path: "/reports",
    tag: "Relatórios",
    summary: "Relatórios do projeto",
    scope: "projects:read",
    query: [
      { name: "project", description: "Código do projeto.", required: true },
    ],
    response: "ReportList",
  },
  {
    method: "post",
    path: "/reports",
    tag: "Relatórios",
    summary: "Rascunho de status",
    description: "Vira aprovação pendente; só é publicado com o sim do Fábio.",
    scope: "reports:draft",
    body: "DraftReportRequest",
    response: "DraftReportResult",
    status: 201,
    write: true,
  },
  {
    method: "get",
    path: "/today",
    tag: "Identidade",
    summary: "Fila do dia",
    description: "Minhas tarefas, bloqueios, prazos próximos e aprovações.",
    response: "Today",
  },
  {
    method: "get",
    path: "/search",
    tag: "Busca",
    summary: "Busca global",
    description:
      "Projetos, tarefas, marcos e frentes do escopo da chave, e pessoas da equipe e agentes pelo nome (só nome e papel; o id serve para atribuir). Sem diferenciar acento.",
    scope: "projects:read",
    query: [
      {
        name: "q",
        description: "De 2 a 100 caracteres; aceita código de tarefa.",
        required: true,
      },
    ],
    response: "Search",
  },
  {
    method: "get",
    path: "/sync/plan",
    tag: "Sincronização",
    summary: "Exportar plan.md",
    description:
      "O plano do Hub no formato plan.md, do zero. Para sincronizar um arquivo que já existe, use o POST (pull ou push).",
    scope: "sync:plan",
    query: [
      { name: "project", description: "Código do projeto.", required: true },
    ],
    response: "PlanExport",
  },
  {
    method: "post",
    path: "/sync/plan",
    tag: "Sincronização",
    summary: "Sincronizar plan.md (pull ou push)",
    description:
      "pull: o Hub vai para o arquivo (caixas, critérios do GATE e as tarefas que faltam). push: item sem código vira tarefa e ganha o código; caixa marcada conclui com a evidência do item ou o commit_sha; com base_markdown, desmarcar reabre, renomear renomeia e tirar o item arquiva. O Hub vence; GATE marcado no arquivo é ignorado e alertado; marco novo não é criado. Devolve o arquivo para gravar, o resumo e os conflitos (também em plan_sync_runs). Formato do arquivo em docs/plan-md.md.",
    scope: "sync:plan",
    body: "SyncPlanRequest",
    response: "SyncPlanResult",
    write: true,
  },
];

function schemasFor(
  entries: Record<string, z.ZodType>,
  io: "input" | "output",
): Record<string, unknown> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(entries))
    registry.add(schema, { id });
  const result = z.toJSONSchema(registry, {
    io,
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: "any",
  }) as { schemas: Record<string, Record<string, unknown>> };
  for (const schema of Object.values(result.schemas)) delete schema.$schema;
  return result.schemas;
}

const problem = {
  type: "object",
  required: ["type", "title", "status", "detail"],
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    request_id: { type: "string" },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: { field: { type: "string" }, message: { type: "string" } },
      },
    },
    missing_scope: { type: "string" },
  },
};

export function buildOpenApi(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const spec of API_SPECS) {
    const parameters: Record<string, unknown>[] = [];
    for (const p of spec.pathParams ?? []) {
      parameters.push({
        name: p.name,
        in: "path",
        required: true,
        description: p.description,
        schema: p.schema ?? { type: "string" },
      });
    }
    for (const q of spec.query ?? []) {
      parameters.push({
        name: q.name,
        in: "query",
        required: q.required ?? false,
        description: q.description,
        schema: q.schema ?? { type: "string" },
      });
    }
    if (spec.write)
      parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
    if (spec.write)
      parameters.push({ $ref: "#/components/parameters/ActingRole" });
    if (spec.ifMatch)
      parameters.push({ $ref: "#/components/parameters/IfMatch" });

    const success = String(spec.status ?? 200);
    const responses: Record<string, unknown> = {
      [success]: {
        description: "Sucesso.",
        ...(spec.etag
          ? {
              headers: {
                ETag: {
                  description: 'Versão da tarefa, como W/"v3".',
                  schema: { type: "string" },
                },
              },
            }
          : {}),
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${spec.response}` },
          },
        },
      },
      "400": { $ref: "#/components/responses/Problem" },
      "401": { $ref: "#/components/responses/Problem" },
      "403": { $ref: "#/components/responses/Problem" },
      "404": { $ref: "#/components/responses/Problem" },
      "423": { $ref: "#/components/responses/Problem" },
      "429": { $ref: "#/components/responses/Problem" },
    };
    if (spec.write) {
      responses["409"] = { $ref: "#/components/responses/Problem" };
      responses["422"] = { $ref: "#/components/responses/Problem" };
    }
    if (spec.ifMatch)
      responses["412"] = { $ref: "#/components/responses/Problem" };

    paths[spec.path] ??= {};
    paths[spec.path][spec.method] = {
      tags: [spec.tag],
      summary: spec.summary,
      ...(spec.description || spec.scope
        ? {
            description: [
              spec.description,
              spec.scope ? `Escopo da chave: \`${spec.scope}\`.` : null,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
      operationId: `${spec.method}${spec.path
        .replace(/[{}]/g, "")
        .replace(/\/(\w)/g, (_, c: string) => c.toUpperCase())
        .replace(/[^A-Za-z0-9]/g, "")}`,
      ...(parameters.length ? { parameters } : {}),
      ...(spec.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: `#/components/schemas/${spec.body}` },
                },
              },
            },
          }
        : {}),
      responses,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Hub de Gestão · API v1",
      version,
      description:
        "API para agentes de IA operarem o Hub de Gestão da Harmony Digital. Toda escrita exige Idempotency-Key; erros seguem application/problem+json (RFC 9457) com mensagens que explicam o que corrigir. Decisões (aprovar, aceitar marco) são só de pessoas.",
    },
    servers: [{ url: "https://hub.harmonydigital.com.br/api/v1" }],
    security: [{ bearerAuth: [] }],
    tags: [
      "Identidade",
      "Projetos",
      "Marcos",
      "Frentes",
      "Tarefas",
      "Comentários",
      "Aprovações",
      "Relatórios",
      "Busca",
      "Sincronização",
    ].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Chave de agente hub_ak_<prefixo>.<segredo>, criada pelo Fábio na tela Agentes.",
        },
      },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          description:
            "Valor único por ação (8 a 200 caracteres). Repetir a mesma chave com o mesmo corpo devolve a mesma resposta; com corpo diferente, 409.",
          schema: { type: "string" },
        },
        ActingRole: {
          name: "Hub-Acting-Role",
          in: "header",
          required: false,
          description:
            "Papel do catálogo em que o agente age nesta escrita (ex.: GP-01), quando ele tem mais de um.",
          schema: { type: "string" },
        },
        IfMatch: {
          name: "If-Match",
          in: "header",
          required: false,
          description:
            'ETag lido antes (ex.: W/"v3"). Se a tarefa mudou, a resposta é 412.',
          schema: { type: "string" },
        },
      },
      responses: {
        Problem: {
          description: "Erro com explicação (problem+json).",
          content: {
            "application/problem+json": {
              schema: { $ref: "#/components/schemas/Problem" },
            },
          },
        },
      },
      schemas: {
        Problem: problem,
        ...schemasFor(REQUESTS, "input"),
        ...schemasFor(RESPONSES, "output"),
      },
    },
  };
}
