import { expect, test } from "@playwright/test";
import { login, openDialog, settle } from "./helpers";

/**
 * Configurações: o dono põe uma pessoa na equipe, muda o papel, suspende (com
 * confirmação) e devolve o acesso, e escolhe o responsável de um departamento. Nomes
 * únicos por execução: o banco do computador guarda tudo entre uma execução e outra.
 */
test("o dono cuida da equipe e do responsável de um departamento", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const name = `Pessoa ${stamp}`;
  const email = `pessoa-${stamp}@harmony.test`;
  await login(page);
  await page.goto("/configuracoes");
  await settle(page);

  const equipe = page.getByRole("region", { name: "Equipe" });
  const novo = await openDialog(
    page,
    equipe.getByRole("button", { name: "Pôr na equipe" }),
    "Pôr uma pessoa na equipe",
  );
  await novo.getByLabel("Nome").fill(name);
  await novo.getByLabel("E-mail de login").fill(email);
  await novo.getByRole("button", { name: "Pôr na equipe" }).click();
  await expect(novo).toBeHidden();
  const row = equipe.getByRole("listitem").filter({ hasText: email });
  await expect(row).toContainText("Ainda não entrou");

  // Papel: de Equipe para Administração.
  const papel = await openDialog(
    page,
    row.getByRole("button", { name: `Mudar o papel de ${name}` }),
    "Mudar o papel",
  );
  await expect(papel.getByRole("radio", { name: /^Equipe/ })).toBeChecked();
  await papel.getByRole("radio", { name: /^Administração/ }).check();
  await papel.getByRole("button", { name: "Salvar o papel" }).click();
  await expect(papel).toBeHidden();
  await expect(row).toContainText("Administração");

  // Suspender pede confirmação; devolver o acesso, não.
  page.once("dialog", (confirm) => void confirm.accept());
  await row
    .getByRole("button", { name: `Suspender o acesso de ${name}` })
    .click();
  await expect(row).toContainText("Suspensa");
  await row
    .getByRole("button", { name: `Devolver o acesso de ${name}` })
    .click();
  await expect(row).toContainText("Ativa");

  // Responsável do departamento: alguém ativo da equipe; fica gravado.
  const departamentos = page.getByRole("region", { name: "Departamentos" });
  await departamentos
    .getByRole("combobox", { name: "Responsável por Estratégia" })
    .selectOption({ label: name });
  await departamentos
    .getByRole("button", { name: "Salvar o responsável por Estratégia" })
    .click();
  await expect(departamentos.getByText("Responsável salvo.")).toBeVisible();
  await page.reload();
  await settle(page);
  await expect(
    page
      .getByRole("region", { name: "Departamentos" })
      .getByRole("combobox", { name: "Responsável por Estratégia" })
      .locator("option:checked"),
  ).toHaveText(name);
});

test("o dono cria, renomeia e remove um departamento sem uso (RF-27)", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const name = `Área ${stamp}`;
  const renamed = `Área renomeada ${stamp}`;
  await login(page);
  await page.goto("/configuracoes");
  await settle(page);

  const departamentos = page.getByRole("region", { name: "Departamentos" });
  const novo = await openDialog(
    page,
    departamentos.getByRole("button", { name: "Novo departamento" }),
    "Novo departamento",
  );
  await novo.getByLabel("Nome").fill(name);
  await novo.getByRole("button", { name: "Criar o departamento" }).click();
  await expect(novo).toBeHidden();
  const row = departamentos.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("sem uso");
  const href = await row.getByRole("link", { name }).getAttribute("href");

  const editar = await openDialog(
    page,
    row.getByRole("button", { name: `Editar o departamento ${name}` }),
    "Editar departamento",
  );
  await editar.getByLabel("Nome").fill(renamed);
  await editar.getByRole("button", { name: "Salvar o departamento" }).click();
  await expect(editar).toBeHidden();
  const same = departamentos.getByRole("listitem").filter({ hasText: renamed });
  // Renomear não muda o endereço do departamento.
  await expect(same.getByRole("link", { name: renamed })).toHaveAttribute(
    "href",
    href!,
  );

  page.once("dialog", (confirm) => void confirm.accept());
  await same
    .getByRole("button", { name: `Remover o departamento ${renamed}` })
    .click();
  await expect(same).toHaveCount(0);
});
