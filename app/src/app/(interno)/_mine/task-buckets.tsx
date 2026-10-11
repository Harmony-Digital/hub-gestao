import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Pill } from "@/components/shell/pill";
import { formatDayMonth } from "@/lib/format";
import { PRIORITY, STATUS_CATEGORY_TONE } from "@/lib/labels";
import type { TaskSummary } from "@/modules/projects/schemas";
import { bucketByDue, type MyTasks } from "@/modules/tasks/mine";

/**
 * As tarefas de alguém, pela data (atrasadas, hoje, 7 dias, depois, sem prazo) e as
 * concluídas nos últimos 14 dias. Usada em Minhas tarefas e em "Tarefas de" (RF-38).
 */
export function TaskBuckets({
  data,
  empty,
}: {
  data: MyTasks;
  /** Frase quando não há tarefa aberta. */
  empty: string;
}) {
  const groups = bucketByDue(data.open, data.today);
  const names = new Map(data.projects.map((p) => [p.code, p.name]));
  const late = groups.find((g) => g.key === "atrasadas")?.tasks.length ?? 0;
  const doing = data.open.filter(
    (task) => task.status_category === "in_progress",
  ).length;

  return (
    <>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <span>
          <span className="font-semibold text-navy">{data.open.length}</span>{" "}
          {data.open.length === 1 ? "aberta" : "abertas"}
        </span>
        <span>
          <span className="font-semibold text-navy">{doing}</span> em andamento
        </span>
        <span className={late > 0 ? "text-danger-fg" : undefined}>
          <span className="font-semibold">{late}</span>{" "}
          {late === 1 ? "atrasada" : "atrasadas"}
        </span>
      </p>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-ink-2">
          {empty}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            aria-labelledby={`grupo-${group.key}`}
            className="flex flex-col gap-2"
          >
            <h2
              id={`grupo-${group.key}`}
              className={`flex items-center gap-2 font-heading text-base font-semibold ${
                group.key === "atrasadas" ? "text-danger-fg" : "text-navy"
              }`}
            >
              {group.label}
              <span className="font-mono text-xs font-normal text-caption">
                {group.tasks.length}
              </span>
            </h2>
            <TaskRows tasks={group.tasks} names={names} today={data.today} />
          </section>
        ))
      )}

      {data.done.length > 0 ? (
        <details className="group rounded-xl border border-line bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-heading text-base font-semibold text-navy [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-90"
            />
            Concluídas nos últimos 14 dias
            <span className="font-mono text-xs font-normal text-caption">
              {data.done.length}
            </span>
          </summary>
          <div className="px-2 pb-2">
            <TaskRows tasks={data.done} names={names} today={data.today} />
          </div>
        </details>
      ) : null}
    </>
  );
}

function TaskRows({
  tasks,
  names,
  today,
}: {
  tasks: TaskSummary[];
  names: Map<string, string>;
  today: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-card">
      {tasks.map((task) => {
        const done = task.status_category === "done";
        const overdue =
          !done && task.due_date !== null && task.due_date < today;
        const priority = PRIORITY[task.priority];
        return (
          <li key={task.code}>
            <Link
              href={`/projetos/${task.project_code}/lista?tarefa=${task.code}`}
              prefetch={false}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-off-2/60"
            >
              <span className="font-mono text-xs text-caption">
                {task.code}
              </span>
              <span
                className={`min-w-0 flex-1 basis-56 text-sm ${
                  done ? "text-ink-2 line-through" : "font-medium text-ink"
                }`}
              >
                {task.title}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className="font-mono text-xs text-ink-2"
                  title={names.get(task.project_code)}
                >
                  {task.project_code}
                </span>
                <Pill tone={STATUS_CATEGORY_TONE[task.status_category]}>
                  {task.status_name}
                </Pill>
                {task.priority === "urgent" || task.priority === "high" ? (
                  <Pill tone={priority.tone}>{priority.label}</Pill>
                ) : null}
                {task.due_date ? (
                  <span
                    className={`text-xs ${overdue ? "font-semibold text-danger-fg" : "text-ink-2"}`}
                  >
                    {overdue ? "venceu " : ""}
                    {formatDayMonth(task.due_date)}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className="h-6 w-64 rounded bg-off-2" />
      <div className="h-40 rounded-xl bg-off-2" />
    </div>
  );
}
