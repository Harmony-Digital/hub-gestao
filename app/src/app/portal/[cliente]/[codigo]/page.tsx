import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PackageCheck } from "lucide-react";
import { ChannelThread } from "@/components/channel-thread";
import { Markdown } from "@/components/markdown";
import { Pill, Progress } from "@/components/shell/pill";
import { HubError } from "@/lib/errors";
import { formatBytes, formatDate, formatTimestampDate } from "@/lib/format";
import { PHASES, type Tone } from "@/lib/labels";
import { ProjectCode } from "@/modules/common";
import { inTx } from "@/modules/context";
import type { ChannelMessage } from "@/modules/comments/client-channel";
import {
  portalAccent,
  portalChannel,
  portalLogo,
  portalFiles,
  portalProject,
  type PortalFile,
  type PortalMilestone,
  type PortalMilestoneStatus,
  type PortalProjectDetail,
  type PortalWorkstream,
} from "@/modules/portal/views";
import { MessageBox } from "../../_ui/message-box";
import { ReceiptButton } from "../../_ui/receipt-button";
import { accentBorder, NoAccess, PortalTop } from "../../_ui/parts";
import { portalContext, portalSessionFor } from "../../_ui/session";

export const metadata: Metadata = { title: "Entregas do projeto" };

/** Para o cliente: o aceite é do dono (D9); para quem acompanha, a entrega está concluída. */
const MILESTONE: Record<PortalMilestoneStatus, { label: string; tone: Tone }> =
  {
    planned: { label: "Prevista", tone: "neutral" },
    in_progress: { label: "Em andamento", tone: "info" },
    delivered: { label: "Entregue", tone: "review" },
    accepted: { label: "Concluída", tone: "ok" },
  };

export default function PortalProjetoPage({
  params,
}: PageProps<"/portal/[cliente]/[codigo]">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="mx-auto w-full max-w-4xl px-4 py-10">
          <div className="h-64 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <Project params={params} />
    </Suspense>
  );
}

