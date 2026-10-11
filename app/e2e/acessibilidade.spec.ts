import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login, openDialog, SCREENS, settle } from "./helpers";

/**
 * Revisão de acessibilidade com o axe (regras WCAG 2.1 A e AA): a tela de login e as
 * telas internas, no tema claro e no escuro, também com as janelas e o painel abertos.
 * Qualquer violação reprova, com a lista do que achou e onde.
 */

/** Estados com janela ou painel aberto, que a varredura da tela sozinha não vê. */
const OPEN: {
  name: string;
  path: string;
  open: (page: Page) => Promise<unknown>;
}[] = [
  {
    name: "painel da tarefa",
    path: "/projetos/EXE/lista",
    open: async (page) => {
      await page.locator('a[href*="tarefa=HUB-"]').first().click();
      await expect(page.locator("#painel-tarefa-titulo")).toBeVisible();
      await page.waitForLoadState("networkidle");
    },
  },
  {
    name: "Nova tarefa",
    path: "/",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: "Nova tarefa", exact: true }).first(),
        "Nova tarefa",
      ),
  },
  {
    name: "busca",
    path: "/",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: /^Buscar/ }).first(),
        "Buscar no Hub",
      ),
  },
  {
    name: "Concierge (prévia)",
    path: "/projetos/EXE",
    open: async (page) => {
      const dialog = await openDialog(
        page,
        page.getByRole("button", { name: /^Buscar/ }).first(),
        "Buscar no Hub",
      );
      await dialog
        .getByRole("combobox")
        .fill(
          '{"kind":"create_task","title":"Prévia da revisão de acessibilidade"}',
        );
      await dialog.getByRole("option", { name: /^Pedir ao Concierge/ }).click();
      await expect(dialog.getByText("Criar uma tarefa")).toBeVisible();
    },
  },
  {
    name: "Modelo de IA",
    path: "/agentes",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: /^Modelo de IA de / }).first(),
        "Modelo de IA",
      ),
  },
  {
    name: "Novo marco",
    path: "/projetos/EXE",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: "Novo marco" }).first(),
        "Novo marco em EXE",
      ),
  },
  {
    name: "Novo modelo",
    path: "/modelos",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: "Novo modelo" }),
        "Novo modelo de projeto",
      ),
  },
  {
    name: "Editar frente (com Depende de)",
    path: "/projetos/EXE",
    open: (page) =>
      openDialog(
        page,
        page.getByRole("button", { name: /^Editar a frente / }).first(),
        "Editar frente",
      ),
  },
];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations.map((v) => ({
    regra: v.id,
    impacto: v.impact,
    ajuda: v.help,
    onde: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

test("login sem violações", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

for (const theme of ["claro", "escuro"] as const) {
  test(`telas internas sem violações, tema ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("hub:tema", value);
    }, theme);
    await login(page);
    const found: Record<string, unknown> = {};
    for (const path of SCREENS) {
      await page.goto(path);
      await settle(page);
      const list = await violations(page);
      if (list.length > 0) found[path] = list;
    }
    for (const state of OPEN) {
      await page.goto(state.path);
      await settle(page);
      await state.open(page);
      const list = await violations(page);
      if (list.length > 0) found[state.name] = list;
    }
    expect(found).toEqual({});
  });
}

test.describe("celular", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("telas no celular sem violações, também com o menu aberto", async ({
    page,
  }) => {
    await login(page);
    const found: Record<string, unknown> = {};
    for (const path of [
      "/",
      "/projetos/EXE",
      "/projetos/EXE/lista",
      "/projetos/EXE/quadro",
      "/projetos/EXE/painel",
    ]) {
      await page.goto(path);
      await settle(page);
      const list = await violations(page);
      if (list.length > 0) found[path] = list;
    }
    await page.goto("/");
    await settle(page);
    await openDialog(
      page,
      page.getByRole("button", { name: "Abrir o menu" }),
      "Menu",
    );
    const list = await violations(page);
    if (list.length > 0) found["menu do celular"] = list;
    expect(found).toEqual({});
  });
});
