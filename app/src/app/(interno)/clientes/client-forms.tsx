"use client";

import { useActionState, useId, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, Plus } from "lucide-react";
import {
  ErrorNote,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { salvarCliente } from "../projetos/_admin/actions";

type Client = {
  id: string;
  name: string;
  segment: string | null;
  notes_internal: string | null;
  accent_color: string | null;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Formulário de cliente: vazio para cadastrar, preenchido para editar. */
export function ClientForm({ client }: { client?: Client }) {
  const form = useRef<HTMLFormElement>(null);
  const [accent, setAccent] = useState(client?.accent_color ?? "");
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await salvarCliente(previous, data);
      if (result.status === "ok" && !client) {
        form.current?.reset();
        setAccent("");
      }
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const ids = useId();
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-3">
      {client ? <input type="hidden" name="id" value={client.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${ids}-name`}
            className="text-sm font-medium text-navy"
          >
            Nome do cliente
          </label>
          <input
            id={`${ids}-name`}
            name="name"
            defaultValue={client?.name ?? ""}
            required
            maxLength={160}
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${ids}-segment`}
            className="text-sm font-medium text-navy"
          >
            Segmento (opcional)
          </label>
          <input
            id={`${ids}-segment`}
            name="segment"
            defaultValue={client?.segment ?? ""}
            maxLength={120}
            disabled={pending}
            placeholder="Ex.: Saúde, Restaurantes, Educação"
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${ids}-accent`}
          className="text-sm font-medium text-navy"
        >
          Cor de destaque no portal (opcional)
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${ids}-accent`}
            name="accent_color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            maxLength={7}
            spellCheck={false}
            disabled={pending}
            placeholder="#2E7D6B"
            aria-describedby={`${ids}-accent-hint`}
            className={`${inputClass} max-w-40 font-mono text-sm`}
          />
          <span
            aria-hidden="true"
            className="size-8 shrink-0 rounded-lg border border-line"
            style={
              HEX.test(accent.trim())
                ? { background: accent.trim() }
                : undefined
            }
          />
        </div>
        <p id={`${ids}-accent-hint`} className="text-xs text-caption">
          O código da cor do cliente, com # e seis caracteres. No portal,
          aparece só em detalhes (a borda dos cartões), sem mudar a cor dos
          textos.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${ids}-notes`}
          className="text-sm font-medium text-navy"
        >
          Notas internas (opcional)
        </label>
        <textarea
          id={`${ids}-notes`}
          name="notes_internal"
          defaultValue={client?.notes_internal ?? ""}
          rows={2}
          maxLength={4000}
          disabled={pending}
          placeholder="Só a equipe vê. Nada de senhas ou dados pessoais sensíveis."
          className={textareaClass}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : client ? null : (
            <Plus aria-hidden="true" />
          )}
          {client ? "Salvar o cliente" : "Cadastrar cliente"}
        </Button>
        <span aria-live="polite" className="text-sm">
          {state.status === "ok" && state.message ? (
            <span className="inline-flex items-center gap-1.5 text-ok-fg">
              <CircleCheck aria-hidden="true" className="size-4" />
              {state.message}
            </span>
          ) : null}
        </span>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
