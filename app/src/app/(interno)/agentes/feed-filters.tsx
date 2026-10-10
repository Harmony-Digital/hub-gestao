"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListFilter, X } from "lucide-react";

const SELECT =
  "h-9 max-w-56 min-w-0 rounded-lg border border-white/20 bg-navy-2 px-2.5 text-sm text-off outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/40";

/**
 * Filtros do feed da Sala de Controle (agente e projeto), guardados no endereço. Cada
 * escolha já aplica; sem JavaScript, o botão Aplicar faz o mesmo.
 */
export function FeedFilters({
  agent,
  project,
  agents,
  projects,
}: {
  agent: string | null;
  project: string | null;
  agents: { id: string; name: string }[];
  projects: { code: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <form
      action="/agentes"
      method="get"
      aria-label="Filtrar a atividade"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget)) {
          if (typeof value === "string" && value) query.set(key, value);
        }
        const qs = query.toString();
        router.push(qs ? `/agentes?${qs}` : "/agentes", { scroll: false });
      }}
    >
      <ListFilter aria-hidden="true" className="size-4 text-off/70" />
      <label className="sr-only" htmlFor="feed-agente">
        Agente
      </label>
      <select
        id="feed-agente"
        name="agente"
        defaultValue={agent ?? ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        <option value="">Todos os agentes</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="feed-projeto">
        Projeto
      </label>
      <select
        id="feed-projeto"
        name="projeto"
        defaultValue={project ?? ""}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className={SELECT}
      >
        <option value="">Todos os projetos</option>
        {projects.map((p) => (
          <option key={p.code} value={p.code}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      <button type="submit" className="sr-only">
        Aplicar
      </button>
      {agent || project ? (
        <Link
          href="/agentes"
          scroll={false}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-off/80 hover:text-off"
        >
          <X aria-hidden="true" className="size-4" />
          Limpar
        </Link>
      ) : null}
    </form>
  );
}
