import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** Depois de um envio: o botão de novo ativo, sem a transição, e o título da página no lugar. */
async function settled(page: Page, button: Locator) {
  await expect(button).toBeEnabled();
  await expect(button).toHaveCSS("opacity", "1");
  await expect(page).toHaveTitle(/\S/);
  await page.waitForLoadState("networkidle");
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

  // Conversa com a equipe: o contato escreve, a equipe vê e responde.
  const question = `Podemos testar na quinta? (${stamp})`;
  const conversa = client.getByRole("region", {
    name: "Conversa com a equipe",
  });
  await conversa.getByLabel("Escreva para a equipe").fill(question);
  await conversa.getByRole("button", { name: "Enviar" }).click();
  await expect(
    conversa.getByText(
      "Mensagem enviada. A equipe da Harmony recebeu o aviso.",
    ),
  ).toBeVisible();
  await expect(conversa.getByText(question)).toBeVisible();
  // O axe mede a tela assentada: o botão volta do estado de envio com uma transição.
  await settled(client, conversa.getByRole("button", { name: "Enviar" }));
  expect(await violations(client)).toEqual([]);

  await page.goto("/projetos/EXE");
  await settle(page);
  const canal = page.getByRole("region", { name: "Canal do cliente" });
  await expect(canal.getByText(question)).toBeVisible();
  const answer = `Pode sim, às 10h. (${stamp})`;
  await canal.getByLabel("Responder ao cliente").fill(answer);
  await canal.getByRole("button", { name: "Enviar ao cliente" }).click();
  await expect(
    canal.getByText("Mensagem enviada: o cliente vê no portal."),
  ).toBeVisible();
  await expect(canal.getByText(answer)).toBeVisible();
  await settled(page, canal.getByRole("button", { name: "Enviar ao cliente" }));
  expect(await violations(page)).toEqual([]);

  // Arquivo entregue: a equipe manda, o cliente baixa pelo portal.
  const delivered = `Entrega ${stamp}.pdf`;
  const arquivos = page.getByRole("region", {
    name: "Arquivos entregues ao cliente",
  });
  await arquivos.getByLabel("Arquivo para o cliente").setInputFiles({
    name: delivered,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nEntrega de teste\n"),
  });
  await arquivos.getByRole("button", { name: "Entregar ao cliente" }).click();
  await expect(
    arquivos.getByText(`${delivered} entregue: o cliente vê no portal.`),
  ).toBeVisible();
  await settled(
    page,
    arquivos.getByRole("button", { name: "Entregar ao cliente" }),
  );
  expect(await violations(page)).toEqual([]);
  // O aviso chegou na caixa de entrada do dono.
  await page.goto("/caixa-de-entrada");
  await settle(page);
  await expect(
    page.getByText(`${name} escreveu no portal, em EXE`).first(),
  ).toBeVisible();

  await client.reload();
  await expect(conversa.getByText(answer)).toBeVisible();
  await expect(
    conversa.getByRole("listitem").filter({ hasText: answer }),
  ).toContainText("Equipe Harmony");
  const fileLink = client
    .getByRole("region", { name: "Arquivos entregues" })
    .getByRole("link", { name: delivered });
  await expect(fileLink).toBeVisible();
  const download = await client
    .context()
    .request.get(
      new URL((await fileLink.getAttribute("href"))!, client.url()).toString(),
    );
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect((await download.body()).toString()).toContain("Entrega de teste");
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
  await page.goto("/clientes/clinica-exemplo/portal");
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