async function Project({
  params,
}: Pick<PageProps<"/portal/[cliente]/[codigo]">, "params">) {
  await connection();
  const { cliente, codigo } = await params;
  const session = await portalSessionFor(cliente);
  if (!session) return <NoAccess />;
  // O aceite do uso dos dados vem antes de qualquer conteúdo.
  if (!session.consentAt) redirect(`/portal/${cliente}`);

  const back = { href: `/portal/${cliente}`, label: "Seus projetos" };
  let project: PortalProjectDetail | null = null;
  let messages: ChannelMessage[] = [];
  let files: PortalFile[] = [];
  let accent: string | null = null;
  let logoVersion: string | null = null;
  if (ProjectCode.safeParse(codigo).success) {
    try {
      ({
        project,
        messages,
        files,
        accent,
        logo: logoVersion,
      } = await inTx(await portalContext(session), async (t) => ({
        project: await portalProject(t, codigo),
        messages: await portalChannel(t, codigo),
        files: await portalFiles(t, codigo),
        accent: await portalAccent(t),
        logo: await portalLogo(t),
      })));
    } catch (err) {
      if (!(err instanceof HubError && err.status === 404)) throw err;
    }
  }
  const logo = logoVersion ? `/portal/${cliente}/logo?v=${logoVersion}` : null;
  if (!project) {
    return (
      <main
        id="conteudo"
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6"
      >
        <PortalTop
          clientName={session.clientName}
          accent={accent}
          logo={logo}
          back={back}
        />
        <h1 className="font-heading text-2xl font-semibold text-navy">
          Projeto não encontrado
        </h1>
        <p className="text-ink-2">
          Este endereço não leva a um projeto que você acompanha. Volte para a
          lista dos seus projetos.
        </p>
      </main>
    );
  }

  const phaseIndex = PHASES.findIndex((p) => p.key === project.phase);
  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6"
    >
      <PortalTop
        clientName={session.clientName}
        accent={accent}
        logo={logo}
        back={back}
      />

      <section aria-labelledby="projeto" className="flex flex-col gap-4">
        <h1
          id="projeto"
          className="font-heading text-3xl font-semibold text-navy"
        >
          {project.name}
        </h1>
        <ol aria-label="Fase do projeto" className="flex flex-wrap gap-2">
          {PHASES.map((p, i) => (
            <li
              key={p.key}
              aria-current={i === phaseIndex ? "step" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                i === phaseIndex
                  ? "border-navy bg-navy font-semibold text-off"
                  : i < phaseIndex
                    ? "border-line bg-card text-ink-2"
                    : "border-dashed border-line text-caption"
              }`}
            >
              {p.label}
              {i === phaseIndex ? (
                <span className="sr-only"> (fase atual)</span>
              ) : null}
            </li>
          ))}
        </ol>
        {project.objective ? (
          <p className="text-lg text-ink">{project.objective}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-caption">Andamento</span>
            <Progress
              value={project.progressPct}
              label={`Andamento de ${project.name}`}
            />
          </div>
          {project.targetDate ? (
            <p>
              <span className="text-caption">Entrega final prevista: </span>
              <span className="text-ink">{formatDate(project.targetDate)}</span>
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="entregas" className="flex flex-col gap-3">
        <h2
          id="entregas"
          className="font-heading text-xl font-semibold text-navy"
        >
          Entregas
        </h2>
        {project.milestones.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-ink-2">
            As entregas deste projeto aparecem aqui assim que forem combinadas
            com você.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {project.milestones.map((m, i) => (
              <MilestoneCard
                key={i}
                milestone={m}
                accent={accent}
                projectCode={project.code}
                canConfirm={
                  project.clientCanConfirm &&
                  session.actor.contactRole === "client_approver"
                }
              />
            ))}
          </ol>
        )}
      </section>

      {project.otherWorkstreams.length > 0 ? (
        <section
          aria-labelledby="outras-frentes"
          className="flex flex-col gap-3"
        >
          <h2
            id="outras-frentes"
            className="font-heading text-xl font-semibold text-navy"
          >
            Outras frentes de trabalho
          </h2>
          <Workstreams items={project.otherWorkstreams} />
        </section>
      ) : null}

      <section aria-labelledby="arquivos" className="flex flex-col gap-3">
        <h2
          id="arquivos"
          className="font-heading text-xl font-semibold text-navy"
        >
          Arquivos entregues
        </h2>
        {files.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-ink-2">
            Os arquivos que a equipe entregar aparecem aqui.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
              >
                <a
                  href={`/portal/${cliente}/${project.code}/arquivos/${f.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 basis-48 font-medium break-words text-info-fg underline-offset-2 hover:underline"
                >
                  {f.filename}
                </a>
                <span className="text-sm text-caption">
                  {formatBytes(f.sizeBytes)} · {formatTimestampDate(f.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="relatorios" className="flex flex-col gap-3">
        <h2
          id="relatorios"
          className="font-heading text-xl font-semibold text-navy"
        >
          Relatórios de andamento
        </h2>
        {project.reports.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-ink-2">
            Os relatórios de andamento aparecem aqui quando forem publicados.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {project.reports.map((r, i) => (
              <li
                key={`${r.publishedAt}-${i}`}
                className="rounded-2xl border border-line bg-card"
              >
                <details open={i === 0} className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium text-navy">
                      De {formatDate(r.periodStart)} a {formatDate(r.periodEnd)}
                    </span>
                    <span className="text-sm text-caption">
                      publicado em {formatTimestampDate(r.publishedAt)}
                    </span>
                  </summary>
                  <div className="border-t border-line px-4 py-3">
                    <Markdown text={r.bodyMd} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="conversa" className="flex flex-col gap-3">
        <h2
          id="conversa"
          className="font-heading text-xl font-semibold text-navy"
        >
          Conversa com a equipe
        </h2>
        <p className="text-sm text-ink-2">
          Dúvidas, pedidos e retornos sobre este projeto. A equipe da Harmony
          recebe o aviso e responde por aqui.
        </p>
        <ChannelThread
          messages={messages}
          clientLabel={session.clientName}
          teamLabel="Equipe Harmony"
          empty="Ainda não há mensagens neste projeto."
        />
        <MessageBox projectCode={project.code} />
      </section>
    </main>
  );
}

function MilestoneCard({
  milestone: m,
  accent,
  projectCode,
  canConfirm,
}: {
  milestone: PortalMilestone;
  /** Cor de destaque do cliente, na borda do cartão. */
  accent: string | null;
  projectCode: string;
  /** O projeto liga a opção e o contato é o decisor (D9). */
  canConfirm: boolean;
}) {
  const status = MILESTONE[m.status];
  const delivered = m.status === "delivered" || m.status === "accepted";
  return (
    <li
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5"
      style={accentBorder(accent)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 basis-56 font-heading text-lg font-semibold break-words text-navy">
          {m.title}
        </h3>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      {m.description ? (
        <p className="whitespace-pre-wrap text-ink">{m.description}</p>
      ) : null}
      <p className="text-sm text-ink-2">
        {m.deliveredAt
          ? `Entregue em ${formatTimestampDate(m.deliveredAt)}`
          : m.dueDate
            ? `Previsão: ${formatDate(m.dueDate)}`
            : "Data a combinar"}
        {!m.deliveredAt && m.revisions > 0
          ? ` · data revista ${m.revisions === 1 ? "1 vez" : `${m.revisions} vezes`}`
          : ""}
      </p>
      {m.receivedAt ? (
        <p className="flex items-center gap-1.5 text-sm text-ok-fg">
          <PackageCheck aria-hidden="true" className="size-4 shrink-0" />
          Recebimento confirmado
          {m.receivedBy ? ` por ${m.receivedBy}` : ""} em{" "}
          {formatTimestampDate(m.receivedAt)}
        </p>
      ) : canConfirm && delivered ? (
        <ReceiptButton
          projectCode={projectCode}
          milestoneId={m.id}
          title={m.title}
        />
      ) : null}
      {m.workstreams.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-medium text-navy">Frentes de trabalho</p>
          <Workstreams items={m.workstreams} />
        </div>
      ) : null}
    </li>
  );
}

function Workstreams({ items }: { items: PortalWorkstream[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((w, i) => (
        <li
          key={i}
          className="flex flex-col gap-1.5 rounded-xl bg-off p-3 sm:flex-row sm:items-center sm:gap-4"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium break-words text-ink">{w.title}</span>
            {w.description ? (
              <span className="text-sm break-words text-ink-2">
                {w.description}
              </span>
            ) : null}
          </div>
          <Progress value={w.progressPct} label={`Andamento de ${w.title}`} />
        </li>
      ))}
    </ul>
  );
}
