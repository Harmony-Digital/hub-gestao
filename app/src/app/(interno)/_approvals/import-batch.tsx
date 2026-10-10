"use client";

import { useActionState, useId, useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { ErrorNote, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { aprovarImportacoesEmLote } from "./actions";
import type { DecisionItem } from "./view";

/**
 * Aprovação em lote das importações de projeto (D10): com duas ou mais esperando, o dono
 * marca os projetos e aprova todos de uma vez, com uma confirmação antes. Recusar ou
 * pedir ajuste continua no cartão de cada pedido, logo abaixo. Fica sempre montado no
 * Hoje (do dono), para o aviso do lote não sumir quando a lista esvazia.
 */
export function ImportBatch({ items }: { items: DecisionItem[] }) {
  const id = useId();
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(items.map((i) => i.id)),
  );
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    async (
      previous: Parameters<typeof aprovarImportacoesEmLote>[0],
      form: FormData,
    ) => {
      const result = await aprovarImportacoesEmLote(previous, form);
      setConfirming(false);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const count = items.filter((i) => checked.has(i.id)).length;
  const plural = (n: number) => (n === 1 ? "1 importação" : `${n} importações`);

  const notice = (
    <div aria-live="polite">
      {state.status === "error" ? (
        <ErrorNote message={state.message} />
      ) : state.status === "ok" && state.message ? (
        <p className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}
    </div>
  );
  // Com menos de duas, o lote não aparece; o aviso do último lote continua na tela.
  if (items.length < 2) return state.status === "idle" ? null : notice;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h3
          id={`${id}-titulo`}
          className="font-heading text-base font-semibold text-navy"
        >
          Importações de projeto para revisar{" "}
          <span className="ml-1 font-mono text-sm font-normal text-caption">
            {items.length}
          </span>
        </h3>
        <p className="text-sm text-ink-2">
          Os agentes importaram estes projetos; cada um fica Em revisão até você
          aprovar. Para recusar ou pedir ajuste, use o cartão de cada pedido,
          abaixo.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-1.5">
          <legend className="sr-only">Projetos importados</legend>
          {items.map((item) => (
            <label
              key={item.id}
              className="flex min-w-0 items-center gap-2 text-sm text-ink"
            >
              <input
                type="checkbox"
                name="id"
                value={item.id}
                checked={checked.has(item.id)}
                onChange={(event) => {
                  const next = new Set(checked);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  setChecked(next);
                  setConfirming(false);
                }}
                className="size-4 shrink-0 accent-brand"
              />
              {item.projectCode ? (
                <span className="font-mono text-xs text-ink-2">
                  {item.projectCode}
                </span>
              ) : null}
              <span className="truncate">{item.title}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-ink">
                Aprovar {plural(count)}? Cada projeto sai de Em revisão.
              </span>
              <Button type="submit" disabled={pending || count === 0}>
                {pending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <CircleCheck aria-hidden="true" />
                )}
                Sim, aprovar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={count === 0}
              onClick={() => setConfirming(true)}
            >
              Aprovar as marcadas ({count})
            </Button>
          )}
        </div>
      </form>
      {notice}
    </section>
  );
}
