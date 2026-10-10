"use client";

import { useTransition, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";

/** Peças comuns dos formulários das telas (campos, aviso de erro e envio). */

export const inputClass =
  "h-10 w-full rounded-lg border border-input bg-paper px-3 text-[15px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60";

export const textareaClass =
  "w-full rounded-lg border border-input bg-paper px-3 py-2 text-[15px] leading-relaxed text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60";

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
