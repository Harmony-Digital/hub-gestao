"use client";

import Image from "next/image";
import { useActionState, useId, useRef, useState } from "react";
import { ImageUp, LoaderCircle, Trash2 } from "lucide-react";
import { ErrorNote, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { enviarLogoCliente, removerLogoCliente } from "./logo-actions";

/** Os mesmos limites do núcleo (src/modules/clients/logo.ts), para avisar antes de enviar. */
const MAX_BYTES = 1024 * 1024;
const ACCEPT = ".png,.jpg,.jpeg,.webp";

/** Logo do cliente (RF-04): ver, enviar ou trocar e remover. Só dono e administração. */
export function ClientLogo({
  clientId,
  clientName,
  src,
}: {
  clientId: string;
  clientName: string;
  /** Endereço do logo atual (com a versão), ou null. */
  src: string | null;
}) {
  const ids = useId();
  const upload = useRef<HTMLFormElement>(null);
  // O retorno da última ação (enviar ou remover), para a mensagem não ficar velha.
  const [feedback, setFeedback] = useState<ActionState>(IDLE);
  const [, send, sending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await enviarLogoCliente(previous, data);
      if (result.status === "ok") upload.current?.reset();
      setFeedback(result);
      return result;
    },
    IDLE,
  );
  const [, remove, removing] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await removerLogoCliente(previous, data);
      setFeedback(result);
      return result;
    },
    IDLE,
  );
  const submitUpload = useSubmit(send);
  const submitRemove = useSubmit(remove);
  const busy = sending || removing;

  return (
    <section
      aria-labelledby={`${ids}-titulo`}
      className="flex flex-col gap-2 border-t border-line pt-3"
    >
      <h3 id={`${ids}-titulo`} className="text-sm font-medium text-navy">
        Logo
      </h3>
      {src ? (
        <Image
          src={src}
          alt={`Logo de ${clientName}`}
          width={160}
          height={40}
          unoptimized
          className="h-10 w-auto max-w-40 object-contain object-left"
        />
      ) : (
        <p className="text-sm text-ink-2">
          Sem logo: o portal mostra só o nome do cliente.
        </p>
      )}
      <form
        ref={upload}
        onSubmit={(event) => {
          const file = new FormData(event.currentTarget).get("logo");
          if (file instanceof File && file.size > MAX_BYTES) {
            event.preventDefault();
            setFeedback({
              status: "error",
              message: `${file.name} passou de 1 MB. Use uma imagem menor.`,
            });
            return;
          }
          submitUpload(event);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="client_id" value={clientId} />
        <label htmlFor={`${ids}-arquivo`} className="sr-only">
          Imagem do logo de {clientName}
        </label>
        <input
          id={`${ids}-arquivo`}
          type="file"
          name="logo"
          required
          accept={ACCEPT}
          disabled={busy}
          aria-describedby={`${ids}-dica`}
          className="min-w-0 flex-1 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy hover:file:bg-off"
        />
        <Button type="submit" variant="outline" size="lg" disabled={busy}>
          {sending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <ImageUp aria-hidden="true" />
          )}
          {src ? "Trocar o logo" : "Enviar o logo"}
        </Button>
      </form>
      {src ? (
        <form onSubmit={submitRemove}>
          <input type="hidden" name="client_id" value={clientId} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="text-danger-fg"
          >
            {removing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            Remover o logo
          </Button>
        </form>
      ) : null}
      <p id={`${ids}-dica`} className="text-xs text-caption">
        PNG, JPG ou WebP, até 1 MB, de preferência com fundo transparente.
        Aparece aqui e no topo do portal do cliente.
      </p>
      {feedback.status === "error" ? (
        <ErrorNote message={feedback.message} />
      ) : null}
      {feedback.status === "ok" && feedback.message && !busy ? (
        <p role="status" className="text-sm text-ok-fg">
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
