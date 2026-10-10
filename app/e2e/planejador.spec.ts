import { expect, test } from "@playwright/test";
import { login, settle } from "./helpers";

/**
 * Planejador (PL-11) com o modelo simulado: o documento termina com a proposta em JSON,
 * que faz o papel da IA (src/lib/llm/dev-fake.ts). Confere o caminho da tela: documento,
 * proposta no formato do plan.md, levar para a importação e ver o que entraria (nada é
 * gravado nesta conferência).
 */
test("documento vira proposta de plano, revisada na importação", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projetos/EXE/importar");
  await settle(page);
  const marco = `Agendamento automático ${Date.now().toString(36)}`;
  const proposta = {
    milestones: [
      {
        title: marco,
        due_date: null,
        acceptance_criteria: ["O paciente agenda sem falar com a recepção"],
        client_title: "Seu agendamento automático",
        client_summary: "Seus pacientes marcam consulta pelo WhatsApp.",
        workstreams: [
          {
            title: "Fluxo de conversa",
            department: null,
            tasks: [
              { title: "Escrever o fluxo de agendamento", subtasks: [] },
              { title: "Testar com a recepção", subtasks: [] },
            ],
          },
        ],
      },
    ],
    assumptions: ["A clínica já usa uma agenda com API?"],
  };
  await page
    .getByLabel("Documento")
    .fill(
      `A clínica quer que os pacientes marquem consulta pelo WhatsApp.\n${JSON.stringify(proposta)}`,
    );
  await page.getByRole("button", { name: "Pedir a proposta" }).click();
  await expect(
    page.getByText(/^Proposta pronta: 1 marco, 1 frente, 2 tarefas/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "A clínica já usa uma agenda com API?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Levar para a importação" }).click();

  const campo = page.getByLabel(/^Conteúdo do /);
  await expect(campo).toHaveValue(new RegExp(`## M\\d+ — ${marco}`));
  await expect(campo).toHaveValue(/- \[ \] Escrever o fluxo de agendamento/);
  await page.getByRole("button", { name: "Ver o que entra" }).click();
  await expect(page.getByText("Marcos novos")).toBeVisible();
});
