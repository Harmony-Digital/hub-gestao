"use client";

import { useActionState, useId, useRef, useState } from "react";
import { CircleCheck, LoaderCircle, Upload, X } from "lucide-react";
import { ErrorNote, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { formatBytes, formatTimestampDay } from "@/lib/format";
import type { ClientFile } from "@/modules/attachments/client-files";
import { enviarArquivoAoCliente, tirarArquivoDoCliente } from "./actions";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Arquivos entregues ao cliente: a lista (a equipe abre pelo /anexos) e, para quem pode
 * mandar algo ao cliente (dono e administração), tirar e mandar um novo.
 */
export function ClientFilesEditor({
  projectCode,
  files,
  accept,
  canSend,
}: {
  projectCode: string;
  files: ClientFile[];
  /** Extensões aceitas (vêm do servidor, que é quem decide). */
  accept: string;
  canSend: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
          Nenhum arquivo entregue ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-1 py-1 hover:bg-off"
            >
              <a
                href={`/anexos/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 basis-40 truncate text-sm text-info-fg underline-offset-2 hover:underline"
              >
                {f.filename}
              </a>
              <span className="text-xs text-caption">
                {formatBytes(f.sizeBytes)} · {f.by ?? "Hub"} ·{" "}
                {formatTimestampDay(f.at)}
              </span>
              {canSend ? <RemoveFile id={f.id} filename={f.filename} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canSend ? (
        <SendFile projectCode={projectCode} accept={accept} />
      ) : (
        <p className="text-sm text-caption">
          Mandar arquivo ao cliente é do dono ou da administração.
        </p>
      )}
    </div>
  );
}

function RemoveFile({ id, filename }: { id: string; filename: string }) {
  const [state, action, pending] = useActionState(tirarArquivoDoCliente, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={`Tirar ${filename} do portal`}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <X aria-hidden="true" />
        )}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-xs text-danger-fg">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SendFile({
  projectCode,
  accept,
}: {
  projectCode: string;
  accept: string;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await enviarArquivoAoCliente(previous, data);
      if (result.status === "ok") form.current?.reset();
      return result;
    },
    IDLE,
  );
  const send = useSubmit(action);
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        const file = new FormData(event.currentTarget).get("file");
        if (file instanceof File && file.size > MAX_BYTES) {
          event.preventDefault();
          setTooBig(
            `${file.name} passou de 25 MB. Compacte ou divida o arquivo.`,
          );
          return;
        }
        setTooBig(null);
        send(event);
      }}
      className="flex flex-col gap-1.5"
    >
      <input type="hidden" name="project" value={projectCode} />
      <label htmlFor={`${id}-file`} className="text-sm font-medium text-navy">
        Arquivo para o cliente
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${id}-file`}
          type="file"
          name="file"
          required
          accept={accept}
          disabled={pending}
          className="min-w-0 flex-1 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy hover:file:bg-off"
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          Entregar ao cliente
        </Button>
      </div>
      <p className="text-xs text-caption">
        Até 25 MB: imagens, PDF, texto, CSV, planilhas, documentos e zip. O
        cliente vê e baixa no portal.
      </p>
      <div aria-live="polite">
        {tooBig ? <ErrorNote message={tooBig} /> : null}
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" && state.message ? (
          <p className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
