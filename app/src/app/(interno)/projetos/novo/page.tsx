import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectFormOptions } from "@/modules/projects/admin";
import { listTemplates } from "@/modules/templates/service";
import { ProjectForm } from "../_admin/project-form";

export const metadata: Metadata = { title: "Novo projeto" };

export default function NovoProjetoPage() {
  return (
    <>
      <PageHeader
        trail={[
          { label: "Projetos", href: "/projetos" },
          { label: "Novo projeto" },
        ]}
        title="Novo projeto"
        description="O projeto nasce com os status padrão da Harmony (A fazer, Em andamento, Em revisão, Bloqueada e Concluída). Com um modelo, ele abre na importação com o esqueleto (marcos, frentes e tarefas), para ver o que entra antes de gravar; sem modelo, marcos e frentes você cria depois, na página do projeto."
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="h-96 max-w-4xl rounded-2xl bg-off-2"
            />
          }
        >
          <NewProject />
        </Suspense>
      </main>
    </>
  );
}

async function NewProject() {
  const { user, ctx } = await pageContext();
  if (!can(user.actor, "workspace.admin")) {
    return (
      <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
        Só o dono do workspace ou a administração cadastram projetos.
      </p>
    );
  }
  const options = await inTx(ctx, async (t) => ({
    ...(await projectFormOptions(t)),
    templates: (await listTemplates(t)).map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      departments: tpl.departments.map((d) => d.slug),
    })),
  }));
  return (
    <ProjectForm
      mode="create"
      options={options}
      cancelHref="/projetos"
      initial={{
        code: "",
        name: "",
        clientId: "",
        phase: "descobrir",
        status: "discovery",
        objectiveInternal: "",
        objectiveClient: "",
        startDate: "",
        targetDate: "",
        ownerId: user.actor.type === "user" ? (user.actor.id ?? "") : "",
        pmAgentId: "",
        repoUrl: "",
        planPath: "",
        requireEvidence: true,
        clientCanConfirmReceipt: false,
        departments: [],
        updatedAt: "",
      }}
    />
  );
}
