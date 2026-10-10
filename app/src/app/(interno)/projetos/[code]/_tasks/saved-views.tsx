"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Bookmark, BookmarkPlus, LoaderCircle, X } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import type { SavedViewDto } from "@/modules/views/service";
import { apagarVisao, salvarVisao } from "./actions";
import { IDLE, type ActionState } from "./form";

/** Visões salvas da pessoa (atalhos para filtros) e o botão de salvar a atual. */
export function SavedViews({
  projectCode,
  type,
  basePath,
  views,
  currentQuery,
}: {
  projectCode: string;
  type: "list" | "board";
  basePath: string;
  views: SavedViewDto[];
  /** Filtros do endereço atual, já normalizados. */
  currentQuery: string;
}) {
  const current = views.find((v) => v.query === currentQuery);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-caption uppercase">
        Visões
      </span>
      <Link
        href={basePath}
        scroll={false}
        aria-current={currentQuery === "" ? "page" : undefined}
        className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm ${
          currentQuery === ""
            ? "border-navy bg-navy text-off"
            : "border-line bg-paper text-ink-2 hover:text-navy"
        }`}
      >
        Tudo
      </Link>
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
      {currentQuery && !current ? (
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
