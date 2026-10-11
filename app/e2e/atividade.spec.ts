import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/** Exportação da atividade por período (RF-43): o CSV do projeto, baixado pelo Painel. */
test("exporta a atividade do projeto em CSV pelo Painel", async ({ page }) => {
  await login(page);
  await page.goto("/projetos/EXE/painel");
  await settle(page);
  const card = page.getByRole("region", { name: "Exportar a atividade" });
  const waiting = page.waitForEvent("download");
  await card.getByRole("button", { name: "Exportar" }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(
    /^atividade-EXE-\d{4}-\d{2}-01-a-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const text = readFileSync(await download.path(), "utf8");
  expect(text.startsWith("﻿quando;projeto;tipo de ator;quem;")).toBe(true);
});
