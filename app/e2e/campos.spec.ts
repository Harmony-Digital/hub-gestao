import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Campos personalizados (RF-19): o dono cria um campo de seleção no Editar projeto, o
 * valor é preenchido no painel da tarefa e, no fim, o campo de teste é removido (o banco
 * do computador guarda tudo entre uma execução e outra).
 */
test("campo de seleção criado no projeto e preenchido na tarefa", async ({
  page,
}) => {
  const name = `Canal ${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/projetos/EXE/editar");
  await settle(page);
  const section = page.getByRole("region", { name: "Campos das tarefas" });
  await section.getByLabel("Nome do campo").fill(name);
  await section.getByLabel("Tipo").selectOption({ label: "Seleção" });
  await section.getByLabel("Opções").fill("Site\nWhatsApp");
  await section.getByRole("button", { name: "Criar campo" }).click();
  await expect(section.getByText(`Campo “${name}” criado.`)).toBeVisible();

  await page.goto("/projetos/EXE/lista");
  await settle(page);
  await page.locator('a[href*="tarefa=HUB-"]').first().click();
  await expect(page.locator("#painel-tarefa-titulo")).toBeAttached();
  await page.getByLabel(name).selectOption("WhatsApp");
  await page.getByRole("button", { name: "Salvar campos" }).click();
  // Salvo: o histórico da tarefa registra, e o valor continua depois de recarregar.
  await expect(
    page.getByText("mudou os campos personalizados").first(),
  ).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(page.getByLabel(name)).toHaveValue("WhatsApp");

  await page.goto("/projetos/EXE/editar");
  await settle(page);
  const again = page.getByRole("region", { name: "Campos das tarefas" });
  await again.getByRole("button", { name: `Remover o campo ${name}` }).click();
  await again
    .getByRole("button", { name: "Remover o campo", exact: true })
    .click();
  await expect(again.getByText(name)).toHaveCount(0);
});
