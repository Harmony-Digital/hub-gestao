"use client";

import { useActionState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { definirSenha } from "./actions";
import { INITIAL_PASSWORD_FORM, PASSWORD_MAX, PASSWORD_MIN } from "./form";

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-paper px-3 text-[15px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60 aria-invalid:border-danger";

export function SenhaForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    definirSenha,
    INITIAL_PASSWORD_FORM,
  );
  const invalid = state.status === "error" || undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Ajuda o gerenciador de senhas do navegador a guardar a senha no e-mail certo. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        Nova senha
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          disabled={pending}
          aria-invalid={invalid}
          aria-describedby="senha-regra"
          className={inputClass}
        />
      </label>
      <p id="senha-regra" className="-mt-2 text-xs text-caption">
        De {PASSWORD_MIN} a {PASSWORD_MAX} caracteres. Uma frase longa é mais
        segura e mais fácil de lembrar.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        Confirme a nova senha
        <input
          type="password"
          name="confirmation"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          disabled={pending}
          aria-invalid={invalid}
          className={inputClass}
        />
      </label>

      <div aria-live="polite">
        {state.status === "error" ? (
          <p
            role="alert"
            className="flex gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-fg"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {state.message}
          </p>
        ) : state.status === "ok" ? (
          <p className="flex gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {state.message}
          </p>
        ) : null}
      </div>

      <div>
        <Button type="submit" size="lg" disabled={pending} className="h-11">
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar senha
        </Button>
      </div>
    </form>
  );
}
