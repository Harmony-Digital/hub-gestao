import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Edição na linha da Lista: a célula grava na hora (chamando a ação direto, sem
 * formulário por linha) e o valor continua depois de recarregar. O histórico da tarefa
 * registra a mudança.
 */
test("muda a prioridade na linha da Lista e o valor fica gravado", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projetos/EXE/lista");
  await settle(page);

  const select = page
    .getByRole("main")
    .getByRole("combobox", { name: /^Prioridade de [A-Z]+-\d+$/ })
    .first();
  const label = (await select.getAttribute("aria-label"))!;
  const code = label.replace("Prioridade de ", "");
  const before = await select.inputValue();
  const next = before === "low" ? "high" : "low";

  await select.selectOption(next);
  // Gravado: a tela se atualiza (a versão da tarefa muda e a célula é montada de novo).
  await expect(
    page.getByRole("main").getByRole("combobox", { name: label }),
  ).toHaveValue(next);
  await page.waitForLoadState("networkidle");
  await page.reload();
  await settle(page);
  await expect(
    page.getByRole("main").getByRole("combobox", { name: label }),
  ).toHaveValue(next);

  // No painel da tarefa, o histórico mostra a mudança.
  await page.goto(`/projetos/EXE/lista?tarefa=${code}`);
  // O Next guarda a página anterior escondida: vale só o que está à vista.
  await expect(
    page.locator("#painel-tarefa-titulo").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/mudou a prioridade/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});

/**
 * Visão padrão por departamento (RF-23): o atalho do departamento na faixa Visões
 * mostra só as tarefas das frentes dele, e a barra de filtros acompanha o endereço
 * (o campo do departamento muda junto, também ao voltar para Tudo).
 */
test("o atalho do departamento filtra a Lista e a barra acompanha", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projetos/EXE/lista");
  await settle(page);
  const main = page.getByRole("main");
  const department = main.getByRole("combobox", {
    name: "Departamento",
    exact: true,
  });
  const sistemas = main.getByRole("link", { name: "Departamento Sistemas" });

  await sistemas.click();
  await expect(page).toHaveURL(/\/lista\?depto=sistemas$/);
  await expect(sistemas).toHaveAttribute("aria-current", "page");
  await expect(department).toHaveValue("sistemas");
  await expect(
    main.getByRole("link", { name: /Integrar consulta de horários livres/ }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: /Desenhar a tela de fila da recepção/ }),
  ).toHaveCount(0);

  await main.getByRole("link", { name: "Tudo", exact: true }).click();
  await expect(page).toHaveURL(/\/lista$/);
  await expect(department).toHaveValue("");
  await expect(
    main.getByRole("link", { name: /Desenhar a tela de fila da recepção/ }),
  ).toBeVisible();
});
