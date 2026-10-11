import { z } from "zod";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  ACTOR_NAME_SQL,
  ActorRef,
  actorRef,
  authorizeProjectId,
  iso,
  IsoDate,
  ProjectCode,
  resolveProject,
  TaskCode,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

export const LogTimeInput = z.strictObject({
  minutes: z.number().int().min(1).max(1440),
  entry_date: IsoDate.optional().describe("Dia do trabalho; padrão: hoje."),
  note: z.string().trim().max(500).optional(),
});
export type LogTimeInput = z.infer<typeof LogTimeInput>;

export const TimeEntryDto = z.object({
  id: Uuid,
  task_code: TaskCode,
  minutes: z.number().int(),
  entry_date: IsoDate,
  note: z.string().nullable(),
  actor: ActorRef,
  created_at: Timestamp,
});
export type TimeEntryDto = z.infer<typeof TimeEntryDto>;

export async function logTime(
  t: TxCtx,
  code: string,
  input: LogTimeInput,
): Promise<TimeEntryDto> {
  const parsed = TaskCode.safeParse(code);
  if (!parsed.success)
    throw badRequest("Código de tarefa inválido: use o formato HUB-123.");
  const task = await maybeOne<{ id: string; code: string; project_id: string }>(
    t,
    `select id, code, project_id from ${S}.tasks where code = $1 and archived_at is null`,
    [parsed.data],
  );
  if (!task)
    throw notFound(`Tarefa ${parsed.data} não encontrada neste workspace.`);
  await authorizeProjectId(t, task.project_id, "time.write");
  assertNoSecrets({ note: input.note });
  const row = await maybeOne<{
    id: string;
    minutes: number;
    entry_date: string;
    note: string | null;
    created_at: Date | string;
  }>(
    t,
    `insert into ${S}.time_entries (workspace_id, task_id, actor_type, actor_id, minutes, entry_date, note)
     values ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7)
     returning id, minutes, entry_date, note, created_at`,
    [
      t.actor.workspaceId,
      task.id,
      t.actor.type,
      t.actor.id,
      input.minutes,
      input.entry_date ?? null,
      input.note ?? null,
    ],
  );
  await audit(t, {
    action: "time.logged",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { minutes: input.minutes, entry_date: row!.entry_date },
  });
  return {
    id: row!.id,
    task_code: task.code,
    minutes: row!.minutes,
    entry_date: row!.entry_date,
    note: row!.note,
    actor: actorRef(t.actor.type, t.actor.id, t.actor.name)!,
    created_at: iso(row!.created_at),
  };
}

// Leituras ---------------------------------------------------------------------------

const ENTRY_LIMIT = 50;

/** O tempo de uma tarefa, para o painel: as entradas mais recentes e o total. */
export async function taskTime(
  t: TxCtx,
  taskId: string,
): Promise<{ totalMinutes: number; entries: TimeEntryDto[] }> {
  const total = await maybeOne<{ minutes: number }>(
    t,
    `select coalesce(sum(minutes), 0)::int as minutes
       from ${S}.time_entries where task_id = $1`,
    [taskId],
  );
  const rows = await many<{
    id: string;
    task_code: string;
    minutes: number;
    entry_date: string;
    note: string | null;
    actor_type: string;
    actor_id: string | null;
    actor_name: string | null;
    created_at: Date | string;
  }>(
    t,
    `select e.id, tk.code as task_code, e.minutes, e.entry_date::text as entry_date,
            e.note, e.actor_type::text as actor_type, e.actor_id,
            ${ACTOR_NAME_SQL("e.actor_type::text", "e.actor_id")} as actor_name,
            e.created_at
       from ${S}.time_entries e join ${S}.tasks tk on tk.id = e.task_id
      where e.task_id = $1
      order by e.entry_date desc, e.created_at desc
      limit ${ENTRY_LIMIT}`,
    [taskId],
  );
  return {
    totalMinutes: total?.minutes ?? 0,
    entries: rows.map((r) => ({
      id: r.id,
      task_code: r.task_code,
      minutes: r.minutes,
      entry_date: r.entry_date,
      note: r.note,
      actor: actorRef(r.actor_type, r.actor_id, r.actor_name)!,
      created_at: iso(r.created_at),
    })),
  };
}

/** Margem acima da estimativa que já conta como desvio (TO-15). */
export const OVERRUN_RATIO = 1.2;

export const ProjectTimeDto = z.object({
  project_code: ProjectCode,
  total_minutes: z
    .number()
    .int()
    .describe("Tudo o que foi registrado no projeto."),
  month_minutes: z
    .number()
    .int()
    .describe("Registrado no mês corrente (pelo dia do trabalho)."),
  by_actor: z
    .array(
      z.object({
        actor: ActorRef,
        minutes: z.number().int(),
        month_minutes: z.number().int(),
      }),
    )
    .describe("Por pessoa ou agente, do que mais registrou para o que menos."),
  by_workstream: z.array(
    z.object({
      workstream: z
        .string()
        .nullable()
        .describe("Título da frente; null: sem frente."),
      minutes: z.number().int(),
    }),
  ),
  estimate: z
    .object({
      tasks: z
        .number()
        .int()
        .describe("Tarefas com estimativa e tempo registrado."),
      estimated_minutes: z.number().int(),
      actual_minutes: z.number().int(),
    })
    .describe("Estimado contra registrado, só nas tarefas que têm os dois."),
  overruns: z
    .array(
      z.object({
        code: TaskCode,
        title: z.string(),
        estimate_minutes: z.number().int(),
        actual_minutes: z.number().int(),
      }),
    )
    .describe(
      `Tarefas com tempo acima de ${Math.round((OVERRUN_RATIO - 1) * 100)}% da estimativa, as maiores primeiro (até 10).`,
    ),
  ai_cost_usd: z
    .object({
      month: z.number().describe("No mês corrente, em dólares."),
      total: z.number(),
      by_agent: z.array(
        z.object({
          agent: z.string(),
          month: z.number(),
          total: z.number(),
        }),
      ),
    })
    .describe(
      "Custo das chamadas de IA dos agentes internos do Hub ligadas ao projeto (Planejador, Redator do Cliente). Os agentes do Hermes pagam a IA por lá e não entram aqui.",
    ),
});
export type ProjectTimeDto = z.infer<typeof ProjectTimeDto>;

