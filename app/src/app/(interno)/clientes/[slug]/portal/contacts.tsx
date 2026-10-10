"use client";

import { useActionState, useId, useState } from "react";
import {
  CircleCheck,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  UserX,
} from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import type { AccessStatus, ContactRole } from "@/modules/portal/access";
import { criarContato, gerarLinkPortal, revogarAcessoPortal } from "./actions";
import { PORTAL_IDLE, ROLE_LABEL, type PortalFormState } from "./form";

/** O link de uso único, uma vez só, com o botão de copiar. */
function LinkOnce({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand/40 bg-brand-soft/10 p-3">
      <p className="text-sm font-medium text-navy">
        Link de acesso (aparece só agora)
      </p>
      <code className="font-mono text-xs break-all text-ink">{link}</code>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {copied ? "Copiado" : "Copiar link"}
        </Button>
      </div>
    </div>
  );
}

function Result({ state }: { state: PortalFormState }) {
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
          {state.link ? <LinkOnce link={state.link} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** Novo contato do cliente: nasce sem acesso ao portal. */
export function NewContactForm({ clientId }: { clientId: string }) {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: PortalFormState, form: FormData) => {
      const result = await criarContato(previous, form);
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    PORTAL_IDLE,
  );
  const submit = useSubmit(action);
  return (
    <div className="flex flex-col gap-3">
      <form key={round} onSubmit={submit} className="flex flex-col gap-3">
        <input type="hidden" name="client_id" value={clientId} />
        <fieldset
          disabled={pending}
          className="grid min-w-0 gap-3 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${id}-name`}
              className="text-sm font-medium text-navy"
            >
              Nome
            </label>
            <input
              id={`${id}-name`}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${id}-email`}
              className="text-sm font-medium text-navy"
            >
              E-mail
            </label>
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-medium text-navy">
              O que pode fazer no portal
            </legend>
            {(Object.keys(ROLE_LABEL) as ContactRole[]).map((role) => (
              <label
                key={role}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="radio"
                  name="role"
                  value={role}
                  defaultChecked={role === "client_viewer"}
                  className="size-4 shrink-0 accent-brand"
                />
                {ROLE_LABEL[role]}
              </label>
            ))}
          </fieldset>
        </fieldset>
        <div>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Cadastrar contato
          </Button>
        </div>
      </form>
      <Result state={state} />
    </div>
  );
}

/** Do dono: liberar o acesso (ou gerar um link novo) e revogar, com confirmação. */
export function ContactAccess({
  contactId,
  name,
  status,
}: {
  contactId: string;
  name: string;
  status: AccessStatus;
}) {
  const [confirming, setConfirming] = useState(false);
  const [linkState, issue, issuing] = useActionState(
    gerarLinkPortal,
    PORTAL_IDLE,
  );
  const [revokeState, revoke, revoking] = useActionState(
    async (previous: PortalFormState, form: FormData) => {
      const result = await revogarAcessoPortal(previous, form);
      setConfirming(false);
      return result;
    },
    PORTAL_IDLE,
  );
  const busy = issuing || revoking;
  const hasAccess = status === "invited" || status === "active";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={issue} className="contents">
          <input type="hidden" name="contact_id" value={contactId} />
          <Button
            type="submit"
            size="sm"
            variant={hasAccess ? "outline" : "default"}
            disabled={busy}
            aria-label={
              hasAccess
                ? `Gerar um link novo para ${name}`
                : `Liberar o acesso de ${name} ao portal`
            }
          >
            {issuing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : hasAccess ? (
              <Link2 aria-hidden="true" />
            ) : (
              <KeyRound aria-hidden="true" />
            )}
            {hasAccess ? "Gerar novo link" : "Liberar acesso"}
          </Button>
        </form>
        {hasAccess ? (
          confirming ? (
            <form action={revoke} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="contact_id" value={contactId} />
              <span className="text-sm text-ink">
                {name} perde o acesso na hora. Revogar?
              </span>
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                disabled={busy}
              >
                {revoking ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <UserX aria-hidden="true" />
                )}
                Sim, revogar
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
              aria-label={`Revogar o acesso de ${name} ao portal`}
              className="text-danger-fg"
            >
              <UserX aria-hidden="true" />
              Revogar acesso
            </Button>
          )
        ) : null}
      </div>
      <Result state={linkState} />
      <Result state={revokeState} />
    </div>
  );
}
