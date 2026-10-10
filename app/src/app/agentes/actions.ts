"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { appUrl } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDb } from "@/lib/db";
import { apiKeyPepper } from "@/lib/env";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import {
  createAgent,
  CreateAgentInput,
  createAgentKey,
  revokeAgentKey,
} from "@/modules/agents/service";
import { inTx, type Ctx } from "@/modules/context";
import {
  parseNewAgentForm,
  parseNewKeyForm,
  parseRevokeForm,
  type AgentFormState,
  type KeyFormState,
  type RevokeState,
} from "./form";

/**
 * Contexto de quem está na tela. Fica fora do try: sem sessão, getCurrentUser manda
 * para o login (redirect), e isso não pode ser engolido como erro comum.
 */
async function uiContext(): Promise<Ctx> {
  const user = await getCurrentUser();
  return {
    db: await getDb(),
    actor: user.actor,
    source: "ui",
    requestId: randomUUID(),
  };
}

/** Mensagem para a tela. Falha interna vai para o log, sem dados do formulário. */
function messageOf(err: unknown, requestId: string): string {
  const hubError = toHubError(err);
  if (hubError.status >= 500) {
    log.error({ err, request_id: requestId }, "Falha no console de agentes.");
  }
  return hubError.detail;
}

export async function criarAgente(
  _previous: AgentFormState,
  form: FormData,
): Promise<AgentFormState> {
  const ctx = await uiContext();
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

export async function criarChave(
  _previous: KeyFormState,
  form: FormData,
): Promise<KeyFormState> {
  const ctx = await uiContext();
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
  const ctx = await uiContext();
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
