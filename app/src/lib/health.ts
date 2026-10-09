export type Health = {
  ok: true;
  service: "hub-gestao";
  version: string;
  time: string;
};

/**
 * Monta a resposta de /api/health. A versão vem de APP_VERSION, que o pipeline
 * preenche com o SHA do commit publicado; localmente vale "local".
 */
export function buildHealth(
  env: Record<string, string | undefined>,
  now: Date,
): Health {
  const version = env.APP_VERSION?.trim();
  return {
    ok: true,
    service: "hub-gestao",
    version: version ? version : "local",
    time: now.toISOString(),
  };
}