/**
 * Tempo e custo do projeto (M7, base do TO-15): o que foi registrado por pessoa ou agente
 * e por frente, o estimado contra o registrado, as tarefas acima da estimativa e o custo
 * de IA dos agentes internos ligado ao projeto. Só leitura, informativo: não muda
 * orçamento nem fatura.
 */
export async function projectTime(
  t: TxCtx,
  code: string,
): Promise<ProjectTimeDto> {
  const project = await resolveProject(t, code, "task.read");
  const totals = await maybeOne<{ total: number; month: number }>(
    t,
    `select coalesce(sum(e.minutes), 0)::int as total,
            coalesce(sum(e.minutes) filter (
              where e.entry_date >= date_trunc('month', current_date)), 0)::int as month
       from ${S}.time_entries e join ${S}.tasks tk on tk.id = e.task_id
      where tk.project_id = $1`,
    [project.id],
  );
  const byActor = await many<{
    actor_type: string;
    actor_id: string | null;
    actor_name: string | null;
    minutes: number;
    month: number;
  }>(
    t,
    `select e.actor_type::text as actor_type, e.actor_id,
            ${ACTOR_NAME_SQL("e.actor_type::text", "e.actor_id")} as actor_name,
            sum(e.minutes)::int as minutes,
            coalesce(sum(e.minutes) filter (
              where e.entry_date >= date_trunc('month', current_date)), 0)::int as month
       from ${S}.time_entries e join ${S}.tasks tk on tk.id = e.task_id
      where tk.project_id = $1
      group by e.actor_type, e.actor_id
      order by sum(e.minutes) desc, 3`,
    [project.id],
  );
  const byWorkstream = await many<{ title: string | null; minutes: number }>(
    t,
    `select w.title, sum(e.minutes)::int as minutes
       from ${S}.time_entries e
       join ${S}.tasks tk on tk.id = e.task_id
       left join ${S}.workstreams w on w.id = tk.workstream_id
      where tk.project_id = $1
      group by w.title
      order by sum(e.minutes) desc, w.title nulls last`,
    [project.id],
  );
  const perTask = await many<{
    code: string;
    title: string;
    estimate: number;
    actual: number;
  }>(
    t,
    `select tk.code, tk.title, tk.estimate_minutes as estimate, sum(e.minutes)::int as actual
       from ${S}.tasks tk join ${S}.time_entries e on e.task_id = tk.id
      where tk.project_id = $1 and tk.archived_at is null and tk.estimate_minutes is not null
      group by tk.id, tk.code, tk.title, tk.estimate_minutes`,
    [project.id],
  );
  const aiCost = await many<{ agent: string; total: number; month: number }>(
    t,
    `select ag.name as agent,
            coalesce(sum(r.cost_usd), 0)::float8 as total,
            coalesce(sum(r.cost_usd) filter (
              where r.started_at >= date_trunc('month', now())), 0)::float8 as month
       from ${S}.agent_runs r join ${S}.agents ag on ag.id = r.agent_id
      where r.project_id = $1
      group by ag.name
      order by sum(r.cost_usd) desc, ag.name`,
    [project.id],
  );
  const round = (usd: number) => Math.round(usd * 10_000) / 10_000;
  const overruns = perTask
    .filter((r) => r.actual > r.estimate * OVERRUN_RATIO)
    .sort((a, b) => b.actual - b.estimate - (a.actual - a.estimate))
    .slice(0, 10);
  return {
    project_code: project.code,
    total_minutes: totals?.total ?? 0,
    month_minutes: totals?.month ?? 0,
    by_actor: byActor.map((r) => ({
      actor: actorRef(r.actor_type, r.actor_id, r.actor_name)!,
      minutes: r.minutes,
      month_minutes: r.month,
    })),
    by_workstream: byWorkstream.map((r) => ({
      workstream: r.title,
      minutes: r.minutes,
    })),
    estimate: {
      tasks: perTask.length,
      estimated_minutes: perTask.reduce((sum, r) => sum + r.estimate, 0),
      actual_minutes: perTask.reduce((sum, r) => sum + r.actual, 0),
    },
    overruns: overruns.map((r) => ({
      code: r.code,
      title: r.title,
      estimate_minutes: r.estimate,
      actual_minutes: r.actual,
    })),
    ai_cost_usd: {
      month: round(aiCost.reduce((sum, r) => sum + Number(r.month), 0)),
      total: round(aiCost.reduce((sum, r) => sum + Number(r.total), 0)),
      by_agent: aiCost.map((r) => ({
        agent: r.agent,
        month: round(Number(r.month)),
        total: round(Number(r.total)),
      })),
    },
  };
}
