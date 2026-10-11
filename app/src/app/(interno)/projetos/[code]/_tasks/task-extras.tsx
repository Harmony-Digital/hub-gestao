"use client";

import Link from "next/link";
import {
  useActionState,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Check,
  File as FileIcon,
  FileImage,
  FileText,
  Link2,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Pill } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { formatBytes, formatTimestampDay } from "@/lib/format";
import { STATUS_CATEGORY_TONE } from "@/lib/labels";
import type { AttachmentDto } from "@/modules/attachments/service";
import type { ChecklistItemDto, DependencyRef } from "@/modules/tasks/extras";
import {
  anexarArquivo,
  checklistTarefa,
  dependenciaTarefa,
  removerAnexo,
} from "./actions";
import { IDLE, type ActionState } from "./form";

// Checklist ---------------------------------------------------------------------------

/** Checklist da tarefa: marcar é imediato na tela; o servidor confirma em seguida. */
export function ChecklistEditor({
  code,
  items,
}: {
  code: string;
  items: ChecklistItemDto[];
}) {
  const done = items.filter((i) => i.done).length;
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <>
          <p className="text-xs text-caption">
            {done} de {items.length} feitos
          </p>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      ) : null}
      <AddChecklistItem code={code} />
    </div>
  );
}

function ChecklistRow({ item }: { item: ChecklistItemDto }) {
  const [renameState, renameAction] = useActionState(checklistTarefa, IDLE);
  const [optimistic, setOptimistic] = useOptimistic(item.done);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const rename = useSubmit((form: FormData) => {
    renameAction(form);
    setEditing(false);
  });

  // Marcar e tirar chamam a ação direto dentro da transição: a marca otimista fica até a
  // tela voltar do servidor, sem piscar.
  const run = (fields: Record<string, string>, optimisticDone?: boolean) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(async () => {
      if (optimisticDone !== undefined) setOptimistic(optimisticDone);
      const result = await checklistTarefa(IDLE, form);
      startTransition(() =>
        setError(result.status === "error" ? result.message : null),
      );
    });
  };
  const toggle = () =>
    run({ op: "toggle", id: item.id, done: String(!optimistic) }, !optimistic);
  const remove = () => run({ op: "remove", id: item.id });
  const message =
    error ?? (renameState.status === "error" ? renameState.message : null);

  return (
    <li className="flex flex-col gap-1">
      <div className="group flex min-h-9 items-center gap-2 rounded-lg px-1 hover:bg-off">
        <input
          type="checkbox"
          checked={optimistic}
          disabled={pending}
          onChange={toggle}
          aria-label={`Feito: ${item.text}`}
          className="size-4 shrink-0 accent-[var(--color-brand)]"
        />
        {editing ? (
          <form onSubmit={rename} className="flex flex-1 items-center gap-1">
            <input type="hidden" name="op" value="rename" />
            <input type="hidden" name="id" value={item.id} />
            <input
              name="text"
              defaultValue={item.text}
              maxLength={300}
              required
              autoFocus
              aria-label="Novo texto do item"
              className={`${inputClass} h-8`}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label="Salvar o item"
            >
              <Check aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancelar"
              onClick={() => setEditing(false)}
            >
              <X aria-hidden="true" />
            </Button>
          </form>
        ) : (
          <>
            <span
              className={`min-w-0 flex-1 text-sm break-words ${
                optimistic ? "text-caption line-through" : "text-ink"
              }`}
            >
              {item.text}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Renomear: ${item.text}`}
              className="opacity-60 group-hover:opacity-100"
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Tirar do checklist: ${item.text}`}
              className="opacity-60 group-hover:opacity-100"
              onClick={remove}
            >
              <X aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      {message ? <ErrorNote message={message} /> : null}
    </li>
  );
}

