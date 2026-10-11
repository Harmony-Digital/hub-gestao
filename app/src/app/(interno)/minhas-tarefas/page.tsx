import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { myTasks } from "@/modules/tasks/mine";
import { ListSkeleton, TaskBuckets } from "../_mine/task-buckets";

export const metadata: Metadata = { title: "Minhas tarefas" };

export default function MinhasTarefasPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Minhas tarefas" }]}
        title="Minhas tarefas"
        description="Tudo o que está com você, em todos os projetos, pela data. Toque numa tarefa para abrir o painel dela no projeto."
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense fallback={<ListSkeleton />}>
          <MyTasksView />
        </Suspense>
      </main>
    </>
  );
}

async function MyTasksView() {
  const { ctx } = await pageContext();
  const data = await inTx(ctx, (t) => myTasks(t));
  return (
    <TaskBuckets data={data} empty="Nenhuma tarefa aberta com você agora." />
  );
}
