import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, CornerDownRight } from "lucide-react";
import { Avatar, Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
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
import { listSavedViews, type SavedViewDto } from "@/modules/views/service";
import { projectChangeMarker } from "@/modules/live";
import { LiveRefresh } from "../../../_live/live-refresh";
import {
  AssigneeCell,
  DueCell,
  PriorityCell,
  StatusCell,
} from "../_tasks/inline-edit";
import { ListToolbar } from "../_tasks/list-toolbar";
import {
  groupTasks,
  hasFilters,
  listQuery,
  readListState,
  sortTasks,
  toTaskFilter,
  type Column,
} from "../_tasks/list-state";
import { NewTaskButton } from "../_tasks/new-task";
import { openTaskParam, PROJECT_CODE } from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";
import { SavedViews } from "../_tasks/saved-views";
import { TaskPanel, taskHref } from "../_tasks/task-panel";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/lista">): Promise<Metadata> {
  const { code } = await params;
  return { title: PROJECT_CODE.test(code) ? `${code} · Lista` : "Lista" };
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

/** Larguras das colunas extras (a do título ocupa o resto). */
const WIDTH: Record<Column | "status", string> = {
  status: "9rem",
  frente: "10rem",
  responsavel: "11rem",
  prazo: "8.5rem",
  prioridade: "7rem",
};

const HEADER: Record<Column | "status", string> = {
  status: "Status",
  frente: "Frente",
  responsavel: "Responsável",
  prazo: "Prazo",
  prioridade: "Prioridade",
};

async function ListView({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/lista">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const query = await searchParams;
  const state = readListState(query);
  const { user, ctx } = await pageContext();
  let data: ProjectTaskList;
  let views: SavedViewDto[];
  let marker: string;
  try {
    ({ data, views, marker } = await inTx(ctx, async (t) => {
      const list = await projectTaskList(t, code, toTaskFilter(state));
      return {
        data: list,
        views: await listSavedViews(t, list.project.id, "list"),
        marker: await projectChangeMarker(t, code),
      };
    }));
  } catch (err) {
    // Projeto inexistente ou fora do alcance de quem vê: a mesma página de "não achei".
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  const basePath = `/projetos/${code}/lista`;
  const current = listQuery(state);
  const keep = Object.fromEntries(current);
  const open = openTaskParam(query.tarefa);
  const archived = data.project.status === "archived";
  const editable = !archived && can(user.actor, "task.write");
  const columns: (Column | "status")[] = [
    ...(state.agrupar === "status" ? [] : (["status"] as const)),
    ...state.colunas,
  ];
  const grid = {
    "--cols": ["minmax(0,1fr)", ...columns.map((c) => WIDTH[c])].join(" "),
  } as CSSProperties;
  const tasks = sortTasks(data.tasks, state.ordem);
  const rowProps = {
    columns,
    grid,
    today: data.today,
    open,
    editable,
    statuses: data.statuses,
    assignees: data.assignees,
    hrefFor: (c: string) => taskHref(basePath, keep, c),
  };

  return (
    <>
      {/* Com o painel aberto em tela larga, a página encolhe para o painel não cobrir nada. */}
      <div className={open ? "xl:pr-[36rem]" : undefined}>
        <ProjectHeader
          project={data.project}
          active="list"
          canRestore={can(user.actor, "workspace.admin")}
          actions={
            // Projeto arquivado é só consulta: sem Nova tarefa.
            archived ? undefined : (
              <NewTaskButton
                projectCode={code}
                basePath={basePath}
                workstream={data.workstream}
                workstreams={data.workstreams}
                assignees={data.assignees}
              />
            )
          }
        />
        <main className="flex w-full flex-col gap-4 px-4 py-6 sm:px-8">
          <LiveRefresh src={`/projetos/${code}/mudancas`} marker={marker} />
          <SavedViews
            projectCode={code}
            type="list"
            basePath={basePath}
            views={views}
            currentQuery={current.toString()}
          />
          <ListToolbar
            basePath={basePath}
            state={state}
            workstreams={data.workstreams}
            assignees={data.assignees}
            mode="list"
          />

          {data.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
              {hasFilters(state)
                ? "Nenhuma tarefa com estes filtros."
                : "Nenhuma tarefa neste projeto ainda. Use o botão Nova tarefa, ou peça a um agente para criar pelo MCP."}
            </p>
          ) : null}

          <div className="@container flex flex-col gap-3">
            {state.agrupar === "status"
              ? data.statuses.map((status) => {
                  const list = tasks.filter((t) => t.status.id === status.id);
                  const doneStatuses = data.statuses.filter(
                    (s) => s.category === "done",
                  ).length;
                  return (
                    <Group
                      key={status.id}
                      label={<StatusLabel status={status} />}
                      tasks={list}
                      total={
                        status.category === "done" &&
                        doneStatuses === 1 &&
                        !hasFilters(state)
                          ? data.doneTotal
                          : list.length
                      }
                      closed={status.category === "done" || list.length === 0}
                      {...rowProps}
                    />
                  );
                })
              : groupTasks(tasks, state.agrupar, data.workstreams).map((g) => (
                  <Group
                    key={g.key}
                    label={
                      <span className="text-sm font-semibold text-navy">
                        {g.label}
                      </span>
                    }
                    tasks={g.tasks}
                    total={g.tasks.length}
                    closed={g.done}
                    {...rowProps}
                  />
                ))}
          </div>
        </main>
      </div>
      {open ? (
        <TaskPanel
          projectCode={code}
          taskCode={open}
          closeHref={current.size ? `${basePath}?${current}` : basePath}
          basePath={basePath}
          keep={keep}
        />
      ) : null}
    </>
  );
}

function StatusLabel({ status }: { status: StatusOption }) {
  return (
    <Pill tone={STATUS_CATEGORY_TONE[status.category]}>
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ background: status.color }}
      />
      {status.name}
    </Pill>
  );
}

