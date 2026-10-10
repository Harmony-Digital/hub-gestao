import { expect, test, type Locator, type Page } from "@playwright/test";
import { login, openDialog } from "./helpers";

/**
 * Jornada principal da equipe, de ponta a ponta, no navegador: criar a tarefa, mover no
 * Quadro, concluir com evidência e aprovar um pedido no Hoje. Roda no banco local (PGlite)
 * com o login de teste e o projeto de exemplo EXE (HUB_DEV_LOGIN e HUB_DEV_SAMPLE).
 */

// Nomes únicos por execução: o teste também roda sobre um banco local já usado.
const RUN = Date.now().toString(36).toUpperCase();
const TASK = `Tarefa de ponta a ponta ${RUN}`;
const MILESTONE = `Marco de ponta a ponta ${RUN}`;

/** Coluna do Quadro pelo nome do status (o título da coluna traz também a contagem). */
function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name: new RegExp(`^${name}\\s*\\d+$`) });
}

function card(scope: Page | Locator, title: string): Locator {
  return scope.locator("[data-board-card]").filter({ hasText: title });
}

/** Arrasta o cartão com o mouse até o fim da coluna (o Quadro começa a arrastar após 6 px). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("Cartão ou coluna fora da tela.");
  const x = a.x + a.width / 2;
  const y = a.y + a.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 12, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 20, {
    steps: 16,
  });
  await page.mouse.up();
}

test("cria a tarefa, move no Quadro, conclui com evidência e aprova no Hoje", async ({
  page,
}) => {
  await test.step("entra com o login de teste", () => login(page));

  let code = "";
  await test.step("cria a tarefa pela Nova tarefa do menu", async () => {
    const dialog = await openDialog(
      page,
      page.getByRole("button", { name: "Nova tarefa", exact: true }).first(),
      "Nova tarefa",
    );
    await dialog.getByLabel("Projeto").selectOption("EXE");
    await dialog.getByLabel("Título").fill(TASK);
    await dialog.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page).toHaveURL(/\/projetos\/EXE\/lista\?tarefa=HUB-\d+/);
    code = new URL(page.url()).searchParams.get("tarefa") ?? "";
    expect(code).toMatch(/^HUB-\d+$/);
  });

  await test.step("move a tarefa para Em andamento no Quadro", async () => {
    await page.goto("/projetos/EXE/quadro");
    const todo = column(page, "A fazer");
    await expect(card(todo, TASK)).toBeVisible();
    const doing = column(page, "Em andamento");
    await expect(async () => {
      await drag(page, card(page, TASK), doing);
      await expect(card(doing, TASK)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // Gravado no servidor: continua na coluna depois de recarregar.
    await page.reload();
    await expect(card(column(page, "Em andamento"), TASK)).toBeVisible();
  });

  await test.step("conclui no Quadro, com a evidência", async () => {
    const done = column(page, "Concluída");
    const dialog = page.getByRole("dialog", { name: `Concluir ${code}` });
    await expect(async () => {
      await drag(page, card(page, TASK), done);
      await expect(dialog).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await dialog
      .getByLabel("Evidência da entrega")
      .fill(`Teste de ponta a ponta ${RUN}: https://hub.harmonydigital.com.br`);
    await dialog.getByRole("button", { name: "Concluir a tarefa" }).click();
    await expect(dialog).toBeHidden();
    await expect(card(done, TASK)).toBeVisible();
    await page.reload();
    await expect(card(column(page, "Concluída"), TASK)).toBeVisible();
  });

  await test.step("pede o aceite de um marco entregue", async () => {
    await page.goto("/projetos/EXE");
    const dialog = await openDialog(
      page,
      page.getByRole("button", { name: "Novo marco" }).first(),
      "Novo marco em EXE",
    );
    await dialog.getByLabel("Título do marco").fill(MILESTONE);
    await dialog
      .getByLabel("Status", { exact: true })
      .selectOption({ label: "Entregue" });
    await dialog.getByLabel("O cliente vê este marco no portal.").uncheck();
    await dialog.getByRole("button", { name: "Criar marco" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole("listitem").filter({ hasText: MILESTONE });
    const ask = await openDialog(
      page,
      row.getByRole("button", { name: /^Pedir aceite do M\d+$/ }),
      /^Pedir o aceite do M\d+$/,
    );
    await ask.getByRole("button", { name: "Pedir o aceite" }).click();
    await expect(ask).toBeHidden();
    await expect(row.getByText("Aceite pedido")).toBeVisible();
  });

  await test.step("aprova o pedido no Hoje", async () => {
    await page.goto("/");
    const request = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: MILESTONE }) });
    await expect(request).toBeVisible();
    // Antes de a tela terminar de carregar, o clique não decide nada: repete até o aviso.
    const notice = page.getByText(/^Aprovado: “Aceite do M\d+/);
    await expect(async () => {
      if (!(await notice.isVisible())) {
        await request
          .getByRole("button", { name: "Aprovar" })
          .click({ timeout: 5_000 });
      }
      await expect(notice).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(request).toBeHidden();

    // O marco passou a Aceito.
    await page.goto("/projetos/EXE");
    const row = page.getByRole("listitem").filter({ hasText: MILESTONE });
    await expect(row.getByText("Aceito", { exact: true })).toBeVisible();
  });
});
