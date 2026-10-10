"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createCredential,
  PROVIDER_LABEL,
  revokeCredential,
  rotateCredential,
} from "@/modules/llm/credentials";
import {
  parseNewAiKeyForm,
  parseRevokeAiKeyForm,
  parseRotateAiKeyForm,
} from "./ai-keys-form";

const failure = (err: unknown, requestId: string): ActionState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha nas chaves de IA."),
});

export async function criarChaveIA(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseNewAiKeyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const created = await inTx(ctx, (t) => createCredential(t, parsed.value));
    refresh();
    return {
      status: "ok",
      message: `Chave "${created.label}" (${PROVIDER_LABEL[created.provider]}, final ${created.last4}) guardada.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function trocarChaveIA(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseRotateAiKeyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const rotated = await inTx(ctx, (t) =>
      rotateCredential(t, parsed.value.id, parsed.value.key),
    );
    refresh();
    return {
      status: "ok",
      message: `Chave trocada: agora termina em ${rotated.last4}.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function revogarChaveIA(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseRevokeAiKeyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => revokeCredential(t, parsed.value.id));
    refresh();
    return { status: "ok", message: "Chave revogada." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
