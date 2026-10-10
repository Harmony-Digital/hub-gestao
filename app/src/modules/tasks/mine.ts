import { authorize } from "@/lib/authorize";
import { projectScopeSql } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { TaskSummary } from "@/modules/projects/schemas";
import { TASK_SUMMARY_SELECT, toTaskSummary } from "@/modules/projects/service";

/**
 * Minhas tarefas: tudo o que está com quem vê, em todos os projetos que enxerga. As abertas
 * vêm todas (até 300), pela data; as concluídas, só as dos últimos 14 dias.
 */
export type MyTasks = {
  /** Hoje no fuso do workspace (AAAA-MM-DD). */
  today: string;
  open: TaskSummary[];
  done: TaskSummary[];
  projects: { code: string; name: string }[];
};

type Row = Parameters<typeof toTaskSummary>[0];

export async function myTasks(t: TxCtx): Promise<MyTasks> {
  authorize(t.actor, "task.read");
  const today = (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;
  if (!t.actor.id) return { today, open: [], done: [], projects: [] };

  const openParams: unknown[] = [t.actor.type, t.actor.id];
  const open = await many<Row>(
    t,
    `${TASK_SUMMARY_SELECT}
      where t.archived_at is null and t.status_category <> 'done'
        and t.assignee_type::text = $1 and t.assignee_id = $2
        and ${projectScopeSql(t.actor, "t.project_id", openParams)}
      order by t.due_date nulls last,
               case t.priority when 'urgent' then 0 when 'high' then 1
                               when 'normal' then 2 else 3 end,
               t.created_at
      limit 300`,
    openParams,
  );
  const doneParams: unknown[] = [t.actor.type, t.actor.id];
  const done = await many<Row>(
    t,
    `${TASK_SUMMARY_SELECT}
      where t.archived_at is null and t.status_category = 'done'
        and t.assignee_type::text = $1 and t.assignee_id = $2
        and t.completed_at > now() - interval '14 days'
        and ${projectScopeSql(t.actor, "t.project_id", doneParams)}
      order by t.completed_at desc
      limit 100`,
    doneParams,
  );
  const codes = [...new Set([...open, ...done].map((r) => r.project_code))];
  const projects =
    codes.length > 0
      ? await many<{ code: string; name: string }>(
          t,
          `select code, name from ${S}.projects
            where code = any($1::text[]) order by code`,
          [codes],
        )
      : [];
  return {
    today,
    open: open.map(toTaskSummary),
    done: done.map(toTaskSummary),
    projects,
  };
}

export type DueBucket = {
  key: "atrasadas" | "hoje" | "semana" | "depois" | "sem-prazo";
  label: string;
  tasks: TaskSummary[];
};

/** Soma dias a uma data AAAA-MM-DD (sem fuso: a data já é a do workspace). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Grupos pela data: atrasadas, hoje, próximos 7 dias, mais adiante e sem prazo. */
export function bucketByDue(tasks: TaskSummary[], today: string): DueBucket[] {
  const week = addDays(today, 7);
  const buckets: DueBucket[] = [
    { key: "atrasadas", label: "Atrasadas", tasks: [] },
    { key: "hoje", label: "Para hoje", tasks: [] },
    { key: "semana", label: "Próximos 7 dias", tasks: [] },
    { key: "depois", label: "Mais adiante", tasks: [] },
    { key: "sem-prazo", label: "Sem prazo", tasks: [] },
  ];
  const pick = (key: DueBucket["key"]) => buckets.find((b) => b.key === key)!;
  for (const task of tasks) {
    const due = task.due_date;
    if (!due) pick("sem-prazo").tasks.push(task);
    else if (due < today) pick("atrasadas").tasks.push(task);
    else if (due === today) pick("hoje").tasks.push(task);
    else if (due <= week) pick("semana").tasks.push(task);
    else pick("depois").tasks.push(task);
  }
  return buckets.filter((b) => b.tasks.length > 0);
}
