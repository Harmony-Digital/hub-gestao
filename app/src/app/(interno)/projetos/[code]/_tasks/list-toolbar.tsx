"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Columns3, ListFilter, Search, X } from "lucide-react";
import type {
  AssigneeOption,
  DepartmentOption,
  WorkstreamOption,
} from "@/modules/tasks/board";
import {
  COLUMNS,
  hasFilters,
  listQuery,
  PRIORITIES,
  readListState,
  type ListState,
} from "./list-state";

/** Campo compacto da barra (sem a largura cheia dos formulários). */
const SELECT =
  "h-9 max-w-56 min-w-0 rounded-lg border border-input bg-paper px-2.5 text-sm text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30";

const PRIORITY_LABEL = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baixa",
} as const;

const COLUMN_LABEL = {
  frente: "Frente",
  responsavel: "Responsável",
  prazo: "Prazo",
  prioridade: "Prioridade",
} as const;

/**
 * Filtros combináveis (departamento, frente, etiqueta, responsável, prioridade, prazo e busca; na
 * Lista, também agrupar, ordenar e colunas) num formulário GET: cada escolha atualiza o
 * endereço, que é a fonte da verdade da tela (dá para salvar e compartilhar). Funciona
 * também sem JavaScript, com o botão Aplicar.
 */
