"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import {
  Bookmark,
  BookmarkPlus,
  Building2,
  LoaderCircle,
  X,
} from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import type { SavedViewDto } from "@/modules/views/service";
import {
  apagarVisao,
  definirVisaoDepartamento,
  restaurarVisaoDepartamento,
  salvarVisao,
} from "./actions";
import { IDLE, type ActionState } from "./form";
import { departmentViewQuery } from "./list-state";

/** A visão padrão de um departamento com frente no projeto (RF-23). */
export type DepartmentView = {
  slug: string;
  name: string;
  color: string;
  /** Endereço da visão, já normalizado (com o filtro do departamento). */
  query: string;
  /** O departamento guardou a própria visão (sem ela, só o filtro dele). */
  custom: boolean;
  /** Quem vê pode mudar o padrão (dono, administração ou o responsável do departamento). */
  canEdit: boolean;
};

const CHIP =
  "inline-flex min-h-8 items-center rounded-full border px-3 text-sm";
const CHIP_ON = "border-navy bg-navy text-off";
const CHIP_OFF = "border-line bg-paper text-ink-2 hover:text-navy";

/**
 * Atalhos de visão: Tudo, a visão padrão de cada departamento do projeto (para toda a
 * equipe) e as visões salvas da pessoa, com os botões de salvar a atual e de mudar o
 * padrão do departamento filtrado.
 */
export function SavedViews({
  projectCode,
  type,
  basePath,
  views,
  departments,
  currentDepartment,
  currentQuery,
}: {
  projectCode: string;
  type: "list" | "board";
  basePath: string;
  views: SavedViewDto[];
  departments: DepartmentView[];
  /** Slug do departamento filtrado agora, se houver. */
  currentDepartment: string | null;
  /** Filtros do endereço atual, já normalizados. */
  currentQuery: string;
}) {
  const current = views.find((v) => v.query === currentQuery);
  const currentDept = departments.find((d) => d.query === currentQuery);
  const filtered = departments.find((d) => d.slug === currentDepartment);
  // O que viraria o padrão do departamento filtrado (sem a frente, que é deste projeto).
  const candidate = filtered
    ? departmentViewQuery(type, filtered.slug, currentQuery)
    : null;
  const canSetDefault = Boolean(
    filtered?.canEdit && candidate !== null && candidate !== filtered.query,
  );
  const canReset = Boolean(filtered?.canEdit && filtered.custom);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-caption uppercase">
        Visões
      </span>
      <Link
        href={basePath}
        scroll={false}
        aria-current={currentQuery === "" ? "page" : undefined}
        className={`${CHIP} ${currentQuery === "" ? CHIP_ON : CHIP_OFF}`}
      >
        Tudo
      </Link>
      {departments.map((d) => (
        <Link
          key={d.slug}
          href={`${basePath}?${d.query}`}
          scroll={false}
          aria-current={d.slug === currentDept?.slug ? "page" : undefined}
          title={`Visão padrão de ${d.name}: só as tarefas das frentes dele`}
          className={`${CHIP} gap-1.5 ${
            d.slug === currentDept?.slug ? CHIP_ON : CHIP_OFF
          }`}
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: d.color }}
          />
          <span className="sr-only">Departamento </span>
          {d.name}
        </Link>
      ))}
      {views.map((v) => (
        <span
          key={v.id}
          className={`inline-flex min-h-8 items-center gap-1 rounded-full border pr-1 pl-3 text-sm ${
            v.id === current?.id
              ? "border-navy bg-navy text-off"
              : "border-line bg-paper text-ink-2"
          }`}
        >
          <Link
            href={v.query ? `${basePath}?${v.query}` : basePath}
            scroll={false}
            aria-current={v.id === current?.id ? "page" : undefined}
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Bookmark aria-hidden="true" className="size-3.5" />
            {v.name}
          </Link>
          <DeleteView id={v.id} name={v.name} />
        </span>
      ))}
      {currentQuery && !current && !currentDept ? (
        <FormDialog
          label="Salvar esta visão"
          icon={<BookmarkPlus aria-hidden="true" />}
          variant="ghost"
          size="sm"
          title="Salvar a visão atual"
          description="Os filtros de agora viram um atalho só seu, neste projeto."
        >
          {(close) => (
            <SaveViewForm
              projectCode={projectCode}
              type={type}
              query={currentQuery}
              onDone={close}
            />
          )}
        </FormDialog>
      ) : null}
      {filtered && (canSetDefault || canReset) ? (
        <FormDialog
          label="Padrão do departamento"
          icon={<Building2 aria-hidden="true" />}
          variant="ghost"
          size="sm"
          title={`Visão padrão de ${filtered.name}`}
          description={`Vale para toda a equipe, em todos os projetos, ${
            type === "list" ? "na Lista" : "no Quadro"
          }.`}
        >
          {(close) => (
            <DepartmentDefaultForm
              department={filtered}
              type={type}
              query={canSetDefault ? candidate : null}
              dropsWorkstream={new URLSearchParams(currentQuery).has("frente")}
              canReset={canReset}
              onDone={close}
            />
          )}
        </FormDialog>
      ) : null}
    </div>
  );
}

