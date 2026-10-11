import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Tempo da tarefa (M7, TO-15): estimativa e lançamento pelo painel da tarefa, e o resumo
 * no Painel do projeto. O banco do computador guarda os lançamentos de execuções
 * anteriores: o teste confere o aviso e o "acima da estimativa", não o total exato.
 */
test("estimativa e lançamento de tempo no painel da tarefa", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projetos/EXE/lista");
  await settle(page);
  await page.locator('a[href*="tarefa=HUB-"]').first().click();
  await expect(page.locator("#painel-tarefa-titulo")).toBeAttached();
  const estimate = page.getByLabel("Estimativa");
  await estimate.fill("1h");
  await estimate.press("Enter");
  // Salvo: o tempo da tarefa passa a comparar com a estimativa nova.
  await expect(page.getByText(/de 1h estimados/)).toBeVisible();

  const time = page.getByLabel("Tempo", { exact: true });
  await time.fill("1h30");
  await page.getByLabel("Nota (opcional)").fill("Teste de ponta a ponta");
  await page.getByRole("button", { name: "Lançar tempo" }).click();
  await expect(page.getByText(/^1h30 lançados em HUB-\d+\.$/)).toBeVisible();
  await expect(page.getByText(/de 1h estimados/)).toBeVisible();
  await expect(page.getByText("· acima da estimativa")).toBeVisible();

  await page.goto("/projetos/EXE/painel");
  await settle(page);
  const card = page.getByRole("region", { name: "Tempo registrado" });
  await expect(card.getByText(/no mês/).first()).toBeVisible();
});
