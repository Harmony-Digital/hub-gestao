import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Bot } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import {
  listAgentsConsole,
  type ConsoleAgent,
  type ConsoleKey,
} from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import { listProjects } from "@/modules/projects/service";
import { KIND_LABELS, SCOPE_LABELS, type KeyScope } from "./form";
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

export default function AgentesPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Sala de Controle" }]}
        title="Sala de Controle"
        description="Quem opera o Hub pela API e pelo MCP. Cada agente entra com chave própria, só com as permissões e os projetos que você liberar, e tudo o que ele faz fica no histórico."
      />
      <main className="flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8">
        <Suspense fallback={<ConsoleSkeleton />}>
          <AgentsConsoleView />
        </Suspense>
      </main>
    </>
  );
}

async function AgentsConsoleView() {
  const user = await getCurrentUser();
  const { data, projects } = await inTx(
    {
      db: await getDb(),
      actor: user.actor,
      source: "ui",
      requestId: randomUUID(),
    },
    async (t) => ({
      data: await listAgentsConsole(t),
      projects: (await listProjects(t)).items.map((p) => ({
        code: p.code,
        name: p.name,
      })),
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
    <div className="flex flex-col gap-6">
      {data.canManage ? <NovoAgenteForm /> : null}

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
                <h2 className="font-heading text-lg font-semibold text-navy">
                  {agent.name}
                </h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[agent.status]}`}
                >
                  {STATUS_LABEL[agent.status]}
                </span>
                <span className="text-sm text-caption">
                  {KIND_LABELS[agent.kind]} · desde{" "}
                  {date.format(new Date(agent.createdAt))}
                </span>
              </div>

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
                            <th className="py-2 pr-3 font-medium">Projetos</th>
                            <th className="py-2 pr-3 font-medium">Validade</th>
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
