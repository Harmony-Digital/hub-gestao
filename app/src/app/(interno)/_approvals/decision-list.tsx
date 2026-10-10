"use client";

import { useActionState, useState } from "react";
import {
  CircleCheck,
  CornerDownRight,
  LoaderCircle,
  MessageSquareText,
  X,
} from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Avatar, Pill } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { initials } from "@/lib/format";
import { decidirPedido } from "./actions";
import type { DecisionItem } from "./view";

/**
 * Pedidos que esperam decisão, com Aprovar, Ajustar e Recusar. O aviso do resultado fica
 * na lista, porque o cartão decidido some quando a tela se atualiza.
 */
export function DecisionList({
  items,
  canDecide,
  emptyText,
}: {
  items: DecisionItem[];
  canDecide: boolean;
  emptyText: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">
        {notice ? (
          <p className="flex items-start gap-2 rounded-xl bg-ok-soft p-3 text-sm text-ok-fg">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="inline-flex size-6 items-center justify-center rounded-md hover:bg-ok/15"
            >
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Fechar o aviso</span>
            </button>
          </p>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <DecisionCard
              key={item.id}
              item={item}
              canDecide={canDecide}
              onDone={setNotice}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

type Mode = "adjust" | "reject" | null;

function DecisionCard({
  item,
  canDecide,
  onDone,
}: {
  item: DecisionItem;
  canDecide: boolean;
  onDone: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await decidirPedido(previous, form);
      if (result.status === "ok") {
        setMode(null);
        onDone(result.message ?? null);
      }
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const titleId = `pedido-${item.id}`;

  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-caption">
        <Pill tone={item.tone}>{item.typeLabel}</Pill>
        {item.projectCode ? (
          <span className="font-mono font-semibold text-ink-2">
            {item.projectCode}
          </span>
        ) : null}
        <span className="ml-auto">{item.age}</span>
        {item.due ? (
          <span className={item.late ? "font-semibold text-danger-fg" : ""}>
            · {item.due}
            {item.late ? " (passou)" : ""}
          </span>
        ) : null}
      </div>

      <h3
        id={titleId}
        className="font-heading text-base leading-snug font-semibold text-navy"
      >
        {item.title}
      </h3>

      {item.summary ? (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">
          {item.summary}
        </p>
      ) : null}

      {item.details.length > 0 ? (
        <dl className="grid gap-x-4 gap-y-1 rounded-xl bg-off p-3 text-sm sm:grid-cols-[max-content_1fr]">
          {item.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="font-medium text-navy">{d.label}</dt>
              <dd className="break-words text-ink-2">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-caption">
        <Avatar
          text={initials(item.requestedBy)}
          agent={item.requestedByAgent}
        />
        <span>
          Preparado por{" "}
          <span className="font-semibold text-ink-2">{item.requestedBy}</span>
          {item.roleLabel ? ` como ${item.roleLabel}` : ""}
        </span>
      </p>

      <p className="flex gap-2 text-sm text-ink-2">
        <CornerDownRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-caption"
        />
        <span>
          <span className="font-semibold text-navy">Ao aprovar,</span>{" "}
          {item.effect}
        </span>
      </p>

      {canDecide ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={item.id} />
          {mode ? (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
                {mode === "adjust"
                  ? "O que deve mudar?"
                  : "Por que recusar? (opcional)"}
                <textarea
                  name="note"
                  required={mode === "adjust"}
                  maxLength={4000}
                  rows={3}
                  autoFocus
                  disabled={pending}
                  placeholder={
                    mode === "adjust"
                      ? "Ex.: mude o prazo para o dia 20 e explique o motivo ao cliente."
                      : "O motivo fica registrado para quem pediu."
                  }
                  className={textareaClass}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  name="decision"
                  value={mode === "adjust" ? "adjust_requested" : "rejected"}
                  size="lg"
                  variant={mode === "reject" ? "destructive" : "default"}
                  disabled={pending}
                >
                  {pending ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {mode === "adjust" ? "Enviar orientação" : "Recusar o pedido"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={pending}
                  onClick={() => setMode(null)}
                >
                  Voltar
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                name="decision"
                value="approved"
                size="lg"
                disabled={pending}
              >
                {pending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <CircleCheck aria-hidden="true" />
                )}
                Aprovar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={pending}
                onClick={() => setMode("adjust")}
              >
                <MessageSquareText aria-hidden="true" />
                Ajustar
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={() => setMode("reject")}
              >
                Recusar
              </Button>
            </div>
          )}
          <div aria-live="polite">
            {state.status === "error" ? (
              <ErrorNote message={state.message} />
            ) : null}
          </div>
        </form>
      ) : (
        <p className="text-sm text-caption">
          Aguardando a decisão do dono do workspace.
        </p>
      )}
    </li>
  );
}
