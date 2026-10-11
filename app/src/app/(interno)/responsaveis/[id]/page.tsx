import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ROLE_LABEL } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { responsibleOf, tasksOf, type Responsible } from "@/modules/tasks/mine";
import { ListSkeleton, TaskBuckets } from "../../_mine/task-buckets";

export const metadata: Metadata = { title: "Tarefas do responsável" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Tarefas de": o que está com uma pessoa ou um agente, em todos os projetos que quem vê
 * enxerga, pela data. Chega pela busca ⌘K (RF-38); é a carga dela, para decidir quem pega
 * a próxima.
 */
export default function ResponsavelPage({
  params,
}: PageProps<"/responsaveis/[id]">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-16 w-80 rounded-xl bg-off-2" />
          <ListSkeleton />
        </div>
      }
    >
      <ResponsibleView params={params} />
    </Suspense>
  );
}

function describe(who: Responsible): string {
  if (who.type === "user") {
    const role = Object.hasOwn(ROLE_LABEL, who.role)
      ? ROLE_LABEL[who.role as keyof typeof ROLE_LABEL]
      : who.role;
    return `${role}. O que está com ${who.name} em todos os projetos que você vê, pela data. Toque numa tarefa para abrir o painel dela no projeto.`;
  }
  const where = who.department ? `Agente de ${who.department}` : "Agente";
  const paused = who.role === "paused" ? " (pausado)" : "";
  return `${where}${paused}. O que está com ${who.name} em todos os projetos que você vê, pela data. Toque numa tarefa para abrir o painel dela no projeto.`;
}

async function ResponsibleView({
  params,
}: Pick<PageProps<"/responsaveis/[id]">, "params">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ctx } = await pageContext();
  const found = await inTx(ctx, async (t) => {
    const who = await responsibleOf(t, id);
    return who ? { who, data: await tasksOf(t, who) } : null;
  });
  if (!found) notFound();
  const { who, data } = found;
  return (
    <>
      <PageHeader
        trail={[{ label: "Tarefas de" }, { label: who.name }]}
        title={`Tarefas de ${who.name}`}
        description={describe(who)}
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        {who.type === "agent" ? (
          <p className="text-sm">
            <Link
              href={`/agentes?agente=${who.id}`}
              className="font-medium text-navy underline underline-offset-2"
            >
              Ver o que {who.name} fez na Sala de Controle
            </Link>
          </p>
        ) : null}
        <TaskBuckets
          data={data}
          empty={`Nenhuma tarefa aberta com ${who.name} nos projetos que você vê.`}
        />
      </main>
    </>
  );
}
