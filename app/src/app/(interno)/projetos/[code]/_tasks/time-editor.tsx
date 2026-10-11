"use client";

import { useActionState, useId } from "react";
import { LoaderCircle } from "lucide-react";
import { Avatar } from "@/components/shell/pill";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { formatDuration } from "@/lib/duration";
import { formatDate, initials } from "@/lib/format";
import type { TimeEntryDto } from "@/modules/time/service";
import { lancarTempo } from "./actions";

/** Tempo da tarefa no painel: o total contra a estimativa, lançar e as entradas. */
export function TimeEditor({
  code,
  totalMinutes,
  estimateMinutes,
  entries,
  today,
  canLog,
}: {
  code: string;
  totalMinutes: number;
  estimateMinutes: number | null;
  entries: TimeEntryDto[];
  today: string;
  /** Projeto arquivado é só consulta. */
  canLog: boolean;
}) {
  const [state, action, pending] = useActionState(lancarTempo, IDLE);
  const submit = useSubmit(action);
  const ids = useId();
  const over = estimateMinutes !== null && totalMinutes > estimateMinutes;
  const pct =
    estimateMinutes && estimateMinutes > 0
      ? Math.min(100, Math.round((totalMinutes / estimateMinutes) * 100))
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink">
          {formatDuration(totalMinutes)} registrados
          {estimateMinutes !== null
            ? ` de ${formatDuration(estimateMinutes)} estimados`
            : ", sem estimativa"}
          {over ? (
            <span className="font-semibold text-danger-fg">
              {" "}
              · acima da estimativa
            </span>
          ) : null}
        </p>
        {pct !== null ? (
          <span
            aria-hidden="true"
            className="block h-1.5 w-full overflow-hidden rounded-full bg-off-2"
          >
            <span
              className={`block h-full rounded-full ${over ? "bg-danger" : "bg-brand"}`}
              style={{ width: `${pct}%` }}
            />
          </span>
        ) : null}
      </div>

      {canLog ? (
        <form
          // Recomeça limpo depois de cada lançamento (a lista muda).
          key={`${entries.length}:${totalMinutes}`}
          onSubmit={submit}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="code" value={code} />
          <fieldset
            disabled={pending}
            className="grid min-w-0 gap-2 sm:grid-cols-[7rem_10rem_minmax(0,1fr)]"
          >
            <Field id={`${ids}-tempo`} label="Tempo">
              <input
                id={`${ids}-tempo`}
                name="minutes"
                required
                inputMode="text"
                placeholder="1h30"
                className={inputClass}
              />
            </Field>
            <Field id={`${ids}-dia`} label="Dia">
              <input
                id={`${ids}-dia`}
                type="date"
                name="entry_date"
                defaultValue={today}
                max={today}
                className={inputClass}
              />
            </Field>
            <Field id={`${ids}-nota`} label="Nota (opcional)">
              <input
                id={`${ids}-nota`}
                name="note"
                maxLength={500}
                className={inputClass}
              />
            </Field>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              Lançar tempo
            </Button>
            <span aria-live="polite" className="text-xs text-ok-fg">
              {state.status === "ok" ? state.message : null}
            </span>
          </div>
          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-2">Nenhum tempo registrado.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="w-24 shrink-0 text-xs text-ink-2">
                {formatDate(e.entry_date)}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ink">
                <Avatar
                  text={initials(e.actor.name)}
                  agent={e.actor.type === "agent"}
                />
                <span className="truncate">{e.actor.name ?? "Sem nome"}</span>
              </span>
              <span className="font-mono text-xs font-semibold text-navy">
                {formatDuration(e.minutes)}
              </span>
              {e.note ? (
                <span className="basis-full text-xs text-ink-2">{e.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
