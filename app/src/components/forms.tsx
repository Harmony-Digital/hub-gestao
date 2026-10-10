"use client";

import { useTransition, type FormEvent, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";

/** Peças comuns dos formulários das telas (campos, aviso de erro e envio). */

export const inputClass =
  "h-10 w-full rounded-lg border border-input bg-paper px-3 text-[15px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60";

export const textareaClass =
  "w-full rounded-lg border border-input bg-paper px-3 py-2 text-[15px] leading-relaxed text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60";

/** Rótulo, campo e dica curta embaixo (a dica não entra no nome do campo). */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-caption">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-fg"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

/**
 * Envia pela ação sem o reset automático do React: se der erro, o que foi digitado
 * continua no campo. O botão que enviou (nome e valor) segue junto, como no envio comum.
 */
export function useSubmit(action: (form: FormData) => void) {
  const [, startTransition] = useTransition();
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
    startTransition(() => action(form));
  };
}
