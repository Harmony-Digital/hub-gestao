import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Ban, CircleCheck, CornerDownRight } from "lucide-react";
import { Linkified } from "@/components/shell/linkified";
import { Avatar, Pill } from "@/components/shell/pill";
import { HubError } from "@/lib/errors";
import { formatMoment, formatTimestampDay, initials } from "@/lib/format";
import { STATUS_CATEGORY_TONE, TASK_SOURCE } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { taskDetail, type TaskDetail } from "@/modules/tasks/board";
import { assigneeValue } from "./form";
import { TaskPanelFrame } from "./panel-frame";
import { ChecklistEditor, DependenciesEditor } from "./task-extras";
import {
  CommentForm,
  DescriptionField,
  StatusPicker,
  TaskFieldsForm,
  TitleField,
} from "./task-forms";

type PanelProps = {
  projectCode: string;
  taskCode: string;
  /** Endereço da tela sem o painel (fechar). */
  closeHref: string;
  /** Tela atual e filtros que continuam ao abrir outra tarefa (subtarefa, tarefa-pai). */
  basePath: string;
  keep: Record<string, string>;
};

export function taskHref(
  basePath: string,
  keep: Record<string, string>,
  code: string,
): string {
  return `${basePath}?${new URLSearchParams({ ...keep, tarefa: code })}`;
}

/** Painel lateral da tarefa (?tarefa=CODE), igual na lista, na visão geral e no quadro. */
export function TaskPanel(props: PanelProps) {
  return (
    <TaskPanelFrame taskCode={props.taskCode} closeHref={props.closeHref}>
      <Suspense key={props.taskCode} fallback={<PanelSkeleton />}>
        <PanelContent {...props} />
      </Suspense>
    </TaskPanelFrame>
  );
}

