import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Logo do cliente (RF-04): o dono cadastra um cliente, envia o logo, vê o logo na lista
 * e remove. Nome único por execução: o banco do computador guarda tudo entre uma
 * execução e outra.
 */

/** PNG de 1 x 1 pixel. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("o dono envia, vê e remove o logo do cliente", async ({ page }) => {
  const name = `Cliente ${Date.now().toString(36)}`;
  await login(page);
  await page.goto("/clientes");
  await settle(page);

  const novo = page.getByRole("region", { name: "Novo cliente" });
  await novo.getByLabel("Nome do cliente").fill(name);
  await novo.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(novo.getByText(`Cliente “${name}” cadastrado.`)).toBeVisible();

  const item = page.getByRole("listitem").filter({ hasText: name });
  await item.locator("summary").click();
  const logo = item.getByRole("region", { name: "Logo" });
  await expect(logo).toContainText("Sem logo");

  // Arquivo que não é imagem: o Hub recusa e explica.
  await logo.getByLabel(`Imagem do logo de ${name}`).setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  });
  await logo.getByRole("button", { name: "Enviar o logo" }).click();
  await expect(
    logo.getByText("O logo precisa ser PNG, JPG ou WebP."),
  ).toBeVisible();

  await logo.getByLabel(`Imagem do logo de ${name}`).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await logo.getByRole("button", { name: "Enviar o logo" }).click();
  await expect(logo.getByText("Logo atualizado.")).toBeVisible();
  const image = logo.getByRole("img", { name: `Logo de ${name}` });
  await expect(image).toBeVisible();
  // A imagem vem mesmo do Hub (a rota exige a sessão da equipe).
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);

  await logo.getByRole("button", { name: "Remover o logo" }).click();
  await expect(logo.getByText("Logo removido.")).toBeVisible();
  await expect(logo).toContainText("Sem logo");
});
