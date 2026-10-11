import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Privacidade (LGPD): o dono exporta os dados do cliente em JSON e exclui os dados
 * pessoais de um contato, com confirmação. Nomes únicos por execução: o banco do
 * computador guarda tudo entre uma execução e outra.
 */
test("exporta os dados do cliente e exclui os dados pessoais de um contato", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const name = `Contato LGPD ${stamp}`;
  const email = `lgpd-${stamp}@exemplo.com`;
  await login(page);
  await page.goto("/clientes/clinica-exemplo/portal");
  await settle(page);

  const novo = page.getByRole("region", { name: "Novo contato" });
  await novo.getByLabel("Nome").fill(name);
  await novo.getByLabel("E-mail").fill(email);
  await novo.getByRole("button", { name: "Cadastrar contato" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // A exportação traz o contato novo, num arquivo JSON para baixar.
  const exported = await page.request.get(
    "/clientes/clinica-exemplo/portal/exportar",
  );
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-disposition"]).toMatch(
    /attachment; filename="dados-clinica-exemplo-\d{4}-\d{2}-\d{2}\.json"/,
  );
  const data = (await exported.json()) as {
    contatos: { nome: string; email: string }[];
  };
  expect(data.contatos).toContainEqual(
    expect.objectContaining({ nome: name, email }),
  );

  // Excluir pede confirmação; depois, o nome e o e-mail somem da lista de contatos (a
  // mensagem do cadastro, acima, continua dizendo quem foi cadastrado).
  const contatos = page.getByRole("region", { name: /^Contatos/ });
  await contatos
    .getByRole("button", { name: `Excluir os dados pessoais de ${name}` })
    .click();
  await contatos.getByRole("button", { name: "Sim, excluir os dados" }).click();
  await expect(contatos.getByText(email)).toHaveCount(0);
  await expect(contatos.getByText(name)).toHaveCount(0);
  await expect(
    contatos.getByText("Dados pessoais excluídos").first(),
  ).toBeVisible();
  // Recarregada a tela, o contato continua só como "Contato removido".
  await page.reload();
  await settle(page);
  await expect(page.getByText(email)).toHaveCount(0);
  await expect(page.getByText(name)).toHaveCount(0);
});
