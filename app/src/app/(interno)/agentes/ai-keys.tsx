"use client";

import { useActionState, useId, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { LLM_PROVIDERS, PROVIDER_LABEL } from "@/modules/llm/providers";
import { criarChaveIA, revogarChaveIA, trocarChaveIA } from "./ai-keys-actions";

/**
 * Cadastro de chave de IA (só o dono). A chave vai num campo de senha, direto para o
 * servidor, que cifra antes de gravar; depois do envio o formulário recomeça vazio e a
 * chave nunca volta para a tela (só os 4 últimos caracteres).
 */
export function NovaChaveIAForm() {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await criarChaveIA(previous, form);
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form
      key={round}
      onSubmit={submit}
      aria-label="Nova chave de IA"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3"
    >
      <p className="text-sm font-semibold text-navy">Nova chave de IA</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-provedor`} className="text-xs text-caption">
            Provedor
          </label>
          <select
            id={`${id}-provedor`}
            name="provider"
            defaultValue="anthropic"
            disabled={pending}
            className={`${inputClass} w-52`}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
          <label htmlFor={`${id}-nome`} className="text-xs text-caption">
            Nome
          </label>
          <input
            id={`${id}-nome`}
            name="label"
            required
            maxLength={80}
            placeholder="Ex.: Anthropic da Harmony"
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <label htmlFor={`${id}-chave`} className="text-xs text-caption">
            Chave
          </label>
          <input
            id={`${id}-chave`}
            name="key"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            className={inputClass}
          />
        </div>
        <Button type="submit" size="lg" disabled={pending} className="h-10">
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" />
          )}
          Guardar a chave
        </Button>
      </div>
      <p className="text-xs text-caption">
        A chave é cifrada antes de ser gravada e só o servidor a usa, na hora da
        chamada. Ela não aparece de novo: só os 4 últimos caracteres.
      </p>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" && state.message ? (
          <p className="text-sm text-ok-fg">{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}

/** Trocar a chave (mesmo nome e provedor) e revogar, na linha da chave (só o dono). */
export function ChaveIAControls({
  id,
  label,
  last4,
}: {
  id: string;
  label: string;
  last4: string;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await trocarChaveIA(previous, form);
      if (result.status === "ok") setOpen(false);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const [revokeState, revoke, revoking] = useActionState(revogarChaveIA, IDLE);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Trocar
        </Button>
        <form
          action={revoke}
          onSubmit={(event) => {
            const ok = window.confirm(
              `Revogar a chave "${label}" (final ${last4})? Os agentes que a usam ficam sem IA na hora, até receberem outra chave.`,
            );
            if (!ok) event.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={revoking}
          >
            Revogar
          </Button>
        </form>
      </div>
      {open ? (
        <form onSubmit={submit} className="flex items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${inputId}-nova`} className="text-xs text-caption">
              Nova chave para &ldquo;{label}&rdquo;
            </label>
            <input
              id={`${inputId}-nova`}
              name="key"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              className={`${inputClass} w-64`}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Guardar
          </Button>
        </form>
      ) : null}
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : state.status === "ok" && state.message ? (
        <span className="text-xs text-ok-fg">{state.message}</span>
      ) : null}
      {revokeState.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {revokeState.message}
        </span>
      ) : null}
    </div>
  );
}
