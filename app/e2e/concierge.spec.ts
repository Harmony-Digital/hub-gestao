import { expect, test } from "@playwright/test";
import { login, openDialog, settle } from "./helpers";

/**
 * Concierge (CO-10) com o modelo simulado: o pedido escrito como JSON faz o papel da IA
 * (src/lib/llm/dev-fake.ts). O que se confere aqui é o caminho da tela: pedido, prévia
 * conferida pelo Hub, confirmação e resultado; e o ditado, com o reconhecimento de voz
 * do navegador trocado por um simulado.
 */

const searchButton = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Buscar/ }).first();

test("pedido digitado vira prévia, e a tarefa só nasce ao confirmar", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projetos/EXE");
  await settle(page);
  const title = `Revisar o roteiro ${Date.now().toString(36)}`;
  const dialog = await openDialog(page, searchButton(page), "Buscar no Hub");
  await dialog.getByRole("combobox").fill(
    JSON.stringify({
      kind: "create_task",
      title,
      priority: "high",
      assignee: "eu",
    }),
  );
  await dialog.getByRole("option", { name: /^Pedir ao Concierge/ }).click();

  // A prévia: projeto da tela, título, prioridade e responsável conferidos.
  await expect(dialog.getByText("Criar uma tarefa")).toBeVisible();
  await expect(dialog.getByLabel("Projeto")).toHaveValue("EXE");
  await expect(dialog.getByLabel("Título")).toHaveValue(title);
  await expect(dialog.getByLabel("Prioridade")).toHaveValue("high");
  await expect(dialog.getByLabel("Responsável")).toHaveValue("me");
  await dialog.getByRole("button", { name: "Confirmar e criar" }).click();

  await expect(page).toHaveURL(/\/projetos\/EXE\/lista\?tarefa=HUB-\d+$/);
  await expect(
    page.getByRole("heading", { name: new RegExp(`: ${title}$`) }),
  ).toBeVisible();
});

test("ditado: a fala vira pergunta, respondida com os dados do Hub", async ({
  page,
}) => {
  // Reconhecimento de voz simulado: "ouve" o pedido e termina.
  await page.addInitScript({
    content: `
      class ReconhecimentoSimulado {
        start() {
          setTimeout(() => {
            const transcript = '{"kind":"question","question":"blocked","project":"EXE"}';
            const result = Object.assign([{ transcript }], { isFinal: true });
            this.onresult && this.onresult({ resultIndex: 0, results: [result] });
            this.onend && this.onend();
          }, 200);
        }
        stop() {}
        abort() {}
      }
      window.webkitSpeechRecognition = ReconhecimentoSimulado;
      window.SpeechRecognition = ReconhecimentoSimulado;
    `,
  });
  await login(page);
  await page.goto("/projetos/EXE");
  await settle(page);
  const dialog = await openDialog(page, searchButton(page), "Buscar no Hub");
  await dialog
    .getByRole("button", { name: "Ditar o pedido ao Concierge" })
    .click();
  await expect(dialog.getByText(/^Você disse:/)).toBeVisible();
  await expect(dialog.getByText("Bloqueadas em EXE")).toBeVisible();
  await expect(
    dialog.getByText("Resposta com os dados do Hub, no seu alcance."),
  ).toBeVisible();
});
