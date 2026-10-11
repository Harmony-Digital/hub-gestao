import { expect, test } from "@playwright/test";
import { login, openDialog, settle } from "./helpers";

/**
 * Dependências entre frentes (RF-13), pela Visão geral: o alerta do exemplo, uma frente
 * nova que depende de outra, a recusa de ciclo e, no fim, a frente de teste arquivada
 * (o banco do computador guarda tudo entre uma execução e outra).
 */
test("frente com Depende de, alerta e recusa de ciclo", async ({ page }) => {
  const title = `Frente dependente ${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/projetos/EXE");
  await settle(page);
  const main = page.getByRole("main");

  // No exemplo, a agenda depende do fluxo e já tem tarefa começada: o alerta aparece.
  await expect(
    main.getByText("Começou antes de “Fluxo de conversa do agente” terminar."),
  ).toBeVisible();

  const nova = await openDialog(
    page,
    page.getByRole("button", { name: "Nova frente", exact: true }),
    "Nova frente em EXE",
  );
  await nova.getByLabel("Título da frente").fill(title);
  await nova
    .getByRole("checkbox", { name: /^Fluxo de conversa do agente/ })
    .check();
  await nova.getByRole("button", { name: "Criar frente" }).click();
  await expect(nova).toBeHidden();
  const row = main.getByRole("row").filter({ hasText: title });
  await expect(
    row.getByText("Depende de “Fluxo de conversa do agente”"),
  ).toBeVisible();

  // O fluxo não pode passar a depender da frente nova, que depende dele.
  const fluxo = await openDialog(
    page,
    page.getByRole("button", {
      name: "Editar a frente Fluxo de conversa do agente",
    }),
    "Editar frente",
  );
  await fluxo.getByRole("checkbox", { name: title }).check();
  await fluxo.getByRole("button", { name: "Salvar a frente" }).click();
  await expect(fluxo.getByText(/a ligação fecharia um ciclo/)).toBeVisible();
  await fluxo.getByRole("button", { name: "Cancelar" }).click();
  await expect(fluxo).toBeHidden();

  // Arquiva a frente de teste (sem tarefas).
  const edit = await openDialog(
    page,
    page.getByRole("button", { name: `Editar a frente ${title}` }),
    "Editar frente",
  );
  await edit.getByRole("button", { name: "Arquivar", exact: true }).click();
  await edit.getByRole("button", { name: "Arquivar a frente" }).click();
  await expect(
    page.getByRole("button", { name: `Editar a frente ${title}` }),
  ).toHaveCount(0);
});
