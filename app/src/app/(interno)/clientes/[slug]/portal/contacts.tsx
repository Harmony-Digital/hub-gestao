"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import {
  CircleCheck,
  Copy,
  Eraser,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  Plus,
  UserX,
} from "lucide-react";
import {
  ErrorNote,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import type { AccessStatus, ContactRole } from "@/modules/portal/access";
import {
  criarContato,
  enviarConvitePorEmail,
  excluirDadosCliente,
  excluirDadosContato,
  gerarLinkPortal,
  revogarAcessoPortal,
} from "./actions";
import { PORTAL_IDLE, ROLE_LABEL, type PortalFormState } from "./form";

/** Para quem o convite pode ir por e-mail, e se o envio está ligado no servidor. */
type InviteEmail = { contactId: string; to: string; on: boolean };

/**
 * O link de uso único, uma vez só, com o botão de copiar, e a mensagem de convite pronta
 * (OB-13), que o dono revisa e manda: copiando, por onde preferir, ou pelo Hub, por
 * e-mail, quando o Resend está configurado (D9). Nada sai sem o clique do dono.
 */
function LinkOnce({
  link,
  invite,
  email,
}: {
  link: string;
  invite?: string;
  email?: InviteEmail;
}) {
  const id = useId();
  const [copied, setCopied] = useState<"link" | "invite" | null>(null);
  const [sending, startSending] = useTransition();
  const [sent, setSent] = useState<PortalFormState>(PORTAL_IDLE);
  const message = useRef<HTMLTextAreaElement>(null);
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
            setCopied("link");
          }}
        >
          {copied === "link" ? (
            <CircleCheck aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {copied === "link" ? "Copiado" : "Copiar link"}
        </Button>
      </div>
      {invite ? (
        <div className="flex flex-col gap-1.5 border-t border-brand/30 pt-2">
          <label
            htmlFor={`${id}-invite`}
            className="text-sm font-medium text-navy"
          >
            {email?.on
              ? "Mensagem de convite (revise; mande pelo Hub ou copie)"
              : "Mensagem de convite (revise e mande você mesmo)"}
          </label>
          <textarea
            id={`${id}-invite`}
            ref={message}
            defaultValue={invite}
            rows={9}
            className={`${textareaClass} text-sm`}
          />
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(
                  message.current?.value ?? invite,
                );
                setCopied("invite");
              }}
            >
              {copied === "invite" ? (
                <CircleCheck aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied === "invite" ? "Copiada" : "Copiar mensagem"}
            </Button>
            {email ? (
              <Button
                type="button"
                className="ml-2"
                disabled={!email.on || sending || sent.status === "ok"}
                aria-label={`Enviar o convite por e-mail para ${email.to}`}
                onClick={() =>
                  startSending(async () => {
                    setSent(
                      await enviarConvitePorEmail({
                        contactId: email.contactId,
                        link,
                        text: message.current?.value ?? invite,
                      }),
                    );
                  })
                }
              >
                {sending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                Enviar por e-mail
              </Button>
            ) : null}
          </div>
          {email && !email.on ? (
            <p className="text-xs text-ink-2">
              O envio por e-mail liga quando o Resend estiver configurado no
              servidor (docs/email.md).
            </p>
          ) : null}
          <div aria-live="polite">
            {sent.status === "error" ? (
              <ErrorNote message={sent.message} />
            ) : sent.status === "ok" ? (
              <p className="flex items-start gap-2 text-sm text-ok-fg">
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                {sent.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Result({
  state,
  email,
}: {
  state: PortalFormState;
  email?: InviteEmail;
}) {
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
          {state.link ? (
            <LinkOnce link={state.link} invite={state.invite} email={email} />
          ) : null}
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
  email,
  emailOn,
  status,
}: {
  contactId: string;
  name: string;
  /** E-mail do contato, para o convite pelo Hub. */
  email: string;
  /** O Resend está configurado no servidor. */
  emailOn: boolean;
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
      <Result state={linkState} email={{ contactId, to: email, on: emailOn }} />
      <Result state={revokeState} />
    </div>
  );
}

/**
 * Do dono: excluir os dados pessoais do contato (LGPD), com confirmação. Não tem volta:
 * nome, e-mail, acesso e as mensagens dele no portal saem; o histórico registra.
 */
export function ContactPrivacy({
  contactId,
  name,
}: {
  contactId: string;
  name: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: PortalFormState, form: FormData) => {
      const result = await excluirDadosContato(previous, form);
      setConfirming(false);
      return result;
    },
    PORTAL_IDLE,
  );
  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="contact_id" value={contactId} />
          <p className="text-sm text-ink">
            Excluir os dados pessoais de {name}? Saem o nome, o e-mail, o acesso
            ao portal e as mensagens que {name} escreveu. Não tem volta: se
            precisar, exporte os dados do cliente antes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Eraser aria-hidden="true" />
              )}
              Sim, excluir os dados
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-danger-fg"
          onClick={() => setConfirming(true)}
          aria-label={`Excluir os dados pessoais de ${name}`}
        >
          <Eraser aria-hidden="true" />
          Excluir os dados pessoais
        </Button>
      )}
      <Result state={state} />
    </div>
  );
}

/** Do dono: fim do contrato, excluir os dados pessoais de todos os contatos do cliente. */
export function ClientPrivacy({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: PortalFormState, form: FormData) => {
      const result = await excluirDadosCliente(previous, form);
      setConfirming(false);
      return result;
    },
    PORTAL_IDLE,
  );
  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="client_id" value={clientId} />
          <p className="text-ink">
            Excluir os dados pessoais de todos os contatos de {clientName}? Cada
            contato perde o acesso, e o nome, o e-mail e as mensagens dele saem.
            Não tem volta: exporte antes, se precisar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Eraser aria-hidden="true" />
              )}
              Sim, excluir de todos
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-danger-fg"
          onClick={() => setConfirming(true)}
        >
          <Eraser aria-hidden="true" />
          Excluir os dados pessoais de todos os contatos
        </Button>
      )}
      <Result state={state} />
    </div>
  );
}
