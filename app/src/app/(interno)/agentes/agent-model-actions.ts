"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { generate } from "@/lib/llm";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { authorize } from "@/lib/authorize";
import { inTx } from "@/modules/context";
import {
  providerModels,
  setAgentModel,
  type ModelList,
} from "@/modules/llm/agent-model";
import { parseAgentModelForm } from "./agent-model-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function salvarModeloIA(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseAgentModelForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      setAgentModel(t, parsed.value.agentId, parsed.value.input),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha no modelo de IA."),
    };
  }
}

/** Lista de modelos do provedor, buscada no servidor com a chave guardada. */
export async function buscarModelosIA(
  credentialId: string,
): Promise<ModelList> {
  const ctx = await actionContext();
  try {
    return await inTx(ctx, (t) => providerModels(t, credentialId));
  } catch (err) {
    return {
      ok: false,
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao buscar modelos.",
      ),
    };
  }
}

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

/** Chamada mínima pelo adaptador (gasta poucos tokens), só para o dono. */
export async function testarConexaoIA(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const agentId = form.get("agent_id");
  if (typeof agentId !== "string" || !UUID.test(agentId)) {
    return {
      status: "error",
      message: "Pedido inválido. Recarregue a página.",
    };
  }
  try {
    const result = await inTx(ctx, (t) => {
      authorize(t.actor, "agent.keys");
      return generate(t, {
        agentId,
        purpose: "Testar conexão (Sala de Controle)",
        instructions: "Responda apenas com a palavra ok.",
        prompt: "Teste de conexão do Hub de Gestão.",
        maxOutputTokens: 16,
      });
    });
    refresh();
    return result.ok
      ? {
          status: "ok",
          message: `Funcionou: ${result.model} respondeu; custo ${money.format(result.costUsd)}.`,
        }
      : { status: "error", message: result.detail };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha no teste de IA."),
    };
  }
}
