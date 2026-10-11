"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { salvarPessoaNoProjeto, tirarPessoaDoProjeto } from "./members-actions";

type Role = "lead" | "member" | "guest";

const ROLE_LABEL: Record<Role, string> = {
  lead: "Responsável",
  member: "Equipe",
  guest: "Convidado (só acompanha)",
};

export type MemberItem = { profileId: string; name: string; role: Role };
export type PersonOption = { id: string; name: string };

/**
 * Pessoas no projeto (RF-03): quem da equipe comum participa e com que papel. O dono e a
 * administração já veem todos os projetos; aqui entra quem tem o papel Equipe no Hub.
 */
export function MembersEditor({
  projectCode,
  members,
  people,
}: {
  projectCode: string;
  members: MemberItem[];
  /** Pessoas da equipe comum que ainda não estão no projeto. */
  people: PersonOption[];
}) {
  return (
    <section
      aria-labelledby="pessoas-do-projeto"
      className="flex max-w-4xl flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="pessoas-do-projeto"
          className="font-heading text-base font-semibold text-navy"
        >
          Pessoas no projeto
        </h2>
        <p className="text-sm text-ink-2">
          Quem tem o papel Equipe no Hub só vê os projetos em que está aqui.
          Responsável e Equipe trabalham no projeto; o convidado só acompanha. O
          dono e a administração já veem todos.
        </p>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-caption">Ninguém da equipe comum ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => (
            <MemberRow key={m.profileId} projectCode={projectCode} member={m} />
          ))}
        </ul>
      )}
      {people.length > 0 ? (
        <AddMember projectCode={projectCode} people={people} />
      ) : null}
    </section>
  );
}

function MemberRow({
  projectCode,
  member,
}: {
  projectCode: string;
  member: MemberItem;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(salvarPessoaNoProjeto, IDLE);
  const [removeState, remove, removing] = useActionState(
    tirarPessoaDoProjeto,
    IDLE,
  );
  const submit = useSubmit(action);
  const error =
    state.status === "error"
      ? state.message
      : removeState.status === "error"
        ? removeState.message
        : null;
  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-40 flex-1 text-sm font-semibold text-navy">
          {member.name}
        </span>
        <form onSubmit={submit} className="flex items-center gap-2">
          <input type="hidden" name="project" value={projectCode} />
          <input type="hidden" name="profile_id" value={member.profileId} />
          <label htmlFor={`${id}-papel`} className="sr-only">
            Papel de {member.name} no projeto
          </label>
          <select
            id={`${id}-papel`}
            name="role"
            defaultValue={member.role}
            disabled={pending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`${inputClass} w-auto`}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </form>
        <form
          action={remove}
          onSubmit={(event) => {
            if (!window.confirm(`Tirar ${member.name} do projeto?`)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="project" value={projectCode} />
          <input type="hidden" name="profile_id" value={member.profileId} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={removing}
            aria-label={`Tirar ${member.name} do projeto`}
            className="text-danger-fg"
          >
            {removing ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </Button>
        </form>
      </div>
      {error ? <ErrorNote message={error} /> : null}
    </li>
  );
}

function AddMember({
  projectCode,
  people,
}: {
  projectCode: string;
  people: PersonOption[];
}) {
  const id = useId();
  const [state, action, pending] = useActionState(salvarPessoaNoProjeto, IDLE);
  const submit = useSubmit(action);
  return (
    <form
      key={people.map((p) => p.id).join("|")}
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-line pt-3"
    >
      <input type="hidden" name="project" value={projectCode} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label
            htmlFor={`${id}-pessoa`}
            className="text-sm font-medium text-navy"
          >
            Pôr no projeto
          </label>
          <select
            id={`${id}-pessoa`}
            name="profile_id"
            required
            defaultValue=""
            disabled={pending}
            className={inputClass}
          >
            <option value="" disabled>
              Escolha a pessoa
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${id}-papel`}
            className="text-sm font-medium text-navy"
          >
            Papel
          </label>
          <select
            id={`${id}-papel`}
            name="role"
            defaultValue="member"
            disabled={pending}
            className={`${inputClass} w-auto`}
          >
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Pôr no projeto
        </Button>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
