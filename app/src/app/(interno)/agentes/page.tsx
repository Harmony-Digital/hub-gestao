import type { Metadata } from "next";
import { Suspense } from "react";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Progress } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { pageContext } from "@/lib/ui-context";
import {
  controlRoom,
  controlRoomMarker,
  readControlRoomFilter,
} from "@/modules/agents/control-room";
import {
  listAgentsConsole,
  type ConsoleAgent,
  type ConsoleKey,
} from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import {
  listCredentials,
  PROVIDER_LABEL,
  type CredentialItem,
} from "@/modules/llm/credentials";
import { listProjects } from "@/modules/projects/service";
import { LiveRefresh } from "../_live/live-refresh";
import { EditarAgenteButton, PausarAgenteButton } from "./agent-controls";
import { ControlRoomView } from "./control-room-view";
import { KIND_LABELS, SCOPE_LABELS, type KeyScope } from "./form";
import { ChaveIAControls, NovaChaveIAForm } from "./ai-keys";
import { NovaChaveForm, NovoAgenteForm, RevogarChaveButton } from "./forms";

export const metadata: Metadata = { title: "Sala de Controle" };

const STATUS_LABEL: Record<ConsoleAgent["status"], string> = {
  active: "Ativo",
  paused: "Pausado",
  revoked: "Revogado",
};

const STATUS_STYLE: Record<ConsoleAgent["status"], string> = {
  active: "bg-ok-soft text-ok-fg",
  paused: "bg-warn-soft text-warn-fg",
  revoked: "bg-off-2 text-caption",
};

const KEY_STATE_STYLE: Record<ConsoleKey["state"], string> = {
  ativa: "bg-ok-soft text-ok-fg",
  vencida: "bg-warn-soft text-warn-fg",
  revogada: "bg-off-2 text-caption",
};

export default function AgentesPage({ searchParams }: PageProps<"/agentes">) {
  return (
    <>
      <PageHeader
        trail={[{ label: "Sala de Controle" }]}
        title="Sala de Controle"
        description="Quem opera o Hub pela API e pelo MCP, o que cada agente está fazendo e o que o Hub recusou. Cada agente entra com chave própria, só com as permissões e os projetos que você liberar, e tudo o que ele faz fica no histórico."
      />
      <main className="flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8">
        <Suspense fallback={<ConsoleSkeleton />}>
          <AgentsConsoleView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function AgentsConsoleView({
  searchParams,
}: Pick<PageProps<"/agentes">, "searchParams">) {
  const query = await searchParams;
  const filter = readControlRoomFilter(query);
  const { ctx } = await pageContext();
  const now = new Date();
  const canSeeAiKeys = can(ctx.actor, "agent.manage");
  const { data, projects, room, marker, aiKeys } = await inTx(
    ctx,
    async (t) => ({
      data: await listAgentsConsole(t),
      projects: (await listProjects(t)).items.map((p) => ({
        code: p.code,
        name: p.name,
      })),
      room: await controlRoom(t, filter),
      marker: await controlRoomMarker(t),
      aiKeys: canSeeAiKeys ? await listCredentials(t) : [],
    }),
  );
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  });
  const dateTime = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="flex flex-col gap-8">
      <LiveRefresh src="/agentes/mudancas" marker={marker} />
      <ControlRoomView room={room} filter={filter} now={now} />

      <section aria-labelledby="agentes-titulo" className="flex flex-col gap-6">
        <h2
          id="agentes-titulo"
          className="font-heading text-xl font-semibold text-navy"
        >
          Agentes
        </h2>
        {data.canManage ? (
          <NovoAgenteForm departments={data.departments} />
        ) : null}

        {data.agents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-ink-2">
            Nenhum agente cadastrado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Bot aria-hidden="true" className="size-5 text-navy" />
                  <h3 className="font-heading text-lg font-semibold text-navy">
                    {agent.name}
                  </h3>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[agent.status]}`}
                  >
                    {STATUS_LABEL[agent.status]}
                  </span>
                  <span className="text-sm text-caption">
                    {KIND_LABELS[agent.kind]} · desde{" "}
                    {date.format(new Date(agent.createdAt))}
                  </span>
                  {data.canManage && agent.status !== "revoked" ? (
                    <div className="ml-auto flex items-start gap-1">
                      <EditarAgenteButton
                        agent={{
                          id: agent.id,
                          name: agent.name,
                          department: agent.department?.slug ?? null,
                          mission: agent.mission,
                          budgetUsdMonth: agent.budgetUsdMonth,
                          owner: agent.owner?.id ?? null,
                          ownerName: agent.owner?.name ?? null,
                        }}
                        options={{
                          departments: data.departments,
                          people: data.people,
                        }}
                      />
                      <PausarAgenteButton
                        agentId={agent.id}
                        name={agent.name}
                        status={agent.status}
                      />
                    </div>
                  ) : null}
                </div>

                <AgentDetails agent={agent} />

                {data.canManageKeys ? (
                  <>
                    {agent.keys.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <caption className="sr-only">
                            Chaves de {agent.name}
                          </caption>
                          <thead className="text-xs text-caption">
                            <tr>
                              <th className="py-2 pr-3 font-medium">Chave</th>
                              <th className="py-2 pr-3 font-medium">
                                Permissões
                              </th>
                              <th className="py-2 pr-3 font-medium">
                                Projetos
                              </th>
                              <th className="py-2 pr-3 font-medium">
                                Validade
                              </th>
                              <th className="py-2 pr-3 font-medium">
                                Último uso
                              </th>
                              <th className="py-2 font-medium">
                                <span className="sr-only">Ações</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {agent.keys.map((key) => (
                              <tr key={key.id} className="align-top">
                                <td className="py-2 pr-3">
                                  <span className="font-mono text-xs">
                                    {key.prefix}
                                  </span>
                                  <span
                                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${KEY_STATE_STYLE[key.state]}`}
                                  >
                                    {key.state}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 text-ink-2">
                                  {key.scopes
                                    .map((s) =>
                                      s === "workspace:*"
                                        ? "Todos os projetos"
                                        : (SCOPE_LABELS[s as KeyScope] ?? s),
                                    )
                                    .join(", ")}
                                </td>
                                <td className="py-2 pr-3 font-mono text-xs">
                                  {key.projects === "all"
                                    ? "todos"
                                    : key.projects.join(", ")}
                                </td>
                                <td className="py-2 pr-3 whitespace-nowrap">
                                  {date.format(new Date(key.expiresAt))}
                                </td>
                                <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                                  {key.lastUsedAt
                                    ? dateTime.format(new Date(key.lastUsedAt))
                                    : "nunca"}
                                </td>
                                <td className="py-2 text-right">
                                  {key.state === "ativa" ? (
                                    <RevogarChaveButton
                                      keyId={key.id}
                                      prefix={key.prefix}
                                    />
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-2">
                        Este agente ainda não tem chave.
                      </p>
                    )}
                    {agent.status !== "revoked" ? (
                      <NovaChaveForm
                        agentId={agent.id}
                        agentName={agent.name}
                        projects={projects}
                      />
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canSeeAiKeys ? (
        <AiKeysSection
          keys={aiKeys}
          canManage={data.canManageKeys}
          date={date}
        />
      ) : null}
    </div>
  );
}

