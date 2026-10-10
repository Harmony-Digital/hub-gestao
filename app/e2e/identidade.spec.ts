import { expect, test } from "@playwright/test";
import { login, SCREENS, settle } from "./helpers";

/**
 * Identidade Harmony desenhada de fato no navegador: as três fontes carregadas e
 * aplicadas, as cores da marca e nenhum emoji no texto das telas internas.
 */

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

test("fontes e cores da marca no Hoje", async ({ page }) => {
  await login(page);
  await settle(page);
  const drawn = await page.evaluate(async () => {
    await document.fonts.ready;
    const style = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el) : null;
    };
    return {
      loaded: [...document.fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => f.family.replace(/["']/g, "")),
      title: style("h1")?.fontFamily,
      text: style("body")?.fontFamily,
      code: style(".font-mono")?.fontFamily,
      page: style("body")?.backgroundColor,
      menu: style(".hub-lateral .bg-navy")?.backgroundColor,
      brand: [...document.querySelectorAll("a, button")].some(
        (el) => getComputedStyle(el).backgroundColor === "rgb(242, 140, 29)",
      ),
    };
  });
  expect(drawn.loaded).toEqual(
    expect.arrayContaining(["Sora", "DM Sans", "JetBrains Mono"]),
  );
  expect(drawn.title).toMatch(/^Sora\b/);
  expect(drawn.text).toMatch(/^"DM Sans"/);
  expect(drawn.code).toMatch(/^"JetBrains Mono"/);
  // Off-white na página, navy no menu e o laranja da marca nos botões principais.
  expect(drawn.page).toBe("rgb(250, 248, 244)");
  expect(drawn.menu).toBe("rgb(21, 26, 45)");
  expect(drawn.brand).toBe(true);
});

test("nenhum emoji no texto das telas internas", async ({ page }) => {
  await login(page);
  const found: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await settle(page);
    const text = await page.locator("body").innerText();
    const hit = EMOJI.exec(text);
    if (hit) found.push(`${path}: ${hit[0]}`);
  }
  expect(found).toEqual([]);
});