function AddChecklistItem({ code }: { code: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await checklistTarefa(previous, data);
      if (result.status === "ok") form.current?.reset();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-1.5">
      <input type="hidden" name="op" value="add" />
      <input type="hidden" name="code" value={code} />
      <div className="flex gap-2">
        <label htmlFor={`checklist-novo-${code}`} className="sr-only">
          Novo item do checklist
        </label>
        <input
          id={`checklist-novo-${code}`}
          name="text"
          maxLength={300}
          required
          disabled={pending}
          placeholder="Novo item do checklist"
          className={`${inputClass} h-9`}
        />
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Adicionar
        </Button>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}

// Dependências ------------------------------------------------------------------------

type LinkedRef = DependencyRef & { href: string };

function DependencyLink({ dep }: { dep: LinkedRef }) {
  return (
    <Link
      href={dep.href}
      scroll={false}
      prefetch={false}
      className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
    >
      <span className="font-mono text-xs font-semibold text-caption">
        {dep.code}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{dep.title}</span>
      <Pill tone={STATUS_CATEGORY_TONE[dep.status_category]}>
        {dep.status_name}
      </Pill>
    </Link>
  );
}

/** "Depende de" (com remover e adicionar) e "Segura" (as que esperam por esta). */
export function DependenciesEditor({
  code,
  blockedBy,
  blocks,
  peers = [],
}: {
  code: string;
  blockedBy: LinkedRef[];
  blocks: LinkedRef[];
  /** Outras tarefas do projeto, sugeridas pelo nome no campo de adicionar. */
  peers?: { code: string; title: string }[];
}) {
  const waiting = blockedBy.filter((d) => d.status_category !== "done");
  return (
    <div className="flex flex-col gap-3">
      {waiting.length > 0 ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-fg">
          Aguardando {waiting.map((d) => d.code).join(", ")}.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-caption uppercase">
          Depende de
        </p>
        {blockedBy.length === 0 ? (
          <p className="text-sm text-caption">Nenhuma tarefa.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {blockedBy.map((dep) => (
              <li key={dep.code} className="flex items-center gap-2">
                <DependencyLink dep={dep} />
                <RemoveDependency code={code} other={dep.code} />
              </li>
            ))}
          </ul>
        )}
        <AddDependency
          code={code}
          peers={peers.filter(
            (p) => !blockedBy.some((dep) => dep.code === p.code),
          )}
        />
      </div>
      {blocks.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-caption uppercase">Segura</p>
          <ul className="flex flex-col gap-1">
            {blocks.map((dep) => (
              <li key={dep.code} className="flex items-center gap-2">
                <DependencyLink dep={dep} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RemoveDependency({ code, other }: { code: string; other: string }) {
  const [state, action, pending] = useActionState(dependenciaTarefa, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end">
      <input type="hidden" name="op" value="remove" />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="other" value={other} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={`${code} deixa de depender de ${other}`}
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

function AddDependency({
  code,
  peers,
}: {
  code: string;
  peers: { code: string; title: string }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const listId = `dependencias-${code}`;
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await dependenciaTarefa(previous, data);
      if (result.status === "ok") form.current?.reset();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-1.5">
      <input type="hidden" name="op" value="add" />
      <input type="hidden" name="code" value={code} />
      <div className="flex gap-2">
        <label htmlFor={`dependencia-${code}`} className="sr-only">
          Tarefa de que esta depende (nome ou código)
        </label>
        {/* Digitar parte do nome mostra as tarefas do projeto; a escolhida entra como
            "HUB-12 · Título", e o código no começo é o que vale. */}
        <input
          id={`dependencia-${code}`}
          name="other"
          list={peers.length > 0 ? listId : undefined}
          maxLength={340}
          required
          disabled={pending}
          autoComplete="off"
          placeholder="Nome ou código da tarefa"
          className={`${inputClass} h-9 min-w-0`}
        />
        {peers.length > 0 ? (
          <datalist id={listId}>
            {peers.map((p) => (
              <option key={p.code} value={`${p.code} · ${p.title}`} />
            ))}
          </datalist>
        ) : null}
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Link2 aria-hidden="true" />
          )}
          Depender
        </Button>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}

// Anexos ------------------------------------------------------------------------------

const MAX_BYTES = 25 * 1024 * 1024;

function AttachmentIcon({ mime }: { mime: string }) {
  const Icon = mime.startsWith("image/")
    ? FileImage
    : mime.startsWith("text/") || mime === "application/pdf"
      ? FileText
      : FileIcon;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-caption" />;
}

/** Anexos da tarefa: abrir (imagem e PDF no navegador), tirar e anexar até 25 MB. */
export function AttachmentsEditor({
  code,
  items,
  accept,
}: {
  code: string;
  items: AttachmentDto[];
  /** Extensões aceitas (vêm do servidor, que é quem decide). */
  accept: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-off"
            >
              <AttachmentIcon mime={a.mime} />
              <a
                href={`/anexos/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-info-fg underline-offset-2 hover:underline"
              >
                {a.filename}
              </a>
              <span className="shrink-0 text-xs text-caption">
                {formatBytes(a.size_bytes)} · {a.uploaded_by?.name ?? "Hub"} ·{" "}
                {formatTimestampDay(a.created_at)}
              </span>
              <RemoveAttachment id={a.id} filename={a.filename} />
            </li>
          ))}
        </ul>
      ) : null}
      <UploadAttachment code={code} accept={accept} />
    </div>
  );
}

function RemoveAttachment({ id, filename }: { id: string; filename: string }) {
  const [state, action, pending] = useActionState(removerAnexo, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label={`Tirar o anexo ${filename}`}
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

function UploadAttachment({ code, accept }: { code: string; accept: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData): Promise<ActionState> => {
      // O envio pode cair antes de chegar à ação (corpo grande demais, conexão perdida):
      // vira aviso no formulário, sem derrubar a tela da tarefa.
      try {
        const result = await anexarArquivo(previous, data);
        if (result.status === "ok") form.current?.reset();
        return result;
      } catch {
        return {
          status: "error",
          message:
            "O arquivo não chegou ao Hub. Confira a conexão e tente de novo.",
        };
      }
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
      <input type="hidden" name="code" value={code} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`anexo-${code}`} className="sr-only">
          Arquivo para anexar
        </label>
        <input
          id={`anexo-${code}`}
          type="file"
          name="file"
          required
          accept={accept}
          disabled={pending}
          className="min-w-0 flex-1 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy hover:file:bg-off"
        />
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Paperclip aria-hidden="true" />
          )}
          Anexar
        </Button>
      </div>
      <p className="text-xs text-caption">
        Até 25 MB: imagens, PDF, texto, CSV, planilhas, documentos e zip.
      </p>
      {tooBig ? <ErrorNote message={tooBig} /> : null}
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
