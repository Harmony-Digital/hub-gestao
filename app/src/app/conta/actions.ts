"use server";

import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { supabaseForRequest } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db";
import { log } from "@/lib/log";
import { inTx } from "@/modules/context";
import { parsePasswordForm, type PasswordFormState } from "./form";

function authMessage(error: { status?: number; code?: string }): string {
  switch (error.code) {
    case "same_password":
      return "A nova senha precisa ser diferente da atual.";
    case "weak_password":
      return "O serviço de login achou a senha fraca. Escolha uma mais longa e menos óbvia.";
    case "reauthentication_needed":
    case "session_not_found":
    case "session_expired":
      return "Por segurança, entre de novo pelo link do e-mail e tente outra vez.";
    default:
      return error.status === 429
        ? "Muitas tentativas seguidas. Aguarde alguns minutos."
        : "O serviço de login não aceitou a troca agora. Tente de novo em alguns minutos.";
  }
}

/**
 * A própria pessoa define a senha. Precisa estar logada (sessão conferida no GoTrue e
 * acesso ao Hub). A senha vai direto para o Supabase Auth; no histórico fica só o fato.
 */
export async function definirSenha(
  _previous: PasswordFormState,
  form: FormData,
): Promise<PasswordFormState> {
  const user = await getCurrentUser();
  const parsed = parsePasswordForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const supabase = await supabaseForRequest();
  if (!supabase) {
    return {
      status: "error",
      message: "O login não está configurado neste servidor.",
    };
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.password,
  });
  if (error) {
    return { status: "error", message: authMessage(error) };
  }

  const requestId = randomUUID();
  try {
    await inTx(
      { db: await getDb(), actor: user.actor, source: "ui", requestId },
      (t) =>
        audit(t, {
          action: "profile.password_set",
          entityType: "profile",
          entityId: user.actor.id,
        }),
    );
  } catch (err) {
    // A senha já foi trocada; a falha fica só no log, sem dados do formulário.
    log.error(
      { err, request_id: requestId },
      "Senha trocada, mas o histórico não foi gravado.",
    );
  }
  log.info(
    { profile_id: user.actor.id },
    "Senha definida pela própria pessoa.",
  );
  return {
    status: "ok",
    message:
      "Senha definida. Da próxima vez, entre com o seu e-mail e esta senha.",
  };
}
