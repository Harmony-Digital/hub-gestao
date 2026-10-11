import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import type { ProjectDetail } from "@/modules/projects/schemas";
import { NO_PLANNER, plannerAgent } from "@/modules/planner/service";
import { getProject } from "@/modules/projects/service";
import { listTemplates, type TemplateDto } from "@/modules/templates/service";
import { PROJECT_CODE } from "../_tasks/params";
import { ImportArea } from "./import-area";

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
  searchParams,
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
      <ImportPlan params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ImportPlan({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/importar">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const query = await searchParams;
  const chosen = typeof query.modelo === "string" ? query.modelo : null;
  const { user, ctx } = await pageContext();
  let project: ProjectDetail;
  let planner: string | null;
  let templates: TemplateDto[];
  try {
    [project, planner, templates] = await inTx(ctx, async (t) => {
      const found = await getProject(t, code);
      // O Planejador (PL-11): pronto, ou o motivo de não estar ligado.
      const agent = await plannerAgent(t);
      return [
        found,
        !agent
          ? NO_PLANNER
          : agent.configured
            ? null
            : `O Planejador (${agent.name}) ainda não tem modelo de IA: escolha em Modelo de IA, na Sala de Controle.`,
        can(user.actor, "workspace.admin") ? await listTemplates(t) : [],
      ] as const;
    });
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const back = `/projetos/${project.code}`;
  const template = templates.find((tpl) => tpl.id === chosen) ?? null;
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
        title={
          template
            ? `Último passo: importar o modelo em ${project.code}`
            : `Importar o plan.md em ${project.code}`
        }
        description={
          template
            ? `Os marcos, as frentes e as tarefas do modelo “${template.name}” só entram no projeto quando você clicar em Importar. Confira o que entra logo abaixo.`
            : "Os marcos, as frentes e as tarefas que faltam entram no Hub, com o código e a ordem do arquivo. Nada que já existe é apagado."
        }
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        {blocked ? (
          <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            {blocked}
          </p>
        ) : (
          <>
            {/* As regras do formato são para quem cola um plan.md; com um modelo, o
                que importa é o botão Importar, logo no começo. */}
            <ul
              hidden={Boolean(template)}
              className="flex max-w-4xl list-disc flex-col gap-1 pl-5 text-sm text-ink-2"
            >
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
            <ImportArea
              key={chosen ?? "-"}
              projectCode={project.code}
              planPath={planPath}
              planner={planner}
              templates={templates.map((tpl) => ({
                id: tpl.id,
                name: tpl.name,
              }))}
              template={template}
            />
          </>
        )}
      </main>
    </>
  );
}
