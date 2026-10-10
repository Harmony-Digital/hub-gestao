import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Aprovação em lote das importações de projeto (D10). O banco de exemplo traz duas
 * importações esperando revisão (IMPA e IMPB), feitas pelo caminho real do importador.
 * No banco novo do CI elas estão sempre pendentes; num banco local em que já foram
 * aprovadas numa conferência anterior, o teste não tem o que aprovar e é pulado.
 */
test("o dono aprova em lote as importações, com confirmação", async ({
  page,
}) => {
  await login(page);
  await settle(page);
  const lote = page.getByRole("region", {
    name: /^Importações de projeto para revisar/,
  });
  test.skip(
    !(await lote.isVisible()),
    "Banco local sem importações pendentes (já aprovadas antes).",
  );
  await expect(lote.getByRole("checkbox")).toHaveCount(2);
  await lote.getByRole("button", { name: "Aprovar as marcadas (2)" }).click();
  await lote.getByRole("button", { name: "Sim, aprovar" }).click();
  await expect(
    page.getByText(/^2 importações aprovadas: IMP[AB], IMP[AB]\.$/),
  ).toBeVisible();
  await page.goto("/projetos/IMPA");
  await settle(page);
  await expect(page.getByText("Em revisão")).toHaveCount(0);
});
