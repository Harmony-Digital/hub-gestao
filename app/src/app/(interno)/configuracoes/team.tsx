"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Mail, Pause, Play, Plus, UserCog } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import {
  adicionarPessoa,
  enviarConviteEquipe,
  definirResponsavel,
  mudarAcesso,
  mudarPapel,
  renomearWorkspace,
} from "./actions";

/** O que cada papel faz, igual na janela de pôr na equipe e na de mudar o papel. */
const ROLES = [
  {
    value: "member",
    label: "Equipe",
    hint: "Trabalha só nos projetos em que está, em Pessoas no projeto (no Editar projeto de cada um).",
  },
  {
    value: "admin",
    label: "Administração",
    hint: "Vê e cadastra tudo: clientes, projetos, agentes e modelos. Aceites, aprovações, chaves, webhooks, o portal e a equipe continuam com o dono.",
  },
] as const;

function Result({ state }: { state: ActionState }) {
  return (
    <div aria-live="polite">
      {state.status === "error" ? (
        <ErrorNote message={state.message} />
      ) : state.status === "ok" && state.message ? (
        <p className="text-sm text-ok-fg">{state.message}</p>
      ) : null}
    </div>
  );
}

function RoleChoice({ current }: { current: "member" | "admin" }) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-navy">Papel</legend>
      {ROLES.map((role) => (
        <label
          key={role.value}
          htmlFor={`${id}-${role.value}`}
          className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 has-checked:border-brand"
        >
          <input
            id={`${id}-${role.value}`}
            type="radio"
            name="role"
            value={role.value}
            defaultChecked={role.value === current}
            className="mt-1 accent-brand"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-navy">
              {role.label}
            </span>
            <span className="text-xs text-ink-2">{role.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Actions({
  pending,
  label,
  onCancel,
}: {
  pending: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending}
        onClick={onCancel}
      >
        Cancelar
      </Button>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : null}
        {label}
      </Button>
    </div>
  );
}

/** Nome do workspace (só o dono): aparece no convite do portal para o cliente. */
export function WorkspaceNameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(renomearWorkspace, IDLE);
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Field id={`${id}-name`} label="Nome do workspace">
            <input
              id={`${id}-name`}
              name="name"
              required
              maxLength={120}
              defaultValue={name}
              disabled={pending}
              aria-describedby={`${id}-hint`}
              className={inputClass}
            />
          </Field>
        </div>
        <Button type="submit" size="lg" variant="outline" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar o nome
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-caption">
        Aparece no convite do portal para o cliente.
      </p>
      <Result state={state} />
    </form>
  );
}

/** "Pôr na equipe": o perfil e o vínculo. O login a pessoa já tem, ou o Fábio cria. */
export function AddMemberButton() {
  return (
    <FormDialog
      label="Pôr na equipe"
      icon={<Plus aria-hidden="true" />}
      variant="default"
      title="Pôr uma pessoa na equipe"
      description="Ela entra no Hub com este e-mail. Quem ainda não tem login na Harmony precisa ter a conta criada no Supabase (Authentication, Add user); a senha é sempre a própria pessoa quem define. Depois, o Convite por e-mail, na linha dela, manda o caminho de entrada."
      wide
    >
      {(close) => <AddMemberForm onDone={close} />}
    </FormDialog>
  );
}

function AddMemberForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await adicionarPessoa(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-name`} label="Nome">
            <input
              id={`${id}-name`}
              name="name"
              required
              maxLength={120}
              autoFocus
              autoComplete="off"
              className={inputClass}
            />
          </Field>
          <Field id={`${id}-email`} label="E-mail de login">
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        </div>
        <RoleChoice current="member" />
      </fieldset>
      <Result state={state} />
      <Actions pending={pending} label="Pôr na equipe" onCancel={onDone} />
    </form>
  );
}

export function MemberRoleButton({
  profileId,
  name,
  role,
}: {
  profileId: string;
  name: string;
  role: "member" | "admin";
}) {
  return (
    <FormDialog
      label="Papel"
      accessibleLabel={`Mudar o papel de ${name}`}
      icon={<UserCog aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Mudar o papel"
      description={name}
      wide
    >
      {(close) => (
        <MemberRoleForm profileId={profileId} role={role} onDone={close} />
      )}
    </FormDialog>
  );
}

function MemberRoleForm({
  profileId,
  role,
  onDone,
}: {
  profileId: string;
  role: "member" | "admin";
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await mudarPapel(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="profile_id" value={profileId} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <RoleChoice current={role} />
      </fieldset>
      <Result state={state} />
      <Actions pending={pending} label="Salvar o papel" onCancel={onDone} />
    </form>
  );
}

/**
 * Suspender (pede confirmação) ou devolver o acesso. Suspensa, a pessoa sai na próxima
 * tela que abrir; o histórico e as tarefas dela continuam.
 */
export function MemberAccessButton({
  profileId,
  name,
  status,
}: {
  profileId: string;
  name: string;
  status: "active" | "suspended";
}) {
  const [state, action, pending] = useActionState(mudarAcesso, IDLE);
  const suspending = status === "active";
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!suspending) return;
        const ok = window.confirm(
          `Suspender o acesso de ${name}? A pessoa sai do Hub na próxima tela que abrir, até você devolver o acesso. O histórico e as tarefas dela continuam.`,
        );
        if (!ok) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="profile_id" value={profileId} />
      <input
        type="hidden"
        name="status"
        value={suspending ? "suspended" : "active"}
      />
      <Button
        type="submit"
        variant={suspending ? "ghost" : "outline"}
        size="sm"
        disabled={pending}
        aria-label={
          suspending
            ? `Suspender o acesso de ${name}`
            : `Devolver o acesso de ${name}`
        }
        className={suspending ? "text-danger-fg" : undefined}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : suspending ? (
          <Pause aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
        {suspending ? "Suspender" : "Devolver o acesso"}
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Responsável de um departamento: alguém ativo da equipe, ou ninguém. */
export function DepartmentLeadForm({
  departmentId,
  departmentName,
  leadProfileId,
  leadName,
  people,
}: {
  departmentId: string;
  departmentName: string;
  leadProfileId: string | null;
  leadName: string | null;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(definirResponsavel, IDLE);
  const submit = useSubmit(action);
  const id = useId();
  // Responsável que saiu da equipe continua à vista, para não sumir sem ninguém ver.
  const missing =
    leadProfileId !== null && !people.some((p) => p.id === leadProfileId);
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <input type="hidden" name="department_id" value={departmentId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-lead`} className="sr-only">
          Responsável por {departmentName}
        </label>
        <select
          id={`${id}-lead`}
          name="profile_id"
          defaultValue={leadProfileId ?? ""}
          disabled={pending}
          className={`${inputClass} h-9 min-w-0 flex-1 basis-48 text-sm`}
        >
          <option value="">Ninguém</option>
          {missing ? (
            <option value={leadProfileId ?? ""}>
              {leadName ?? "Responsável atual"} (fora da equipe ativa)
            </option>
          ) : null}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`Salvar o responsável por ${departmentName}`}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar
        </Button>
      </div>
      <span aria-live="polite" className="text-xs">
        {state.status === "error" ? (
          <span role="alert" className="text-danger-fg">
            {state.message}
          </span>
        ) : state.status === "ok" && state.message ? (
          <span className="text-ok-fg">{state.message}</span>
        ) : null}
      </span>
    </form>
  );
}

/** Convite por e-mail (RF-03): só o dono, com o e-mail do Hub ligado. */
export function MemberInviteButton({
  profileId,
  name,
  emailOn,
}: {
  profileId: string;
  name: string;
  emailOn: boolean;
}) {
  const [state, action, pending] = useActionState(enviarConviteEquipe, IDLE);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="profile_id" value={profileId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending || !emailOn}
        aria-label={`Mandar o convite por e-mail para ${name}`}
        title={
          emailOn
            ? undefined
            : "O e-mail do Hub está desligado (docs/email.md)."
        }
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Mail aria-hidden="true" />
        )}
        Convite por e-mail
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : state.status === "ok" && state.message ? (
        <span role="status" className="text-xs text-ok-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
