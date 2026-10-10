"use client";

import { inputClass } from "@/components/forms";
import type { AssigneeOption } from "@/modules/tasks/board";

/**
 * Quem destrava a tarefa bloqueada (opcional): uma pessoa ou um agente do projeto. Quem
 * for indicado recebe um aviso e vê a tarefa em "Esperando você", no Hoje.
 */
export function WaitingOnSelect({
  id,
  assignees,
  disabled = false,
}: {
  id: string;
  assignees: AssigneeOption[];
  disabled?: boolean;
}) {
  const people = assignees.filter((a) => a.type === "user");
  const agents = assignees.filter((a) => a.type === "agent");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-navy">
        Quem destrava (opcional)
      </label>
      <select
        id={id}
        name="waiting_on"
        defaultValue=""
        disabled={disabled}
        className={inputClass}
      >
        <option value="">Ninguém em especial</option>
        {people.length > 0 ? (
          <optgroup label="Pessoas">
            {people.map((p) => (
              <option key={p.id} value={`user:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {agents.length > 0 ? (
          <optgroup label="Agentes">
            {agents.map((a) => (
              <option key={a.id} value={`agent:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <p className="text-xs text-caption">
        Quem for indicado recebe um aviso e vê a tarefa em “Esperando você”, no
        Hoje.
      </p>
    </div>
  );
}