async function PanelContent({
  projectCode,
  taskCode,
  basePath,
  keep,
}: PanelProps) {
  const { ctx } = await pageContext();
  let data: TaskDetail;
  try {
    data = await inTx(ctx, (t) => taskDetail(t, taskCode));
  } catch (err) {
    if (err instanceof HubError && [400, 403, 404].includes(err.status)) {
      return <NotFound code={taskCode} />;
    }
    throw err;
  }
  const { task } = data;
  if (task.project_code !== projectCode) return <NotFound code={taskCode} />;
  const hrefFor = (code: string) => taskHref(basePath, keep, code);
  const late =
    task.due_date !== null &&
    task.due_date < data.today &&
    task.status.category !== "done";

  return (
    <div className="flex flex-col gap-6 px-5 pt-4 pb-10 sm:px-6">
      <div className="flex flex-col gap-1.5">
        {task.parent_code ? (
          <p className="flex items-center gap-1 text-xs text-caption">
            <CornerDownRight aria-hidden="true" className="size-3.5" />
            Subtarefa de
            <Link
              href={hrefFor(task.parent_code)}
              scroll={false}
              className="font-mono font-semibold text-info-fg hover:underline"
            >
              {task.parent_code}
            </Link>
          </p>
        ) : null}
        <h2 id="painel-tarefa-titulo" className="sr-only">
          {task.code}: {task.title}
        </h2>
        <TitleField
          key={`titulo-${task.version}`}
          code={task.code}
          version={task.version}
          title={task.title}
        />
      </div>

      <Section title="Status">
        <StatusPicker
          code={task.code}
          version={task.version}
          statuses={data.statuses}
          currentId={task.status.id}
        />
        {task.status.category === "blocked" && task.blocked_reason ? (
          <Callout tone="danger" icon={<Ban aria-hidden="true" />}>
            <span className="font-semibold">Bloqueada:</span>{" "}
            <Linkified text={task.blocked_reason} />
          </Callout>
        ) : null}
        {task.status.category === "done" ? (
          <Callout tone="ok" icon={<CircleCheck aria-hidden="true" />}>
            <span className="font-semibold">
              Concluída
              {task.completed_by?.name ? ` por ${task.completed_by.name}` : ""}
              {task.completed_at
                ? ` em ${formatTimestampDay(task.completed_at)}`
                : ""}
              .
            </span>
            {task.done_evidence ? (
              <span className="mt-1 block">
                Evidência: <Linkified text={task.done_evidence} />
              </span>
            ) : null}
          </Callout>
        ) : null}
      </Section>

      <TaskFieldsForm
        key={`campos-${task.version}`}
        code={task.code}
        version={task.version}
        assignee={assigneeValue(task.assignee)}
        dueDate={task.due_date}
        late={late}
        priority={task.priority}
        workstreamId={task.workstream?.id ?? null}
        assignees={data.assignees}
        workstreams={data.workstreams}
      />

      <p className="-mt-3 text-xs text-caption">
        Criada por {task.created_by.name ?? "Hub"}{" "}
        {TASK_SOURCE[task.source] ?? ""} em{" "}
        {formatTimestampDay(task.created_at)}.
      </p>

      <Section title="Descrição">
        <DescriptionField
          code={task.code}
          version={task.version}
          description={task.description_md}
        >
          {task.description_md ? (
            <Linkified text={task.description_md} />
          ) : null}
        </DescriptionField>
      </Section>

      <Section
        title={
          data.checklist.length > 0
            ? `Checklist (${data.checklist.filter((i) => i.done).length}/${data.checklist.length})`
            : "Checklist"
        }
      >
        <ChecklistEditor code={task.code} items={data.checklist} />
      </Section>

      {data.subtasks.length > 0 ? (
        <Section title={`Subtarefas (${data.subtasks.length})`}>
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {data.subtasks.map((s) => (
              <li key={s.code}>
                <Link
                  href={hrefFor(s.code)}
                  scroll={false}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-off"
                >
                  <span className="font-mono text-xs font-semibold text-caption">
                    {s.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {s.title}
                  </span>
                  <Pill tone={STATUS_CATEGORY_TONE[s.status.category]}>
                    {s.status.name}
                  </Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Dependências">
        <DependenciesEditor
          code={task.code}
          blockedBy={data.dependencies.blocked_by.map((d) => ({
            ...d,
            href: hrefFor(d.code),
          }))}
          blocks={data.dependencies.blocks.map((d) => ({
            ...d,
            href: hrefFor(d.code),
          }))}
        />
      </Section>

      <Section title={`Comentários (${data.comments.length})`}>
        {data.comments.length > 0 ? (
          <ol className="flex flex-col gap-4">
            {data.comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar
                  text={initials(c.author.name)}
                  agent={c.author.type === "agent"}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-caption">
                    <span className="font-semibold text-navy">
                      {c.author.name ?? "Hub"}
                    </span>{" "}
                    · {formatMoment(c.created_at)}
                  </p>
                  <div className="mt-1 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
                    <Linkified text={c.body_md} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <CommentForm code={task.code} />
      </Section>

      <Section title="Histórico">
        {data.history.length === 0 ? (
          <p className="text-sm text-caption">Nada registrado ainda.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {data.history.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
                <span className="w-12 shrink-0 font-mono text-xs text-caption">
                  {formatMoment(e.at)}
                </span>
                <span className="min-w-0 text-ink-2">
                  <span className="font-semibold text-navy">
                    {e.actor?.name ?? "Hub"}
                  </span>{" "}
                  {e.text}
                  {e.detail ? (
                    <span className="block break-words text-caption">
                      <Linkified text={e.detail} />
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold tracking-[0.08em] text-caption uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Callout({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "danger";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex gap-2 rounded-xl p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 ${
        tone === "ok"
          ? "bg-ok-soft text-ok-fg"
          : "border border-danger/30 bg-danger-soft/50 text-danger-fg"
      }`}
    >
      {icon}
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}

function NotFound({ code }: { code: string }) {
  return (
    <div className="flex flex-col gap-2 px-6 pt-6 pb-10">
      <h2
        id="painel-tarefa-titulo"
        className="font-heading text-lg font-semibold text-navy"
      >
        Tarefa {code} não encontrada
      </h2>
      <p className="text-sm text-ink-2">
        Ela pode ter sido arquivada, pertencer a outro projeto ou estar fora do
        seu acesso.
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5 px-6 pt-6">
      <span id="painel-tarefa-titulo" className="sr-only">
        Carregando a tarefa
      </span>
      <div className="h-4 w-24 rounded bg-off-2" />
      <div className="h-8 w-3/4 rounded bg-off-2" />
      <div className="h-10 rounded-full bg-off-2" />
      <div className="h-32 rounded-xl bg-off-2" />
      <div className="h-24 rounded-xl bg-off-2" />
    </div>
  );
}
