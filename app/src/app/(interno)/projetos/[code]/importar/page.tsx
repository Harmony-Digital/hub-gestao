import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import type { ProjectDetail } from "@/modules/projects/schemas";
import { getProject } from "@/modules/projects/service";
import { PROJECT_CODE } from "../_tasks/params";
import { ImportPlanForm } from "./import-form";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/importar">): Promise<Metadata> {
  const { code } = await params;
  return {
    title: PROJECT_CODE.test(code)
      ? `${code} · Importar o plan.md`
      : "Importar o plan.md",
  };
}

export default function ImportarPlanoPage({
  params,
}: PageProps<"/projetos/[code]/importar">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 max-w-4xl rounded-2xl bg-off-2" />
        </div>
      }
    >
      <ImportPlan params={params} />
    </Suspense>
  );
}

async function ImportPlan({
  params,
}: Pick<PageProps<"/projetos/[code]/importar">, "params">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const { user, ctx } = await pageContext();
  let project: ProjectDetail;
  try {
    project = await inTx(ctx, (t) => getProject(t, code));
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const back = `/projetos/${project.code}`;
  const planPath = project.plan_path || "PLAN.md";
  const blocked = !can(user.actor, "workspace.admin")
    ? "Só o dono do workspace ou a administração importam o plano: marcos são decisão de pessoa."
    : project.status === "archived"
      ? "Projeto arquivado não recebe importação."
      : project.status === "in_review"
        ? "Este projeto está em revisão: ele passa a valer pela decisão da importação, nas Aprovações."
        : null;
  return (
    <>
      <PageHeader
        trail={[
          { label: "Projetos", href: "/projetos" },
          { label: project.name, href: back },
          { label: "Editar", href: `${back}/editar` },
          { label: "Importar o plan.md" },
        ]}
        title={`Importar o plan.md em ${project.code}`}
        description="Os marcos, as frentes e as tarefas que faltam entram no Hub, com o código e a ordem do arquivo. Nada que já existe é apagado."
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        {blocked ? (
          <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            {blocked}
          </p>
        ) : (
          <>
            <ul className="flex max-w-4xl list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
              <li>
                Marco novo entra como Planejado, Em andamento ou Entregue,
                conforme o arquivo. O aceite continua sendo pedido (Pedir
                aceite, na Visão geral) e decidido nas Aprovações.
              </li>
              <li>
                Os itens do GATE viram critérios de aceite do marco; item
                riscado não vira tarefa.
              </li>
              <li>
                Item marcado entra concluído, com a evidência escrita no item ou
                com a nota da importação.
              </li>
              <li>
                Regras completas do formato em docs/plan-md.md, no repositório
                do Hub.
              </li>
            </ul>
            <ImportPlanForm projectCode={project.code} planPath={planPath} />
          </>
        )}
      </main>
    </>
  );
}
