"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { sendEmail } from "@/lib/email";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  addMember,
  createDepartment,
  emailTestTarget,
  removeDepartment,
  renameWorkspace,
  setDepartmentLead,
  setMemberRole,
  setMemberStatus,
  updateDepartment,
} from "@/modules/workspace/settings";
import {
  parseDepartmentForm,
  parseDepartmentLeadForm,
  parseDepartmentRemoveForm,
  parseMemberForm,
  parseMemberRoleForm,
  parseMemberStatusForm,
  parseWorkspaceNameForm,
} from "./form";

const failure = (err: unknown, requestId: string): ActionState => ({
  status: "error",
  message: actionErrorMessage(
    err,
    requestId,
    "Falha ao salvar a configuração.",
  ),
});

export async function renomearWorkspace(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseWorkspaceNameForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => renameWorkspace(t, { name: parsed.value }));
    refresh();
    return { status: "ok", message: "Nome salvo." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function adicionarPessoa(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMemberForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => addMember(t, parsed.value));
    refresh();
    return {
      status: "ok",
      message: `${parsed.value.name} está na equipe e entra com ${parsed.value.email}.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function mudarPapel(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMemberRoleForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      setMemberRole(t, parsed.value.profileId, parsed.value.role),
    );
    refresh();
    return { status: "ok", message: "Papel salvo." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function mudarAcesso(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMemberStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      setMemberStatus(t, parsed.value.profileId, parsed.value.status),
    );
    refresh();
    return {
      status: "ok",
      message:
        parsed.value.status === "suspended"
          ? "Acesso suspenso: a pessoa sai na próxima tela que abrir."
          : "Acesso devolvido.",
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function definirResponsavel(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseDepartmentLeadForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      setDepartmentLead(t, parsed.value.departmentId, parsed.value.profileId),
    );
    refresh();
    return { status: "ok", message: "Responsável salvo." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/**
 * E-mail de teste, do dono para ele mesmo: confere a configuração do Resend (domínio,
 * chave e remetente) sem mandar nada a cliente.
 */
export async function enviarEmailTeste(): Promise<ActionState> {
  const ctx = await actionContext();
  try {
    const me = await inTx(ctx, (t) => emailTestTarget(t));
    const sent = await sendEmail({
      to: me.email,
      subject: `Teste de e-mail do Hub de Gestão`,
      text: [
        `Olá, ${me.name}!`,
        "",
        "Este é um e-mail de teste do Hub de Gestão: o envio está funcionando.",
        "Com ele, o convite do portal pode sair pelo Hub, com o seu clique.",
      ].join("\n"),
      fromName: me.orgName,
    });
    return sent.ok
      ? { status: "ok", message: `E-mail de teste enviado para ${me.email}.` }
      : { status: "error", message: sent.detail };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Novo departamento ou edição do nome e da cor (RF-27). */
export async function salvarDepartamento(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseDepartmentForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, ...fields } = parsed.value;
  try {
    if (id) {
      await inTx(ctx, (t) => updateDepartment(t, id, fields));
    } else {
      await inTx(ctx, (t) => createDepartment(t, fields));
    }
    refresh();
    return {
      status: "ok",
      message: id
        ? `Departamento “${fields.name}” salvo.`
        : `Departamento “${fields.name}” criado.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function removerDepartamento(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseDepartmentRemoveForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => removeDepartment(t, parsed.value));
    refresh();
    return { status: "ok", message: "Departamento removido." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
