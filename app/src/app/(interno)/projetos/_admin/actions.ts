"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  ClientInput,
  createClient,
  createProject,
  CreateProjectInput,
  updateClient,
  updateProject,
  UpdateProjectInput,
} from "@/modules/projects/admin";
import { getTemplate } from "@/modules/templates/service";
import { parseClientForm, parseProjectForm } from "./form";

/** Cria ou edita o projeto (e, se pedido, o cliente novo, na mesma transação). */
export async function salvarProjeto(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseProjectForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const v = parsed.value;
  let code: string;
  try {
    code = await inTx(ctx, async (t) => {
      const clientId = v.newClientName
        ? (await createClient(t, ClientInput.parse({ name: v.newClientName })))
            .id
        : v.clientId!;
      if (v.mode === "create") {
        // O modelo traz os departamentos do projeto; o esqueleto entra pela importação.
        const template = v.template ? await getTemplate(t, v.template) : null;
        const created = await createProject(
          t,
          CreateProjectInput.parse({
            ...v.fields,
            departments: [
              ...new Set([
                ...v.fields.departments,
                ...(template?.departments.map((d) => d.slug) ?? []),
              ]),
            ],
            code: v.code,
            client_id: clientId,
          }),
        );
        return created.code;
      }
      const updated = await updateProject(
        t,
        v.code,
        UpdateProjectInput.parse({ ...v.fields, client_id: clientId }),
        v.expectedUpdatedAt ?? undefined,
      );
      return updated.code;
    });
  } catch (err) {
    if (toHubError(err).status === 412) {
      return {
        status: "error",
        message:
          "O projeto mudou enquanto você editava. Recarregue a página para ver a versão nova e refaça a alteração.",
      };
    }
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao salvar projeto.",
      ),
    };
  }
  // Projeto novo ou renomeado muda a barra lateral (projetos em destaque): o layout
  // vem de novo junto com a página. Fora do try: o redirect é lançado como exceção.
  revalidatePath("/", "layout");
  // Com modelo, o projeto abre na importação com o esqueleto: a prévia mostra o que entra.
  redirect(
    v.template
      ? `/projetos/${code}/importar?modelo=${v.template}`
      : `/projetos/${code}`,
  );
}

export async function salvarCliente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseClientForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, ...fields } = parsed.value;
  try {
    const saved = await inTx(ctx, (t) =>
      id
        ? updateClient(t, id, ClientInput.parse(fields))
        : createClient(t, ClientInput.parse(fields)),
    );
    refresh();
    return {
      status: "ok",
      message: id
        ? `Cliente “${saved.name}” atualizado.`
        : `Cliente “${saved.name}” cadastrado.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao salvar cliente.",
      ),
    };
  }
}
