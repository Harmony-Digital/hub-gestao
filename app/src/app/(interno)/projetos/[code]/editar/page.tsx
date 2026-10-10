import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectFormOptions } from "@/modules/projects/admin";
import type { ProjectDetail } from "@/modules/projects/schemas";
import { getProject } from "@/modules/projects/service";
import { projectStatusesAdmin } from "@/modules/tasks/statuses";
import { ArchiveButton } from "../../../_archive/archive-controls";
import { ProjectForm } from "../../_admin/project-form";
import { PROJECT_CODE } from "../_tasks/params";
import { StatusEditor } from "./status-editor";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/editar">): Promise<Metadata> {
  const { code } = await params;
  return {
    title: PROJECT_CODE.test(code) ? `${code} · Editar` : "Editar projeto",
  };
}

export default function EditarProjetoPage({
  params,
}: PageProps<"/projetos/[code]/editar">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 max-w-4xl rounded-2xl bg-off-2" />
        </div>
      }
    >
      <EditProject params={params} />
    </Suspense>
  );
}

async function EditProject({
  params,
}: Pick<PageProps<"/projetos/[code]/editar">, "params">) {
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
  const header = (
    <PageHeader
      trail={[
        { label: "Projetos", href: "/projetos" },
        { label: project.name, href: back },
        { label: "Editar" },
      ]}
      title={`Editar ${project.code}`}
      description="Mudanças ficam registradas no histórico, com quem fez e o que mudou."
    />
  );
  const blocked = !can(user.actor, "workspace.admin")
    ? "Só o dono do workspace ou a administração editam projetos."
    : project.status === "in_review"
      ? "Este projeto está em revisão: ele passa a valer pela decisão da importação, nas Aprovações."
      : project.status === "archived"
        ? "Projeto arquivado não é editado."
        : null;
  if (blocked) {
    return (
      <>
        {header}
        <main className="px-4 py-6 sm:px-8">
          <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            {blocked}
          </p>
        </main>
      </>
    );
  }
  const { options, statuses } = await inTx(ctx, async (t) => ({
    options: await projectFormOptions(t),
    statuses: await projectStatusesAdmin(t, project.code),
  }));
  return (
    <>
      {header}
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <ProjectForm
          mode="edit"
          options={options}
          cancelHref={back}
          initial={{
            code: project.code,
            name: project.name,
            clientId: project.client.id,
            phase: project.phase,
            status: project.status,
            objectiveInternal: project.objective_internal ?? "",
            objectiveClient: project.objective_client ?? "",
            startDate: project.start_date ?? "",
            targetDate: project.target_date ?? "",
            ownerId: project.owner?.id ?? "",
            pmAgentId: project.pm_agent?.id ?? "",
            repoUrl: project.repo_url ?? "",
            planPath: project.plan_path ?? "",
            requireEvidence: project.require_evidence,
            clientCanConfirmReceipt: project.client_can_confirm_receipt,
            departments: project.departments.map((d) => d.slug),
            updatedAt: project.updated_at,
          }}
        />
        <StatusEditor projectCode={project.code} statuses={statuses} />
        <section
          aria-labelledby="arquivar-projeto"
          className="flex max-w-4xl flex-col items-start gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
        >
          <h2
            id="arquivar-projeto"
            className="font-heading text-base font-semibold text-navy"
          >
            Arquivar o projeto
          </h2>
          <p className="text-sm text-ink-2">
            O projeto sai das listas, do Hoje e do portal do cliente e para de
            receber mudanças, inclusive dos agentes. Nada é apagado: a página
            dele continua aberta para consulta, com o botão Restaurar.
          </p>
          <ArchiveButton
            target={{ entity: "project", ref: project.code }}
            label="Arquivar o projeto"
            title={`Arquivar ${project.code}?`}
            consequence="O projeto vira só consulta e some das listas. Pedidos esperando decisão nas Aprovações impedem o arquivamento: decida-os antes."
            confirmLabel="Arquivar o projeto"
          />
        </section>
      </main>
    </>
  );
}
