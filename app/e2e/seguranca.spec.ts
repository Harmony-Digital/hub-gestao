import { expect, test } from "@playwright/test";
import { login, SCREENS, settle } from "./helpers";

/**
 * Cabeçalhos de segurança (M8) no navegador: a política de conteúdo (CSP) chega em toda
 * tela e nada do que as telas carregam é recusado por ela. Aqui roda a versão de
 * desenvolvimento da política, que só acrescenta o eval do React e o WebSocket do
 * recarregamento à de produção.
 */

test("toda tela traz a política de conteúdo e nada é recusado por ela", async ({
  page,
}) => {
  const refused: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Refused to/i.test(text)) {
      refused.push(`${page.url()}: ${text.slice(0, 200)}`);
    }
  });

  const loginPage = await page.goto("/login");
  const headers = loginPage?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["permissions-policy"]).toContain("microphone=(self)");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");

  await login(page);
  for (const path of SCREENS) {
    const response = await page.goto(path);
    expect(
      response?.headers()["content-security-policy"],
      `${path} sem a política de conteúdo`,
    ).toBeTruthy();
    await settle(page);
  }
  // O painel da tarefa e a busca (⌘K), que buscam dados no navegador.
  await page.goto("/projetos/EXE/lista");
  await settle(page);
  await page.locator('a[href*="tarefa=HUB-"]').first().click();
  await expect(page.locator("#painel-tarefa-titulo")).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(refused).toEqual([]);
});
