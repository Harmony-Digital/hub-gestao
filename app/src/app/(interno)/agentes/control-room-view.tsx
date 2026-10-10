import Link from "next/link";
import { Activity, ShieldAlert } from "lucide-react";
import type {
  ControlRoom,
  ControlRoomFilter,
  DenialItem,
} from "@/modules/agents/control-room";
import { FeedFilters } from "./feed-filters";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
});
const TZ = "America/Sao_Paulo";
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const dayFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: TZ,
});

/** Hora de hoje ("14:03") ou dia e hora ("09/10 14:03"), no fuso da Harmony. */
function when(at: string, today: string): string {
  const date = new Date(at);
  const day = dayFmt.format(date);
  return day === today
    ? timeFmt.format(date)
    : `${day} ${timeFmt.format(date)}`;
}

const DENIAL_LABEL: Record<DenialItem["status"], string> = {
  401: "Chave revogada ou vencida",
  403: "Sem permissão",
  423: "Agente pausado",
};

const SOURCE_LABEL: Record<string, string> = {
  mcp: "MCP",
  api: "API",
  sync: "plan.md",
  cron: "rotina",
  webhook: "webhook",
  system: "sistema",
  ui: "tela",
};

/** Painel da Sala de Controle: números do dia, atividade ao vivo e recusas. */
export function ControlRoomView({
  room,
  filter,
  now,
}: {
  room: ControlRoom;
  filter: ControlRoomFilter;
  /** Agora, lido no pedido (as datas relativas são da hora de quem vê). */
  now: Date;
}) {
  const today = dayFmt.format(now);
  const { kpis } = room;
  const filtered = Boolean(filter.agent || filter.project);
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Agentes ativos"
          value={String(kpis.active)}
          note={
            kpis.paused > 0
              ? `${kpis.paused} ${kpis.paused === 1 ? "pausado" : "pausados"}`
              : undefined
          }
        />
        <Kpi label="Ações nas últimas 24 h" value={String(kpis.actions24h)} />
        <Kpi
          label="Recusas nas últimas 24 h"
          value={String(kpis.denials24h)}
          warn={kpis.denials24h > 0}
        />
        <Kpi
          label="IA neste mês"
          value={money.format(kpis.spentMonth)}
          note={
            kpis.budgetMonth > 0
              ? `de ${money.format(kpis.budgetMonth)} somando os orçamentos`
              : "sem orçamento definido"
          }
        />
      </dl>

      <section
        aria-labelledby="atividade-titulo"
        className="flex flex-col gap-4 rounded-2xl bg-navy p-4 text-off sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="atividade-titulo"
            className="flex items-center gap-2 font-heading text-lg font-semibold"
          >
            <Activity aria-hidden="true" className="size-5 text-brand" />O que
            os agentes estão fazendo
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-off/80">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-ok motion-safe:animate-pulse"
              />
              ao vivo
            </span>
          </h2>
          <FeedFilters
            agent={filter.agent}
            project={filter.project}
            agents={room.filters.agents}
            projects={room.filters.projects}
          />
        </div>
        {room.feed.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-center text-sm text-off/70">
            {filtered
              ? "Nenhuma ação com estes filtros."
              : "Nenhuma ação de agente ainda."}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-white/10">
            {room.feed.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[3.25rem_1fr] gap-x-3 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[6.25rem_1fr_auto]"
              >
                <span className="font-mono text-xs leading-5 text-off/60">
                  {when(e.at, today)}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-brand-soft">
                    {e.agent}
                  </span>
                  {e.role ? (
                    <span className="ml-1 font-mono text-xs text-off/60">
                      {e.role}
                    </span>
                  ) : null}{" "}
                  <span className="text-off/90">{e.text}</span>
                  {/* O código da tarefa já está no texto; o link leva a ela no projeto. */}
                  {e.projectCode ? (
                    <>
                      {" "}
                      <span aria-hidden="true" className="text-off/40">
                        ·
                      </span>{" "}
                      <Link
                        href={
                          e.taskCode
                            ? `/projetos/${e.projectCode}?tarefa=${e.taskCode}`
                            : `/projetos/${e.projectCode}`
                        }
                        aria-label={
                          e.taskCode
                            ? `Abrir ${e.taskCode} no projeto ${e.projectCode}`
                            : `Abrir o projeto ${e.projectCode}`
                        }
                        prefetch={false}
                        className="font-mono text-xs text-off/70 underline-offset-2 hover:text-off hover:underline"
                      >
                        {e.projectCode}
                      </Link>
                    </>
                  ) : null}
                </span>
                <span className="col-start-2 font-mono text-[11px] text-off/50 sm:col-start-3 sm:text-right">
                  {SOURCE_LABEL[e.source] ?? e.source}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        aria-labelledby="recusas-titulo"
        className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
      >
        <h2
          id="recusas-titulo"
          className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
        >
          <ShieldAlert aria-hidden="true" className="size-5 text-danger-fg" />
          Recusas de acesso
          <span className="text-sm font-normal text-caption">
            últimos 30 dias
          </span>
        </h2>
        <p className="text-sm text-ink-2">
          Quando um agente tenta algo que a chave dele não permite, está pausado
          ou usa uma chave revogada ou vencida, o Hub recusa e registra aqui.
          Repetições da mesma recusa entram uma vez por minuto.
        </p>
        {room.denials.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-ink-2">
            Nenhuma recusa nos últimos 30 dias.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {room.denials.map((d) => (
              <li key={d.id} className="flex flex-col gap-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      d.status === 423
                        ? "bg-warn-soft text-warn-fg"
                        : "bg-danger-soft text-danger-fg"
                    }`}
                  >
                    {DENIAL_LABEL[d.status]}
                  </span>
                  <span className="font-semibold text-navy">
                    {d.agent ?? "Agente removido"}
                  </span>
                  <span className="font-mono text-xs text-ink-2">
                    {d.action}
                  </span>
                  <span className="ml-auto font-mono text-xs text-caption">
                    {SOURCE_LABEL[d.source]} · {when(d.at, today)}
                  </span>
                </div>
                <p className="text-ink-2">{d.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  warn = false,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-card p-3 sm:p-4">
      <dt className="text-xs font-medium text-caption">{label}</dt>
      <dd
        className={`font-heading text-2xl font-semibold ${warn ? "text-danger-fg" : "text-navy"}`}
      >
        {value}
      </dd>
      {note ? <dd className="text-xs text-ink-2">{note}</dd> : null}
    </div>
  );
}