/** Chaves de IA do workspace (D5): lista para a administração; mudanças só do dono. */
function AiKeysSection({
  keys,
  canManage,
  date,
}: {
  keys: CredentialItem[];
  canManage: boolean;
  date: Intl.DateTimeFormat;
}) {
  return (
    <section aria-labelledby="chaves-ia-titulo" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id="chaves-ia-titulo"
          className="font-heading text-xl font-semibold text-navy"
        >
          Chaves de IA
        </h2>
        <p className="max-w-3xl text-sm text-ink-2">
          Uma chave por provedor e conta, usada pelos agentes internos do Hub
          para redigir. Sem chave, o Hub funciona normalmente, só sem as funções
          de redação. Cadastrar, trocar e revogar é só do dono.
        </p>
      </div>
      {keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
          Nenhuma chave de IA cadastrada.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-off-2 text-xs text-caption">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Provedor
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Nome
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Final
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Agentes
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Situação
                </th>
                {canManage ? (
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {keys.map((k) => (
                <tr key={k.id} className="align-top">
                  <td className="px-3 py-2 text-ink">
                    {PROVIDER_LABEL[k.provider]}
                  </td>
                  <td className="px-3 py-2 text-ink">{k.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">
                    …{k.last4}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{k.agents}</td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {k.revokedAt
                      ? `Revogada em ${date.format(new Date(k.revokedAt))}`
                      : k.rotatedAt
                        ? `Trocada em ${date.format(new Date(k.rotatedAt))}`
                        : `Desde ${date.format(new Date(k.createdAt))}${k.createdBy ? `, por ${k.createdBy}` : ""}`}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2 text-right">
                      {k.revokedAt ? null : (
                        <ChaveIAControls
                          id={k.id}
                          label={k.label}
                          last4={k.last4}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? <NovaChaveIAForm /> : null}
    </section>
  );
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
});

/** Departamento, responsável, missão e o gasto de IA do mês contra o orçamento. */
function AgentDetails({ agent }: { agent: ConsoleAgent }) {
  const spent = money.format(agent.spentUsdMonth);
  const share =
    agent.budgetUsdMonth > 0
      ? (agent.spentUsdMonth / agent.budgetUsdMonth) * 100
      : 0;
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-caption">Departamento:</dt>
          <dd className="text-ink">{agent.department?.name ?? "nenhum"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-caption">Responsável:</dt>
          <dd className="text-ink">{agent.owner?.name ?? "ninguém"}</dd>
        </div>
      </dl>
      {agent.mission ? (
        <p className="max-w-3xl text-sm whitespace-pre-line text-ink-2">
          {agent.mission}
        </p>
      ) : null}
      {agent.budgetUsdMonth > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-2">
            IA neste mês:{" "}
            <span className="font-semibold text-navy">{spent}</span> de{" "}
            {money.format(agent.budgetUsdMonth)}
          </span>
          <Progress
            value={share}
            label={`Orçamento de IA de ${agent.name} usado no mês`}
          />
        </div>
      ) : (
        <p className="text-sm text-caption">
          Sem orçamento de IA definido
          {agent.spentUsdMonth > 0 ? ` · gasto no mês: ${spent}` : ""}.
        </p>
      )}
    </div>
  );
}

function ConsoleSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="h-20 rounded-xl bg-off-2" />
      <div className="h-32 rounded-xl bg-off-2" />
    </div>
  );
}
