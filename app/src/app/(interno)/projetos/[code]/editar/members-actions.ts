"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  removeProjectMember,
  setProjectMember,
} from "@/modules/projects/members";
import { parseMemberForm, parseMemberRemoveForm } from "./members-form";

const failure = (err: unknown, requestId: string): ActionState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha nas pessoas do projeto."),
});

/** Põe a pessoa no projeto ou muda o papel dela. */
export async function salvarPessoaNoProjeto(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMemberForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, profileId, role } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      setProjectMember(t, project, { profile_id: profileId, role }),
    );
    refresh();
    return { status: "ok", message: "Pessoas do projeto salvas." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function tirarPessoaDoProjeto(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMemberRemoveForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      removeProjectMember(t, parsed.value.project, parsed.value.profileId),
    );
    refresh();
    return { status: "ok", message: "A pessoa saiu do projeto." };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
