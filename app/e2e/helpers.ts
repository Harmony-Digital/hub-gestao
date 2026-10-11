import { expect, type Locator, type Page } from "@playwright/test";

/** Telas internas que as revisões de acessibilidade e de identidade percorrem. */
export const SCREENS = [
  "/",
  "/minhas-tarefas",
  "/aprovacoes",
  "/relatorios",
  "/caixa-de-entrada",
  "/clientes",
  "/clientes/clinica-exemplo/portal",
  "/projetos",
  "/departamentos",
  "/departamentos/agentes-e-automacoes",
  "/projetos/EXE",
  "/projetos/EXE/lista",
  "/projetos/EXE/quadro",
  "/projetos/EXE/calendario",
  "/projetos/EXE/editar",
  "/projetos/EXE/importar",
  "/agentes",
  "/conta",
];

/** Entra com o login de teste (só no banco local) e chega no Hoje. */
export async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Entrar como dono, sem senha/ })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Clica num botão que abre uma janela. Antes de a página terminar de carregar, o clique
 * não faz nada: repete até a janela aparecer.
 */
export async function openDialog(
  page: Page,
  button: Locator,
  name: string | RegExp,
): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name });
  await expect(async () => {
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  return dialog;
}

/** Espera a tela terminar de chegar (conteúdo em streaming incluído). */
export async function settle(page: Page) {
  await expect(page.locator("#conteudo")).toBeVisible();
  await page.waitForLoadState("networkidle");
}
