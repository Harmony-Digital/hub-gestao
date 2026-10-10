import "server-only";
import { audit } from "@/lib/audit";
import { authorize, can } from "@/lib/authorize";
import { forbidden, HubError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { APPROVAL_TYPE, HEALTH } from "@/lib/labels";
import { generateObject, type LlmDeps } from "@/lib/llm";
import { CONCIERGE_INTERPRET } from "@/modules/agents/prompts/concierge";
import { promptTag } from "@/modules/agents/prompts";
import { listApprovals } from "@/modules/approvals/service";
import { createComment } from "@/modules/comments/service";
import { projectScopeSql } from "@/modules/common";
import {
  inTx,
  many,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";
import { getProject, listProjects } from "@/modules/projects/service";
import { TASK_SUMMARY_SELECT, toTaskSummary } from "@/modules/projects/service";
import {
  createTask,
  getTask,
  moveTask,
  updateTask,
} from "@/modules/tasks/service";
import type { TaskDto, UpdateTaskInput } from "@/modules/tasks/schemas";
import { STATUS_CATEGORY_LABEL } from "@/modules/tasks/status-categories";
import {
  conciergeMessage,
  type ConciergeContext,
  type ContextProject,
} from "./context";
import { ConciergeIntent, type ConciergeQuestion } from "./intent";
import type {
  AnswerItem,
  Choice,
  ConciergeCommand,
  ConciergeMeta,
  ConciergeProposal,
  StatusChoice,
  TaskRef,
} from "./proposal";
import {
  clip,
  isoDate,
  matchMember,
  matchProject,
  memberValue,
  screenTarget,
  taskCode,
} from "./resolve";

/**
 * CO-10 Concierge (AGENTES.md): a pessoa fala ou digita um pedido; a IA aponta a ação;
 * o Hub confere tudo (projeto, pessoa, data, tarefa) no alcance de quem pede e devolve a
 * prévia. Nada é gravado sem a confirmação da pessoa, e a execução é em nome dela, com
 * os limites dela, pelos mesmos casos de uso das telas, com o papel CO-10 no histórico
 * (`source = ui`, `acting_role = CO-10`). Pergunta é respondida com dados do Hub, nunca
 * pela IA; pedido de aprovação vira o cartão de decisão de sempre (quem decide é a
 * pessoa). Sem agente CO-10 ou sem IA configurada, recusa com o motivo (falha fechada).
 */

export const CONCIERGE_ROLE = "CO-10";

export const NO_CONCIERGE =
  "O Concierge ainda não está ligado: na Sala de Controle, cadastre um agente com o papel CO-10 (Concierge do Hub) e escolha o modelo de IA dele.";

const MAX_TEXT = 1000;
const MAX_ITEMS = 12;

export type InterpretResult =
  { ok: true; proposal: ConciergeProposal } | { ok: false; message: string };

/** Só a equipe usa o Concierge (o portal do cliente não tem barra de comando). */
function assertTeam(ctx: Ctx) {
  if (ctx.actor.type !== "user" || ctx.actor.scope !== "internal") {
    throw forbidden("O Concierge é só da equipe.");
  }
}

/** O agente do Concierge: ativo e com o papel CO-10 (o interno primeiro). */
export async function conciergeAgent(
  t: TxCtx,
): Promise<{ id: string; name: string; configured: boolean } | null> {
  const row = await maybeOne<{
    id: string;
    name: string;
    configured: boolean;
  }>(
    t,
    `select id, name,
            (llm_provider is not null and llm_model is not null
              and llm_credential_id is not null and budget_usd_month > 0) as configured
       from ${S}.agents
      where workspace_id = $1 and status = 'active' and $2 = any(roles)
      order by (kind = 'internal') desc, created_at
      limit 1`,
    [t.actor.workspaceId, CONCIERGE_ROLE],
  );
  return row;
}

/** Para a barra ⌘K: o Concierge está pronto para responder? */
export async function conciergeReady(t: TxCtx): Promise<boolean> {
  return Boolean((await conciergeAgent(t))?.configured);
}

const PROJECT_IN_PATH = /^\/projetos\/([A-Z0-9]{2,8})(?:[/?#]|$)/;

async function buildContext(
  t: TxCtx,
  path: string | null,
): Promise<ConciergeContext> {
  const today = (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;
  const projects: ContextProject[] = (await listProjects(t)).items.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    client: p.client.name,
  }));
  const screen = PROJECT_IN_PATH.exec(path ?? "")?.[1] ?? null;
  const people = await many<{ id: string; name: string }>(
    t,
    `select pr.id, pr.full_name as name
       from ${S}.memberships m
       join ${S}.profiles pr on pr.id = m.profile_id
      where m.workspace_id = $1 and m.status = 'active' and pr.deactivated_at is null
      order by pr.full_name`,
    [t.actor.workspaceId],
  );
  const agents = await many<{ id: string; name: string }>(
    t,
    `select id, name from ${S}.agents
      where workspace_id = $1 and status <> 'revoked'
      order by name`,
    [t.actor.workspaceId],
  );
  const approvals = can(t.actor, "approval.read")
    ? (
        await listApprovals(t, {
          status: "pending",
          mine: can(t.actor, "approval.decide") ? undefined : true,
        })
      ).items.slice(0, 30)
    : [];
  return {
    today,
    screenProject:
      screen && projects.some((p) => p.code === screen) ? screen : null,
    me: { id: t.actor.id!, name: t.actor.name },
    projects,
    team: [
      ...people.map((p) => ({ type: "user" as const, ...p })),
      ...agents.map((a) => ({ type: "agent" as const, ...a })),
    ],
    approvals: approvals.map((a, index) => ({
      ref: index + 1,
      id: a.id,
      typeLabel: (APPROVAL_TYPE[a.type] ?? APPROVAL_TYPE.custom).label,
      title: a.title,
      project: a.project_code,
    })),
  };
}

/**
 * Interpreta o pedido e devolve a prévia. A IA é chamada fora de transação (o adaptador
 * abre as próprias); o contexto e a conferência usam as permissões de quem pede.
 */
export async function interpretRequest(
  ctx: Ctx,
  input: { text: string; path?: string | null },
  deps: LlmDeps = {},
): Promise<InterpretResult> {
  assertTeam(ctx);
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (text.length < 2) {
    return { ok: false, message: "Diga ou digite o que você precisa." };
  }
  const prepared = await inTx(ctx, async (t) => {
    authorize(t.actor, "task.read");
    const agent = await conciergeAgent(t);
    if (!agent) return null;
    return { agent, context: await buildContext(t, input.path ?? null) };
  });
  if (!prepared) return { ok: false, message: NO_CONCIERGE };

  const answer = await generateObject(
    ctx,
    {
      agentId: prepared.agent.id,
      purpose: `Concierge · ${promptTag(CONCIERGE_INTERPRET)}`,
      instructions: CONCIERGE_INTERPRET.instructions,
      prompt: conciergeMessage(prepared.context, text),
      maxOutputTokens: 800,
      schema: ConciergeIntent,
      schemaName: "acao_do_concierge",
      schemaDescription: "A ação que o pedido descreve, para a prévia.",
    },
    deps,
  );
  if (!answer.ok) return { ok: false, message: answer.detail };
  const proposal = await inTx(ctx, (t) =>
    propose(t, answer.object, prepared.context),
  );
  return { ok: true, proposal };
}

const unknown = (message: string): ConciergeProposal => ({
  kind: "unknown",
  message,
});

const UNKNOWN_DEFAULT =
  "Não entendi o pedido. Tente de outro jeito, por exemplo: “cria uma tarefa de revisar o contrato no projeto HUB para sexta”.";

/** Da intenção da IA para a prévia, conferindo tudo no alcance de quem pede. */
export async function propose(
  t: TxCtx,
  intent: ConciergeIntent,
  ctx: ConciergeContext,
): Promise<ConciergeProposal> {
  switch (intent.kind) {
    case "create_task":
      return proposeCreate(intent, ctx);
    case "update_task":
      return proposeUpdate(t, intent, ctx);
    case "comment": {
      const found = await taskFor(t, intent.task);
      if ("message" in found) return unknown(found.message);
      const body = (intent.comment ?? "").trim().slice(0, 10000);
      return {
        kind: "comment",
        task: found.ref,
        body,
        notes: body ? [] : ["Diga o texto do comentário."],
      };
    }
    case "approval": {
      const approval = ctx.approvals.find((a) => a.ref === intent.approval);
      if (!approval) {
        return unknown(
          ctx.approvals.length
            ? "Não achei esse pedido entre os que esperam decisão. Abra Aprovações para ver todos."
            : "Nenhum pedido de aprovação esperando agora.",
        );
      }
      return { kind: "approval", approvalId: approval.id };
    }
    case "question":
      return answer(t, intent.question, matchProject(intent.project, ctx), ctx);
    case "navigate": {
      if (intent.task) {
        const found = await taskFor(t, intent.task);
        if ("message" in found) return unknown(found.message);
        return {
          kind: "navigate",
          label: `${found.ref.code} · ${found.ref.title}`,
          href: `/projetos/${found.ref.project_code}/lista?tarefa=${found.ref.code}`,
        };
      }
      const target = screenTarget(
        intent.screen,
        matchProject(intent.project, ctx),
      );
      return target
        ? { kind: "navigate", ...target }
        : unknown("Não achei a tela pedida.");
    }
    case "unknown":
      return unknown(clip(intent.note, 300) || UNKNOWN_DEFAULT);
  }
}

function teamChoices(ctx: ConciergeContext): Choice[] {
  return [
    { value: "", label: "Ninguém por enquanto" },
    { value: "me", label: `Eu (${ctx.me.name})` },
    ...ctx.team
      .filter((m) => !(m.type === "user" && m.id === ctx.me.id))
      .map((m) => ({
        value: `${m.type}:${m.id}`,
        label: m.type === "agent" ? `${m.name} (agente)` : m.name,
      })),
  ];
}

function dateNotes(
  said: string | null,
  date: string | null,
  ctx: ConciergeContext,
): string[] {
  if (said && !date) {
    return ["O prazo entendido não é uma data válida: escolha no campo."];
  }
  if (date && date < ctx.today) {
    return [`O prazo entendido (${formatDate(date)}) já passou: confira.`];
  }
  return [];
}

function proposeCreate(
  intent: ConciergeIntent,
  ctx: ConciergeContext,
): ConciergeProposal {
  const project =
    matchProject(intent.project, ctx) ??
    (intent.project ? null : matchProject(ctx.screenProject, ctx));
  const member = matchMember(intent.assignee, ctx);
  const due = isoDate(intent.due_date);
  const title = clip(intent.title, 300);
  const notes: string[] = [];
  if (!project) {
    notes.push(
      intent.project
        ? `Não achei o projeto “${clip(intent.project, 60)}”: escolha na lista.`
        : "Escolha o projeto.",
    );
  }
  if (!title) notes.push("Diga o título da tarefa.");
  if (intent.assignee && !member) {
    notes.push(
      `Não achei “${clip(intent.assignee, 60)}” na equipe: escolha o responsável.`,
    );
  }
  notes.push(...dateNotes(intent.due_date, due, ctx));
  return {
    kind: "create_task",
    draft: {
      project: project?.code ?? "",
      title,
      description: (intent.description ?? "").trim().slice(0, 2000),
      due_date: due ?? "",
      priority: intent.priority ?? "normal",
      assignee: memberValue(member, ctx),
    },
    projects: ctx.projects.map((p) => ({
      value: p.code,
      label: `${p.code} · ${p.name}`,
    })),
    team: teamChoices(ctx),
    notes,
  };
}

/** A tarefa citada, no alcance de quem pede; senão, o recado para a prévia. */
async function taskFor(
  t: TxCtx,
  said: string | null,
): Promise<{ ref: TaskRef; task: TaskDto } | { message: string }> {
  const code = taskCode(said);
  if (!code) {
    return { message: "Diga o código da tarefa, por exemplo: HUB-12." };
  }
  let task: TaskDto;
  try {
    task = await getTask(t, code);
  } catch (err) {
    if (err instanceof HubError && err.status < 500) {
      return { message: `Não achei a tarefa ${code} no seu alcance.` };
    }
    throw err;
  }
  if (task.archived_at) {
    return { message: `A tarefa ${code} está arquivada.` };
  }
  return {
    task,
    ref: {
      code: task.code,
      title: task.title,
      project_code: task.project_code,
      version: task.version,
      status_name: task.status.name,
      status_category: task.status.category,
    },
  };
}

async function proposeUpdate(
  t: TxCtx,
  intent: ConciergeIntent,
  ctx: ConciergeContext,
): Promise<ConciergeProposal> {
  const found = await taskFor(t, intent.task);
  if ("message" in found) return unknown(found.message);
  const { task, ref } = found;
  const statuses = await many<StatusChoice>(
    t,
    `select s.id, s.name, s.category::text as category
       from ${S}.task_statuses s
       join ${S}.projects p on p.id = s.project_id
      where p.code = $1
      order by s.sort_order, s.name`,
    [task.project_code],
  );
  const notes: string[] = [];
  let statusId: string | null = null;
  if (intent.status && intent.status !== task.status.category) {
    const target = statuses.find((s) => s.category === intent.status);
    if (target) statusId = target.id;
    else {
      notes.push(
        `O projeto ${task.project_code} não tem status em “${STATUS_CATEGORY_LABEL[intent.status]}”.`,
      );
    }
  }
  const member = matchMember(intent.assignee, ctx);
  if (intent.assignee && !member) {
    notes.push(
      `Não achei “${clip(intent.assignee, 60)}” na equipe: escolha o responsável.`,
    );
  }
  const due = isoDate(intent.due_date);
  notes.push(...dateNotes(intent.due_date, due, ctx));
  const title = clip(intent.title, 300);
  const changes = {
    status_id: statusId,
    due_date: due && due !== task.due_date ? due : null,
    priority:
      intent.priority && intent.priority !== task.priority
        ? intent.priority
        : null,
    assignee: member ? memberValue(member, ctx) : null,
    title: title && title !== task.title ? title : null,
  };
  const nothing =
    Object.values(changes).every((v) => v === null) &&
    !(intent.assignee && !member);
  if (nothing) {
    return unknown(
      intent.status === task.status.category
        ? `${task.code} já está em “${task.status.name}”.`
        : `Não entendi o que mudar em ${task.code}.`,
    );
  }
  return {
    kind: "update_task",
    task: ref,
    changes,
    reason: clip(intent.reason, 2000),
    statuses,
    team: teamChoices(ctx),
    notes,
  };
}

type SummaryRow = Parameters<typeof toTaskSummary>[0];

/** Tarefas no alcance de quem pede (e no projeto, se a pergunta citou um). */
async function tasksWhere(
  t: TxCtx,
  condition: string,
  project: ContextProject | null,
  order: string,
  extra: unknown[] = [],
): Promise<{ rows: SummaryRow[]; total: number }> {
  const params: unknown[] = [...extra];
  let where = `t.archived_at is null and ${condition} and ${projectScopeSql(t.actor, "t.project_id", params)}`;
  if (project) {
    params.push(project.id);
    where += ` and t.project_id = $${params.length}`;
  }
  const rows = await many<SummaryRow>(
    t,
    `${TASK_SUMMARY_SELECT}
      where ${where}
      order by ${order}
      limit ${MAX_ITEMS}`,
    params,
  );
  const total =
    rows.length < MAX_ITEMS
      ? rows.length
      : ((
          await maybeOne<{ n: number }>(
            t,
            `select count(*)::int as n from ${S}.tasks t where ${where}`,
            params,
          )
        )?.n ?? rows.length);
  return { rows, total };
}

const taskHref = (r: { project_code: string; code: string }) =>
  `/projetos/${r.project_code}/lista?tarefa=${r.code}`;

function answerList(
  title: string,
  items: AnswerItem[],
  total: number,
  empty: string,
  more: { label: string; href: string },
): ConciergeProposal {
  return {
    kind: "answer",
    title,
    items,
    empty,
    more:
      total > items.length
        ? { ...more, label: `${more.label} (${total})` }
        : null,
  };
}

/** Perguntas são respondidas com os dados do Hub, nunca com texto da IA. */
async function answer(
  t: TxCtx,
  question: ConciergeQuestion | null,
  project: ContextProject | null,
  ctx: ConciergeContext,
): Promise<ConciergeProposal> {
  const inProject = project ? ` em ${project.code}` : "";
  const projectsHref = project ? `/projetos/${project.code}/lista` : "/";
  switch (question) {
    case "blocked": {
      const { rows, total } = await tasksWhere(
        t,
        "t.status_category = 'blocked'",
        project,
        "t.updated_at desc",
      );
      return answerList(
        `Bloqueadas${inProject}`,
        rows.map((r) => ({
          label: `${r.code} · ${r.title}`,
          hint:
            [
              r.blocked_reason ? clip(r.blocked_reason, 120) : null,
              r.blocked_on_name ? `esperando ${r.blocked_on_name}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || null,
          href: taskHref(r),
        })),
        total,
        `Nada bloqueado${inProject}.`,
        { label: "Ver todas", href: projectsHref },
      );
    }
    case "overdue":
    case "due_soon": {
      const overdue = question === "overdue";
      const { rows, total } = await tasksWhere(
        t,
        overdue
          ? "t.status_category <> 'done' and t.due_date < current_date"
          : "t.status_category <> 'done' and t.due_date between current_date and current_date + 7",
        project,
        "t.due_date, t.code",
      );
      return answerList(
        overdue
          ? `Atrasadas${inProject}`
          : `Vencem nos próximos 7 dias${inProject}`,
        rows.map((r) => ({
          label: `${r.code} · ${r.title}`,
          hint: [
            `prazo ${formatDate(r.due_date)}`,
            r.assignee_name ?? "sem responsável",
          ].join(" · "),
          href: taskHref(r),
        })),
        total,
        overdue
          ? `Nada atrasado${inProject}.`
          : `Nada vence nos próximos 7 dias${inProject}.`,
        { label: "Ver todas", href: projectsHref },
      );
    }
    case "my_tasks": {
      const { rows, total } = await tasksWhere(
        t,
        "t.status_category <> 'done' and t.assignee_type = 'user' and t.assignee_id = $1",
        project,
        "t.due_date nulls last, t.code",
        [ctx.me.id],
      );
      return answerList(
        `Suas tarefas abertas${inProject}`,
        rows.map((r) => ({
          label: `${r.code} · ${r.title}`,
          hint: [
            r.status_name,
            r.due_date ? `prazo ${formatDate(r.due_date)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          href: taskHref(r),
        })),
        total,
        `Nenhuma tarefa aberta com você${inProject}.`,
        { label: "Abrir Minhas tarefas", href: "/minhas-tarefas" },
      );
    }
    case "pending_approvals": {
      const items = ctx.approvals.filter(
        (a) => !project || a.project === project.code,
      );
      return answerList(
        `Esperando decisão${inProject}`,
        items.slice(0, MAX_ITEMS).map((a) => ({
          label: a.title,
          hint: [a.typeLabel, a.project].filter(Boolean).join(" · "),
          href: "/aprovacoes",
        })),
        items.length,
        `Nenhum pedido esperando decisão${inProject}.`,
        { label: "Abrir Aprovações", href: "/aprovacoes" },
      );
    }
    case "project_status": {
      if (!project) {
        return unknown(
          "Diga de qual projeto, por exemplo: “como está o HUB?”.",
        );
      }
      const p = await getProject(t, project.code);
      const href = `/projetos/${p.code}`;
      return {
        kind: "answer",
        title: `${p.code} · ${p.name}`,
        items: [
          { label: `Saúde: ${HEALTH[p.health].label}`, hint: null, href },
          { label: `Progresso: ${p.progress_pct}%`, hint: null, href },
          {
            label: `Tarefas abertas: ${p.open_task_count}`,
            hint:
              p.blocked_task_count > 0
                ? `${p.blocked_task_count} bloqueada${p.blocked_task_count === 1 ? "" : "s"}`
                : null,
            href: `${href}/lista`,
          },
          ...(p.target_date
            ? [
                {
                  label: `Entrega prevista: ${formatDate(p.target_date)}`,
                  hint: null,
                  href,
                },
              ]
            : []),
        ],
        empty: "",
        more: { label: "Abrir o projeto", href },
      };
    }
    default:
      return unknown(UNKNOWN_DEFAULT);
  }
}

export type ConciergeDone = {
  code: string;
  project_code: string;
  message: string;
};

/**
 * Executa o que a pessoa confirmou, em nome dela (com os limites dela), pelos casos de uso
 * de sempre, numa transação só, com o papel CO-10 no histórico. Grava também a
 * confirmação (editou ou não, voz ou texto, tempo) para as métricas do CO-10.
 */
export async function executeConcierge(
  ctx: Ctx,
  command: ConciergeCommand,
  meta: ConciergeMeta,
): Promise<ConciergeDone> {
  assertTeam(ctx);
  const via: Ctx = {
    ...ctx,
    actor: { ...ctx.actor, actingRole: CONCIERGE_ROLE },
  };
  return inTx(via, async (t) => {
    let task: TaskDto;
    let message: string;
    switch (command.kind) {
      case "create_task": {
        task = await createTask(t, {
          project: command.project,
          title: command.title,
          ...(command.description_md
            ? { description_md: command.description_md }
            : {}),
          priority: command.priority,
          ...(command.due_date ? { due_date: command.due_date } : {}),
          ...(command.assignee ? { assignee: command.assignee } : {}),
        });
        message = `${task.code} criada em ${task.project_code}.`;
        break;
      }
      case "update_task": {
        let version: number | undefined = command.version;
        if (command.status_id) {
          await moveTask(
            t,
            command.task,
            {
              status_id: command.status_id,
              evidence: command.evidence,
              reason: command.reason,
            },
            version,
          );
          version = undefined;
        }
        const changes: UpdateTaskInput = {
          ...(command.due_date ? { due_date: command.due_date } : {}),
          ...(command.priority ? { priority: command.priority } : {}),
          ...(command.assignee ? { assignee: command.assignee } : {}),
          ...(command.title ? { title: command.title } : {}),
        };
        task =
          Object.keys(changes).length > 0
            ? await updateTask(t, command.task, changes, version)
            : await getTask(t, command.task);
        message = `${task.code} atualizada (${task.status.name}).`;
        break;
      }
      case "comment": {
        await createComment(
          t,
          { task: command.task },
          { body_md: command.body_md },
        );
        task = await getTask(t, command.task);
        message = `Comentário publicado em ${task.code}.`;
        break;
      }
    }
    await audit(t, {
      action: "concierge.confirmed",
      entityType: "task",
      entityId: task.id,
      after: {
        kind: command.kind,
        code: task.code,
        edited: meta.edited,
        voice: meta.voice,
        seconds: meta.seconds,
      },
    });
    return { code: task.code, project_code: task.project_code, message };
  });
}
