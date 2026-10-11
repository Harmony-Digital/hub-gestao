import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { formatTimestampDate } from "@/lib/format";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { departmentOptions } from "@/modules/projects/admin";
import { listTemplates, type TemplateDto } from "@/modules/templates/service";
import { RemoveTemplateButton, TemplateButton } from "./template-dialog";

export const metadata: Metadata = { title: "Modelos de projeto" };

export default function ModelosPage() {
  return (
    <>
      <PageHeader
        trail={[
          { label: "Projetos", href: "/projetos" },
          { label: "Modelos de projeto" },
        ]}
        title="Modelos de projeto"
        description="Esqueletos para começar um projeto: marcos, frentes com o departamento, tarefas e critérios de aceite. Use em Novo projeto ou na tela Importar o plan.md; a prévia mostra tudo antes de gravar."
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-96 rounded-2xl bg-off-2" />
          }
        >
          <Templates />
        </Suspense>
      </main>
    </>
  );
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

async function Templates() {
  const { user, ctx } = await pageContext();
  if (!can(user.actor, "workspace.admin")) {
    return (
      <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
        Os modelos de projeto são do dono do workspace e da administração.
      </p>
    );
  }
  const { templates, departments } = await inTx(ctx, async (t) => ({
    templates: await listTemplates(t),
    departments: await departmentOptions(t),
  }));
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-ink-2">
          Os seis modelos iniciais da Harmony são um ponto de partida: ajuste à
          vontade. Para guardar a estrutura de um projeto que deu certo, use
          “Salvar como modelo” no Editar projeto.
        </p>
        <TemplateButton departments={departments} />
      </div>
      {templates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-ink-2">
          Nenhum modelo ainda. Crie o primeiro em Novo modelo.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {templates.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              departments={departments}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function TemplateCard({
  template: tpl,
  departments,
}: {
  template: TemplateDto;
  departments: { slug: string; name: string }[];
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold text-navy">
            {tpl.name}
          </h2>
          <p className="text-xs text-ink-2">
            Versão {tpl.version} · atualizado em{" "}
            {formatTimestampDate(tpl.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <TemplateButton
            departments={departments}
            template={{
              id: tpl.id,
              name: tpl.name,
              description: tpl.description,
              markdown: tpl.markdown,
              departments: tpl.departments.map((d) => d.slug),
            }}
          />
          <RemoveTemplateButton id={tpl.id} name={tpl.name} />
        </div>
      </div>
      {tpl.description ? (
        <p className="text-sm text-ink">{tpl.description}</p>
      ) : null}
      <p className="text-sm text-ink-2">
        {plural(tpl.counts.milestones, "marco", "marcos")} ·{" "}
        {plural(tpl.counts.workstreams, "frente", "frentes")} ·{" "}
        {plural(tpl.counts.tasks, "tarefa", "tarefas")}
        {tpl.counts.subtasks > 0
          ? ` · ${plural(tpl.counts.subtasks, "subtarefa", "subtarefas")}`
          : ""}
      </p>
      {tpl.statuses ? (
        <p className="text-sm text-ink-2">
          Status das tarefas: {tpl.statuses.map((st) => st.name).join(", ")}.
        </p>
      ) : null}
      {tpl.client ? (
        <p className="text-sm text-ink-2">
          Textos para o cliente:{" "}
          {[
            tpl.client.objective ? "o objetivo" : null,
            Object.keys(tpl.client.milestones).length
              ? plural(
                  Object.keys(tpl.client.milestones).length,
                  "marco",
                  "marcos",
                )
              : null,
            Object.keys(tpl.client.workstreams).length
              ? plural(
                  Object.keys(tpl.client.workstreams).length,
                  "frente",
                  "frentes",
                )
              : null,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      ) : null}
      {tpl.departments.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Departamentos">
          {tpl.departments.map((d) => (
            <li key={d.slug}>
              <Pill tone="neutral">{d.name}</Pill>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">
          Ver o esqueleto
        </summary>
        <pre className="relative mt-2 max-h-80 overflow-auto rounded-xl bg-off p-3 font-mono text-xs whitespace-pre-wrap text-ink">
          {tpl.markdown}
        </pre>
      </details>
      <p className="text-xs text-ink-2">
        Para usar: em{" "}
        <Link
          href="/projetos/novo"
          className="font-semibold text-brand-strong hover:text-navy"
        >
          Novo projeto
        </Link>
        , escolha o modelo; o projeto abre na importação com o esqueleto.
      </p>
    </li>
  );
}
