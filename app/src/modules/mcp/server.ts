import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { badRequest, toHubError } from "@/lib/errors";
import {
  assertIdempotencyKey,
  credentialOf,
  requestHash,
  withIdempotency,
} from "@/lib/idempotency";
import { MeDto, whoami, withActingRole } from "@/modules/agents/service";
import { accessAudit, AccessAuditDto } from "@/modules/audit/access";
import {
  ApprovalFilter,
  ApprovalList,
  listApprovals,
  requestApproval,
  RequestApprovalInput,
  ApprovalDto,
} from "@/modules/approvals/service";
import {
  CommentDto,
  createComment,
  CreateCommentInput,
  listComments,
} from "@/modules/comments/service";
import { ProjectCode, RoleCode, TaskCode, Text, Uuid } from "@/modules/common";
import { inTx, type Ctx, type TxCtx } from "@/modules/context";
import {
  PlanDto,
  ProjectDetail,
  ProjectList,
  WorkstreamDto,
} from "@/modules/projects/schemas";
import {
  getPlan,
  getProject,
  getProjectHealth,
  listProjects,
  renderPlanMarkdown,
} from "@/modules/projects/service";
import {
  draftReport,
  DraftReportInput,
  DraftReportResult,
} from "@/modules/reports/service";
import {
  ImportClientInput,
  importClient,
  ImportProjectInput,
  importProject,
  ImportProjectPlanInput,
  importProjectPlan,
} from "@/modules/projects/import";
import { search, SearchDto } from "@/modules/search/service";
import {
  syncPlan,
  SyncPlanInput,
  SyncPlanResult,
} from "@/modules/sync/service";
import {
  CustomFieldList,
  listProjectFields,
} from "@/modules/tasks/custom-fields";
import {
  BlockTaskInput,
  CreateTaskInput,
  TaskDto,
  TaskFilter,
  TaskPage,
  UpdateTaskInput,
} from "@/modules/tasks/schemas";
import {
  blockTask,
  completeTask,
  createTask,
  getTask,
  listTasks,
  reopenTask,
  startTask,
  updateTask,
} from "@/modules/tasks/service";
import {
  logTime,
  LogTimeInput,
  projectTime,
  ProjectTimeDto,
  TimeEntryDto,
} from "@/modules/time/service";
import { today, TodayDto } from "@/modules/today/service";
import {
  createWorkstream,
  CreateWorkstreamInput,
  updateWorkstream,
  UpdateWorkstreamInput,
} from "@/modules/workstreams/service";

/**
 * Servidor MCP do Hub (PRD §8.4): sem estado, uma instância por pedido, ligada ao agente
 * autenticado. Mostra só as ferramentas que a chave pode usar. Nomes em inglês,
 * descrições curtas em PT-BR e distintas entre si.
 */

export const MCP_INSTRUCTIONS = `Você está conectado ao Hub de Gestão da Harmony Digital. Regras do Protocolo do Agente Operador:
1. Comece por hub_whoami. Se a identidade, o workspace ou os projetos não baterem com o esperado, pare.
2. Trabalhe uma tarefa por vez: hub_start_task, trabalho real, hub_comment no que for relevante, hub_complete_task com evidência verificável (SHA, URL, arquivo ou teste).
3. Bloqueio: hub_block_task dizendo o que falta e de quem depende.
4. Nunca marque GATE, nunca crie ou mude marco, nunca escreva texto para o cliente: peça com hub_request_approval. Só o Fábio decide.
5. Nunca coloque segredos, tokens, senhas ou dados pessoais em título, descrição, comentário ou evidência.
6. Toda escrita exige idempotency_key, um valor novo por ação (por exemplo, um UUID); repetir a mesma chave com os mesmos dados é seguro. Se você acumula papéis, informe papel (ex.: GP-01).
7. Importação de projetos (só com o escopo projects:import): hub_create_client, hub_create_project e hub_import_plan, nessa ordem, sempre com dry_run antes. O projeto nasce "Em revisão" e só passa a valer com o ok do Fábio; é a única exceção à regra 4, e só em projeto em revisão.`;

