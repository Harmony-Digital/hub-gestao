import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Linkified } from "@/components/shell/linkified";
import { PageHeader } from "@/components/shell/page-header";
import { HubError } from "@/lib/errors";
import { formatDayTime } from "@/lib/format";
import { AGENT_ROLE } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import {
  entityTimeline,
  TIMELINE_LIMIT,
  type EntityTimeline,
  type TimelineEntity,
} from "@/modules/activity/timeline";
import { inTx } from "@/modules/context";

export const metadata: Metadata = { title: "Histórico" };

/** O endereço em PT-BR de cada tipo de entidade. */
const TYPES: Record<string, { type: TimelineEntity; noun: string }> = {
  marco: { type: "milestone", noun: "do marco" },
  frente: { type: "workstream", noun: "da frente" },
  projeto: { type: "project", noun: "do projeto" },
  cliente: { type: "client", noun: "do cliente" },
};

/** O papel declarado na escrita, em PT-BR (o contato do cliente escreve pelo portal). */
function roleText(role: string): string {
  return role === "client_contact"
    ? "contato do cliente"
    : (AGENT_ROLE[role] ?? role);
}

/**
 * Linha do tempo de um marco, uma frente, um projeto ou um cliente (RF-43): quem fez o
 * quê e quando, do mais recente para o mais antigo, com os pedidos de aprovação ligados.
 */
export default function HistoricoPage({
  params,
}: PageProps<"/historico/[tipo]/[id]">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-16 w-80 rounded-xl bg-off-2" />
          <div className="h-64 rounded-xl bg-off-2" />
        </div>
      }
    >
      <TimelineView params={params} />
    </Suspense>
  );
}

async function TimelineView({
  params,
}: Pick<PageProps<"/historico/[tipo]/[id]">, "params">) {
  const { tipo, id } = await params;
  const kind = Object.hasOwn(TYPES, tipo) ? TYPES[tipo] : null;
  if (!kind) notFound();
  const { ctx } = await pageContext();
  let data: EntityTimeline;
  try {
    data = await inTx(ctx, (t) => entityTimeline(t, kind.type, id));
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const trail =
    data.type === "client"
      ? [{ label: "Clientes", href: "/clientes" }, { label: data.label }]
      : [
          { label: "Projetos", href: "/projetos" },
          { label: data.projectCode ?? "", href: data.backHref },
          { label: "Histórico" },
        ];
  return (
    <>
      <PageHeader
        trail={trail}
        title={`Histórico ${kind.noun}`}
        description={`${data.label}. Quem fez o quê e quando, do mais recente para o mais antigo, com os pedidos de aprovação ligados.`}
      />
      <main className="flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8">
        {data.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-ink-2">
            Nada registrado ainda.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-xl border border-line bg-card">
            {data.items.map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4"
              >
                <span className="shrink-0 font-mono text-xs text-caption sm:w-28">
                  {formatDayTime(e.at)}
                </span>
                <span className="min-w-0 text-ink-2">
                  <span className="font-semibold text-navy">
                    {e.actor?.name ?? "Hub"}
                  </span>
                  {e.role ? (
                    <span className="text-caption">
                      {" "}
                      como {roleText(e.role)}
                    </span>
                  ) : null}{" "}
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
        {data.items.length >= TIMELINE_LIMIT ? (
          <p className="text-xs text-caption">
            Mostrando os {TIMELINE_LIMIT} registros mais recentes. O histórico
            completo sai na exportação da atividade, no Painel do projeto.
          </p>
        ) : null}
      </main>
    </>
  );
}
