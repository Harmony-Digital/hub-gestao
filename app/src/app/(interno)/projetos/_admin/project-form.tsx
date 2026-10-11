"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { PHASES, PROJECT_STATUS } from "@/lib/labels";
import type { ProjectFormOptions } from "@/modules/projects/admin";
import { salvarProjeto } from "./actions";
import { EDITABLE_STATUSES } from "./form";

/** Valores iniciais do formulário (vazios na criação, os do projeto na edição). */
export type ProjectFormInitial = {
  code: string;
  name: string;
  clientId: string;
  phase: string;
  status: string;
  objectiveInternal: string;
  objectiveClient: string;
  startDate: string;
  targetDate: string;
  ownerId: string;
  pmAgentId: string;
  repoUrl: string;
  planPath: string;
  requireEvidence: boolean;
  clientCanConfirmReceipt: boolean;
  emailClientReports: boolean;
  departments: string[];
  updatedAt: string;
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <legend className="px-1 font-heading text-base font-semibold text-navy">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function ProjectForm({
  mode,
  options,
  initial,
  cancelHref,
}: {
  mode: "create" | "edit";
  options: ProjectFormOptions;
  initial: ProjectFormInitial;
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState(salvarProjeto, IDLE);
  const submit = useSubmit(action);
  const [client, setClient] = useState(
    initial.clientId || (options.clients.length === 0 ? "novo" : ""),
  );
  const [departments, setDepartments] = useState<string[]>(initial.departments);
  const templates = mode === "create" ? (options.templates ?? []) : [];
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;

  return (
    <form onSubmit={submit} className="flex max-w-4xl flex-col gap-5">
      <input type="hidden" name="mode" value={mode} />
      {mode === "edit" ? (
        <input type="hidden" name="updated_at" value={initial.updatedAt} />
      ) : null}

      {templates.length > 0 ? (
        <Group title="Modelo">
          <Field
            id={id("template")}
            label="Começar de um modelo (opcional)"
            hint="O modelo marca os departamentos dele aqui. Depois de criar, o projeto abre na importação com o esqueleto, para você ver o que entra antes de gravar."
          >
            <select
              id={id("template")}
              name="template"
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                const chosen = templates.find(
                  (tpl) => tpl.id === e.currentTarget.value,
                );
                if (chosen) {
                  setDepartments((current) => [
                    ...new Set([...current, ...chosen.departments]),
                  ]);
                }
              }}
              className={inputClass}
            >
              <option value="">Sem modelo</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </Field>
        </Group>
      ) : null}

      <Group title="Identificação">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field
            id={id("code")}
            label="Código"
            hint={
              mode === "create"
                ? "De 2 a 8 letras ou números, como CLI. Aparece nas listas e no endereço do projeto."
                : "O código não muda depois de criado."
            }
          >
            <input
              id={id("code")}
              name="code"
              defaultValue={initial.code}
              required
              readOnly={mode === "edit"}
              maxLength={8}
              pattern="[A-Za-z0-9]{2,8}"
              autoCapitalize="characters"
              disabled={pending}
              onInput={(e) => {
                e.currentTarget.value = e.currentTarget.value.toUpperCase();
              }}
              className={`${inputClass} font-mono uppercase ${mode === "edit" ? "bg-off text-caption" : ""}`}
            />
          </Field>
          <Field id={id("name")} label="Nome do projeto">
            <input
              id={id("name")}
              name="name"
              defaultValue={initial.name}
              required
              maxLength={160}
              disabled={pending}
              placeholder="Ex.: Atendimento com IA da clínica"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("client")} label="Cliente">
            <select
              id={id("client")}
              name="client"
              value={client}
              onChange={(e) => setClient(e.currentTarget.value)}
              required
              disabled={pending}
              className={inputClass}
            >
              <option value="" disabled>
                Escolha o cliente
              </option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="novo">Cliente novo…</option>
            </select>
          </Field>
          {client === "novo" ? (
            <Field
              id={id("new-client")}
              label="Nome do cliente novo"
              hint="O cliente é cadastrado junto com o projeto."
            >
              <input
                id={id("new-client")}
                name="new_client_name"
                required
                maxLength={160}
                autoFocus
                disabled={pending}
                className={inputClass}
              />
            </Field>
          ) : null}
        </div>
      </Group>

      <Group title="Andamento">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field id={id("phase")} label="Fase">
            <select
              id={id("phase")}
              name="phase"
              defaultValue={initial.phase}
              disabled={pending}
              className={inputClass}
            >
              {PHASES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("status")} label="Status">
            <select
              id={id("status")}
              name="status"
              defaultValue={initial.status}
              disabled={pending}
              className={inputClass}
            >
              {EDITABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS[s].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("start")} label="Início">
            <input
              id={id("start")}
              type="date"
              name="start_date"
              defaultValue={initial.startDate}
              disabled={pending}
              className={inputClass}
            />
          </Field>
          <Field id={id("target")} label="Previsão de entrega">
            <input
              id={id("target")}
              type="date"
              name="target_date"
              defaultValue={initial.targetDate}
              disabled={pending}
              className={inputClass}
            />
          </Field>
        </div>
      </Group>

      <Group title="Pessoas e departamentos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={id("owner")} label="Responsável">
            <select
              id={id("owner")}
              name="owner_profile_id"
              defaultValue={initial.ownerId}
              disabled={pending}
              className={inputClass}
            >
              <option value="">Ninguém</option>
              {options.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={id("agent")}
            label="Agente gestor"
            hint="O agente que acompanha o projeto (na fase 1, o Kratos)."
          >
            <select
              id={id("agent")}
              name="pm_agent_id"
              defaultValue={initial.pmAgentId}
              disabled={pending}
              className={inputClass}
            >
              <option value="">Nenhum</option>
              {options.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {options.departments.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-navy">Departamentos</span>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {options.departments.map((d) => (
                <label
                  key={d.slug}
                  className="flex min-h-9 items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="department"
                    value={d.slug}
                    checked={departments.includes(d.slug)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setDepartments((current) =>
                        on
                          ? [...new Set([...current, d.slug])]
                          : current.filter((slug) => slug !== d.slug),
                      );
                    }}
                    disabled={pending}
                    className="size-4 accent-[var(--color-brand)]"
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ background: d.color }}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </Group>

      <Group title="Objetivo">
        <Field
          id={id("objective")}
          label="Objetivo (interno)"
          hint="O que o projeto precisa entregar, nas palavras da equipe."
        >
          <textarea
            id={id("objective")}
            name="objective_internal"
            defaultValue={initial.objectiveInternal}
            rows={3}
            maxLength={4000}
            disabled={pending}
            className={textareaClass}
          />
        </Field>
        <Field
          id={id("objective-client")}
          label="Objetivo para o cliente (opcional)"
          hint="Como o cliente vê o objetivo no portal. Fica separado do texto interno."
        >
          <textarea
            id={id("objective-client")}
            name="objective_client"
            defaultValue={initial.objectiveClient}
            rows={2}
            maxLength={2000}
            disabled={pending}
            className={textareaClass}
          />
        </Field>
      </Group>

      <Group title="Regras e código">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="require_evidence"
            defaultChecked={initial.requireEvidence}
            disabled={pending}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          Concluir uma tarefa exige evidência (padrão da Harmony).
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="client_can_confirm_receipt"
            defaultChecked={initial.clientCanConfirmReceipt}
            disabled={pending}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          O cliente pode confirmar o recebimento das entregas no portal (o
          aceite do marco continua com você).
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="email_client_reports"
            defaultChecked={initial.emailClientReports}
            disabled={pending}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          O relatório aprovado para o cliente vai também por e-mail aos contatos
          com acesso ao portal (quando o e-mail do Hub estiver ligado).
        </label>
        <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
          <Field id={id("repo")} label="Repositório (opcional)">
            <input
              id={id("repo")}
              name="repo_url"
              type="url"
              defaultValue={initial.repoUrl}
              maxLength={500}
              disabled={pending}
              placeholder="https://github.com/Harmony-Digital/…"
              className={inputClass}
            />
          </Field>
          <Field id={id("plan")} label="Arquivo do plano (opcional)">
            <input
              id={id("plan")}
              name="plan_path"
              defaultValue={initial.planPath}
              maxLength={300}
              disabled={pending}
              placeholder="PLAN.md"
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
      </Group>

      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          {mode === "create" ? "Criar projeto" : "Salvar alterações"}
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
