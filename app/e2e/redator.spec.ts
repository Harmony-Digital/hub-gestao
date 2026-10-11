import { expect, test } from "@playwright/test";
import { login, openDialog, settle } from "./helpers";

/**
 * Texto da frente para o cliente (M6, RC-12): a janela da frente confere o texto enquanto
 * a pessoa escreve e pede a sugestão do Redator do Cliente, que a pessoa usa ou descarta.
 * O modelo simulado devolve o JSON escrito no fim do pedido (aqui, na descrição). Nada é
 * salvo: a janela fecha em Cancelar.
 */
test("alertas e sugestão do Redator na janela da frente", async ({ page }) => {
  await login(page);
  await page.goto("/projetos/EXE");
  await settle(page);
  const dialog = await openDialog(
    page,
    page.getByRole("button", {
      name: "Editar a frente Fluxo de conversa do agente",
    }),
    "Editar frente",
  );
  const title = dialog.getByLabel("Título para o cliente");
  await title.fill("Fluxo do agente (HUB-12)");
  await expect(
    dialog.getByText(/O texto para o cliente cita código de tarefa HUB-12/),
  ).toBeVisible();

  await dialog.getByLabel("Descrição para o cliente (opcional)").fill(
    JSON.stringify({
      text: null,
      title: "Atendimento no WhatsApp",
      description: "Seus pacientes marcam consulta sozinhos, a qualquer hora.",
      notes: "Tirei o código da tarefa.",
    }),
  );
  await dialog
    .getByRole("button", { name: "Pedir sugestão ao Redator" })
    .click();
  await expect(
    dialog.getByText("Sugestão do Redator do Cliente"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Usar a sugestão" }).click();
  await expect(title).toHaveValue("Atendimento no WhatsApp");
  await expect(dialog.getByText(/O texto para o cliente cita/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
});
