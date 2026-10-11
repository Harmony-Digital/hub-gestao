import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Avatar, Pill, Progress } from "@/components/shell/pill";
import { PageHeader } from "@/components/shell/page-header";
import { HubError } from "@/lib/errors";
import { formatDayMonth, initials } from "@/lib/format";
import { STATUS_CATEGORY_TONE, WORKSTREAM_STATUS } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  departmentDetail,
  type DepartmentDetail,
} from "@/modules/departments/view";
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL,
} from "@/modules/tasks/status-categories";

export const metadata: Metadata = { title: "Departamento" };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const COLUMN_LABEL: Record<(typeof STATUS_CATEGORIES)[number], string> = {
  ...STATUS_CATEGORY_LABEL,
  blocked: "Bloqueadas",
  done: "Concluídas na semana",
};

export default function DepartamentoPage({
  params,
}: PageProps<"/departamentos/[slug]">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <DepartmentView params={params} />
    </Suspense>
  );
}

async function DepartmentView({
  params,
}: Pick<PageProps<"/departamentos/[slug]">, "params">) {
  const { slug } = await params;
  if (slug.length > 80 || !SLUG.test(slug)) notFound();
  const { ctx } = await pageContext();
  let data: DepartmentDetail;
  try {
    data = await inTx(ctx, (t) => departmentDetail(t, slug));
  } catch (err) {
    if (err instanceof HubError && err.status === 404) notFound();
    throw err;
  }
  const { department: d, tasks, load, workstreams, views } = data;
  const unassigned = tasks.filter(
    (t) => !t.assignee && t.status_category !== "done",
  ).length;
  // Os projetos com frente do departamento, na ordem da lista de frentes.
  const projects = [
    ...new Map(
      workstreams.map((w) => [
        w.projectCode,
        { code: w.projectCode, name: w.projectName },
      ]),
    ).values(),
  ];
  const listView = views.list ?? `depto=${d.slug}`;
  const boardView = views.board ?? `depto=${d.slug}`;
  return (
    <>
      <PageHeader
        trail={[
          { label: "Departamentos", href: "/departamentos" },
          { label: d.name },
        ]}
        title={d.name}
        description={`${d.lead ? `Responsável: ${d.lead}. ` : ""}As tarefas das frentes deste departamento em todos os projetos ativos. Abra uma tarefa para mudar o que for preciso.`}
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        {projects.length > 0 ? (
          <section
            aria-labelledby="nos-projetos"
            className="flex flex-col gap-2"
          >
            <h2
              id="nos-projetos"
              className="font-heading text-lg font-semibold text-navy"
            >
              Nos projetos
            </h2>
            <p className="text-sm text-ink-2">
              A visão padrão de {d.name} na Lista e no Quadro de cada projeto:
              só as tarefas das frentes do departamento
              {views.list || views.board
                ? ", com o que o departamento guardou como padrão"
                : ""}
              .
            </p>
            <ul className="flex flex-wrap gap-2">
              {projects.map((p) => (
                <li
                  key={p.code}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-card px-3 py-2 text-sm"
                >
                  <span className="font-mono text-xs font-semibold text-ink-2">
                    {p.code}
                  </span>
                  <span className="break-words text-navy">{p.name}</span>
                  <Link
                    href={`/projetos/${p.code}/lista?${listView}`}
                    aria-label={`Lista de ${p.code} na visão de ${d.name}`}
                    className="font-medium text-navy underline underline-offset-2"
                  >
                    Lista
                  </Link>
                  <Link
                    href={`/projetos/${p.code}/quadro?${boardView}`}
                    aria-label={`Quadro de ${p.code} na visão de ${d.name}`}
                    className="font-medium text-navy underline underline-offset-2"
                  >
                    Quadro
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section
          aria-labelledby="quadro-departamento"
          className="flex flex-col gap-3"
        >
          <h2
            id="quadro-departamento"
            className="font-heading text-lg font-semibold text-navy"
          >
            Quadro{" "}
            {unassigned > 0 ? (
              <span className="ml-2 text-sm font-normal text-danger-fg">
                {unassigned === 1
                  ? "1 tarefa sem responsável"
                  : `${unassigned} tarefas sem responsável`}
              </span>
            ) : null}
          </h2>
          <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="grid min-w-[60rem] grid-cols-5 gap-3">
              {STATUS_CATEGORIES.map((category) => {
                const items = tasks.filter(
                  (t) => t.status_category === category,
                );
                return (
                  <section
                    key={category}
                    aria-label={`${COLUMN_LABEL[category]}: ${items.length}`}
                    className="flex flex-col gap-2 rounded-2xl bg-off p-2"
                  >
                    <p className="flex items-center justify-between px-1 text-xs font-semibold tracking-[0.06em] text-caption uppercase">
                      {COLUMN_LABEL[category]}
                      <span className="font-mono">{items.length}</span>
                    </p>
                    <ul className="flex flex-col gap-2">
                      {items.map((task) => (
                        <li
                          key={task.code}
                          className="flex flex-col gap-1 rounded-xl border border-line bg-card p-2.5 text-sm"
                        >
                          <span className="flex items-center gap-2 font-mono text-xs text-caption">
                            {task.code} · {task.project_code}
                          </span>
                          <Link
                            href={`/projetos/${task.project_code}?tarefa=${task.code}`}
                            prefetch={false}
                            className="font-medium break-words text-navy hover:underline"
                          >
                            {task.title}
                          </Link>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                            {task.assignee ? (
                              <span>{task.assignee.name ?? "Sem nome"}</span>
                            ) : (
                              <Pill tone="danger">Sem responsável</Pill>
                            )}
                            {task.due_date ? (
                              <span>até {formatDayMonth(task.due_date)}</span>
                            ) : null}
                          </span>
                          {task.status_category === "blocked" &&
                          task.blocked_reason ? (
                            <span className="text-xs break-words text-danger-fg">
                              {task.blocked_reason}
                              {task.blocked_on?.name
                                ? ` · espera ${task.blocked_on.name}`
                                : ""}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="carga" className="flex flex-col gap-3">
            <h2
              id="carga"
              className="font-heading text-lg font-semibold text-navy"
            >
              Carga por pessoa e agente
            </h2>
            {load.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
                Nenhuma tarefa aberta com responsável.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-2">
                {load.map((l) => (
                  <li
                    key={l.key}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <Avatar text={initials(l.name)} agent={l.agent} />
                    <span className="min-w-32 flex-1 font-medium text-navy">
                      {l.name}
                    </span>
                    <span className="text-ink-2">
                      {l.open} {l.open === 1 ? "aberta" : "abertas"}
                    </span>
                    <Pill tone={STATUS_CATEGORY_TONE.in_progress}>
                      {l.inProgress} em andamento
                    </Pill>
                    {l.blocked > 0 ? (
                      <Pill tone="danger">
                        {l.blocked}{" "}
                        {l.blocked === 1 ? "bloqueada" : "bloqueadas"}
                      </Pill>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="frentes" className="flex flex-col gap-3">
            <h2
              id="frentes"
              className="font-heading text-lg font-semibold text-navy"
            >
              Frentes
            </h2>
            {workstreams.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
                Nenhuma frente deste departamento em projeto ativo.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-2">
                {workstreams.map((w, i) => (
                  <li
                    key={`${w.projectCode}-${i}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <Link
                      href={`/projetos/${w.projectCode}`}
                      className="font-mono text-xs font-semibold text-ink-2 hover:text-navy hover:underline"
                    >
                      {w.projectCode}
                      {w.milestone ? ` · ${w.milestone}` : ""}
                    </Link>
                    <span className="min-w-32 flex-1 break-words text-navy">
                      {w.title}
                    </span>
                    <Pill tone={WORKSTREAM_STATUS[w.status].tone}>
                      {WORKSTREAM_STATUS[w.status].label}
                    </Pill>
                    <Progress
                      value={w.progressPct}
                      label={`Progresso de ${w.title}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
