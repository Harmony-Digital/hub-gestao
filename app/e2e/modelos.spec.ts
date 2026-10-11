import { expect, test } from "@playwright/test";
import { login, openDialog, settle } from "./helpers";

/**
 * Modelos de projeto (RF-36): o Novo projeto com um modelo marca os departamentos dele e
 * abre o projeto na importação com o esqueleto; a prévia mostra o que entra, e as frentes
 * chegam com o departamento. No fim, o projeto de teste é arquivado (o banco do computador
 * guarda tudo entre uma execução e outra).
 */
test("novo projeto a partir de um modelo, com prévia e importação", async ({
  page,
}) => {
  const code = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await login(page);
  await page.goto("/projetos/novo");
  await settle(page);
  const form = page.getByRole("main");
  await form
    .getByLabel("Começar de um modelo (opcional)")
    .selectOption({ label: "Site institucional" });
  await expect(form.getByRole("checkbox", { name: "Design" })).toBeChecked();
  await expect(form.getByRole("checkbox", { name: "Dados" })).not.toBeChecked();
  await form.getByLabel("Código", { exact: true }).fill(code);
  await form.getByLabel("Nome do projeto").fill(`Site de teste ${code}`);
  await form
    .getByLabel("Cliente", { exact: true })
    .selectOption({ label: "Clínica Exemplo" });
  await form.getByRole("button", { name: "Criar projeto" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/projetos/${code}/importar\\?modelo=`),
  );
  await settle(page);
  const main = page.getByRole("main");
  await expect(
    main.getByText(/O esqueleto do modelo “Site institucional” está no campo/),
  ).toBeVisible();
  await expect(main.getByLabel(/^Conteúdo do /)).toHaveValue(
    /## M1 — Descoberta e conteúdo/,
  );
  await main.getByRole("button", { name: "Ver o que entra" }).click();
  await expect(main.getByText("O que entra (nada foi gravado)")).toBeVisible();
  await main.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(main.getByText("Importado", { exact: true })).toBeVisible();

  await page.goto(`/projetos/${code}`);
  await settle(page);
  const layout = page
    .getByRole("main")
    .getByRole("row")
    .filter({ hasText: "Layout" });
  await expect(layout.getByText("Design")).toBeVisible();

  // Arquiva o projeto de teste.
  await page.goto(`/projetos/${code}/editar`);
  await settle(page);
  const dialog = await openDialog(
    page,
    page.getByRole("button", { name: "Arquivar o projeto" }),
    `Arquivar ${code}?`,
  );
  await dialog.getByRole("button", { name: "Arquivar o projeto" }).click();
  await expect(page).toHaveURL(new RegExp(`/projetos/${code}`));
});
