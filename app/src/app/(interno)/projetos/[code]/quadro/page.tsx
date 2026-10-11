import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HubError } from "@/lib/errors";
import { can } from "@/lib/authorize";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectTaskList, type ProjectTaskList } from "@/modules/tasks/board";
import {
  departmentViews,
  listSavedViews,
  type DepartmentViewDto,
  type SavedViewDto,
} from "@/modules/views/service";
import { projectChangeMarker } from "@/modules/live";
import { LiveRefresh } from "../../../_live/live-refresh";
import {
  boardColumns,
  boardLanes,
  sortForBoard,
  toBoardCard,
} from "../_tasks/board-state";
import { KanbanBoard } from "../_tasks/kanban";
import { ListToolbar } from "../_tasks/list-toolbar";
import {
  departmentViewQuery,
  hasFilters,
  listQuery,
  readListState,
  stateFor,
  toTaskFilter,
} from "../_tasks/list-state";
import { NewTaskButton } from "../_tasks/new-task";
import { openTaskParam, PROJECT_CODE } from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";
import { SavedViews } from "../_tasks/saved-views";
import { TaskPanel, taskHref } from "../_tasks/task-panel";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/quadro">): Promise<Metadata> {
  const { code } = await params;
  return { title: PROJECT_CODE.test(code) ? `${code} · Quadro` : "Quadro" };
}

export default function QuadroPage({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/quadro">) {
  return (
    <Suspense fallback={<BoardSkeleton />}>
      <BoardView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BoardView({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/quadro">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const query = await searchParams;
  // O Quadro usa só os filtros e as raias (agrupar, ordem e colunas são da Lista).
  const state = stateFor("board", readListState(query));
  const { user, ctx } = await pageContext();
  let data: ProjectTaskList;
  let views: SavedViewDto[];
  let deptViews: DepartmentViewDto[];
  let marker: string;
  try {
    ({ data, views, deptViews, marker } = await inTx(ctx, async (t) => {
      const list = await projectTaskList(t, code, toTaskFilter(state));
      return {
        data: list,
        views: await listSavedViews(t, list.project.id, "board"),
        deptViews: await departmentViews(t, list.departments, "board"),
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

  const basePath = `/projetos/${code}/quadro`;
  const current = listQuery(state);
  const keep = Object.fromEntries(current);
  const open = openTaskParam(query.tarefa);
  const columns = boardColumns(data.statuses, data.tasks, data.doneTotal);
  const cards = sortForBoard(
    data.tasks.map((task) =>
      toBoardCard(
        task,
        data.today,
        taskHref(basePath, keep, task.code),
        data.waitingOn[task.code],
      ),
    ),
  );
  // Raias só quando há cartão; sem nenhum, o quadro único mostra as colunas vazias.
  const laneBy = state.raia === "nenhuma" ? null : state.raia;
  const lanes = laneBy
    ? boardLanes(
        cards,
        laneBy,
        data.workstreams.map((w) => w.id),
      )
    : [];

  return (
    <>
      {/* Com o painel aberto em tela larga, a página encolhe para o painel não cobrir nada. */}
      <div className={open ? "xl:pr-[36rem]" : undefined}>
        <ProjectHeader
          project={data.project}
          active="board"
          canRestore={can(user.actor, "workspace.admin")}
          actions={
            // Projeto arquivado é só consulta: sem Nova tarefa.
            data.project.status === "archived" ? undefined : (
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
        <main className="flex w-full min-w-0 flex-col gap-5 px-4 py-6 sm:px-8">
          <LiveRefresh src={`/projetos/${code}/mudancas`} marker={marker} />
          <SavedViews
            projectCode={code}
            type="board"
            basePath={basePath}
            views={views}
            departments={deptViews.map((d) => ({
              ...d,
              query: departmentViewQuery("board", d.slug, d.stored),
              custom: d.stored !== null,
            }))}
            currentDepartment={data.department}
            currentQuery={current.toString()}
          />
          <ListToolbar
            basePath={basePath}
            state={state}
            departments={data.departments}
            workstreams={data.workstreams}
            assignees={data.assignees}
            mode="board"
          />
          {hasFilters(state) && data.tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
              Nenhuma tarefa com estes filtros.
            </p>
          ) : null}
          <p className="text-sm text-caption">
            Arraste as tarefas entre as colunas ou solte uma sobre outra para
            mudar a ordem (no celular, toque e segure antes de arrastar).
            Concluir pede a evidência e bloquear pede o motivo. Toque na tarefa
            para ver tudo dela.
          </p>
          <KanbanBoard
            projectCode={code}
            columns={columns}
            cards={cards}
            lanes={lanes.length ? lanes : null}
            laneBy={lanes.length ? laneBy : null}
            assignees={data.assignees}
          />
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

function BoardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="h-24 rounded-xl bg-off-2" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-72 w-72 shrink-0 rounded-2xl bg-off-2" />
        ))}
      </div>
    </div>
  );
}
