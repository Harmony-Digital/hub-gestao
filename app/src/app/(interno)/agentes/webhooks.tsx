"use client";

import { useActionState, useId, useState } from "react";
import {
  CircleCheck,
  Copy,
  KeyRound,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Send,
} from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_EVENTS,
  EVENT_LABEL,
  WEBHOOK_EVENTS,
} from "@/modules/webhooks/events";
import {
  cadastrarWebhook,
  mudarWebhook,
  trocarSegredoWebhook,
} from "./webhooks-actions";
import { WEBHOOK_IDLE, type WebhookFormState } from "./webhooks-form";

/** O segredo, uma vez só, com o botão de copiar. */
function SecretOnce({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand-soft/10 p-3">
      <p className="text-sm font-medium text-navy">
        Segredo do webhook (aparece só agora)
      </p>
      <code className="font-mono text-xs break-all text-ink">{secret}</code>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {copied ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {copied ? "Copiado" : "Copiar segredo"}
        </Button>
      </div>
    </div>
  );
}

function Result({ state }: { state: WebhookFormState }) {
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      {state.status === "ok" ? (
        <>
          <p className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {state.message}
          </p>
          {state.secret ? <SecretOnce secret={state.secret} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** Cadastro de webhook: endereço público (https) e os eventos que ele recebe. */
export function NovoWebhookForm() {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: WebhookFormState, form: FormData) => {
      const result = await cadastrarWebhook(previous, form);
      // Cadastrou: o formulário recomeça limpo (o segredo fica no aviso).
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    WEBHOOK_IDLE,
  );
  const submit = useSubmit(action);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4">
      <form key={round} onSubmit={submit} className="flex flex-col gap-3">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${id}-url`}
              className="text-sm font-medium text-navy"
            >
              Endereço que recebe os avisos
            </label>
            <input
              id={`${id}-url`}
              name="url"
              type="url"
              required
              maxLength={500}
              spellCheck={false}
              placeholder="https://hermes.exemplo.com.br/hub"
              className={`${inputClass} font-mono text-sm`}
            />
            <p className="text-xs text-caption">
              Público e com https. Sem senha no endereço: quem recebe confere a
              assinatura com o segredo.
            </p>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-medium text-navy">Eventos</legend>
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex min-w-0 items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="event"
                    value={event}
                    defaultChecked={DEFAULT_EVENTS.includes(event)}
                    className="size-4 shrink-0 accent-brand"
                  />
                  <span className="truncate">{EVENT_LABEL[event]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Cadastrar webhook
          </Button>
        </div>
      </form>
      <Result state={state} />
    </div>
  );
}

/** Enviar teste, trocar o segredo (com confirmação) e pausar ou reativar. */
export function WebhookControls({
  id,
  url,
  active,
}: {
  id: string;
  url: string;
  active: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(mudarWebhook, WEBHOOK_IDLE);
  const [secretState, rotate, rotating] = useActionState(
    async (previous: WebhookFormState, form: FormData) => {
      const result = await trocarSegredoWebhook(previous, form);
      setConfirming(false);
      return result;
    },
    WEBHOOK_IDLE,
  );
  const busy = pending || rotating;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={action} className="contents">
          <input type="hidden" name="id" value={id} />
          {active ? (
            <Button
              type="submit"
              name="intent"
              value="testar"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Enviar um aviso de teste para ${url}`}
            >
              <Send aria-hidden="true" />
              Enviar teste
            </Button>
          ) : null}
          <Button
            type="submit"
            name="intent"
            value={active ? "pausar" : "reativar"}
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`${active ? "Pausar" : "Reativar"} o webhook ${url}`}
          >
            {active ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {active ? "Pausar" : "Reativar"}
          </Button>
        </form>
        {confirming ? (
          <form action={rotate} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <span className="text-sm text-ink">
              O segredo atual para de valer na hora. Trocar?
            </span>
            <Button type="submit" size="sm" disabled={busy}>
              {rotating ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <KeyRound aria-hidden="true" />
              )}
              Sim, trocar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(true)}
            aria-label={`Trocar o segredo do webhook ${url}`}
          >
            <KeyRound aria-hidden="true" />
            Trocar segredo
          </Button>
        )}
      </div>
      <Result state={state} />
      <Result state={secretState} />
    </div>
  );
}
