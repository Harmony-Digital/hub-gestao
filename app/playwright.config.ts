import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta (pasta `e2e/`), no `next dev` com o banco local (PGlite), o login
 * de teste e o projeto de exemplo EXE. No CI, sobe um servidor novo com um banco vazio; no
 * computador, reaproveita o servidor que já estiver na porta (o preview do app Claude usa
 * a 3100), porque o `next dev` não sobe duas vezes na mesma pasta.
 */

const PORT = Number(process.env.HUB_E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  // Um navegador por vez: os testes gravam no mesmo banco local.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // O `next dev` compila cada tela na primeira visita, o que leva alguns segundos no CI.
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Larga o bastante para as cinco colunas do Quadro caberem sem rolar.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      HUB_DATA_DIR: ".data/e2e",
      HUB_DEV_LOGIN: "on",
      HUB_DEV_LOGIN_SECRET: randomBytes(32).toString("hex"),
      HUB_DEV_SAMPLE: "on",
      HUB_API_KEY_PEPPER: randomBytes(32).toString("hex"),
      // Concierge com o modelo simulado (nenhum provedor é chamado no CI).
      HUB_DEV_FAKE_LLM: "on",
      HUB_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    },
  },
});
