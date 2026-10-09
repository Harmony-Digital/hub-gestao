"use client";

import { useActionState, useState } from "react";
import { CircleAlert, LoaderCircle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INITIAL_LOGIN_STATE, type LoginState } from "@/lib/auth/login-state";
import { entrarComSenha, enviarLinkDeAcesso } from "./actions";

type Props = {
  next: string;
  initialError: string | null;
  magicLink: boolean;
  configured: boolean;
};

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-paper px-3 text-[15px] text-ink outline-none transition-colors placeholder:text-mist-2 focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60 aria-invalid:border-danger";

export function LoginForm({
  next,
  initialError,
  magicLink,
  configured,
}: Props) {
  const [password, passwordAction, passwordPending] = useActionState(
    entrarComSenha,
    INITIAL_LOGIN_STATE,
  );
  const [link, linkAction, linkPending] = useActionState(
    enviarLinkDeAcesso,
    INITIAL_LOGIN_STATE,
  );
  const [last, setLast] = useState<"password" | "link" | null>(null);

  const state: LoginState =
    last === "link"
      ? link
      : last === "password"
        ? password
        : INITIAL_LOGIN_STATE;
  const pending = passwordPending || linkPending;
  const errorMessage =
    state.status === "error"
      ? state.message
      : last === null
        ? initialError
        : null;
  const email =
    state.status === "error" && state.email !== undefined ? state.email : "";
  // Campos em vermelho só quando o envio falhou; aviso vindo do endereço não é culpa deles.
  const fieldsInvalid = state.status === "error";

  if (!configured) {
    return (
      <p
        role="alert"
        className="mt-6 flex gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn-fg"
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />O
        login ainda não foi configurado neste servidor. Avise o Fábio.
      </p>
    );
  }

  return (
    <form action={passwordAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-navy">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          maxLength={254}
          defaultValue={email}
          disabled={pending}
          aria-invalid={fieldsInvalid || undefined}
          aria-describedby={errorMessage ? "login-mensagem" : undefined}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-navy">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          disabled={pending}
          aria-invalid={fieldsInvalid || undefined}
          aria-describedby={errorMessage ? "login-mensagem" : undefined}
          className={inputClass}
        />
      </div>

      <div id="login-mensagem" aria-live="polite">
        {errorMessage ? (
          <p
            role="alert"
            className="flex gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-fg"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {errorMessage}
          </p>
        ) : state.status === "sent" ? (
          <p className="flex gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
            <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {state.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={pending}
        onClick={() => setLast("password")}
        className="h-11 text-[15px] font-semibold"
      >
        {passwordPending ? (
          <>
            <LoaderCircle aria-hidden="true" className="animate-spin" />
            Entrando
          </>
        ) : (
          "Entrar"
        )}
      </Button>

      {magicLink ? (
        <Button
          type="submit"
          variant="outline"
          size="lg"
          formAction={linkAction}
          formNoValidate
          disabled={pending}
          onClick={() => setLast("link")}
          className="h-11 text-[15px]"
        >
          {linkPending ? (
            <>
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              Enviando o link
            </>
          ) : (
            "Receber link de acesso por e-mail"
          )}
        </Button>
      ) : null}
    </form>
  );
}