type ToolResult = {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function success(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function failure(err: unknown): ToolResult {
  const e = toHubError(err);
  const extra =
    Object.keys(e.extra).length > 0 ? `\n${JSON.stringify(e.extra)}` : "";
  return {
    isError: true,
    content: [
      { type: "text", text: `${e.title} (${e.status}): ${e.detail}${extra}` },
    ],
  };
}

const writeFields = {
  papel: RoleCode.optional().describe(
    "Papel do catálogo em que você age nesta escrita (ex.: GP-01).",
  ),
  idempotency_key: z
    .string()
    .min(8)
    .max(200)
    .describe(
      "Obrigatório. Valor novo por ação (por exemplo, um UUID); repetir com os mesmos dados devolve o mesmo resultado, sem duplicar.",
    ),
};

type WriteArgs = { papel?: string; idempotency_key: string };

export function buildMcpServer(
  base: Ctx,
  version: string,
  /** Chamado com o erro de uma ferramenta (registro de recusas na Sala de Controle). */
  onFailure?: (err: unknown) => Promise<void>,
): McpServer {
  const server = new McpServer(
    { name: "hub-gestao", title: "Hub de Gestão · Harmony Digital", version },
    { instructions: MCP_INSTRUCTIONS },
  );
  const actor = base.actor;
  const has = (scope?: string) =>
    !scope ||
    actor.type !== "agent" ||
    actor.scopes.includes(scope) ||
    actor.scopes.includes("workspace:*");

  const read = async (
    fn: (t: TxCtx) => Promise<unknown>,
  ): Promise<ToolResult> => {
    try {
      return success(await inTx(base, fn));
    } catch (err) {
      await onFailure?.(err);
      return failure(err);
    }
  };

  const write = async (
    tool: string,
    args: WriteArgs & Record<string, unknown>,
    fn: (t: TxCtx) => Promise<unknown>,
  ): Promise<ToolResult> => {
    try {
      const ctx: Ctx = { ...base, actor: withActingRole(actor, args.papel) };
      const key = assertIdempotencyKey(args.idempotency_key);
      const { idempotency_key: _ignored, ...rest } = args;
      void _ignored;
      const hash = requestHash("MCP", tool, rest, credentialOf(actor));
      const { response } = await inTx(ctx, (t) =>
        withIdempotency(t, key, hash, async () => ({
          status: 200,
          body: await fn(t),
        })),
      );
      return success(response.body);
    } catch (err) {
      await onFailure?.(err);
      return failure(err);
    }
  };

  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const mutating = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  } as const;

  // Identidade e leitura ---------------------------------------------------------------

  server.registerTool(
    "hub_whoami",
    {
      title: "Quem sou eu",
      description:
        "Identidade no Hub: agente, workspace, projetos permitidos, escopos da chave e orçamento de IA. Chame primeiro em toda sessão.",
      inputSchema: z.strictObject({}),
      outputSchema: MeDto,
      annotations: readOnly,
    },
    async () => read((t) => whoami(t)),
  );

  server.registerTool(
    "hub_get_today",
    {
      title: "Minha fila",
      description:
        "Sua fila do dia: tarefas atribuídas a você na ordem de trabalho, bloqueios dos seus projetos, prazos dos próximos 3 dias e seus pedidos de aprovação.",
      inputSchema: z.strictObject({}),
      outputSchema: TodayDto,
      annotations: readOnly,
    },
    async () => read((t) => today(t)),
  );

  if (has("agents:read")) {
    server.registerTool(
      "hub_get_access_audit",
      {
        title: "Auditoria de acesso e segurança",
        description:
          "AC-14: os pontos para o dono olhar (chaves de agente antigas, paradas, amplas ou vencendo; pessoas e contatos sem atividade; aprovações paradas; recusas; gasto de IA; chaves de IA antigas; webhooks falhando), cada um com o que fazer. Só lê: quem revoga e troca é o dono. Precisa de chave com acesso a todos os projetos.",
        inputSchema: z.strictObject({}),
        outputSchema: AccessAuditDto,
        annotations: readOnly,
      },
      async () => read((t) => accessAudit(t)),
    );
  }

  if (has("projects:read")) {
    server.registerTool(
      "hub_list_projects",
      {
        title: "Listar projetos",
        description:
          "Projetos que esta chave pode ver, com status, fase, saúde e progresso.",
        inputSchema: z.strictObject({}),
        outputSchema: ProjectList,
        annotations: readOnly,
      },
      async () => read((t) => listProjects(t)),
    );

    server.registerTool(
      "hub_get_project",
      {
        title: "Detalhe do projeto",
        description:
          "Um projeto pelo código (ex.: HUB): objetivo, saúde com motivos, progresso, departamentos e próximos marcos.",
        inputSchema: z.strictObject({ project: ProjectCode }),
        outputSchema: ProjectDetail,
        annotations: readOnly,
      },
      async ({ project }) => read((t) => getProject(t, project)),
    );

    server.registerTool(
      "hub_get_plan",
      {
        title: "Plano do projeto",
        description:
          'Árvore completa do projeto: marcos, frentes e tarefas com subtarefas. Com format "md", devolve o texto no formato plan.md.',
        inputSchema: z.strictObject({
          project: ProjectCode,
          format: z.enum(["json", "md"]).optional(),
        }),
        outputSchema: z.object({
          plan: PlanDto.optional(),
          markdown: z.string().optional(),
        }),
        annotations: readOnly,
      },
      async ({ project, format }) =>
        read(async (t) => {
          const plan = await getPlan(t, project);
          return format === "md"
            ? { markdown: renderPlanMarkdown(plan) }
            : { plan };
        }),
    );

    server.registerTool(
      "hub_search",
      {
        title: "Buscar",
        description:
          "Busca por texto (sem diferenciar acento) ou código (ex.: HUB-12) em projetos, tarefas, marcos e frentes do seu escopo, e pessoas da equipe e agentes pelo nome (o id serve para atribuir: assignee { type, id }).",
        inputSchema: z.strictObject({ q: z.string().min(2).max(100) }),
        outputSchema: SearchDto,
        annotations: readOnly,
      },
      async ({ q }) => read((t) => search(t, q)),
    );

    server.registerTool(
      "hub_list_approvals",
      {
        title: "Listar pedidos de aprovação",
        description:
          "Pedidos de aprovação no seu escopo e a situação de cada um: pendente, aprovado, recusado ou com ajuste pedido.",
        inputSchema: ApprovalFilter,
        outputSchema: ApprovalList,
        annotations: readOnly,
      },
      async (args) => read((t) => listApprovals(t, args)),
    );
  }

  if (has("tasks:read")) {
    server.registerTool(
      "hub_list_tasks",
      {
        title: "Listar tarefas",
        description:
          'Tarefas com filtros: projeto, responsável ("me", "none", "agent:<id>"), categoria de status, prazo, bloqueio, frente e tarefa-pai. Paginação por cursor.',
        inputSchema: TaskFilter,
        outputSchema: TaskPage,
        annotations: readOnly,
      },
      async (args) => read((t) => listTasks(t, args)),
    );

    server.registerTool(
      "hub_get_task",
      {
        title: "Detalhe da tarefa",
        description:
          "Uma tarefa pelo código (ex.: HUB-12), com evidência, bloqueio, versão e comentários internos.",
        inputSchema: z.strictObject({ code: TaskCode }),
        outputSchema: TaskDto.extend({ comments: z.array(CommentDto) }),
        annotations: readOnly,
      },
      async ({ code }) =>
        read(async (t) => {
          const task = await getTask(t, code);
          const comments = (await listComments(t, { task: code })).items;
          return { ...task, comments };
        }),
    );
  }

  // Tarefas ------------------------------------------------------------------------------

  if (has("tasks:write")) {
    server.registerTool(
      "hub_create_task",
      {
        title: "Criar tarefa",
        description:
          "Cria tarefa operacional com código HUB-n. Use para trabalho descoberto e ligue à frente (workstream_id) ou à tarefa-pai (parent). Marco novo não: peça com hub_request_approval.",
        inputSchema: CreateTaskInput.extend(writeFields),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_create_task", args, (t) => createTask(t, input));
      },
    );

    server.registerTool(
      "hub_update_task",
      {
        title: "Atualizar tarefa",
        description:
          "Muda título, descrição, prioridade, datas, responsável, frente, status (menos concluir e bloquear) ou os campos personalizados do projeto (custom_fields, pelo nome; veja hub_list_custom_fields). Informe expected_version para não sobrescrever a mudança de outro.",
        inputSchema: UpdateTaskInput.extend({
          code: TaskCode,
          expected_version: z.number().int().positive().optional(),
          ...writeFields,
        }),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) => {
        const {
          code,
          expected_version,
          papel: _p,
          idempotency_key: _k,
          ...input
        } = args;
        void _p;
        void _k;
        return write("hub_update_task", args, (t) =>
          updateTask(t, code, input, expected_version),
        );
      },
    );
  }

  if (has("tasks:complete")) {
    server.registerTool(
      "hub_start_task",
      {
        title: "Iniciar tarefa",
        description:
          "Inicia a tarefa e a assume, se estiver livre. Um agente tem uma tarefa em andamento por vez.",
        inputSchema: z.strictObject({ code: TaskCode, ...writeFields }),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) =>
        write("hub_start_task", args, (t) => startTask(t, args.code)),
    );

    server.registerTool(
      "hub_block_task",
      {
        title: "Bloquear tarefa",
        description:
          "Marca a tarefa como bloqueada, dizendo o que falta e de quem depende.",
        inputSchema: z.strictObject({
          code: TaskCode,
          ...BlockTaskInput.shape,
          ...writeFields,
        }),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) =>
        write("hub_block_task", args, (t) =>
          blockTask(t, args.code, {
            reason: args.reason,
            waiting_on: args.waiting_on,
          }),
        ),
    );

    server.registerTool(
      "hub_complete_task",
      {
        title: "Concluir tarefa",
        description:
          "Conclui a tarefa com evidência verificável: SHA do commit, URL, arquivo ou teste. Sem evidência, o Hub recusa.",
        inputSchema: z.strictObject({
          code: TaskCode,
          evidence: Text(2000),
          ...writeFields,
        }),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) =>
        write("hub_complete_task", args, (t) =>
          completeTask(t, args.code, { evidence: args.evidence }),
        ),
    );

    server.registerTool(
      "hub_reopen_task",
      {
        title: "Reabrir tarefa",
        description:
          "Reabre tarefa concluída ou bloqueada, por exemplo uma conclusão sem prova. O motivo vira comentário interno.",
        inputSchema: z.strictObject({
          code: TaskCode,
          reason: Text(2000).optional(),
          ...writeFields,
        }),
        outputSchema: TaskDto,
        annotations: mutating,
      },
      async (args) =>
        write("hub_reopen_task", args, (t) =>
          reopenTask(t, args.code, { reason: args.reason }),
        ),
    );
  }

  if (has("comments:write")) {
    server.registerTool(
      "hub_comment",
      {
        title: "Comentar",
        description:
          "Comentário interno em uma tarefa, frente, marco ou projeto: progresso relevante, decisão técnica ou dúvida. Nunca aparece para o cliente.",
        inputSchema: z.strictObject({
          task: TaskCode.optional(),
          project: ProjectCode.optional(),
          milestone_id: Uuid.optional(),
          workstream_id: Uuid.optional(),
          body_md: Text(10000),
          mentions: CreateCommentInput.shape.mentions,
          ...writeFields,
        }),
        outputSchema: CommentDto,
        annotations: mutating,
      },
      async (args) =>
        write("hub_comment", args, (t) => {
          const targets = [
            args.task ? { task: args.task } : null,
            args.project ? { project: args.project } : null,
            args.milestone_id ? { milestone_id: args.milestone_id } : null,
            args.workstream_id ? { workstream_id: args.workstream_id } : null,
          ].filter((x) => x !== null);
          if (targets.length !== 1) {
            throw badRequest(
              "Informe um só destino: task, project, milestone_id ou workstream_id.",
            );
          }
          return createComment(t, targets[0], {
            body_md: args.body_md,
            mentions: args.mentions,
          });
        }),
    );
  }

  if (has("time:write")) {
    server.registerTool(
      "hub_log_time",
      {
        title: "Registrar tempo",
        description: "Registra minutos trabalhados em uma tarefa.",
        inputSchema: LogTimeInput.extend({ code: TaskCode, ...writeFields }),
        outputSchema: TimeEntryDto,
        annotations: mutating,
      },
      async (args) => {
        const { code, papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_log_time", args, (t) => logTime(t, code, input));
      },
    );
  }

  // Tempo (TO-15) ------------------------------------------------------------------------

  if (has("tasks:read")) {
    server.registerTool(
      "hub_get_project_time",
      {
        title: "Tempo do projeto",
        description:
          "Tempo registrado no projeto por pessoa ou agente e por frente, o estimado contra o registrado e as tarefas acima da estimativa. Informativo (TO-15): não muda orçamento nem fatura.",
        inputSchema: z.strictObject({ project: ProjectCode }),
        outputSchema: ProjectTimeDto,
        annotations: readOnly,
      },
      async ({ project }) => read((t) => projectTime(t, project)),
    );

    server.registerTool(
      "hub_list_custom_fields",
      {
        title: "Campos personalizados do projeto",
        description:
          "Os campos próprios das tarefas do projeto (texto, número, seleção, data ou URL), com as opções da seleção. Para gravar, use hub_update_task com custom_fields, pelo nome do campo.",
        inputSchema: z.strictObject({ project: ProjectCode }),
        outputSchema: CustomFieldList,
        annotations: readOnly,
      },
      async ({ project }) =>
        read(async (t) => ({ items: await listProjectFields(t, project) })),
    );
  }

  // Frentes ------------------------------------------------------------------------------

  if (has("workstreams:write")) {
    server.registerTool(
      "hub_create_workstream",
      {
        title: "Criar frente",
        description:
          "Cria uma frente (camada tática) ligada a marco e departamento, com as frentes de que ela depende (depends_on). Nasce interna; mostrar ao cliente é pedido de aprovação.",
        inputSchema: CreateWorkstreamInput.extend(writeFields),
        outputSchema: WorkstreamDto,
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_create_workstream", args, (t) =>
          createWorkstream(t, input),
        );
      },
    );

    server.registerTool(
      "hub_update_workstream",
      {
        title: "Atualizar frente",
        description:
          "Atualiza título, marco, departamento, descrição interna, status, ordem, responsável ou dependências (depends_on, a lista inteira, sem ciclos) de uma frente.",
        inputSchema: UpdateWorkstreamInput.extend({ id: Uuid, ...writeFields }),
        outputSchema: WorkstreamDto,
        annotations: mutating,
      },
      async (args) => {
        const { id, papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_update_workstream", args, (t) =>
          updateWorkstream(t, id, input),
        );
      },
    );
  }

  // Governança ---------------------------------------------------------------------------

  if (has("approvals:request")) {
    server.registerTool(
      "hub_request_approval",
      {
        title: "Pedir aprovação",
        description:
          "Pede uma decisão ao Fábio: aceite de marco, novo marco, replanejamento, mudança de escopo, frente visível ao cliente, mensagem externa ou revogar a chave de um agente (agent_key, só para quem audita o acesso, sem project). Você pede; só ele decide.",
        inputSchema: RequestApprovalInput.extend(writeFields),
        outputSchema: ApprovalDto,
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_request_approval", args, (t) =>
          requestApproval(t, input),
        );
      },
    );
  }

  if (has("reports:draft")) {
    server.registerTool(
      "hub_draft_status_report",
      {
        title: "Rascunho de status",
        description:
          "Cria o rascunho do relatório de status de um período, interno ou para o cliente. Vira pedido de aprovação; só é publicado com o sim do Fábio. Para o cliente, o Hub confere o texto (verificação do Redator do Cliente, RC-12) e devolve os alertas em checks: corrija e mande de novo; a versão nova substitui a sua anterior ainda pendente do mesmo período.",
        inputSchema: DraftReportInput.extend(writeFields),
        outputSchema: DraftReportResult,
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_draft_status_report", args, (t) =>
          draftReport(t, input),
        );
      },
    );
  }

  if (has("sync:plan")) {
    server.registerTool(
      "hub_sync_plan",
      {
        title: "Sincronizar plan.md",
        description:
          'Sincroniza o plan.md do projeto com o Hub, que vence os conflitos. "pull": o Hub vai para o arquivo (caixas e as tarefas que faltam). "push": item sem código vira tarefa e ganha o código; caixa marcada conclui com a evidência escrita no item ("— evidência: ...") ou com o commit_sha; com base_markdown (o arquivo da última sincronização), desmarcar reabre, renomear renomeia e tirar o item arquiva. GATE marcado no arquivo é ignorado e alertado; marco novo não é criado. Grave no repositório o markdown devolvido. Para só ler o plano, use hub_get_plan.',
        inputSchema: SyncPlanInput.extend(writeFields),
        outputSchema: SyncPlanResult,
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_sync_plan", args, (t) => syncPlan(t, input));
      },
    );
  }

  // Importação de projetos (D10) -----------------------------------------------------------

  if (has("projects:import")) {
    server.registerTool(
      "hub_create_client",
      {
        title: "Cadastrar cliente (importação)",
        description:
          "Cadastra o cliente de um projeto que você vai importar, sem acesso ao portal (quem libera o portal é o Fábio). Se já existe cliente com o mesmo nome, devolve esse, com created: false. Nunca coloque segredos nem dados pessoais nas notas.",
        inputSchema: ImportClientInput.extend(writeFields),
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_create_client", args, (t) => importClient(t, input));
      },
    );
    server.registerTool(
      "hub_create_project",
      {
        title: "Cadastrar projeto em revisão (importação)",
        description:
          'Cadastra um projeto "Em revisão" ligado a um cliente (o de hub_create_client), com departamentos (slugs de hub_whoami), repositório e caminho do plan.md. O projeto só passa a valer quando o Fábio aprovar a importação. Repetir com o mesmo código e o mesmo cliente devolve o mesmo projeto (created: false); código de um projeto que já está no Hub fora de revisão é recusado (409). Depois, importe o plano com hub_import_plan.',
        inputSchema: ImportProjectInput.extend(writeFields),
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_create_project", args, (t) =>
          importProject(t, input),
        );
      },
    );
    server.registerTool(
      "hub_import_plan",
      {
        title: "Importar o plan.md de um projeto em revisão",
        description:
          'Importa o plan.md inteiro num projeto "Em revisão" (de hub_create_project): marcos com o código do arquivo (sempre como Planejado), frentes, tarefas e subtarefas, e os critérios do GATE; item marcado entra concluído, com a evidência escrita ou com a nota da importação. Abre o pedido import_review para o Fábio (um só por projeto) com o seu resumo (summary: de onde veio o plano e o que ficou de fora). Use antes dry_run: true para ver o que entraria e os avisos, sem gravar. O markdown devolvido traz os códigos: entregue-o para ir ao repositório por PR depois da aprovação, nunca direto na main.',
        inputSchema: ImportProjectPlanInput.extend(writeFields),
        annotations: mutating,
      },
      async (args) => {
        const { papel: _p, idempotency_key: _k, ...input } = args;
        void _p;
        void _k;
        return write("hub_import_plan", args, (t) =>
          importProjectPlan(t, input),
        );
      },
    );
  }

  // Recursos e prompts --------------------------------------------------------------------

  if (has("projects:read")) {
    server.registerResource(
      "plano-do-projeto",
      new ResourceTemplate("hub://projects/{code}/plan.md", {
        list: async () => {
          const projects = await inTx(base, (t) => listProjects(t));
          return {
            resources: projects.items.map((p) => ({
              uri: `hub://projects/${p.code}/plan.md`,
              name: `${p.code} · plan.md`,
              mimeType: "text/markdown",
            })),
          };
        },
      }),
      { title: "Plano do projeto (plan.md)", mimeType: "text/markdown" },
      async (uri, variables) => {
        const code = String(variables.code);
        const plan = await inTx(base, (t) => getPlan(t, code));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: renderPlanMarkdown(plan),
            },
          ],
        };
      },
    );

    server.registerResource(
      "saude-do-projeto",
      new ResourceTemplate("hub://projects/{code}/health", { list: undefined }),
      { title: "Saúde do projeto", mimeType: "application/json" },
      async (uri, variables) => {
        const health = await inTx(base, (t) =>
          getProjectHealth(t, String(variables.code)),
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(health, null, 2),
            },
          ],
        };
      },
    );
  }

  server.registerResource(
    "minha-fila",
    "hub://today",
    { title: "Minha fila do dia", mimeType: "application/json" },
    async (uri) => {
      const data = await inTx(base, (t) => today(t));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "status-semanal",
    {
      title: "Status semanal",
      description:
        "Rascunho do status semanal de um projeto, a partir de dados reais do Hub.",
      argsSchema: {
        project: z.string().describe("Código do projeto, como HUB."),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Monte o status semanal do projeto ${project}. Use hub_get_project (saúde e motivos), hub_get_plan (marcos, frentes e tarefas) e hub_list_tasks com status_category done para ver o que foi concluído na semana. Escreva o que avançou, o que está bloqueado e de quem depende, os riscos e os próximos passos. Não invente números nem prazos. Ao final, salve com hub_draft_status_report (audience internal); ele vira pedido de aprovação para o Fábio.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "digest-matinal",
    {
      title: "Digest matinal",
      description:
        "Resumo da manhã: fila do dia, bloqueios e o que depende do Fábio.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Monte o digest matinal. Use hub_get_today e hub_list_tasks com blocked true. Organize por projeto: o que está em andamento, o que vence nos próximos 3 dias, o que está bloqueado e de quem depende, e quais aprovações esperam o Fábio. Seja curto: uma linha por item, sem jargão.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "revisar-conclusoes",
    {
      title: "Revisar conclusões",
      description:
        "Guardião da Qualidade: confere a evidência das tarefas concluídas.",
      argsSchema: {
        project: z.string().describe("Código do projeto, como HUB."),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Revise as conclusões do projeto ${project}. Use hub_list_tasks com status_category done e confira em cada tarefa se a evidência é verificável (SHA, URL, arquivo ou teste). Sem prova, use hub_reopen_task com o motivo. Aponte tarefas duplicadas em hub_comment. Não conclua nada por conta própria.`,
          },
        },
      ],
    }),
  );

  return server;
}

export type { McpServer };