export function ListToolbar({
  basePath,
  state,
  departments,
  labels,
  workstreams,
  assignees,
  mode,
}: {
  basePath: string;
  state: ListState;
  /** Departamentos com frente no projeto (o filtro aparece quando há algum). */
  departments: Pick<DepartmentOption, "slug" | "name">[];
  /** Etiquetas do workspace (o filtro aparece quando há alguma). */
  labels: { name: string }[];
  workstreams: WorkstreamOption[];
  assignees: AssigneeOption[];
  mode: "list" | "board";
}) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // O endereço também muda por link (Visões, Limpar filtros) sem remontar a barra, e
  // os campos não controlados ficariam com o valor antigo: acompanham o endereço, menos
  // o campo em uso.
  const signature = listQuery(state).toString();
  useEffect(() => {
    const el = form.current;
    if (!el) return;
    const now = readListState(
      Object.fromEntries(new URLSearchParams(signature)),
    );
    const values: Record<string, string> = {
      depto: now.depto ?? "",
      etiqueta: canonicalLabel(now.etiqueta, labels),
      frente: now.frente ?? "",
      resp: now.resp ?? "",
      prazo: now.prazo ?? "",
      busca: now.busca ?? "",
      agrupar: now.agrupar,
      ordem: now.ordem,
      raia: now.raia,
    };
    for (const field of el.querySelectorAll<
      HTMLSelectElement | HTMLInputElement
    >("select[name], input[name]")) {
      if (field === document.activeElement) continue;
      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        field.checked =
          field.name === "prio"
            ? now.prio.includes(field.value as (typeof now.prio)[number])
            : now.colunas.includes(field.value as (typeof now.colunas)[number]);
      } else if (Object.hasOwn(values, field.name)) {
        field.value = values[field.name];
      }
    }
  }, [signature, labels]);
  // O endereço leva só o que difere do padrão (fica curto, salvável e compartilhável).
  const apply = () => {
    if (!form.current) return;
    const values: Record<string, string[]> = {};
    for (const [key, value] of new FormData(form.current).entries()) {
      (values[key] ??= []).push(String(value));
    }
    const query = listQuery(readListState(values)).toString();
    router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
  };
  const submit = () => form.current?.requestSubmit();
  // O filtro não diferencia maiúsculas: o campo mostra o nome cadastrado.
  const label = canonicalLabel(state.etiqueta, labels);
  const people = assignees.filter((a) => a.type === "user");
  const agents = assignees.filter((a) => a.type === "agent");
  const clear = listQuery({
    ...state,
    frente: null,
    depto: null,
    etiqueta: null,
    resp: null,
    prio: [],
    prazo: null,
    busca: null,
  }).toString();

  return (
    <form
      ref={form}
      action={basePath}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      className="flex flex-wrap items-center gap-2"
      aria-label="Filtros"
    >
      <ListFilter aria-hidden="true" className="size-4 text-caption" />
      {departments.length ? (
        <>
          <label className="sr-only" htmlFor="filtro-departamento">
            Departamento
          </label>
          <select
            id="filtro-departamento"
            name="depto"
            defaultValue={state.depto ?? ""}
            onChange={submit}
            className={SELECT}
          >
            <option value="">Todos os departamentos</option>
            {departments.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <label className="sr-only" htmlFor="filtro-frente">
        Frente
      </label>
      <select
        id="filtro-frente"
        name="frente"
        defaultValue={state.frente ?? ""}
        onChange={submit}
        className={SELECT}
      >
        <option value="">Todas as frentes</option>
        <option value="none">Sem frente</option>
        {workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {w.title}
          </option>
        ))}
      </select>

      {labels.length || state.etiqueta ? (
        <>
          <label className="sr-only" htmlFor="filtro-etiqueta">
            Etiqueta
          </label>
          <select
            id="filtro-etiqueta"
            name="etiqueta"
            defaultValue={label}
            onChange={submit}
            className={SELECT}
          >
            <option value="">Qualquer etiqueta</option>
            {labels.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
            {label && !labels.some((l) => l.name === label) ? (
              <option value={label}>{label}</option>
            ) : null}
          </select>
        </>
      ) : null}

      <label className="sr-only" htmlFor="filtro-responsavel">
        Responsável
      </label>
      <select
        id="filtro-responsavel"
        name="resp"
        defaultValue={state.resp ?? ""}
        onChange={submit}
        className={SELECT}
      >
        <option value="">Qualquer responsável</option>
        <option value="eu">Comigo</option>
        <option value="nenhum">Sem responsável</option>
        {people.length ? (
          <optgroup label="Pessoas">
            {people.map((p) => (
              <option key={p.id} value={`user:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {agents.length ? (
          <optgroup label="Agentes">
            {agents.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>

      <details className="relative">
        <summary
          className={`${SELECT} flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
        >
          {state.prio.length
            ? state.prio.map((p) => PRIORITY_LABEL[p]).join(", ")
            : "Qualquer prioridade"}
        </summary>
        <fieldset className="absolute z-20 mt-1 flex w-48 flex-col gap-1 rounded-lg border border-line bg-paper p-2 shadow-lg">
          <legend className="sr-only">Prioridade</legend>
          {PRIORITIES.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="prio"
                value={p}
                defaultChecked={state.prio.includes(p)}
                onChange={submit}
                className="size-4 accent-[var(--color-brand)]"
              />
              {PRIORITY_LABEL[p]}
            </label>
          ))}
        </fieldset>
      </details>

      <label className="sr-only" htmlFor="filtro-prazo">
        Prazo
      </label>
      <select
        id="filtro-prazo"
        name="prazo"
        defaultValue={state.prazo ?? ""}
        onChange={submit}
        className={SELECT}
      >
        <option value="">Qualquer prazo</option>
        <option value="atrasadas">Atrasadas</option>
        <option value="semana">Vencem em 7 dias</option>
        <option value="sem">Sem prazo</option>
      </select>

      <div className="relative">
        <label className="sr-only" htmlFor="filtro-busca">
          Buscar por título ou código
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-caption"
        />
        <input
          id="filtro-busca"
          name="busca"
          type="search"
          defaultValue={state.busca ?? ""}
          maxLength={80}
          placeholder="Título ou código"
          className={`${SELECT} w-44 pl-8`}
        />
      </div>

      {mode === "list" ? (
        <>
          <label className="sr-only" htmlFor="lista-agrupar">
            Agrupar por
          </label>
          <select
            id="lista-agrupar"
            name="agrupar"
            defaultValue={state.agrupar}
            onChange={submit}
            className={SELECT}
          >
            <option value="status">Agrupar por status</option>
            <option value="frente">Agrupar por frente</option>
            <option value="responsavel">Agrupar por responsável</option>
            <option value="prioridade">Agrupar por prioridade</option>
          </select>
          <label className="sr-only" htmlFor="lista-ordem">
            Ordenar
          </label>
          <select
            id="lista-ordem"
            name="ordem"
            defaultValue={state.ordem}
            onChange={submit}
            className={SELECT}
          >
            <option value="padrao">Ordem de trabalho</option>
            <option value="prazo">Por prazo</option>
            <option value="prioridade">Por prioridade</option>
            <option value="recentes">Mais recentes</option>
            <option value="codigo">Por código</option>
          </select>
          <details className="relative">
            <summary
              className={`${SELECT} flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden`}
            >
              <Columns3 aria-hidden="true" className="size-4" />
              Colunas
            </summary>
            <fieldset className="absolute right-0 z-20 mt-1 flex w-44 flex-col gap-1 rounded-lg border border-line bg-paper p-2 shadow-lg">
              <legend className="sr-only">Colunas visíveis</legend>
              {/* Marcador: mantém o parâmetro mesmo com todas desmarcadas. */}
              <input type="hidden" name="col" value="titulo" />
              {COLUMNS.map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="col"
                    value={c}
                    defaultChecked={state.colunas.includes(c)}
                    onChange={submit}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  {COLUMN_LABEL[c]}
                </label>
              ))}
            </fieldset>
          </details>
        </>
      ) : (
        <>
          <label className="sr-only" htmlFor="quadro-raias">
            Raias
          </label>
          <select
            id="quadro-raias"
            name="raia"
            defaultValue={state.raia}
            onChange={submit}
            className={SELECT}
          >
            <option value="nenhuma">Sem raias</option>
            <option value="frente">Raias por frente</option>
            <option value="responsavel">Raias por responsável</option>
          </select>
        </>
      )}

      <button type="submit" className="sr-only">
        Aplicar
      </button>
      {hasFilters(state) ? (
        <Link
          href={clear ? `${basePath}?${clear}` : basePath}
          scroll={false}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-caption hover:text-navy"
        >
          <X aria-hidden="true" className="size-4" />
          Limpar filtros
        </Link>
      ) : null}
    </form>
  );
}

function canonicalLabel(
  name: string | null,
  labels: { name: string }[],
): string {
  if (!name) return "";
  return (
    labels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.name ??
    name
  );
}
