"use client";

import { useActionState, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { criarAgente, criarChave, revogarChave } from "./actions";
import {
  DEFAULT_EXPIRY,
  DEFAULT_KEY_SCOPES,
  EXPIRY_OPTIONS,
  INITIAL_AGENT_FORM,
  INITIAL_KEY_FORM,
  INITIAL_REVOKE,
  KEY_SCOPES,
  KIND_LABELS,
  SCOPE_LABELS,
  type AgentKind,
} from "./form";

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-paper px-3 text-[15px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60";

function ErrorNote({ message }: { message: string }) {
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

export function NovoAgenteForm() {
  const [state, action, pending] = useActionState(
    criarAgente,
    INITIAL_AGENT_FORM,
  );
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-navy">
          Nome do agente
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Claude Code do Fábio"
            disabled={pending}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy sm:w-72">
          Tipo
          <select
            name="kind"
            defaultValue="session"
            disabled={pending}
            className={inputClass}
          >
            {(Object.keys(KIND_LABELS) as AgentKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="lg" disabled={pending} className="h-10">
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Cadastrar agente
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" ? (
          <p className="flex gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? (
        <CircleCheck aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {copied ? "Copiada" : "Copiar chave"}
    </Button>
  );
}

type ProjectOption = { code: string; name: string };

export function NovaChaveForm({
  agentId,
  agentName,
  projects,
}: {
  agentId: string;
  agentName: string;
  projects: ProjectOption[];
}) {
  const [state, action, pending] = useActionState(criarChave, INITIAL_KEY_FORM);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const showKey = state.status === "created" && dismissed !== state.key;

  return (
    <div className="flex flex-col gap-3">
      {showKey ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border-2 border-brand bg-paper p-4"
        >
          <p className="flex items-center gap-2 font-heading font-semibold text-navy">
            <KeyRound aria-hidden="true" className="size-4 text-brand-strong" />
            Chave criada para {agentName}
          </p>
          <p className="text-sm text-ink-2">
            Esta é a única vez que a chave aparece. Guarde agora: depois, só dá
            para revogar e criar outra.
          </p>
          <code className="block overflow-x-auto rounded-lg bg-navy px-3 py-2 font-mono text-sm break-all text-off">
            {state.key}
          </code>
          <dl className="grid gap-1 text-sm text-ink-2 sm:grid-cols-[max-content_1fr] sm:gap-x-4">
            <dt className="font-medium text-navy">Endereço do MCP</dt>
            <dd className="font-mono text-xs break-all">{state.mcpUrl}</dd>
            <dt className="font-medium text-navy">Cabeçalho</dt>
            <dd className="font-mono text-xs">
              Authorization: Bearer &lt;a chave acima&gt;
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={state.key} />
            <Button
              type="button"
              size="lg"
              onClick={() => setDismissed(state.key)}
            >
              Já guardei a chave
            </Button>
          </div>
        </div>
      ) : null}

      <details className="group rounded-xl border border-line bg-paper">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-navy">
          <KeyRound aria-hidden="true" className="size-4" />
          Criar chave
        </summary>
        <form action={action} className="flex flex-col gap-4 px-4 pb-4">
          <input type="hidden" name="agent_id" value={agentId} />

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-navy">
              O que o agente pode fazer
            </legend>
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {KEY_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={DEFAULT_KEY_SCOPES.includes(scope)}
                    className="size-4 accent-brand"
                  />
                  {SCOPE_LABELS[scope]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-navy">
              Em quais projetos
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {projects.map((p) => (
                <label
                  key={p.code}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="project"
                    value={p.code}
                    defaultChecked={p.code === "HUB"}
                    className="size-4 accent-brand"
                  />
                  <span className="font-mono text-xs text-caption">
                    {p.code}
                  </span>
                  {p.name}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name="todos"
                className="size-4 accent-brand"
              />
              Todos os projetos (acesso amplo, só para o agente gestor)
            </label>
          </fieldset>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy sm:w-60">
            Validade
            <select
              name="validade"
              defaultValue={String(DEFAULT_EXPIRY)}
              className={inputClass}
            >
              {EXPIRY_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} dias
                </option>
              ))}
            </select>
          </label>

          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}

          <div>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <KeyRound aria-hidden="true" />
              )}
              Criar chave
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}

export function RevogarChaveButton({
  keyId,
  prefix,
}: {
  keyId: string;
  prefix: string;
}) {
  const [state, action, pending] = useActionState(revogarChave, INITIAL_REVOKE);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Revogar a chave ${prefix}? O agente perde o acesso na hora, e isso não tem volta.`,
        );
        if (!ok) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="key_id" value={keyId} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Revogar
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
