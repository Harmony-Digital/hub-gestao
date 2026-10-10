import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HubError } from "@/lib/errors";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectTaskList, type ProjectTaskList } from "@/modules/tasks/board";
import { boardColumns, toBoardCard } from "../_tasks/board-state";
import { KanbanBoard } from "../_tasks/kanban";
import { NewTaskButton } from "../_tasks/new-task";
import {
  firstParam,
  openTaskParam,
  PROJECT_CODE,
  viewHref,
} from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";
import { TaskPanel, taskHref } from "../_tasks/task-panel";
import { WorkstreamFilter } from "../_tasks/workstream-filter";

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
  const { ctx } = await pageContext();
  let data: ProjectTaskList;
  try {
    data = await inTx(ctx, (t) =>
      projectTaskList(t, code, { workstream: firstParam(query.frente) }),
    );
  } catch (err) {
    // Projeto inexistente ou fora do alcance de quem vê: a mesma página de "não achei".
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  const basePath = `/projetos/${code}/quadro`;
  const keep: Record<string, string> = data.workstream
    ? { frente: data.workstream }
    : {};
  const open = openTaskParam(query.tarefa);
  const columns = boardColumns(data.statuses, data.tasks, data.doneTotal);
  const cards = data.tasks.map((task) =>
    toBoardCard(task, data.today, taskHref(basePath, keep, task.code)),
  );

  return (
    <>
      {/* Com o painel aberto em tela larga, a página encolhe para o painel não cobrir nada. */}
      <div className={open ? "xl:pr-[36rem]" : undefined}>
        <ProjectHeader
          project={data.project}
          active="board"
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
        <main className="flex w-full min-w-0 flex-col gap-5 px-4 py-6 sm:px-8">
          <WorkstreamFilter
            basePath={basePath}
            workstreams={data.workstreams}
            active={data.workstream}
          />
          <p className="text-sm text-caption">
            Arraste as tarefas entre as colunas (no celular, toque e segure
            antes de arrastar). Concluir pede a evidência e bloquear pede o
            motivo. Toque na tarefa para ver tudo dela.
          </p>
          <KanbanBoard columns={columns} cards={cards} />
        </main>
      </div>
      {open ? (
        <TaskPanel
          projectCode={code}
          taskCode={open}
          closeHref={viewHref(basePath, data.workstream)}
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
