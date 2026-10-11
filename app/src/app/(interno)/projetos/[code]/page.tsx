import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import {
  Ban,
  Check,
  Eye,
  EyeOff,
  ListChecks,
  Lock,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { ChannelThread } from "@/components/channel-thread";
import { Avatar, Pill, Progress } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import {
  formatDayMonth,
  formatMoment,
  formatTimestampDay,
  initials,
} from "@/lib/format";
import {
  MILESTONE_STATUS,
  PRIORITY,
  STATUS_CATEGORY_TONE,
  WORKSTREAM_STATUS,
} from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import {
  archivedInProject,
  type ArchivedInProject,
} from "@/modules/archive/service";
import {
  clientFiles,
  type ClientFile,
} from "@/modules/attachments/client-files";
import { ACCEPTED_EXTENSIONS } from "@/modules/attachments/service";
import {
  clientChannel,
  type ChannelMessage,
} from "@/modules/comments/client-channel";
import { clientTextContext } from "@/modules/client-text/context";
import { NO_WRITER, writerAgent } from "@/modules/client-text/writer";
import { inTx } from "@/modules/context";
import { projectChangeMarker } from "@/modules/live";
import { pendingAcceptances } from "@/modules/milestones/admin";
import { departmentOptions } from "@/modules/projects/admin";
import {
  projectOverview,
  type ProjectOverview,
} from "@/modules/projects/overview";
import type {
  MilestoneDto,
  TaskSummary,
  WorkstreamDto,
} from "@/modules/projects/schemas";
import { taskFormOptions } from "@/modules/tasks/board";
import {
  MilestoneButton,
  MilestoneOrder,
  RequestAcceptanceButton,
  type MilestoneInitial,
} from "./_plan/milestone-dialog";
import {
  WorkstreamButton,
  type WorkstreamFormOptions,
  type WorkstreamInitial,
} from "./_plan/workstream-dialog";
import { LiveRefresh } from "../../_live/live-refresh";
import { RestoreButton } from "../../_archive/archive-controls";
import { ArchivedSection, archivedWhen } from "../../_archive/archived-section";
import { welcomeMessage } from "@/modules/portal/invite";
import { ReplyBox } from "./_channel/reply-box";
import { ClientFilesEditor } from "./_files/files-editor";
import { NewTaskButton } from "./_tasks/new-task";
import { openTaskParam, PROJECT_CODE } from "./_tasks/params";
import { ProjectHeader } from "./_tasks/project-header";
import { TaskPanel, taskHref } from "./_tasks/task-panel";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]">): Promise<Metadata> {
  const { code } = await params;
  return { title: PROJECT_CODE.test(code) ? code : "Projeto" };
}