/** Guardar os filtros de agora como o padrão do departamento, ou voltar ao do Hub. */
function DepartmentDefaultForm({
  department,
  type,
  query,
  dropsWorkstream,
  canReset,
  onDone,
}: {
  department: DepartmentView;
  type: "list" | "board";
  /** O endereço que vira o padrão, ou null quando o de agora já é o padrão. */
  query: string | null;
  dropsWorkstream: boolean;
  canReset: boolean;
  onDone: () => void;
}) {
  const id = useId();
  const closeOnOk =
    (run: (previous: ActionState, form: FormData) => Promise<ActionState>) =>
    async (previous: ActionState, form: FormData) => {
      const result = await run(previous, form);
      if (result.status === "ok") onDone();
      return result;
    };
  const [setState, setAction, setting] = useActionState(
    closeOnOk(definirVisaoDepartamento),
    IDLE,
  );
  const [resetState, resetAction, resetting] = useActionState(
    closeOnOk(restaurarVisaoDepartamento),
    IDLE,
  );
  const submitSet = useSubmit(setAction);
  const submitReset = useSubmit(resetAction);
  const pending = setting || resetting;
  const error =
    setState.status === "error"
      ? setState.message
      : resetState.status === "error"
        ? resetState.message
        : null;
  return (
    <div className="flex flex-col gap-4 text-sm text-ink-2">
      {query !== null ? (
        <p>
          {type === "list"
            ? "Os filtros, o agrupamento, a ordem e as colunas de agora"
            : "Os filtros e as raias de agora"}{" "}
          passam a abrir a visão de {department.name} em todos os projetos.
          {dropsWorkstream
            ? " A frente escolhida não entra: cada projeto tem as suas."
            : ""}
        </p>
      ) : null}
      {canReset ? (
        <p>
          {query !== null
            ? "Ou volte ao padrão do Hub, que"
            : "O padrão do Hub"}{" "}
          mostra só as tarefas das frentes de {department.name}, sem outros
          filtros.
        </p>
      ) : null}
      {/* Os botões ficam juntos no rodapé e enviam cada um o seu formulário. */}
      <form id={`${id}-padrao`} onSubmit={submitSet} hidden>
        <input type="hidden" name="department" value={department.slug} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="query" value={query ?? ""} />
      </form>
      <form id={`${id}-hub`} onSubmit={submitReset} hidden>
        <input type="hidden" name="department" value={department.slug} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="query" value="" />
      </form>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
        {canReset ? (
          <Button
            type="submit"
            form={`${id}-hub`}
            variant="outline"
            size="lg"
            disabled={pending}
          >
            {resetting ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Voltar ao padrão do Hub
          </Button>
        ) : null}
        {query !== null ? (
          <Button
            type="submit"
            form={`${id}-padrao`}
            size="lg"
            disabled={pending}
          >
            {setting ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Usar como padrão
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SaveViewForm({
  projectCode,
  type,
  query,
  onDone,
}: {
  projectCode: string;
  type: "list" | "board";
  query: string;
  onDone: () => void;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarVisao(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="project" value={projectCode} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="query" value={query} />
      <label htmlFor={`${id}-nome`} className="text-sm font-medium text-navy">
        Nome da visão
      </label>
      <input
        id={`${id}-nome`}
        name="name"
        required
        maxLength={60}
        autoFocus
        placeholder="Ex.: Minhas urgentes"
        className={inputClass}
      />
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar a visão
        </Button>
      </div>
    </form>
  );
}

function DeleteView({ id, name }: { id: string; name: string }) {
  const [, action, pending] = useActionState(apagarVisao, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Apagar a visão ${name}`}
        className="inline-flex size-6 items-center justify-center rounded-full opacity-70 hover:opacity-100"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </form>
  );
}
