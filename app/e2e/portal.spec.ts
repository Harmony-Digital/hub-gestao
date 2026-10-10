import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Portal do cliente (D9): o contato nasce sem acesso; o dono libera e copia o link de uso
 * único; o contato entra por ele num navegador sem a sessão da equipe, aceita o uso dos
 * dados, vê só o que é dele e sai; o link não vale de novo; o dono revoga.
 */

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations.map((v) => ({
    regra: v.id,
    onde: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

test("o dono libera o acesso e o contato acompanha os projetos pelo portal", async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const name = `Contato ${stamp}`;
  const email = `contato-${stamp}@exemplo.com.br`;

  await login(page);
  await page.goto("/clientes/clinica-exemplo/portal");
  await settle(page);
  const novo = page.getByRole("region", { name: "Novo contato" });
  await novo.getByLabel("Nome").fill(name);
  await novo.getByLabel("E-mail").fill(email);
  await novo.getByLabel(/^Decisor/).check();
  await novo.getByRole("button", { name: "Cadastrar contato" }).click();
  await expect(
    page.getByText(`${name} cadastrado, ainda sem acesso ao portal.`),
  ).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: email });
  await expect(row.getByText("Sem acesso", { exact: true })).toBeVisible();
  await row
    .getByRole("button", { name: `Liberar o acesso de ${name} ao portal` })
    .click();
  await expect(row.getByText(/^Acesso liberado\./)).toBeVisible();
  const link = (await row.locator("code").textContent()) ?? "";
  expect(link).toMatch(/\/portal\/entrar\/[A-Za-z0-9_-]{43}$/);
  await expect(
    row.getByText("Link enviado, ainda não entrou", { exact: true }),
  ).toBeVisible();
  // O endereço do link é o público do Hub; aqui, o caminho vai para o servidor do teste.
  const entrar = new URL(new URL(link).pathname, page.url()).toString();

  // O contato, em outro navegador: sem a sessão da equipe.
  const context = await browser.newContext();
  const client = await context.newPage();
  await client.goto(entrar);
  await expect(
    client.getByRole("heading", { name: "Seu acesso ao portal" }),
  ).toBeVisible();
  expect(await violations(client)).toEqual([]);
  // Abrir a página (como a prévia do WhatsApp faz) não gasta o link: só o clique.
  await client.reload();
  await client.getByRole("button", { name: "Entrar no portal" }).click();
  await expect(client).toHaveURL(/\/portal\/clinica-exemplo$/);
  await expect(
    client.getByRole("heading", { name: `Boas-vindas, ${name}` }),
  ).toBeVisible();
  expect(await violations(client)).toEqual([]);
  await client
    .getByRole("button", { name: "Concordo e quero continuar" })
    .click();
  await expect(
    client.getByRole("heading", { name: "Seus projetos" }),
  ).toBeVisible();
  await expect(
    client.getByRole("heading", { name: "Atendimento com IA (exemplo)" }),
  ).toBeVisible();
  await expect(
    client.getByText(
      "Atendimento mais rápido no WhatsApp, com agendamento automático.",
    ),
  ).toBeVisible();
  // O texto interno do projeto nunca aparece no portal.
  await expect(client.getByText(/painel para a recepção/)).toHaveCount(0);
  expect(await violations(client)).toEqual([]);

  // A página do projeto: entregas e frentes marcadas para o cliente, nada interno.
  await client
    .getByRole("link", {
      name: "Ver as entregas de Atendimento com IA (exemplo)",
    })
    .click();
  await expect(client).toHaveURL(/\/portal\/clinica-exemplo\/EXE$/);
  await expect(
    client.getByRole("heading", { name: "Entregas", exact: true }),
  ).toBeVisible();
  for (const visible of [
    "Diagnóstico e desenho do atendimento",
    "Agente de atendimento no WhatsApp",
    "Fluxo de conversa do agente",
    "Integração com a agenda da clínica",
  ]) {
    await expect(client.getByText(visible, { exact: true })).toBeVisible();
  }
  await expect(client.locator('[aria-current="step"]')).toHaveText(/Validar/);
  const text = await client.getByRole("main").innerText();
  for (const hidden of [
    // frentes internas, tarefas, agentes e o objetivo interno
    "Telas do painel da recepção",
    "Mensagens e respostas padrão",
    "Mapear as perguntas mais frequentes",
    "Escrever o fluxo de agendamento",
    "Revisar o tom das mensagens",
    "Kratos",
    "Codex",
    "painel para a recepção",
  ]) {
    expect({ hidden, found: text.includes(hidden) }).toEqual({
      hidden,
      found: false,
    });
  }
  expect(text).not.toMatch(/\bHUB-\d+\b/);
  expect(await violations(client)).toEqual([]);
  // Projeto que não é do cliente: a mesma resposta de "não encontrado".
  await client.goto("/portal/clinica-exemplo/HUB");
  await expect(
    client.getByRole("heading", { name: "Projeto não encontrado" }),
  ).toBeVisible();
  await client.goto("/portal/clinica-exemplo");

  // Sair encerra a sessão; o mesmo link não vale de novo.
  await client.getByRole("button", { name: "Sair" }).click();
  await expect(
    client.getByRole("heading", { name: "Você saiu do portal" }),
  ).toBeVisible();
  await client.goto("/portal/clinica-exemplo");
  await expect(
    client.getByRole("heading", { name: "Seu acesso não está ativo" }),
  ).toBeVisible();
  await client.goto(entrar);
  await client.getByRole("button", { name: "Entrar no portal" }).click();
  await expect(client).toHaveURL(/\/portal\/sem-acesso$/);
  await context.close();

  // De volta à equipe: o contato entrou e aceitou; o dono revoga.
  await page.reload();
  await settle(page);
  await expect(row.getByText("Com acesso", { exact: true })).toBeVisible();
  await expect(row.getByText(/Aceitou o uso dos dados em/)).toBeVisible();
  await row
    .getByRole("button", { name: `Revogar o acesso de ${name} ao portal` })
    .click();
  await row.getByRole("button", { name: "Sim, revogar" }).click();
  await expect(row.getByText(/^Acesso revogado:/)).toBeVisible();
  await expect(row.getByText("Acesso revogado", { exact: true })).toBeVisible();
});