export default function ProjetoPage({
  params,
  searchParams,
}: PageProps<"/projetos/[code]">) {
  return (
    <Suspense fallback={<ProjectSkeleton />}>
      <ProjectView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProjectView({
  params,
  searchParams,
}: PageProps<"/projetos/[code]">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const query = await searchParams;
  const { user, ctx } = await pageContext();
  let data: ProjectOverview;
  let options: Awaited<ReturnType<typeof taskFormOptions>>;
  let departments: Awaited<ReturnType<typeof departmentOptions>>;
  let pending: string[];
  let archived: ArchivedInProject;
  let channel: {
    portalEnabled: boolean;
    orgName: string;
    messages: ChannelMessage[];
  };
  let files: ClientFile[];
  let marker: string;
  let clientText: WorkstreamFormOptions["clientText"] = null;
  try {
    ({
      data,
      options,
      departments,
      pending,
      archived,
      channel,
      files,
      marker,
      clientText,
    } = await inTx(ctx, async (t) => {
      const overview = await projectOverview(t, code);
      // Verificação do texto para o cliente e o Redator, para quem decide a visibilidade.
      const canShow = can(user.actor, "workstream.visibility");
      return {
        data: overview,
        options: await taskFormOptions(t, overview.project.id),
        departments: await departmentOptions(t),
        pending: await pendingAcceptances(t, overview.project.id),
        archived: await archivedInProject(t, overview.project.id),
        channel: await clientChannel(t, code),
        files: await clientFiles(t, code),
        marker: await projectChangeMarker(t, code),
        clientText: canShow
          ? {
              context: await clientTextContext(t, overview.project.id),
              writer: (await writerAgent(t)) ? null : NO_WRITER,
            }
          : null,
      };
    }));
  } catch (err) {
    // Projeto inexistente ou fora do alcance de quem vê: a mesma página de "não achei".
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const basePath = `/projetos/${code}`;
  const open = openTaskParam(query.tarefa);
  const hrefFor = (task: string) => taskHref(basePath, {}, task);
  // Projeto arquivado é só consulta: nada de criar, editar ou restaurar o que há dentro.
  const archivedProject = data.project.status === "archived";
  const canWriteMilestones =
    !archivedProject && can(user.actor, "milestone.write");
  const canWriteWorkstreams =
    !archivedProject && can(user.actor, "workstream.write");
  const workstreamOptions: WorkstreamFormOptions = {
    milestones: data.milestones.map((m) => ({ code: m.code, title: m.title })),
    departments,
    assignees: options.assignees,
    workstreams: data.workstreams.map((w) => ({
      id: w.id,
      title: w.title,
      milestone: w.milestone?.code ?? null,
    })),
    canShowClient: can(user.actor, "workstream.visibility"),
    clientText,
  };

  return (
    <>
      {/* Com o painel aberto em tela larga, a página encolhe para o painel não cobrir nada. */}
      <div className={open ? "xl:pr-[36rem]" : undefined}>
        <ProjectHeader
          project={data.project}
          active="overview"
          showObjective
          canRestore={can(user.actor, "workspace.admin")}
          actions={
            archivedProject ? undefined : (
              <>
                {can(user.actor, "workspace.admin") ? (
                  <Button asChild variant="outline" size="lg">
                    <Link href={`/projetos/${code}/editar`}>
                      <Pencil aria-hidden="true" />
                      Editar projeto
                    </Link>
                  </Button>
                ) : null}
                <NewTaskButton
                  projectCode={code}
                  basePath={basePath}
                  workstream={null}
                  workstreams={options.workstreams}
                  assignees={options.assignees}
                />
              </>
            )
          }
        />

        <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
          <LiveRefresh src={`/projetos/${code}/mudancas`} marker={marker} />
          <Layer
            n={1}
            title="Estratégica"
            heading="Marcos e entregas"
            note="O cliente vê, exceto os internos"
            icon={<Eye aria-hidden="true" className="size-3.5" />}
            action={
              canWriteMilestones ? (
                <MilestoneButton
                  projectCode={code}
                  canDropGate={can(user.actor, "milestone.accept")}
                />
              ) : null
            }
          >
            <Milestones
              data={data}
              projectCode={code}
              canWrite={canWriteMilestones}
              canDropGate={can(user.actor, "milestone.accept")}
              canRequest={
                !archivedProject && can(user.actor, "approval.request")
              }
              pending={pending}
            />
            <ArchivedItems
              label="Marcos arquivados"
              verb="arquivado"
              entity="milestone"
              canRestore={canWriteMilestones}
              items={archived.milestones.map((m) => ({
                id: m.id,
                code: m.code,
                title: m.title,
                note: null,
                archived_at: m.archived_at,
              }))}
            />
          </Layer>

          <Layer
            n={2}
            title="Tática"
            heading="Frentes por departamento"
            note="O cliente vê só as frentes marcadas"
            icon={<Eye aria-hidden="true" className="size-3.5" />}
            action={
              canWriteWorkstreams ? (
                <WorkstreamButton
                  projectCode={code}
                  options={workstreamOptions}
                />
              ) : null
            }
          >
            <Workstreams
              data={data}
              projectCode={code}
              canWrite={canWriteWorkstreams}
              options={workstreamOptions}
            />
            <ArchivedItems
              label="Frentes arquivadas"
              verb="arquivada"
              entity="workstream"
              canRestore={canWriteWorkstreams}
              items={archived.workstreams.map((w) => ({
                id: w.id,
                code: null,
                title: w.title,
                note: w.milestone_code ? `Marco ${w.milestone_code}` : null,
                archived_at: w.archived_at,
              }))}
            />
          </Layer>

          <Layer
            n={3}
            title="Operacional"
            heading="O que está acontecendo agora"
            note="O cliente nunca vê"
            icon={<EyeOff aria-hidden="true" className="size-3.5" />}
          >
            <Operational data={data} hrefFor={hrefFor} />
          </Layer>

          {channel.portalEnabled || files.length > 0 ? (
            <section
              id="arquivos-do-cliente"
              aria-labelledby="arquivos-do-cliente-titulo"
              className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="arquivos-do-cliente-titulo"
                  className="font-heading text-lg font-semibold text-navy"
                >
                  Arquivos entregues ao cliente
                </h2>
                <span className="inline-flex items-center gap-1 text-xs text-caption">
                  <Eye aria-hidden="true" className="size-3.5" />O cliente vê e
                  baixa no portal
                </span>
              </div>
              <ClientFilesEditor
                projectCode={code}
                files={files}
                accept={ACCEPTED_EXTENSIONS}
                canSend={
                  !archivedProject &&
                  data.project.status !== "in_review" &&
                  can(user.actor, "attachment.write_client")
                }
              />
            </section>
          ) : null}

          {channel.portalEnabled || channel.messages.length > 0 ? (
            <section
              id="canal-do-cliente"
              aria-labelledby="canal-do-cliente-titulo"
              className="flex scroll-mt-4 flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="canal-do-cliente-titulo"
                  className="font-heading text-lg font-semibold text-navy"
                >
                  Canal do cliente
                </h2>
                <span className="inline-flex items-center gap-1 text-xs text-caption">
                  <Eye aria-hidden="true" className="size-3.5" />O cliente vê
                  esta conversa no portal
                </span>
              </div>
              <ChannelThread
                messages={channel.messages}
                clientLabel="cliente"
                teamLabel="equipe"
                empty="Nenhuma mensagem ainda. O que o cliente escrever no portal aparece aqui."
              />
              {archivedProject ? (
                <p className="text-sm text-caption">
                  Projeto arquivado: a conversa fica só para consulta.
                </p>
              ) : data.project.status === "in_review" ? (
                <p className="text-sm text-caption">
                  Projeto em revisão: a conversa começa depois da decisão da
                  importação.
                </p>
              ) : can(user.actor, "comment.write_client") ? (
                <ReplyBox
                  projectCode={code}
                  welcome={
                    channel.messages.length === 0
                      ? welcomeMessage({
                          projectName: data.project.name,
                          orgName: channel.orgName,
                        })
                      : undefined
                  }
                />
              ) : (
                <p className="text-sm text-caption">
                  Responder ao cliente é do dono ou da administração.
                </p>
              )}
            </section>
          ) : null}
        </main>
      </div>
      {open ? (
        <TaskPanel
          projectCode={code}
          taskCode={open}
          closeHref={basePath}
          basePath={basePath}
          keep={{}}
        />
      ) : null}
    </>
  );
}

function Layer({
  n,
  title,
  heading,
  note,
  icon,
  action,
  children,
}: {
  n: number;
  title: string;
  heading: string;
  note: string;
  icon: ReactNode;
  /** Botão da camada (ex.: Novo marco), só para quem pode. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`camada-${n}`}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[11px] tracking-[0.12em] text-brand-strong uppercase">
            Camada {n} · {title}
          </p>
          <h2
            id={`camada-${n}`}
            className="font-heading text-lg font-semibold text-navy"
          >
            {heading}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-off-2 px-2.5 py-1 text-xs text-ink-2">
            {icon}
            {note}
          </span>
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Arquivados da camada, recolhidos no fim; restaurar devolve o item à lista. */
function ArchivedItems({
  label,
  verb,
  entity,
  items,
  canRestore,
}: {
  label: string;
  verb: string;
  entity: "milestone" | "workstream";
  items: {
    id: string;
    code: string | null;
    title: string;
    note: string | null;
    archived_at: string;
  }[];
  canRestore: boolean;
}) {
  return (
    <ArchivedSection label={label} count={items.length}>
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
        >
          {item.code ? (
            <span className="w-10 font-mono text-xs font-semibold text-caption">
              {item.code}
            </span>
          ) : null}
          <span className="min-w-40 flex-1">
            <span className="block text-ink">{item.title}</span>
            <span className="block text-xs text-caption">
              {archivedWhen(
                verb,
                formatTimestampDay(item.archived_at),
                item.note,
              )}
            </span>
          </span>
          {canRestore ? (
            <RestoreButton
              target={{ entity, ref: item.id }}
              accessibleLabel={
                item.code
                  ? `Restaurar ${item.code}`
                  : `Restaurar a frente ${item.title}`
              }
            />
          ) : null}
        </li>
      ))}
    </ArchivedSection>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
      {children}
    </p>
  );
}

/** O marco no formato do formulário de edição; aceito não se edita mais. */
function milestoneInitial(m: MilestoneDto): MilestoneInitial | null {
  const status = m.status;
  if (status === "accepted") return null;
  return {
    id: m.id,
    code: m.code,
    title: m.title,
    title_client: m.title_client,
    description_client: m.description_client,
    due_date: m.due_date,
    status,
    visibility: m.visibility,
    acceptance_criteria: m.acceptance_criteria,
    gate_required: m.gate_required,
  };
}

function Milestones({
  data,
  projectCode,
  canWrite,
  canDropGate,
  canRequest,
  pending,
}: {
  data: ProjectOverview;
  projectCode: string;
  canWrite: boolean;
  /** Quem aceita marcos (o dono) pode tirar o GATE (RF-09). */
  canDropGate: boolean;
  canRequest: boolean;
  /** Marcos com pedido de aceite esperando decisão. */
  pending: string[];
}) {
  if (data.milestones.length === 0) {
    return (
      <Empty>
        Nenhum marco cadastrado. Marcos são criados por pessoas, e o aceite é
        sempre do Fábio.
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-line">
      {data.milestones.map((m, index) => {
        const status = MILESTONE_STATUS[m.status];
        const criteriaDone = m.acceptance_criteria.filter((c) => c.done).length;
        const initial = milestoneInitial(m);
        const requested = pending.includes(m.id);
        return (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
          >
            {/* O código leva ao histórico do marco (RF-43). */}
            <Link
              href={`/historico/marco/${m.id}`}
              aria-label={`Histórico do ${m.code}`}
              className="w-10 font-mono text-xs font-semibold text-caption underline-offset-2 hover:text-navy hover:underline"
            >
              {m.code}
            </Link>
            <span className="min-w-48 flex-1">
              <span className="block font-semibold text-navy">{m.title}</span>
              <span className="block text-xs text-caption">
                {m.accepted_at
                  ? `Aceito em ${formatTimestampDay(m.accepted_at)}${m.accepted_by?.name ? ` por ${m.accepted_by.name}` : ""}`
                  : m.due_date
                    ? `${m.late ? "Atrasado · era " : "Previsto para "}${formatDayMonth(m.due_date)}`
                    : "Sem data"}
                {m.acceptance_criteria.length > 0
                  ? ` · critérios ${criteriaDone}/${m.acceptance_criteria.length}`
                  : ""}
                {m.visibility === "internal" ? " · interno" : ""}
                {m.gate_required ? "" : " · sem GATE"}
              </span>
              {m.client_received_at ? (
                <span className="block text-xs text-ok-fg">
                  Recebimento confirmado pelo cliente
                  {m.client_received_by
                    ? ` (${m.client_received_by})`
                    : ""} em {formatTimestampDay(m.client_received_at)}
                </span>
              ) : null}
            </span>
            <Pill tone={m.late && !m.accepted_at ? "danger" : status.tone}>
              {m.late && !m.accepted_at ? "Atrasado" : status.label}
            </Pill>
            <Progress value={m.progress_pct} label={`Progresso de ${m.code}`} />
            {/* Ações em coluna de largura fixa: as barras de progresso ficam alinhadas. */}
            {canWrite || canRequest ? (
              <span className="flex items-center justify-end gap-1 sm:w-64">
                {initial && requested ? (
                  <Link
                    href="/aprovacoes"
                    aria-label={`Aceite pedido do ${m.code}: abrir Aprovações`}
                    className="rounded-full focus-visible:ring-3 focus-visible:ring-brand/30 focus-visible:outline-none"
                  >
                    <Pill tone="review">Aceite pedido</Pill>
                  </Link>
                ) : initial?.status === "delivered" &&
                  m.gate_required &&
                  canRequest ? (
                  <RequestAcceptanceButton
                    milestone={{
                      id: m.id,
                      code: m.code,
                      title: m.title,
                      criteriaDone,
                      criteriaTotal: m.acceptance_criteria.length,
                    }}
                  />
                ) : null}
                {canWrite ? (
                  <MilestoneOrder
                    milestone={{ id: m.id, code: m.code }}
                    first={index === 0}
                    last={index === data.milestones.length - 1}
                  />
                ) : null}
                {initial && canWrite ? (
                  <MilestoneButton
                    projectCode={projectCode}
                    milestone={initial}
                    canDropGate={canDropGate}
                  />
                ) : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function workstreamInitial(w: WorkstreamDto): WorkstreamInitial {
  return {
    id: w.id,
    title: w.title,
    milestone: w.milestone?.code ?? null,
    department: w.department?.slug ?? null,
    status: w.status,
    description_internal: w.description_internal,
    assignee: w.assignee ? `${w.assignee.type}:${w.assignee.id}` : null,
    assigneeName: w.assignee?.name ?? null,
    visibility: w.visibility,
    title_client: w.title_client,
    description_client: w.description_client,
    dependsOn: w.depends_on,
    taskCount: w.task_count,
  };
}

/** “A”, “A” e “B”, “A”, “B” e “C”. */
function quotedList(titles: string[]): string {
  const quoted = titles.map((t) => `“${t}”`);
  return quoted.length <= 1
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} e ${quoted.at(-1)}`;
}

function Workstreams({
  data,
  projectCode,
  canWrite,
  options,
}: {
  data: ProjectOverview;
  projectCode: string;
  canWrite: boolean;
  options: WorkstreamFormOptions;
}) {
  const titleOf = new Map(data.workstreams.map((w) => [w.id, w.title]));
  const alerts = new Map(data.dependencyAlerts.map((a) => [a.id, a]));
  if (data.workstreams.length === 0) {
    return (
      <Empty>
        Nenhuma frente cadastrada. Frentes organizam o trabalho por departamento
        e podem ser mostradas ao cliente, uma a uma.
      </Empty>
    );
  }
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Frentes do projeto</caption>
        <thead className="text-xs text-caption">
          <tr>
            <th className="py-2 pr-3 font-medium">Departamento</th>
            <th className="py-2 pr-3 font-medium">Frente</th>
            <th className="py-2 pr-3 font-medium">Responsável</th>
            <th className="py-2 pr-3 font-medium">Progresso</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">No portal</th>
            {canWrite ? (
              <th className="py-2 font-medium">
                <span className="sr-only">Ações</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.workstreams.map((w) => {
            const status = WORKSTREAM_STATUS[w.status];
            const dependsOn = w.depends_on
              .map((id) => titleOf.get(id))
              .filter((t): t is string => Boolean(t));
            const alert = alerts.get(w.id);
            return (
              <tr key={w.id} className="align-top">
                <td className="py-2.5 pr-3">
                  {w.department ? (
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full"
                        style={{ background: w.department.color }}
                      />
                      {w.department.name}
                    </span>
                  ) : (
                    <span className="text-caption">Sem departamento</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-navy">{w.title}</span>
                  <span className="block text-xs text-caption">
                    {w.milestone ? `Marco ${w.milestone.code}` : null}
                    {w.milestone && w.blocked_count === 1
                      ? " · 1 bloqueada"
                      : w.milestone && w.blocked_count > 1
                        ? ` · ${w.blocked_count} bloqueadas`
                        : ""}
                    {w.milestone ? " · " : null}
                    <Link
                      href={`/historico/frente/${w.id}`}
                      aria-label={`Histórico da frente ${w.title}`}
                      className="underline underline-offset-2 hover:text-navy"
                    >
                      Histórico
                    </Link>
                  </span>
                  {dependsOn.length > 0 ? (
                    <span className="block text-xs text-ink-2">
                      Depende de {quotedList(dependsOn)}
                    </span>
                  ) : null}
                  {alert ? (
                    <span className="mt-1 flex items-start gap-1 text-xs font-medium text-warn-fg">
                      <TriangleAlert
                        aria-hidden="true"
                        className="mt-px size-3.5 shrink-0"
                      />
                      Começou antes de{" "}
                      {quotedList(alert.waitingOn.map((x) => x.title))}{" "}
                      {alert.waitingOn.length === 1 ? "terminar" : "terminarem"}
                      .
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-3">
                  {w.assignee ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar
                        text={initials(w.assignee.name)}
                        agent={w.assignee.type === "agent"}
                      />
                      {w.assignee.name}
                    </span>
                  ) : (
                    <span className="text-caption">Ninguém</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <Progress
                    value={w.progress_pct}
                    label={`Progresso de ${w.title}`}
                  />
                </td>
                <td className="py-2.5 pr-3">
                  <Pill tone={status.tone}>{status.label}</Pill>
                </td>
                <td className="py-2.5 pr-3">
                  {w.visibility === "client" ? (
                    <span className="inline-flex items-center gap-1 text-ok-fg">
                      <Eye aria-hidden="true" className="size-4" /> Visível
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-caption">
                      <EyeOff aria-hidden="true" className="size-4" /> Interna
                    </span>
                  )}
                </td>
                {canWrite ? (
                  <td className="py-1.5 text-right">
                    <WorkstreamButton
                      projectCode={projectCode}
                      workstream={workstreamInitial(w)}
                      options={options}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task, href }: { task: TaskSummary; href: string }) {
  const priority = PRIORITY[task.priority];
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        prefetch={false}
        className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 hover:bg-off"
      >
        <span className="w-16 font-mono text-xs font-semibold text-caption">
          {task.code}
        </span>
        <span className="min-w-40 flex-1 text-ink">{task.title}</span>
        {task.priority === "urgent" || task.priority === "high" ? (
          <Pill tone={priority.tone}>{priority.label}</Pill>
        ) : null}
        {task.due_date ? (
          <span className="text-xs text-caption">
            até {formatDayMonth(task.due_date)}
          </span>
        ) : null}
        {task.assignee ? (
          <Avatar
            text={initials(task.assignee.name)}
            agent={task.assignee.type === "agent"}
            title={task.assignee.name ?? undefined}
          />
        ) : null}
        <Pill tone={STATUS_CATEGORY_TONE[task.status_category]}>
          {task.status_name}
        </Pill>
      </Link>
    </li>
  );
}

function Operational({
  data,
  hrefFor,
}: {
  data: ProjectOverview;
  hrefFor: (code: string) => string;
}) {
  const { project: p } = data;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
            <ListChecks aria-hidden="true" className="size-4" />
            Fila de trabalho
          </h3>
          {data.queue.length === 0 ? (
            <Empty>Nenhuma tarefa aberta neste projeto.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.queue.map((t) => (
                <TaskRow key={t.code} task={t} href={hrefFor(t.code)} />
              ))}
            </ul>
          )}
        </div>

        {data.blocked.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-danger-fg">
              <Ban aria-hidden="true" className="size-4" />
              Bloqueios
            </h3>
            <ul className="flex flex-col gap-2">
              {data.blocked.map((t) => (
                <li key={t.code}>
                  <Link
                    href={hrefFor(t.code)}
                    scroll={false}
                    prefetch={false}
                    className="block rounded-xl border border-danger/30 bg-danger-soft/40 p-3 text-sm hover:border-danger/60"
                  >
                    <span className="font-mono text-xs font-semibold text-danger-fg">
                      {t.code}
                    </span>{" "}
                    <span className="font-medium text-navy">{t.title}</span>
                    {t.blocked_reason ? (
                      <span className="mt-1 block text-ink-2">
                        {t.blocked_reason}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 rounded-xl bg-off p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
            <Lock aria-hidden="true" className="size-4" />
            Regras deste projeto
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              {p.require_evidence
                ? "Concluir uma tarefa exige evidência."
                : "Concluir uma tarefa não exige evidência."}
            </li>
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              Aceite de marco: só o Fábio.
            </li>
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              {p.client_can_confirm_receipt
                ? "O cliente pode confirmar o recebimento das entregas."
                : "O cliente acompanha, sem confirmar recebimento."}
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-navy">Atividade recente</h3>
          {data.activity.length === 0 ? (
            <Empty>Nada registrado ainda.</Empty>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {data.activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex gap-3 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs text-caption">
                    {formatMoment(a.at)}
                  </span>
                  <span className="text-ink-2">
                    <span className="font-semibold text-navy">
                      {a.actor?.name ?? "Hub"}
                    </span>{" "}
                    {a.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="h-24 rounded-xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
    </div>
  );
}
