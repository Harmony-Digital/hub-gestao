import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight, CornerDownRight } from "lucide-react";
import { Avatar, Pill } from "@/components/shell/pill";
import { HubError } from "@/lib/errors";
import { formatDayMonth, initials } from "@/lib/format";
import { PRIORITY, STATUS_CATEGORY_TONE } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  projectTaskList,
  type ProjectTaskList,
  type StatusOption,
} from "@/modules/tasks/board";
import type { TaskDto } from "@/modules/tasks/schemas";
import { NewTaskButton } from "../_tasks/new-task";
import { ProjectHeader } from "../_tasks/project-header";
import { TaskPanel, taskHref } from "../_tasks/task-panel";

const CODE = /^[A-Z0-9]{2,8}$/;
const TASK = /^[A-Z]{2,6}-[0-9]{1,9}$/;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/lista">): Promise<Metadata> {
  const { code } = await params;
  return { title: CODE.test(code) ? `${code} · Lista` : "Lista" };
}

export default function ListaPage({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/lista">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ListView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ListView({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/lista">) {
  const { code } = await params;
  if (!CODE.test(code)) notFound();
  const query = await searchParams;
  const { ctx } = await pageContext();
  let data: ProjectTaskList;
  try {
    data = await inTx(ctx, (t) =>
      projectTaskList(t, code, { workstream: first(query.frente) }),
    );
  } catch (err) {
    // Projeto inexistente ou fora do alcance de quem vê: a mesma página de "não achei".
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  const basePath = `/projetos/${code}/lista`;
  const keep: Record<string, string> = data.workstream
    ? { frente: data.workstream }
    : {};
  const openCode = first(query.tarefa);
  const open = openCode && TASK.test(openCode) ? openCode : null;
  const listHref = (frente: string | null) =>
    frente ? `${basePath}?${new URLSearchParams({ frente })}` : basePath;
  const byStatus = new Map<string, TaskDto[]>();
  for (const task of data.tasks) {
    const group = byStatus.get(task.status.id) ?? [];
    group.push(task);
    byStatus.set(task.status.id, group);
  }
  const doneStatuses = data.statuses.filter(
    (s) => s.category === "done",
  ).length;

  return (
    <>
      {/* Com o painel aberto em tela larga, a página encolhe para o painel não cobrir nada. */}
      <div className={open ? "xl:pr-[36rem]" : undefined}>
        <ProjectHeader
          project={data.project}
          active="list"
          actions={
            <NewTaskButton
              projectCode={code}
              basePath={basePath}
              workstream={data.workstream}
              workstreams={data.workstreams}
              assignees={data.assignees}
            />
          }
        />
        <main className="flex w-full flex-col gap-5 px-4 py-6 sm:px-8">
          {data.workstreams.length > 0 ? (
            <nav
              aria-label="Filtrar por frente"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
            >
              <FilterChip href={listHref(null)} active={!data.workstream}>
                Todas as frentes
              </FilterChip>
              {data.workstreams.map((w) => (
                <FilterChip
                  key={w.id}
                  href={listHref(w.id)}
                  active={data.workstream === w.id}
                >
                  {w.title}
                </FilterChip>
              ))}
              <FilterChip
                href={listHref("none")}
                active={data.workstream === "none"}
              >
                Sem frente
              </FilterChip>
            </nav>
          ) : null}

          {data.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
              {data.workstream
                ? "Nenhuma tarefa com este filtro."
                : "Nenhuma tarefa neste projeto ainda. Use o botão Nova tarefa, ou peça a um agente para criar pelo MCP."}
            </p>
          ) : null}

          <div className="@container flex flex-col gap-3">
            {data.statuses.map((status) => {
              const tasks = byStatus.get(status.id) ?? [];
              return (
                <StatusGroup
                  key={status.id}
                  status={status}
                  tasks={tasks}
                  total={
                    status.category === "done" && doneStatuses === 1
                      ? data.doneTotal
                      : tasks.length
                  }
                  today={data.today}
                  open={open}
                  hrefFor={(c) => taskHref(basePath, keep, c)}
                />
              );
            })}
          </div>
        </main>
      </div>
      {open ? (
        <TaskPanel
          projectCode={code}
          taskCode={open}
          closeHref={listHref(data.workstream)}
          basePath={basePath}
          keep={keep}
        />
      ) : null}
    </>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors ${
        active
          ? "border-navy bg-navy text-off"
          : "border-line bg-paper text-ink-2 hover:border-mist hover:text-navy"
      }`}
    >
      {children}
    </Link>
  );
}

/** Colunas da linha em telas largas (a lista é um container: encolhe com o painel). */
const ROW_GRID =
  "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_10rem_10rem_5rem_6rem] @3xl:items-center @3xl:gap-x-4";

function StatusGroup({
  status,
  tasks,
  total,
  today,
  open,
  hrefFor,
}: {
  status: StatusOption;
  tasks: TaskDto[];
  total: number;
  today: string;
  open: string | null;
  hrefFor: (code: string) => string;
}) {
  const isDone = status.category === "done";
  return (
    <details
      open={!isDone && tasks.length > 0}
      className="group rounded-2xl border border-line bg-card"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-caption transition-transform group-open:rotate-90"
        />
        <Pill tone={STATUS_CATEGORY_TONE[status.category]}>
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ background: status.color }}
          />
          {status.name}
        </Pill>
        <span className="font-mono text-xs text-caption">{total}</span>
        {isDone && total > tasks.length ? (
          <span className="text-xs text-caption">
            mostrando as {tasks.length} mais recentes
          </span>
        ) : null}
      </summary>
      {tasks.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-caption">Nenhuma tarefa aqui.</p>
      ) : (
        <div className="border-t border-line">
          <div
            aria-hidden="true"
            className={`hidden px-4 py-2 text-xs text-caption ${ROW_GRID}`}
          >
            <span>Tarefa</span>
            <span>Frente</span>
            <span>Responsável</span>
            <span>Prazo</span>
            <span>Prioridade</span>
          </div>
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <TaskRow
                key={task.code}
                task={task}
                today={today}
                active={task.code === open}
                href={hrefFor(task.code)}
              />
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function TaskRow({
  task,
  today,
  active,
  href,
}: {
  task: TaskDto;
  today: string;
  active: boolean;
  href: string;
}) {
  const late =
    task.due_date !== null &&
    task.due_date < today &&
    task.status.category !== "done";
  const priority = PRIORITY[task.priority];
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        prefetch={false}
        aria-current={active ? "true" : undefined}
        className={`flex flex-col gap-1.5 px-4 py-2.5 text-sm transition-colors hover:bg-off ${ROW_GRID} ${
          active
            ? "bg-brand-soft/15 shadow-[inset_3px_0_0_var(--color-brand)]"
            : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-16 shrink-0 font-mono text-xs font-semibold text-caption">
            {task.code}
          </span>
          {task.parent_code ? (
            <CornerDownRight
              aria-label={`Subtarefa de ${task.parent_code}`}
              className="size-3.5 shrink-0 text-caption"
            />
          ) : null}
          <span
            className={`min-w-0 truncate ${task.status.category === "done" ? "text-ink-2 line-through decoration-mist" : "text-ink"}`}
          >
            {task.title}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-18 text-xs @3xl:contents">
          <span className="truncate text-ink-2">
            {task.workstream?.title ?? (
              <span className="text-caption @3xl:hidden">Sem frente</span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
            {task.assignee ? (
              <>
                <Avatar
                  text={initials(task.assignee.name)}
                  agent={task.assignee.type === "agent"}
                />
                <span className="truncate">{task.assignee.name}</span>
              </>
            ) : (
              <span className="text-caption">Ninguém</span>
            )}
          </span>
          <span
            className={late ? "font-semibold text-danger-fg" : "text-ink-2"}
          >
            {task.due_date ? (
              <>
                {formatDayMonth(task.due_date)}
                {late ? <span className="sr-only"> (atrasada)</span> : null}
              </>
            ) : (
              <span className="text-caption @3xl:hidden">Sem prazo</span>
            )}
          </span>
          <span>
            {task.priority !== "normal" ? (
              <Pill tone={priority.tone}>{priority.label}</Pill>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="h-24 rounded-xl bg-off-2" />
      <div className="h-12 rounded-2xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
      <div className="h-12 rounded-2xl bg-off-2" />
    </div>
  );
}