type RowProps = {
  columns: (Column | "status")[];
  grid: CSSProperties;
  today: string;
  open: string | null;
  editable: boolean;
  statuses: ProjectTaskList["statuses"];
  assignees: ProjectTaskList["assignees"];
  hrefFor: (code: string) => string;
};

/** Grade das colunas em telas largas (a lista é um container: encolhe com o painel). */
const ROW_GRID =
  "@3xl:grid @3xl:[grid-template-columns:var(--cols)] @3xl:items-center @3xl:gap-x-3";

function Group({
  label,
  tasks,
  total,
  closed,
  ...row
}: RowProps & {
  label: ReactNode;
  tasks: TaskDto[];
  total: number;
  closed: boolean;
}) {
  return (
    <details
      open={!closed && tasks.length > 0}
      className="group rounded-2xl border border-line bg-card"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-caption transition-transform group-open:rotate-90"
        />
        {label}
        <span className="font-mono text-xs text-caption">{total}</span>
        {total > tasks.length ? (
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
            style={row.grid}
            className={`hidden px-4 py-2 text-xs text-caption ${ROW_GRID}`}
          >
            <span>Tarefa</span>
            {row.columns.map((c) => (
              <span key={c}>{HEADER[c]}</span>
            ))}
          </div>
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <TaskRow key={task.code} task={task} {...row} />
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function TaskRow({
  task,
  columns,
  grid,
  today,
  open,
  editable,
  statuses,
  assignees,
  hrefFor,
}: RowProps & { task: TaskDto }) {
  const late =
    task.due_date !== null &&
    task.due_date < today &&
    task.status.category !== "done";
  const priority = PRIORITY[task.priority];
  const base = { code: task.code, version: task.version };
  const assignee = task.assignee
    ? `${task.assignee.type}:${task.assignee.id}`
    : "";
  const cell = (c: Column | "status") => {
    switch (c) {
      case "status":
        return editable ? (
          <StatusCell
            {...base}
            statusId={task.status.id}
            statuses={statuses}
            panelHref={hrefFor(task.code)}
          />
        ) : (
          <Pill tone={STATUS_CATEGORY_TONE[task.status.category]}>
            {task.status.name}
          </Pill>
        );
      case "frente":
        return (
          <span className="truncate text-xs text-ink-2">
            {task.workstream?.title ?? (
              <span className="text-caption">Sem frente</span>
            )}
          </span>
        );
      case "responsavel":
        return editable ? (
          <span className="flex min-w-0 items-center gap-1">
            {task.assignee ? (
              <Avatar
                text={initials(task.assignee.name)}
                agent={task.assignee.type === "agent"}
              />
            ) : null}
            <AssigneeCell {...base} assignee={assignee} options={assignees} />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
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
        );
      case "prazo":
        return editable ? (
          <DueCell {...base} due={task.due_date} late={late} />
        ) : (
          <span
            className={`text-xs ${late ? "font-semibold text-danger-fg" : "text-ink-2"}`}
          >
            {task.due_date ? formatDayMonth(task.due_date) : "Sem prazo"}
          </span>
        );
      case "prioridade":
        return editable ? (
          <PriorityCell {...base} priority={task.priority} />
        ) : task.priority !== "normal" ? (
          <Pill tone={priority.tone}>{priority.label}</Pill>
        ) : (
          <span className="text-xs text-caption">Normal</span>
        );
    }
  };

  return (
    <li
      style={grid}
      aria-current={task.code === open ? "true" : undefined}
      className={`flex flex-col gap-1.5 px-4 py-2 text-sm transition-colors hover:bg-off ${ROW_GRID} ${
        task.code === open
          ? "bg-brand-soft/15 shadow-[inset_3px_0_0_var(--color-brand)]"
          : ""
      }`}
    >
      <Link
        href={hrefFor(task.code)}
        scroll={false}
        prefetch={false}
        className="flex min-w-0 items-center gap-2 hover:underline"
      >
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
      </Link>
      {columns.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-18 @3xl:contents">
          {columns.map((c) => (
            // A versão na chave remonta a célula quando a tarefa muda (valor sempre o atual).
            <div key={`${c}-${task.version}`} className="min-w-0">
              {cell(c)}
            </div>
          ))}
        </div>
      ) : null}
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
