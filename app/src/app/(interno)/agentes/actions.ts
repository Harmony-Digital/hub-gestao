"use server";

import { refresh } from "next/cache";
import { appUrl } from "@/lib/auth/config";
import { apiKeyPepper } from "@/lib/env";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import {
  createAgent,
  CreateAgentInput,
  createAgentKey,
  revokeAgentKey,
  setAgentStatus,
  updateAgent,
} from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import {
  parseAgentEditForm,
  parseAgentStatusForm,
  parseNewAgentForm,
  parseNewKeyForm,
  parseRevokeForm,
  type AgentFormState,
  type KeyFormState,
  type RevokeState,
} from "./form";

const messageOf = (err: unknown, requestId: string) =>
  actionErrorMessage(err, requestId, "Falha no console de agentes.");

export async function criarAgente(
  _previous: AgentFormState,
  form: FormData,
): Promise<AgentFormState> {
  const ctx = await actionContext();
  const parsed = parseNewAgentForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const input = CreateAgentInput.parse(parsed.value);
    const agent = await inTx(ctx, (t) => createAgent(t, input));
    refresh();
    return {
      status: "ok",
      message: `Agente "${agent.name}" cadastrado. Agora crie a chave dele.`,
    };
  } catch (err) {
    return { status: "error", message: messageOf(err, ctx.requestId) };
  }
}

export async function salvarAgente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseAgentEditForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => updateAgent(t, parsed.value.id, parsed.value.input));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: messageOf(err, ctx.requestId) };
  }
}

export async function mudarStatusAgente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseAgentStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      setAgentStatus(t, parsed.value.id, parsed.value.status),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: messageOf(err, ctx.requestId) };
  }
}

export async function criarChave(
  _previous: KeyFormState,
  form: FormData,
): Promise<KeyFormState> {
  const ctx = await actionContext();
  const parsed = parseNewKeyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const created = await inTx(ctx, (t) =>
      createAgentKey(t, parsed.value, apiKeyPepper()),
    );
    refresh();
    return {
      status: "created",
      key: created.key,
      prefix: created.prefix,
      expiresAt: created.expires_at,
      mcpUrl: `${appUrl() ?? ""}/mcp`,
    };
  } catch (err) {
    return { status: "error", message: messageOf(err, ctx.requestId) };
  }
}

export async function revogarChave(
  _previous: RevokeState,
  form: FormData,
): Promise<RevokeState> {
  const ctx = await actionContext();
  const parsed = parseRevokeForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => revokeAgentKey(t, parsed.value.keyId));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return { status: "error", message: messageOf(err, ctx.requestId) };
  }
}
