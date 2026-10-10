"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { Cpu, LoaderCircle, PlugZap } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import {
  LLM_PROVIDERS,
  PROVIDER_LABEL,
  type LlmProvider,
} from "@/modules/llm/providers";
import {
  buscarModelosIA,
  salvarModeloIA,
  testarConexaoIA,
} from "./agent-model-actions";
import { budgetText } from "./agent-controls";

export type AgentModelInitial = {
  agentId: string;
  agentName: string;
  provider: LlmProvider | null;
  model: string | null;
  credentialId: string | null;
  priceIn: number | null;
  priceOut: number | null;
  budgetUsdMonth: number;
};

export type CredentialOption = {
  id: string;
  provider: LlmProvider;
  label: string;
  last4: string;
};

const priceText = (value: number | null) =>
  value === null ? "" : String(value).replace(".", ",");

/** "Modelo de IA" do agente (só o dono): provedor, chave, modelo, preços e teto do mês. */
export function ModeloIAButton({
  initial,
  credentials,
}: {
  initial: AgentModelInitial;
  credentials: CredentialOption[];
}) {
  return (
    <FormDialog
      label="Modelo de IA"
      accessibleLabel={`Modelo de IA de ${initial.agentName}`}
      icon={<Cpu aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Modelo de IA"
      description={initial.agentName}
      wide
    >
      {(close) => (
        <ModelForm initial={initial} credentials={credentials} onDone={close} />
      )}
    </FormDialog>
  );
}

function ModelForm({
  initial,
  credentials,
  onDone,
}: {
  initial: AgentModelInitial;
  credentials: CredentialOption[];
  onDone: () => void;
}) {
  const id = useId();
  const [provider, setProvider] = useState<LlmProvider>(
    initial.provider ?? credentials[0]?.provider ?? "anthropic",
  );
  const options = credentials.filter((c) => c.provider === provider);
  const [credentialId, setCredentialId] = useState(
    initial.credentialId && options.some((c) => c.id === initial.credentialId)
      ? initial.credentialId
      : (options[0]?.id ?? ""),
  );
  const [models, setModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarModeloIA(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  const changeProvider = (next: LlmProvider) => {
    setProvider(next);
    setCredentialId(credentials.find((c) => c.provider === next)?.id ?? "");
    setModels([]);
    setModelsNote(null);
  };
  const fetchModels = () =>
    startLoading(async () => {
      const result = await buscarModelosIA(credentialId);
      if (result.ok) {
        setModels(result.models);
        setModelsNote(
          result.models.length
            ? `${result.models.length} modelos do provedor: escolha no campo.`
            : "O provedor não listou modelos; digite o nome.",
        );
      } else {
        setModels([]);
        setModelsNote(result.message);
      }
    });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="agent_id" value={initial.agentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-provedor`} label="Provedor">
          <select
            id={`${id}-provedor`}
            name="provider"
            value={provider}
            onChange={(e) => changeProvider(e.target.value as LlmProvider)}
            disabled={pending}
            className={inputClass}
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id={`${id}-chave`}
          label="Chave"
          hint={
            options.length === 0
              ? "Nenhuma chave deste provedor: cadastre em Chaves de IA, nesta tela."
              : undefined
          }
        >
          <select
            id={`${id}-chave`}
            name="credential_id"
            value={credentialId}
            onChange={(e) => {
              setCredentialId(e.target.value);
              setModels([]);
              setModelsNote(null);
            }}
            disabled={pending || options.length === 0}
            className={inputClass}
          >
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} (final {c.last4})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        id={`${id}-modelo`}
        label="Modelo"
        hint={modelsNote ?? "O nome do modelo como o provedor escreve."}
      >
        <div className="flex gap-2">
          <input
            id={`${id}-modelo`}
            name="model"
            list={`${id}-modelos`}
            defaultValue={initial.model ?? ""}
            maxLength={120}
            spellCheck={false}
            disabled={pending}
            className={`${inputClass} min-w-0 flex-1 font-mono text-sm`}
          />
          <datalist id={`${id}-modelos`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-10"
            disabled={!credentialId || loading || pending}
            onClick={fetchModels}
          >
            {loading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Buscar modelos
          </Button>
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          id={`${id}-entrada`}
          label="Preço de entrada (US$ por milhão de tokens)"
        >
          <input
            id={`${id}-entrada`}
            name="price_in"
            inputMode="decimal"
            defaultValue={priceText(initial.priceIn)}
            disabled={pending}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${id}-saida`}
          label="Preço de saída (US$ por milhão de tokens)"
        >
          <input
            id={`${id}-saida`}
            name="price_out"
            inputMode="decimal"
            defaultValue={priceText(initial.priceOut)}
            disabled={pending}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-teto`} label="Teto do mês (US$)">
          <input
            id={`${id}-teto`}
            name="budget"
            inputMode="decimal"
            defaultValue={budgetText(initial.budgetUsdMonth)}
            disabled={pending}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="text-xs text-caption">
        Os preços vêm da tabela do provedor para o modelo escolhido. Com eles, o
        Hub calcula o custo de cada chamada e respeita o teto do mês; sem preço
        ou sem teto, o agente não usa IA.
      </p>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="submit"
          name="intent"
          value="off"
          variant="ghost"
          size="lg"
          disabled={pending || !initial.provider}
        >
          Desligar a IA deste agente
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={onDone}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save"
            size="lg"
            disabled={pending || !credentialId}
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Salvar
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Chamada mínima pelo adaptador, para conferir modelo, chave, preço e teto. */
export function TestarConexaoButton({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [state, action, pending] = useActionState(testarConexaoIA, IDLE);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="agent_id" value={agentId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`Testar a conexão de IA de ${agentName}`}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <PlugZap aria-hidden="true" />
        )}
        Testar conexão
      </Button>
      <span aria-live="polite" className="text-xs">
        {state.status === "error" ? (
          <span className="text-danger-fg">{state.message}</span>
        ) : state.status === "ok" && state.message ? (
          <span className="text-ok-fg">{state.message}</span>
        ) : null}
      </span>
    </form>
  );
}
